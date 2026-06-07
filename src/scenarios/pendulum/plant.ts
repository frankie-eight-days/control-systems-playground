import type { Plant } from '../../sim/plant'

/**
 * Cart-pole (inverted pendulum on a cart) — THE boss-fight plant: open-loop
 * unstable, stabilization about upright only (swing-up is explicitly out of
 * scope; see the theory panel roadmap note).
 *
 * Frictionless pivot, viscous cart damping b. Point-mass pole (massless rod of
 * half-length l to the bob). φ is measured from UPRIGHT (φ=0 straight up),
 * φ>0 leans toward +x. Full nonlinear equations (Lagrangian, verified):
 *
 *   den = M + m·sin²φ
 *   ẍ  = [ F − b·ẋ + m·l·φ̇²·sinφ − m·g·sinφ·cosφ ] / den
 *   φ̈  = [ −(F − b·ẋ)·cosφ + (M+m)·g·sinφ − m·l·φ̇²·sinφ·cosφ ] / (l·den)
 *
 * States: x = [x (m), ẋ (m/s), φ (rad), φ̇ (rad/s)].  Output: y = φ·180/π (°).
 *
 * ACTUATOR (motor-style unipolar 50% trim, exactly the spec form):
 *   F = ((u − 50)/50)·F_max,   u = 50% ⇒ F = 0 (no push).
 * The control effectiveness onto the pole is NEGATIVE (∂φ̈/∂F < 0: shoving the
 * cart +x tips the pole −φ — you move the cart UNDER the falling pole). The
 * pendulum's own PID therefore carries a sign flip (see controllers.tsx); this
 * is the same situation as the jet's M_δ<0 and is documented there.
 *
 * Disturbance: nudge (N) — a constant horizontal bias force on the cart. With
 * angle-only feedback the cart position is a free integrator, so a steady nudge
 * makes the cart march off to a rail end — the SISO lesson the user can steer.
 */
export interface PendulumDisturbances extends Record<string, number> {
  /** Constant cart-bias force, N (steers the uncontrolled cart drift). */
  nudge: number
}

export const CART = {
  M: 0.5, // kg   — cart mass
  m: 0.2, // kg   — pole (bob) mass
  l: 0.6, // m    — pivot→CoM (pole half-length)
  b: 0.1, // N·s/m — viscous cart damping
  g: 9.81,
  Fmax: 10, // N  — peak actuator force at u = 0 or 100%
  track: 2.0, // m — |x| limit (rail half-length): beyond ⇒ HIT TRACK END
  fallen: 30, // ° — |φ| beyond which the pole has FALLEN
  deg2rad: Math.PI / 180,
  rad2deg: 180 / Math.PI,
} as const

/** Bidirectional cart force (N) from the 0–100% unipolar command. */
export function forceFromU(u: number): number {
  return ((Math.min(100, Math.max(0, u)) - 50) / 50) * CART.Fmax
}

export class PendulumPlant implements Plant<PendulumDisturbances> {
  deriv(x: number[], u: number, d: PendulumDisturbances): number[] {
    const [xpos, xd, phi, phid] = x
    // FAILURE LATCH: once the pole has fallen (|φ|>30°) or the cart has hit a
    // rail end (|x|≥track), freeze the state (zero derivative) so the scene can
    // flag it and hold the frozen pose until Reset. This is physics-as-limit,
    // like the tank rim — past the boundary nothing moves.
    if (Math.abs(phi) > CART.fallen * CART.deg2rad || Math.abs(xpos) >= CART.track) {
      return [0, 0, 0, 0]
    }
    const F = forceFromU(u) + (d.nudge ?? 0)
    const { M, m, l, b, g } = CART
    const sin = Math.sin(phi)
    const cos = Math.cos(phi)
    const den = M + m * sin * sin
    const Feff = F - b * xd
    const xdd = (Feff + m * l * phid * phid * sin - m * g * sin * cos) / den
    const phidd = (-Feff * cos + (M + m) * g * sin - m * l * phid * phid * sin * cos) / (l * den)
    return [xd, xdd, phid, phidd]
  }

  /** y = pole angle from upright, in degrees. */
  output(x: number[]): number {
    return x[2] * CART.rad2deg
  }

  /**
   * Upright equilibrium holding y (≈0°): φ = y, all rates 0, x = 0, F = 0 ⇒
   * u = 50% (trim). The cart position is a FREE integrator at this equilibrium
   * (no x term in any restoring law) — that pole-at-the-origin is the whole
   * SISO-limitation lesson, surfaced in the live eigenvalue readout.
   */
  equilibrium(y: number, _d: PendulumDisturbances): { x: number[]; u: number } {
    return { x: [0, 0, y * CART.deg2rad, 0], u: 50 }
  }
}

export const pendulumPlant = new PendulumPlant()
