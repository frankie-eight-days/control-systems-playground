/**
 * Discrete Type II / Type III compensator core — pure logic, no UI.
 *
 * Continuous structure (corner frequencies in kHz, K_mod = 100 %/duty):
 *
 *   C(s) = 100 · (ω_I/s) · Π_i (1 + s/ω_zi)/(1 + s/ω_pi)
 *
 * Each factor is discretized backward-Euler at the caller's dt. The z-domain
 * transfer function of the difference equations below is EXACTLY the
 * continuous form evaluated at s_BE = (1 − z⁻¹)/dt — the same substitution
 * controllers.tsx uses for the Bode response, so the plotted C(e^{jωT}) is
 * the law running here, coefficient for coefficient.
 *
 * Anti-windup: back-calculation into the integrator — the only unbounded
 * state (the lead-lags are stable, unity-DC-gain filters of the bounded
 * error, so they cannot wind up).
 */

/**
 * The buck scenario's fixed integration step, seconds. This is the sample
 * period the BE difference equations actually run at — the engine passes
 * scn.dt into update() every step. controllers.tsx evaluates the exact
 * discrete frequency response at this same T (s_BE = (1 − e^{−jωT})/T), so the
 * Bode tabs describe the law that runs. MUST equal index.ts's `dt`; ideally
 * index.ts should set `dt: BUCK_T` to keep the two in lockstep.
 */
export const BUCK_T = 0.5e-6

/** Anti-windup tracking time constant, s (≈ a few crossover periods at 20 kHz). */
const TT = 1e-4

class LeadLag {
  private xPrev = 0
  private yPrev = 0

  reset() {
    this.xPrev = 0
    this.yPrev = 0
  }

  /** (1+s/ωz)/(1+s/ωp), backward Euler:
   *  y_k = [τp·y_{k−1} + (τz+dt)·x_k − τz·x_{k−1}] / (τp + dt) */
  step(x: number, dt: number, fzKHz: number, fpKHz: number): number {
    const tz = 1 / (2000 * Math.PI * Math.max(fzKHz, 1e-6))
    const tp = 1 / (2000 * Math.PI * Math.max(fpKHz, 1e-6))
    const y = (tp * this.yPrev + (tz + dt) * x - tz * this.xPrev) / (tp + dt)
    this.xPrev = x
    this.yPrev = y
    return y
  }
}

export class Compensator {
  private lls: LeadLag[]
  private integ = 0

  /** nSections = 1 → Type II, 2 → Type III. */
  constructor(nSections: 1 | 2) {
    this.lls = Array.from({ length: nSections }, () => new LeadLag())
  }

  reset() {
    this.integ = 0
    for (const ll of this.lls) ll.reset()
  }

  /**
   * One update: e → lead-lag section(s) → integrator (gain ω_I) → ×100 → sat.
   * `corners` = [fz, fp][] in kHz, one pair per section; fIKHz = integrator
   * unity-gain frequency in kHz. Returns the SATURATED duty command 0–100.
   */
  update(e: number, dt: number, fIKHz: number, corners: [number, number][]): number {
    let v = e
    for (let i = 0; i < this.lls.length; i++) {
      v = this.lls[i].step(v, dt, corners[i][0], corners[i][1])
    }
    this.integ += 2000 * Math.PI * fIKHz * dt * v // BE integrator, gain ω_I
    const uRaw = 100 * this.integ
    const uSat = Math.min(100, Math.max(0, uRaw))
    this.integ += ((uSat - uRaw) * dt) / (100 * TT) // back-calculation
    return uSat
  }
}
