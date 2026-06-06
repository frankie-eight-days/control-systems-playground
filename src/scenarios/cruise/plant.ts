import type { Plant } from '../../sim/plant'

/**
 * Longitudinal vehicle dynamics for cruise control.
 *
 *   m·v̇ = F_traction − F_aero − F_roll − F_grade
 *
 *   F_traction = (u/100) · F_max           (0 ≤ u ≤ 100, no braking)
 *   F_aero     = ½·ρ·CdA·(v + wind)·|v + wind|   (headwind+ convention)
 *   F_roll     = μ·m·g                     (constant rolling resistance)
 *   F_grade    = m·g·(grade/100)           (positive = uphill)
 *
 * State: x = [v  (m/s)].  Output: y = v·3.6  (km/h).
 *
 * Deliberate physics lesson: there are NO brakes, so u is clamped at 0.
 * On a downhill grade the controller can only coast — it cannot correct
 * overspeed. This asymmetric actuation limit is shown in the scene and theory.
 */

export interface CruiseDisturbances extends Record<string, number> {
  /** Road grade in percent; positive = uphill (adds resistance). */
  grade: number
  /** Headwind in m/s; positive = into the car (adds aerodynamic load). */
  wind: number
}

export const CAR = {
  mass: 1500,          // kg
  fMax: 4000,          // N   traction force at u = 100%
  rho: 1.2,            // kg/m³  air density
  cdA: 0.7,            // m²  drag area (Cd × frontal area)
  mu: 0.012,           // —   rolling-resistance coefficient
  g: 9.81,             // m/s²
} as const

/** Aerodynamic drag for vehicle speed v (m/s) and headwind w (m/s). */
export function aeroDrag(v: number, wind: number): number {
  const vRel = v + wind
  return 0.5 * CAR.rho * CAR.cdA * vRel * Math.abs(vRel)
}

/** Rolling resistance (speed-independent in this model). */
export function rollDrag(): number {
  return CAR.mu * CAR.mass * CAR.g
}

/** Grade force (positive = opposes motion going uphill). */
export function gradeDrag(grade: number): number {
  return CAR.mass * CAR.g * (grade / 100)
}

export class CruisePlant implements Plant<CruiseDisturbances> {
  deriv(x: number[], u: number, d: CruiseDisturbances): number[] {
    const v = Math.max(0, x[0]) // speed cannot be negative (stopped)
    const uSat = Math.min(100, Math.max(0, u)) // no braking: u ≥ 0
    const fTraction = (uSat / 100) * CAR.fMax
    const fAero = aeroDrag(v, d.wind ?? 0)
    const fRoll = rollDrag()
    const fGrade = gradeDrag(d.grade ?? 0)
    const vDot = (fTraction - fAero - fRoll - fGrade) / CAR.mass
    // Clamp: car doesn't roll backward
    return [v <= 0 && vDot < 0 ? 0 : vDot]
  }

  output(x: number[]): number {
    // Convert m/s → km/h for display
    return Math.max(0, x[0]) * 3.6
  }

  equilibrium(y: number, d: CruiseDisturbances): { x: number[]; u: number } {
    const v = Math.max(0, y / 3.6) // km/h → m/s
    const fResist = aeroDrag(v, d.wind ?? 0) + rollDrag() + gradeDrag(d.grade ?? 0)
    const uEq = (fResist / CAR.fMax) * 100
    return {
      x: [v],
      u: Math.min(100, Math.max(0, uEq)),
    }
  }

  /** Total resistive force in N at given state / disturbance (for the aux chart). */
  resistiveForce(x: number[], d: CruiseDisturbances): number {
    const v = Math.max(0, x[0])
    return aeroDrag(v, d.wind ?? 0) + rollDrag() + gradeDrag(d.grade ?? 0)
  }
}

export const cruisePlant = new CruisePlant()
