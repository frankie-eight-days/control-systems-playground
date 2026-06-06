import type { Plant } from '../../sim/plant'

/**
 * Espresso-boiler FOPDT plant with 2nd-order Padé dead time.
 *
 * Governing ODE (continuous time):
 *
 *   C_th · Ṫ = P_delayed − k_eff · (T − T_amb)
 *
 * where P_delayed = (p2_norm / 100) · P_max  is the heater power passed
 * through the Padé dead-time approximation of θ = 3 s.
 *
 * Dead-time realisation — 2nd-order Padé on the INPUT u:
 *
 *   e^{-θs} ≈ N(s)/D(s)    N = 1 − θs/2 + (θs)²/12
 *                            D = 1 + θs/2 + (θs)²/12
 *
 * Controllable-canonical-form state-space for N/D with input r = u/100 · Pmax:
 *
 *   Let a = θ/2, b = θ²/12  (so  D = 1 + a·s + b·s² in ascending powers).
 *   Divide top & bottom by b:
 *
 *     D' = 1/b + (a/b)·s + s²   → coefficients: [c0, c1] = [1/b, a/b]
 *     N' =  "same" with sign flips on odd powers (all-pass property)
 *
 *   Controllable canonical form:  [ṗ1, ṗ2] = [p2, −c0·p1 − c1·p2 + r/b]
 *   Output of Padé block: p_out = r − a·ṗ_in_terms + … (numerator evaluation)
 *     = r + (N(s) − D(s))/D(s) · r = [1 − 2a·s·D⁻¹(s)] · r
 *
 * Concretely with θ = 3 s  →  a = 1.5, b = 0.75, c0 = 1/b, c1 = a/b:
 *
 *   ṗ1 = p2
 *   ṗ2 = −(1/b)·p1 − (a/b)·p2 + (1/b)·(u_norm)   where u_norm = u/100
 *
 * Output of Padé block (u_norm delayed):
 *   p_out_norm = u_norm − 2a · ṗ2  (via bilinear transform identity)
 *
 * In practice: we evaluate p_out_norm from the states directly by noting
 * that the Padé output is the numerator evaluated at the state:
 *   p_out_norm = p1 · c0 + p2 · c1 + u_norm
 *   (with the cancellation that results in the all-pass shape — see note)
 *
 * NOTE: For numerical correctness we use the direct form:
 *   p_out_norm = p1 · (c0) + p2 · (c1) + u_norm
 * but with sign adjustment so that the dc gain of the Padé block is exactly 1.
 * Verified: at steady state ṗ1=ṗ2=0 → 0 = -c0·p1 - c1·p2 + u_norm/b ... wait
 * that's not right. Let's re-derive carefully:
 *
 * Correct controllable canonical form for  Y/U = N(s)/D(s):
 *
 *   N(s) = n0 + n1·s + n2·s²   n0=1, n1=−a, n2=b   (note: same b)
 *   D(s) = d0 + d1·s + d2·s²   d0=1, d1= a, d2=b
 *
 *   Internal state q: D(s)·Q = U  (make the denominator states)
 *   ṡtate equations: [q̇1] = [    0       1  ][q1]   [  0   ]
 *                    [q̇2]   [-d0/d2  -d1/d2][q2] + [1/d2  ]·u
 *
 *   Output: y = n0·q1 + n1·q2 + n2·q̇2
 *            = n0·q1 + n1·q2 + n2·((-d0/d2)·q1 + (-d1/d2)·q2 + u/d2)
 *            = (n0 - n2·d0/d2)·q1 + (n1 - n2·d1/d2)·q2 + (n2/d2)·u
 *
 * With d2=b, d0=1, d1=a, n0=1, n1=-a, n2=b:
 *   A = [0, 1; -1/b, -a/b]
 *   B_col = [0; 1/b]
 *   output coeff: c_q1 = (1 - b·(1/b)) = 0
 *                 c_q2 = (-a - b·(a/b)) = -2a
 *                 c_u  = (b/b) = 1
 *
 * So:  p_out_norm = 0·p1 + (−2a)·p2 + 1·u_norm
 *                 = u_norm − 2a·p2
 *
 * At dc (s=0): p2=0 (at steady state with ṗ2=0: 0 = -c0·p1 + u_norm/b  →
 *   p1 = u_norm·b/d0/d2 = u_norm; p2 = 0)
 *   p_out_norm = u_norm − 0 = u_norm  ✓  (dc gain = 1)
 *
 * States: x = [T (°C), p1, p2]
 * Output: y = T (°C)
 * Input:  u ∈ [0,100] % heater command
 *
 * Disturbances: d.tamb (°C), d.lossMult (k multiplier)
 */

export interface ThermalDisturbances extends Record<string, number> {
  /** Ambient temperature, °C. */
  tamb: number
  /** Loss multiplier (1 = nominal lid on, >1 = lid open / more losses). */
  lossMult: number
}

export const THERMAL = {
  /** Thermal capacitance, J/K. */
  Cth: 800,
  /** Nominal thermal conductance, W/K. */
  kNom: 5,
  /** Max heater power, W. */
  Pmax: 1500,
  /** Dead time, s. */
  theta: 3,
  /** Nominal DC gain K = Pmax/100/kNom, °C/%. */
  K: 3, // 1500/100/5 = 3
  /** Nominal time constant τ = Cth/kNom, s. */
  tau: 160, // 800/5 = 160
} as const

// Padé parameters (θ = 3 s, 2nd order)
// D(s) = 1 + a·s + b·s²  with a = θ/2 = 1.5, b = θ²/12 = 0.75
const PADE_A = THERMAL.theta / 2 // 1.5
const PADE_B = (THERMAL.theta * THERMAL.theta) / 12 // 0.75

export class ThermalPlant implements Plant<ThermalDisturbances> {
  /**
   * State derivative:  ẋ = [Ṫ, ṗ1, ṗ2]
   *
   * ṗ1 = p2
   * ṗ2 = −(1/b)·p1 − (a/b)·p2 + (1/b)·u_norm
   *
   * p_out_norm = u_norm − 2a·p2    (Padé output, see derivation above)
   *
   * Ṫ = (p_out_norm · Pmax − k_eff · (T − T_amb)) / C_th
   */
  deriv(x: number[], u: number, d: ThermalDisturbances): number[] {
    const [T, p1, p2] = x
    const kEff = THERMAL.kNom * Math.max(1, d.lossMult ?? 1)
    const tamb = d.tamb ?? 22
    const uNorm = Math.min(1, Math.max(0, u / 100))

    // Padé state derivatives
    const invB = 1 / PADE_B // 1/0.75 ≈ 1.333
    const p1dot = p2
    const p2dot = -invB * p1 - (PADE_A / PADE_B) * p2 + invB * uNorm

    // Padé output: delayed u (in [0,1] range)
    const pOutNorm = uNorm - 2 * PADE_A * p2

    // Boiler ODE
    const Tdot = (pOutNorm * THERMAL.Pmax - kEff * (T - tamb)) / THERMAL.Cth

    return [Tdot, p1dot, p2dot]
  }

  output(x: number[]): number {
    // Clamp to physical range
    return Math.min(200, Math.max(-20, x[0]))
  }

  /**
   * Equilibrium: T = y, Padé at steady-state pass-through (p1=u_norm, p2=0),
   * u = k_eff · (y − T_amb) / P_max × 100.
   * At dc: p_out_norm = u_norm (dc gain of Padé = 1), so steady P = u_norm·Pmax.
   * Steady state: P_ss = k_eff·(T-T_amb)  →  u_norm = k_eff·(T-T_amb)/Pmax.
   * Padé states at dc: p1 = u_norm, p2 = 0 (from ṗ1=ṗ2=0 solving the A matrix).
   */
  equilibrium(y: number, d: ThermalDisturbances): { x: number[]; u: number } {
    const kEff = THERMAL.kNom * Math.max(1, d.lossMult ?? 1)
    const tamb = d.tamb ?? 22
    const T = Math.min(200, Math.max(tamb + 0.1, y))
    const uNorm = Math.min(1, Math.max(0, (kEff * (T - tamb)) / THERMAL.Pmax))
    const u = uNorm * 100
    // Padé steady-state: p2=0, p1=u_norm (from solving A·[p1,p2]' = -B·u_norm, dc)
    return { x: [T, uNorm, 0], u }
  }

  /**
   * Effective FOPDT parameters at the current operating point (lossMult changes k).
   * K = Pmax / (100 · k_eff)  [°C/%]
   * τ = Cth / k_eff            [s]
   * θ = 3 s  (fixed dead time)
   */
  fopdt(lossMult: number): { K: number; tau: number; theta: number } {
    const kEff = THERMAL.kNom * Math.max(1, lossMult)
    return {
      K: THERMAL.Pmax / 100 / kEff,
      tau: THERMAL.Cth / kEff,
      theta: THERMAL.theta,
    }
  }
}

export const thermalPlant = new ThermalPlant()
