import type { Plant } from '../../sim/plant'

/**
 * Magnetic levitation — a steel ball held under an electromagnet. The
 * EE-flavoured unstable classic, and the FASTEST plant in the app.
 *
 *   m·z̈ = m·g − C·i²/z²            (gravity down; magnet force pulls UP, ∝ i²/z²)
 *   τ_coil·i̇ = i_cmd − i            (coil current lags the command, first-order)
 *
 * z = air gap, measured DOWN from the magnet face (positive, metres). The ball
 * hangs BELOW the magnet, so a larger z is further away and a weaker pull —
 * that geometry is the whole instability: drift up (z↓) and the force grows,
 * pulling it up harder; drift down (z↑) and the force weakens, dropping it. The
 * magnet can only ever PULL (i² ≥ 0): the actuator is UNIPOLAR, and gravity is
 * the only "down". States x = [z (m), ż (m/s), i (A)]. Output y = z in mm.
 *
 * INSTABILITY (derived in the theory panel, and it's beautiful): linearising
 * z̈ = g − (C/m)·i²/z² about an equilibrium (z₀, i₀) where (C/m)·i₀²/z₀² = g,
 *   ∂z̈/∂z = +2(C/m)·i₀²/z₀³ = +2g/z₀,
 * so the gap subsystem is z̈ = (2g/z₀)·Δz → poles s = ±√(2g/z₀). The unstable
 * pole λ = +√(2g/z₀) depends ONLY on g and the gap — independent of m, C, i₀.
 * At z₀ = 15 mm, λ = +36.2 rad/s (time-to-double ≈ 19 ms). The third pole is
 * the coil at −1/τ_coil = −50 rad/s. The unstable pole MOVES WITH THE SETPOINT
 * (the operating point IS the commanded gap) — the tank's √h lesson, unstable
 * edition: tune at one gap, command another, and the pole walks out from under
 * your gains.
 *
 * FAILURE STATES (terminal, like the jet's departure): the ball slams to the
 * magnet (z ≤ z_stuck) or falls away (z ≥ z_drop). The plant clamps z at those
 * bounds (zeroing the inward velocity so RK4 stays physical); the scene detects
 * the terminal gap, freezes the sim, and flags STUCK / DROPPED until Reset.
 */
export interface MaglevDisturbances extends Record<string, number> {
  /** Ball-mass multiplier (swap the ball): actual mass = m·mass. */
  mass: number
  /** Coil supply-voltage fraction (authority sag): i_cmd scaled by vSupply. */
  vSupply: number
}

export const MAGLEV = {
  m: 0.05, // kg     — nominal ball mass
  g: 9.81, // m/s²
  z0: 0.015, // m    — design equilibrium gap (15 mm), where i₀ = 0.8 A
  i0: 0.8, // A      — design equilibrium current at z0
  iMax: 2.0, // A    — coil current at u = 100%
  tauCoil: 0.02, // s — coil time constant (1/τ = 50 rad/s pole)
  zStuck: 0.002, // m — ≤ this ⇒ STUCK TO MAGNET
  zDrop: 0.04, // m   — ≥ this ⇒ DROPPED
  // C from the design point: m·g = C·i₀²/z₀²  ⇒  C = m·g·z₀²/i₀².
  C: (0.05 * 9.81 * 0.015 * 0.015) / (0.8 * 0.8), // ≈ 1.724e-4 N·m²/A²
} as const

/** Unstable-pole magnitude at gap z: λ = √(2g/z) (g and gap only). rad/s. */
export function rhpPole(z: number): number {
  return Math.sqrt((2 * MAGLEV.g) / Math.max(1e-4, z))
}

/** Equilibrium coil current to hold gap z with mass multiplier `mass`:
 *  m·g = C·i²/z² ⇒ i = √(m·g·z²/C) = i₀·(z/z₀)·√mass. */
export function currentForGap(z: number, mass = 1): number {
  return Math.sqrt((MAGLEV.m * mass * MAGLEV.g * z * z) / MAGLEV.C)
}

/** Coil command current from the 0–100% unipolar command (× supply sag). */
export function iCmdFromU(u: number, vSupply = 1): number {
  const uc = Math.min(100, Math.max(0, u))
  return (uc / 100) * MAGLEV.iMax * vSupply
}

export class MaglevPlant implements Plant<MaglevDisturbances> {
  deriv(x: number[], u: number, d: MaglevDisturbances): number[] {
    const [z, zdot, i] = x
    const mass = MAGLEV.m * (d.mass ?? 1)
    const vSupply = d.vSupply ?? 1

    // Magnet force F = C·i²/z² (always ≥ 0 — UNIPOLAR pull). Guard z→0.
    const zSafe = Math.max(MAGLEV.zStuck * 0.5, z)
    const Fmag = (MAGLEV.C * i * i) / (zSafe * zSafe)
    // z̈ = g − F/m   (z increases DOWNWARD, so gravity is +, magnet pull is −)
    let zddot = MAGLEV.g - Fmag / mass

    // Hard physical limits: ball can't pass the magnet face or the floor.
    // Zero the boundary-crossing acceleration AND velocity so the integrator
    // rests against the stop instead of tunnelling (the scene freezes there).
    let zd = zdot
    if (z <= MAGLEV.zStuck && zddot < 0) {
      zddot = 0
      if (zd < 0) zd = 0
    }
    if (z >= MAGLEV.zDrop && zddot > 0) {
      zddot = 0
      if (zd > 0) zd = 0
    }

    const iCmd = iCmdFromU(u, vSupply)
    const idot = (iCmd - i) / MAGLEV.tauCoil
    return [zd, zddot, idot]
  }

  output(x: number[]): number {
    // Air gap in mm, clamped to the physical travel.
    const zmm = x[0] * 1000
    return Math.min(MAGLEV.zDrop * 1000, Math.max(MAGLEV.zStuck * 1000, zmm))
  }

  /**
   * Equilibrium holding gap y (mm): ż = 0, z̈ = 0 ⇒ the magnet exactly cancels
   * gravity. i₀ = √(m·mass·g·z²/C); u₀ = i₀ / (i_max·vSupply) · 100. The coil
   * state sits at i₀. Heavier ball or sagging supply ⇒ more % command.
   */
  equilibrium(y: number, d: MaglevDisturbances): { x: number[]; u: number } {
    const z = Math.min(MAGLEV.zDrop, Math.max(MAGLEV.zStuck, y / 1000))
    const mass = d.mass ?? 1
    const vSupply = d.vSupply ?? 1
    const i0 = currentForGap(z, mass)
    const u = Math.min(100, Math.max(0, (i0 / (MAGLEV.iMax * Math.max(0.1, vSupply))) * 100))
    return { x: [z, 0, i0], u }
  }
}

export const maglevPlant = new MaglevPlant()
