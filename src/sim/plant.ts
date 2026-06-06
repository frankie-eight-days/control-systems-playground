/** Disturbance / operating-condition inputs, plant-specific keys. */
export type Disturbances = Record<string, number>

/**
 * Every plant is a continuous-time ODE:  ẋ = f(x, u, d)
 * with a scalar actuator command u (always in %, 0–100) and a scalar
 * sensor output y in physical units.
 */
export interface Plant<D extends Disturbances = Disturbances> {
  /** State derivative ẋ = f(x, u, d). Must be pure (no mutation). */
  deriv(x: number[], u: number, d: D): number[]
  /** Sensor measurement y = g(x). */
  output(x: number[]): number
  /** Equilibrium (x₀, u₀) that holds output y — linearization point. */
  equilibrium(y: number, d: D): { x: number[]; u: number }
}
