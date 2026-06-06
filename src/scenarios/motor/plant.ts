import type { Plant } from '../../sim/plant'

/**
 * DC position servo — near-double integrator.
 *
 *   J·ω̇ = τ_m − b·ω − τ_load
 *   θ̇  = ω
 *
 * States: x = [θ (rad), ω (rad/s)].  Output: y = θ·(180/π) (degrees).
 *
 * ACTUATOR MAPPING (unipolar PWM + H-bridge offset):
 *   τ_m = ((u − 50) / 50) · τmax
 * So u = 50% ⇒ zero torque, u = 100% ⇒ +τmax, u = 0% ⇒ −τmax.
 * This is how real unipolar-only drives work: the 50% quiescent point
 * acts as the zero of a bidirectional torque command.
 *
 * Disturbances: d.load (N·m) — constant load torque (someone leaning on shaft).
 * Impulses: ω += Δω (velocity kick — "whack").
 */
export interface MotorDisturbances extends Record<string, number> {
  load: number
}

export const MOTOR = {
  J: 0.01,        // kg·m²  — rotor inertia
  b: 0.002,       // N·m·s/rad — viscous friction
  tauMax: 0.5,    // N·m   — peak torque at u = 0% or u = 100%
  deg2rad: Math.PI / 180,
  rad2deg: 180 / Math.PI,
} as const

/** Bidirectional torque from the 0–100% unipolar command. */
export function tauFromU(u: number): number {
  return ((u - 50) / 50) * MOTOR.tauMax
}

export class MotorPlant implements Plant<MotorDisturbances> {
  deriv(x: number[], u: number, d: MotorDisturbances): number[] {
    const [_theta, omega] = x
    const uClamped = Math.min(100, Math.max(0, u))
    const tauM = tauFromU(uClamped)
    const load = d.load ?? 0
    // J·ω̇ = τ_m − b·ω − τ_load
    const omegaDot = (tauM - MOTOR.b * omega - load) / MOTOR.J
    // θ̇ = ω
    return [omega, omegaDot]
  }

  output(x: number[]): number {
    // Return angle in degrees for display
    return x[0] * MOTOR.rad2deg
  }

  equilibrium(y: number, d: MotorDisturbances): { x: number[]; u: number } {
    const theta = y * MOTOR.deg2rad
    const omega = 0
    const load = d.load ?? 0
    // At equilibrium: τ_m = τ_load  →  ((u−50)/50)·τmax = load
    const uRaw = 50 + 50 * (load / MOTOR.tauMax)
    const u = Math.min(100, Math.max(0, uRaw))
    return { x: [theta, omega], u }
  }
}

export const motorPlant = new MotorPlant()
