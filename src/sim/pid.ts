/**
 * Real-world parallel-form PID:
 *
 *   u = Kp·e + Ki·∫e dt − Kd · d(y_f)/dt
 *
 * - Derivative acts on the MEASUREMENT (not error) → no derivative kick on
 *   setpoint steps. Filtered with a first-order lag, time constant τf = 1/ωf,
 *   discretized backward-Euler:  D(s) = −Kd·s / (τf·s + 1) acting on y.
 * - Output saturated to [uMin, uMax]; anti-windup by back-calculation:
 *   the integrator is driven toward consistency with the saturated output
 *   through tracking time constant Tt.
 *
 * The frequency-domain twin of this exact structure lives in
 * analysis/freq.ts (pidResponse) — keep them in sync.
 */
export interface PidTerms {
  p: number
  i: number
  d: number
}

export class PID {
  kp = 0
  ki = 0
  kd = 0
  /** Derivative filter cutoff ωf in rad/s (τf = 1/ωf). */
  wf = 10
  uMin = 0
  uMax = 100
  /** Anti-windup tracking time constant, s. */
  tt = 1.0

  private integ = 0
  private dTerm = 0
  private yPrev: number | null = null
  /** Last computed term contributions, for the theory panel / charts. */
  terms: PidTerms = { p: 0, i: 0, d: 0 }

  setGains(kp: number, ki: number, kd: number, wf: number) {
    this.kp = kp
    this.ki = ki
    this.kd = kd
    this.wf = wf
  }

  reset() {
    this.integ = 0
    this.dTerm = 0
    this.yPrev = null
    this.terms = { p: 0, i: 0, d: 0 }
  }

  /** One controller update. Returns the SATURATED actuator command. */
  update(setpoint: number, y: number, dt: number): number {
    const e = setpoint - y

    // Filtered derivative on measurement (backward Euler):
    //   d_k = (τf·d_{k−1} + Kd·(y_{k−1} − y_k)) / (τf + dt)
    const tf = 1 / this.wf
    const d =
      this.yPrev === null ? 0 : (tf * this.dTerm + this.kd * (this.yPrev - y)) / (tf + dt)
    this.dTerm = d
    this.yPrev = y

    const p = this.kp * e
    const uRaw = p + this.integ + d
    const uSat = Math.min(this.uMax, Math.max(this.uMin, uRaw))

    // Integrate with back-calculation anti-windup. With Ki = 0 the user
    // expects pure P/PD — keep the integrator dead instead of letting the
    // back-calculation term turn it into a hidden state.
    if (this.ki > 0) {
      this.integ += this.ki * e * dt + ((uSat - uRaw) * dt) / this.tt
    } else {
      this.integ = 0
    }

    this.terms = { p, i: this.integ, d }
    return uSat
  }
}
