/**
 * Surface-PMSM in the rotor (dq) reference frame — the shared physics for both
 * sibling demos (pmsm-torque, pmsm-speed). Two plants are built on top of this
 * file; the model itself is the field-oriented machine.
 *
 * dq voltage equations (Park frame, ω_e = p·ω_m electrical speed):
 *
 *   L_d·di_d/dt = v_d − R·i_d + ω_e·L_q·i_q
 *   L_q·di_q/dt = v_q − R·i_q − ω_e·(L_d·i_d + λ_m)
 *
 * Electromagnetic torque (SPM, L_d = L_q → no reluctance term):
 *
 *   T = (3/2)·p·λ_m·i_q = K_t·i_q
 *
 * Mechanical:  J·dω_m/dt = T − T_load − b·ω_m.
 *
 * The whole point of FOC: rotate the stator AC quantities into this frame and
 * they become DC. i_q is then a clean torque command and i_d a flux command —
 * each a first-order plant with pole R/L, the lesson of the torque demo.
 */

export const PMSM = {
  p: 4, // pole pairs
  R: 0.5, // Ω, stator phase resistance
  Ld: 2e-3, // H, d-axis inductance (= Lq for a surface PM rotor)
  Lq: 2e-3, // H, q-axis inductance
  lambdaM: 0.022, // Wb, rotor flux linkage (PM)
  J: 5e-4, // kg·m², rotor + dyno inertia
  b: 2e-4, // N·m·s/rad, viscous friction
  Vdc: 80, // V, DC-bus voltage (see headroom note in index.ts)
  Imax: 10, // A, rated current (per-axis command clamp)
} as const

/** Torque constant K_t = (3/2)·p·λ_m, so T = K_t·i_q (N·m/A). ≈ 0.132. */
export const Kt = 1.5 * PMSM.p * PMSM.lambdaM

/**
 * Peak phase voltage available from the inverter with space-vector PWM:
 * V_max = V_dc/√3. The current loops must keep |v_dq| under this — at speed
 * the back-EMF ω_e·λ_m eats most of it (verified in index.ts headroom note).
 */
export const vMax = (vdc: number) => vdc / Math.sqrt(3)

/** Electrical time constant τ_e = L/R and pole 1/τ_e = R/L (rad/s). ≈250. */
export const tauE = PMSM.Ld / PMSM.R
export const elecPole = PMSM.R / PMSM.Ld // rad/s

/** Mechanical pole b/J (rad/s). ≈0.4. */
export const mechPole = PMSM.b / PMSM.J

/* ------------------------------------------------------------------ *
 *  Clarke / Park transforms — used by the scene to reconstruct the    *
 *  three physical phase currents i_a,i_b,i_c from the dq state and the *
 *  rotor angle, so the winding-glow animation is the real machine.    *
 * ------------------------------------------------------------------ */

/**
 * Inverse Park: (i_d, i_q) in the rotor frame → (i_α, i_β) in the stator
 * stationary frame, given electrical angle θ_e.
 *   i_α = i_d·cosθ − i_q·sinθ
 *   i_β = i_d·sinθ + i_q·cosθ
 */
export function invPark(id: number, iq: number, thetaE: number): [number, number] {
  const c = Math.cos(thetaE)
  const s = Math.sin(thetaE)
  return [id * c - iq * s, id * s + iq * c]
}

/**
 * Inverse Clarke (amplitude-invariant): (i_α, i_β) → three phase currents.
 *   i_a = i_α
 *   i_b = −½·i_α + (√3/2)·i_β
 *   i_c = −½·i_α − (√3/2)·i_β
 */
export function invClarke(alpha: number, beta: number): [number, number, number] {
  const ia = alpha
  const ib = -0.5 * alpha + (Math.sqrt(3) / 2) * beta
  const ic = -0.5 * alpha - (Math.sqrt(3) / 2) * beta
  return [ia, ib, ic]
}

/** Convenience: dq + θ_e → the three physical phase currents (A). */
export function phaseCurrents(
  id: number,
  iq: number,
  thetaE: number,
): [number, number, number] {
  const [a, b] = invPark(id, iq, thetaE)
  return invClarke(a, b)
}

/** Forward Clarke + Park, completeness/teaching twin of the inverse above. */
export function clarkePark(
  ia: number,
  ib: number,
  ic: number,
  thetaE: number,
): { id: number; iq: number } {
  // amplitude-invariant Clarke
  const alpha = (2 / 3) * (ia - 0.5 * ib - 0.5 * ic)
  const beta = (2 / 3) * ((Math.sqrt(3) / 2) * ib - (Math.sqrt(3) / 2) * ic)
  const c = Math.cos(thetaE)
  const s = Math.sin(thetaE)
  return { id: alpha * c + beta * s, iq: -alpha * s + beta * c }
}

/** rpm ↔ mechanical rad/s. */
export const RPM_PER_RADS = 60 / (2 * Math.PI)
export const rpmToRads = (rpm: number) => rpm / RPM_PER_RADS
export const radsToRpm = (w: number) => w * RPM_PER_RADS
