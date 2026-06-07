import type { Plant } from '../../sim/plant'

/**
 * Ball & beam — the undergrad-lab classic.
 *
 * A solid sphere rolls without slipping on a beam that is tilted by a servo.
 * States: x = [p (m), v (m/s), theta (rad)]
 *   p_dot   = v
 *   v_dot   = -(5/7) g sin(theta) + tilt_bias        (rolling-sphere dynamics)
 *   theta_dot = (theta_cmd - theta) / tau_servo       (first-order servo lag)
 *
 * The 5/7 factor comes from energy partitioning for a solid sphere:
 *   J = (2/5)mr^2  ->  effective translational acceleration = (m/(m+J/r^2)) g sin(theta)
 *                                                            = (m/(m + 2m/5)) g sin(theta)
 *                                                            = (5/7) g sin(theta)
 * (see theory panel for the derivation).
 *
 * ACTUATOR MAPPING (same unipolar-offset convention as the motor scenario):
 *   theta_cmd = ((u - 50) / 50) * THETA_MAX
 * u = 50% => zero tilt command (beam horizontal at equilibrium).
 * u = 100% => +THETA_MAX tilt; u = 0% => -THETA_MAX tilt.
 *
 * Sign convention: positive theta tilts the beam so the ball accelerates
 * toward NEGATIVE p (ball at p=0, theta>0 => ball rolls left).
 *
 * Output: y = p * 100  (centimetres, for display).
 *
 * Disturbances:
 *   d.tilt  (deg) -- mounting bias added to theta at every step (beam not level).
 *                    Makes P-only drift toward the edge: steady-state-error lesson.
 *
 * Failure: |p| > BEAM_HALF  (0.35 m). The engine keeps integrating but the
 * plant enforces v_dot = 0 and v = 0 once past the edge so the state freezes;
 * the scene draws the "BALL OFF" overlay and reset recovers.
 */
export interface BallBeamDisturbances extends Record<string, number> {
  tilt: number  // deg, beam mounting bias
}

export const BB = {
  g: 9.81,           // m/s^2
  tauServo: 0.1,     // s  (servo lag; pole at -1/tau = -10 rad/s)
  thetaMax: 15 * (Math.PI / 180),  // rad, max beam tilt = 15 deg
  beamHalf: 0.35,    // m, beam half-length (failure threshold)
  rollFactor: 5 / 7, // solid sphere: J=2mr^2/5 => 5/7 factor
  deg2rad: Math.PI / 180,
  rad2deg: 180 / Math.PI,
  cm2m: 0.01,
  m2cm: 100,
} as const

/** Beam tilt command (rad) from the 0-100% unipolar command. */
export function thetaCmdFromU(u: number): number {
  const uc = Math.min(100, Math.max(0, u))
  return ((uc - 50) / 50) * BB.thetaMax
}

/** True when ball has left the beam. */
export function ballOff(p: number): boolean {
  return Math.abs(p) > BB.beamHalf
}

export class BallBeamPlant implements Plant<BallBeamDisturbances> {
  deriv(x: number[], u: number, d: BallBeamDisturbances): number[] {
    const [p, v, theta] = x
    const tiltBiasRad = (d.tilt ?? 0) * BB.deg2rad
    const thetaCmd = thetaCmdFromU(u)

    // If ball is off the beam: freeze dynamics (no forces, no servo)
    if (ballOff(p)) {
      return [0, 0, 0]
    }

    const thetaEff = theta + tiltBiasRad  // effective tilt including mounting bias
    const vDot = -BB.rollFactor * BB.g * Math.sin(thetaEff)
    const thetaDot = (thetaCmd - theta) / BB.tauServo

    return [v, vDot, thetaDot]
  }

  output(x: number[]): number {
    // Ball position in centimetres
    return x[0] * BB.m2cm
  }

  /**
   * Equilibrium: ball stationary at position y (cm), beam horizontal.
   * At equilibrium theta = 0 (no tilt needed when ball is still with no bias
   * and no friction). The command u = 50% gives theta_cmd = 0.
   * With a non-zero tilt bias a true equilibrium doesn't exist (the ball
   * drifts) — but for the linearisation point we still use theta = 0, u = 50%.
   */
  equilibrium(y: number, _d: BallBeamDisturbances): { x: number[]; u: number } {
    const p = Math.max(-BB.beamHalf, Math.min(BB.beamHalf, y * BB.cm2m))
    return { x: [p, 0, 0], u: 50 }
  }
}

export const ballbeamPlant = new BallBeamPlant()
