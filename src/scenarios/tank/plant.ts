import type { Plant } from '../../sim/plant'

/**
 * Gravity-drained water tank with a lagged pump.
 *
 *   A_t · ḣ = q_in − C_d · a_v · √(2 g h)      (Torricelli outflow)
 *   τ_p · q̇_in = (u/100) · Q_max − q_in        (pump first-order lag)
 *
 * States: x = [h (m), q_in (m³/s)].  Output: y = h.
 * Disturbances: d.valve ∈ [0,1] — drain valve opening (a_v = valve · a_max).
 *
 * Deliberately nonlinear: the √h term means the linearized pole (and so the
 * "right" PID gains) move with the operating level — a core lesson.
 */
export interface TankDisturbances extends Record<string, number> {
  valve: number
}

export const TANK = {
  area: 0.5, // m² cross-section
  height: 2.0, // m
  qMax: 0.05, // m³/s pump flow at u = 100%
  pumpTau: 1.0, // s pump lag
  cd: 0.62, // discharge coefficient
  aOrificeMax: 0.012, // m² orifice at valve fully open
  g: 9.81,
} as const

export class TankPlant implements Plant<TankDisturbances> {
  deriv(x: number[], u: number, d: TankDisturbances): number[] {
    const [h, qIn] = x
    const aEff = TANK.cd * TANK.aOrificeMax * Math.min(1, Math.max(0, d.valve))
    const qOut = aEff * Math.sqrt(2 * TANK.g * Math.max(h, 0))
    const uClamped = Math.min(100, Math.max(0, u))
    // Hard tank limits: no inflow effect once brim-full (overflow spills),
    // no outflow once empty. Keeps RK4 inside physical bounds.
    let hdot = (qIn - qOut) / TANK.area
    if (h >= TANK.height && hdot > 0) hdot = 0
    if (h <= 0 && hdot < 0) hdot = 0
    return [
      hdot,
      ((uClamped / 100) * TANK.qMax - qIn) / TANK.pumpTau, // q̇_in
    ]
  }

  output(x: number[]): number {
    return Math.min(TANK.height, Math.max(0, x[0]))
  }

  equilibrium(y: number, d: TankDisturbances): { x: number[]; u: number } {
    const h = Math.min(TANK.height, Math.max(0, y))
    const aEff = TANK.cd * TANK.aOrificeMax * Math.min(1, Math.max(0, d.valve))
    const qOut = aEff * Math.sqrt(2 * TANK.g * h)
    return { x: [h, qOut], u: Math.min(100, (qOut / TANK.qMax) * 100) }
  }

  /** Steady outflow at level h — used by the scene and theory panel. */
  outflow(h: number, valve: number): number {
    const aEff = TANK.cd * TANK.aOrificeMax * Math.min(1, Math.max(0, valve))
    return aEff * Math.sqrt(2 * TANK.g * Math.max(h, 0))
  }
}

export const tankPlant = new TankPlant()
