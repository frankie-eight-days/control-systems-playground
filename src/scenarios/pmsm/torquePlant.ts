import type { Plant } from '../../sim/plant'
import { Kt, PMSM, rpmToRads, vMax } from './model'

/**
 * DEMO 1 — the PMSM current loop on a dynamometer.
 *
 * The dyno IMPOSES the mechanical speed (it's a bench brake), so ω_m is a
 * disturbance, NOT a state — exactly how a torque-control loop is tested in
 * the lab. The plant is the dq current dynamics at that fixed speed:
 *
 *   L_d·di_d/dt = v_d − R·i_d + ω_e·L_q·i_q
 *   L_q·di_q/dt = v_q − R·i_q − ω_e·(L_d·i_d + λ_m)
 *
 * States x = [i_d (A), i_q (A)].  Output y = T = K_t·i_q (N·m).
 * ω_e = p·ω_m, with ω_m set by the dyno-rpm disturbance.
 *
 * ACTUATOR (unipolar-PWM servo offset, the motor scenario's mapping):
 *   v_q = ((u − 50)/50)·V_max          u=50% ⇒ 0 V, u=100% ⇒ +V_max
 *   v_d = −decouple·ω_e·L_q·i_q         cross-coupling feedforward
 * With decouple = 1 the d-axis cancels the ω_e·L_q·i_q term and i_d stays at 0;
 * at decouple = 0 that speed-voltage shoves i_d off zero — the visible cost of
 * NOT decoupling (watch the i_d aux trace during the back-EMF ambush).
 *
 * Disturbances: dynoRpm (imposed speed), decouple (0..1 feedforward gain),
 * vdc (bus voltage — moves V_max, hence the actuator scaling and headroom).
 */
export interface TorqueDisturbances extends Record<string, number> {
  dynoRpm: number
  decouple: number
  vdc: number
}

/** v_q (volts) from the 0–100% command at the current bus voltage. */
export function vqFromU(u: number, vdc: number): number {
  return ((Math.min(100, Math.max(0, u)) - 50) / 50) * vMax(vdc)
}

export class TorquePlant implements Plant<TorqueDisturbances> {
  deriv(x: number[], u: number, d: TorqueDisturbances): number[] {
    const [id, iq] = x
    const wm = rpmToRads(d.dynoRpm ?? 0)
    const we = PMSM.p * wm
    const vdc = d.vdc ?? PMSM.Vdc

    const vq = vqFromU(u, vdc)
    // Decoupling feedforward on the d-axis (decouple ∈ [0,1]).
    const vd = -(d.decouple ?? 1) * we * PMSM.Lq * iq

    // Saturate the applied voltage vector to the inverter hexagon (≈ circle of
    // radius V_max) — physics, like the tank rim. Above V_max the loop simply
    // can't push harder; this is what limits torque at high speed.
    const vm = vMax(vdc)
    const vmag = Math.hypot(vd, vq)
    let vdS = vd
    let vqS = vq
    if (vmag > vm && vmag > 0) {
      const k = vm / vmag
      vdS = vd * k
      vqS = vq * k
    }

    const didt = (vdS - PMSM.R * id + we * PMSM.Lq * iq) / PMSM.Ld
    const diqt = (vqS - PMSM.R * iq - we * (PMSM.Ld * id + PMSM.lambdaM)) / PMSM.Lq
    return [didt, diqt]
  }

  /** y = electromagnetic torque T = K_t·i_q. */
  output(x: number[]): number {
    return Kt * x[1]
  }

  /**
   * Equilibrium holding torque T at the imposed speed:
   *   i_q = T/K_t,
   *   v_q = R·i_q + ω_e·λ_m + ω_e·L_d·i_d  → u = 50 + 50·v_q/V_max.
   * The d-axis settles where R·i_d = (1−decouple)·ω_e·L_q·i_q (the part of the
   * speed-voltage the feedforward did NOT cancel): with full decoupling i_d=0
   * (MTPA), and the residual grows as decouple→0 — the exact linearization
   * point so the Bode tracks the sim even with the decoupler turned down.
   */
  equilibrium(y: number, d: TorqueDisturbances): { x: number[]; u: number } {
    const wm = rpmToRads(d.dynoRpm ?? 0)
    const we = PMSM.p * wm
    const vdc = d.vdc ?? PMSM.Vdc
    const decouple = d.decouple ?? 1
    const iq = y / Kt
    const id = ((1 - decouple) * we * PMSM.Lq * iq) / PMSM.R
    const vq = PMSM.R * iq + we * (PMSM.Ld * id + PMSM.lambdaM)
    const u = 50 + (50 * vq) / vMax(vdc)
    return { x: [id, iq], u: Math.min(100, Math.max(0, u)) }
  }
}

export const torquePlant = new TorquePlant()
