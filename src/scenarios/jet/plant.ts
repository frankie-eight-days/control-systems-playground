import type { Plant } from '../../sim/plant'

/**
 * Relaxed-static-stability fighter — longitudinal short-period dynamics plus a
 * first-order elevator actuator. THE APP'S FIRST OPEN-LOOP-UNSTABLE PLANT.
 *
 *   α̇ = Z_v·α + q                          (vertical-velocity / lift relation)
 *   q̇ = Mα_eff·α + M_q·q + M_δ·δ           (pitching-moment balance)
 *   θ̇ = q                                   (pitch-attitude kinematics)
 *   δ̇ = (δ_cmd − δ)/τ_act                   (elevator servo, first-order lag)
 *
 * States: x = [α (rad), q (rad/s), θ (rad), δ (rad)].  Output: y = θ·180/π (°).
 *
 * Actuator (bidirectional surface from a 0–100% command, motor-style 50% trim):
 *   δ_cmd = ((u − 50)/50)·δmax,   u = 50% ⇒ δ_cmd = 0 (elevator faired).
 *
 * STATIC STABILITY comes from Mα_eff, set by the CG disturbance slider:
 *   Mα_eff(cg) = −4 + 16·cg     (fwd CG → negative/stable, aft CG → positive)
 * The [α, q] short-period block A_sp = [[Z_v, 1], [Mα_eff, M_q]] has
 *   det = Z_v·M_q − Mα_eff,   trace = Z_v + M_q = −2.2 (always).
 * A real pole reaches the RHP when det = 0 ⇒ Mα_eff = Z_v·M_q = +1.2 ⇒
 * cg = 0.325 (the DYNAMIC boundary). The classic static neutral point
 * (Mα_eff = 0) sits at cg = 0.25, but pitch damping (M_q) keeps the airframe
 * dynamically stable a little past it. Default cg = 0.75 ⇒ Mα_eff = +8 ⇒
 * short-period eigenvalues +1.73 / −3.93 rad/s (time-to-double ≈ 0.40 s).
 * The remaining two open-loop poles are the θ integrator at 0 and the actuator
 * at −1/τ_act = −20 rad/s.
 *
 * SOFT STALL (honestly simplified — no real post-stall aerodynamics): for
 * |α| > αstall the restoring/destabilising moment slope Mα_eff fades toward a
 * mild −2 and the lift slope Z_v is scaled down, both via a smooth sigmoid
 * over ~3°. Big upsets therefore "mush" past stall and become genuinely hard
 * to recover — the departure lesson.
 */
export interface JetDisturbances extends Record<string, number> {
  /** CG position 0 (fwd) → 1 (aft). Sets static stability via Mα_eff. */
  cg: number
  /** Steady vertical gust as an equivalent α bias, degrees. */
  gust: number
}

export const JET = {
  Zv: -1.2, // 1/s    — lift-curve / vertical-speed damping
  Mq: -1.0, // 1/s    — pitch-rate (aerodynamic) damping
  Mdelta: -20, // 1/s² — elevator control power (per rad of δ)
  tauAct: 0.05, // s   — elevator servo time constant (1/τ = 20 rad/s pole)
  dmax: 25 * (Math.PI / 180), // rad — elevator authority (±25°)
  alphaStall: 15 * (Math.PI / 180), // rad — soft-stall onset (±15°)
  stallWidth: 3 * (Math.PI / 180), // rad — sigmoid blend half-scale
  MaPostStall: -2, // 1/s² — faded slope deep in stall
  deg2rad: Math.PI / 180,
  rad2deg: 180 / Math.PI,
} as const

/** Static-stability derivative as a function of CG (fwd→aft, 0..1). */
export function MaOfCg(cg: number): number {
  return -4 + 16 * Math.min(1, Math.max(0, cg))
}

/** Bidirectional elevator command (rad) from the 0–100% unipolar command. */
export function deltaCmdFromU(u: number): number {
  const uc = Math.min(100, Math.max(0, u))
  return ((uc - 50) / 50) * JET.dmax
}

/**
 * Stall blend ∈ [0,1]: 0 below αstall, →1 once |α| is ~stallWidth past it.
 * Smooth (logistic) so the linearization stays well-defined and RK4 is happy.
 */
export function stallBlend(alpha: number): number {
  const over = (Math.abs(alpha) - JET.alphaStall) / JET.stallWidth
  return 1 / (1 + Math.exp(-over))
}

/** Effective Mα at this α: nominal Mα_eff(cg) faded toward MaPostStall in stall. */
export function MaEffective(alpha: number, cg: number): number {
  const s = stallBlend(alpha)
  return (1 - s) * MaOfCg(cg) + s * JET.MaPostStall
}

export class JetPlant implements Plant<JetDisturbances> {
  deriv(x: number[], u: number, d: JetDisturbances): number[] {
    const [alpha, q, , delta] = x
    const cg = d.cg ?? 0.75
    const gustRad = (d.gust ?? 0) * JET.deg2rad

    // Aero α includes the steady gust bias (a vertical gust looks like extra α).
    const alphaAero = alpha + gustRad
    const s = stallBlend(alphaAero)
    // Lift slope collapses past stall (scaled, never fully zero — keeps damping).
    const Zv = JET.Zv * (1 - 0.6 * s)
    const MaEff = MaEffective(alphaAero, cg)

    const deltaCmd = deltaCmdFromU(u)

    const alphaDot = Zv * alpha + q
    const qDot = MaEff * alphaAero + JET.Mq * q + JET.Mdelta * delta
    const thetaDot = q
    const deltaDot = (deltaCmd - delta) / JET.tauAct
    return [alphaDot, qDot, thetaDot, deltaDot]
  }

  output(x: number[]): number {
    // Pitch attitude θ in degrees.
    return x[2] * JET.rad2deg
  }

  /**
   * Trimmed straight-and-level flight holding θ = θ₀: α = 0, q = 0, δ = 0,
   * u = 50% (elevator faired). Simplification documented in the theory panel —
   * a real trim solves the moment balance for a nonzero (α_trim, δ_trim); here
   * the model is written in perturbation form about level flight, so the
   * trimmed equilibrium is the origin with a 50% quiescent command.
   */
  equilibrium(y: number, _d: JetDisturbances): { x: number[]; u: number } {
    const theta = y * JET.deg2rad
    return { x: [0, 0, theta, 0], u: 50 }
  }
}

export const jetPlant = new JetPlant()
