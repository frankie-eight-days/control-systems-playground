import type { Plant } from '../../sim/plant'
import { Kt, PMSM, RPM_PER_RADS } from './model'

/**
 * DEMO 2 — the cascade made real: outer speed loop around the inner current
 * loop. The crucial modeling step, and the whole lesson of this demo:
 *
 *   THE TORQUE DEMO'S CLOSED CURRENT LOOP IS THIS DEMO'S ACTUATOR.
 *
 * A well-tuned current loop (the pole-zero-cancellation preset of demo 1) is
 * first-order with a fast time constant; we model it as a single lag τ_i:
 *
 *   di_q/dt = (i_q* − i_q)/τ_i,     τ_i = 0.3 ms  (≈ 1/(2π·530 Hz))
 *   J·dω_m/dt = K_t·i_q − T_load − b·ω_m
 *
 * States x = [i_q (A), ω_m (rad/s)].  Output y = ω_m·(60/2π) (rpm).
 *
 * ACTUATOR: the outer loop commands a torque current, again via the unipolar
 * servo offset:
 *   i_q* = ((u − 50)/50)·I_max        u=50% ⇒ 0 A, u=100% ⇒ +I_max
 *
 * Disturbances: tload (load torque N·m), jmult (inertia multiplier — the
 * flywheel; multiplies J in BOTH the derivative and the equilibrium so the
 * linearization stays consistent).
 */
export interface SpeedDisturbances extends Record<string, number> {
  tload: number
  jmult: number
}

/** Inner current-loop equivalent lag (s) — the closed torque loop of demo 1. */
export const TAU_I = 0.3e-3

/** i_q* (A) from the 0–100% command. */
export function iqStarFromU(u: number): number {
  return ((Math.min(100, Math.max(0, u)) - 50) / 50) * PMSM.Imax
}

export class SpeedPlant implements Plant<SpeedDisturbances> {
  deriv(x: number[], u: number, d: SpeedDisturbances): number[] {
    const [iq, wm] = x
    const J = PMSM.J * (d.jmult ?? 1)
    const iqStar = iqStarFromU(u)
    // Inner loop clamps its own current command to the drive's rating.
    const iqStarSat = Math.min(PMSM.Imax, Math.max(-PMSM.Imax, iqStar))
    const diq = (iqStarSat - iq) / TAU_I
    const dwm = (Kt * iq - (d.tload ?? 0) - PMSM.b * wm) / J
    return [diq, dwm]
  }

  /** y = mechanical speed in rpm. */
  output(x: number[]): number {
    return x[1] * RPM_PER_RADS
  }

  /**
   * Equilibrium holding speed y (rpm) against load + friction:
   *   ω_m = y·(2π/60),  i_q = (b·ω_m + T_load)/K_t  → u = 50 + 50·i_q/I_max.
   * jmult does not enter here (steady state is inertia-independent) but DOES
   * scale the linearized mechanical pole b/(J·jmult) — see theory.tsx.
   */
  equilibrium(y: number, d: SpeedDisturbances): { x: number[]; u: number } {
    const wm = y / RPM_PER_RADS
    const iq = (PMSM.b * wm + (d.tload ?? 0)) / Kt
    const u = 50 + (50 * iq) / PMSM.Imax
    return { x: [iq, wm], u: Math.min(100, Math.max(0, u)) }
  }
}

export const speedPlant = new SpeedPlant()
