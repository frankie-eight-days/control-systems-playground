import type { Plant } from '../../sim/plant'

/**
 * Switching-cycle-averaged synchronous buck converter, voltage mode.
 *
 *   L·di_L/dt = (u/100)·V_in − v_o − DCR·i_L
 *   C·dv_C/dt = i_L − i_o
 *   v_o       = v_C + ESR·(i_L − i_o)        (cap current through its ESR)
 *
 * States x = [i_L (A), v_C (V)]; output y = v_o. The model is the duty-cycle
 * AVERAGE: dt = 0.5 µs is an integration step, not a switching period, so there
 * is no ripple. Synchronous rectification (two FETs) means i_L may go
 * negative — the averaged model stays valid at light load (no DCM mode).
 *
 * Disturbances: io (load current, A — a current-source load, so it adds NO
 * damping), vin (input rail, V), esr (output-cap ESR, Ω — the slider that
 * moves the famous ESR zero, the star of this scenario).
 */
export interface BuckDisturbances extends Record<string, number> {
  io: number
  vin: number
  esr: number
}

export const BUCK = {
  L: 22e-6, // H
  DCR: 0.02, // Ω, inductor copper
  C: 470e-6, // F
} as const

export class BuckPlant implements Plant<BuckDisturbances> {
  /**
   * v_o = v_C + ESR·(i_L − i_o) needs the live disturbances, but the Plant
   * contract's output(x) doesn't carry them — so deriv() caches the last d
   * it saw. The engine calls deriv with the live d every step, and
   * linearize() perturbs deriv (same fixed d) before output, so the cached
   * value is always the one the caller is working with.
   */
  private d: BuckDisturbances = { io: 2, vin: 12, esr: 0.05 }

  vout(x: number[], d: BuckDisturbances): number {
    return x[1] + d.esr * (x[0] - d.io)
  }

  deriv(x: number[], u: number, d: BuckDisturbances): number[] {
    this.d = d
    const duty = Math.min(100, Math.max(0, u)) / 100
    const vo = this.vout(x, d)
    return [
      (duty * d.vin - vo - BUCK.DCR * x[0]) / BUCK.L, // di_L/dt
      (x[0] - d.io) / BUCK.C, // dv_C/dt
    ]
  }

  output(x: number[]): number {
    return this.vout(x, this.d)
  }

  /** At equilibrium i_L = i_o, v_C = v_o, duty = (v_o + DCR·i_o)/V_in. */
  equilibrium(vo: number, d: BuckDisturbances): { x: number[]; u: number } {
    return {
      x: [d.io, vo],
      u: Math.min(100, Math.max(0, (100 * (vo + BUCK.DCR * d.io)) / d.vin)),
    }
  }
}

export const buckPlant = new BuckPlant()

/** LC corner f₀ = 1/(2π√LC) ≈ 1.565 kHz. */
export const f0Hz = () => 1 / (2 * Math.PI * Math.sqrt(BUCK.L * BUCK.C))
/** ESR zero f_z = 1/(2π·ESR·C): ≈6.8 kHz at 50 mΩ, ≈68 kHz at 5 mΩ. */
export const esrZeroHz = (esr: number) => 1 / (2 * Math.PI * esr * BUCK.C)
/** Resonance Q = √(L/C)/(DCR+ESR) — only series resistance damps the tank. */
export const qFactor = (esr: number) =>
  Math.sqrt(BUCK.L / BUCK.C) / (BUCK.DCR + esr)
