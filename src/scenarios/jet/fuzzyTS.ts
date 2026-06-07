/**
 * Takagi–Sugeno (T-S) fuzzy controller for the jet — pure logic, no DOM.
 * Shares its fuzzifier and 5×5 antecedent structure with the Mamdani FLC
 * (fuzzy.ts: same five triangular MFs, same min-AND firing). The ONLY thing
 * that differs is the consequent and how the output is formed:
 *
 *   Mamdani: each rule points at an output FUZZY SET; aggregate + defuzzify
 *            (centroid) → one crisp value.
 *   T-S    : each rule (i,j) carries a LOCAL LINEAR CONTROLLER
 *               u_ij = a_ij · E + b_ij · Ė     (first-order consequent)
 *            and the output is their firing-weighted AVERAGE — NO
 *            defuzzification step at all:
 *               U = Σ_ij w_ij · u_ij / Σ_ij w_ij ,   w_ij = min(μ_E i, μ_Ė j)
 *            then U is clamped and mapped u% = 50 + ku·U·50 like the other laws.
 *
 * The lesson: T-S INTERPOLATES between local linear controllers — gain
 * scheduling, formalized. If every cell holds the SAME (a,b), the weighted
 * average collapses to U = a·E + b·Ė exactly: a single linear PD law. So
 * fuzzy ↔ linear is a continuum, and the "uniformity" slider slides along it.
 *
 * LOCAL-GAIN SCHEDULE (fixed, well-designed; the slider reshapes it):
 *   a base PD slope (a0,b0) = (−1,−1) — matched to the Mamdani surface's
 *   centre slope and to the jet-pid PD gains — is scaled per cell by a factor
 *   that grows toward the corners, so big upsets get MORE aggressive local
 *   gains (like Mamdani's saturating surface, but achieved by stronger local
 *   slopes rather than clipping). `uniformity ∈ [0,1]` blends that schedule
 *   toward the flat (all-equal) table:
 *     a_ij = a0 · ((1−uniformity)·s_ij + uniformity),   s_ij = 1 + GAIN_SPREAD·d_ij
 *   where d_ij = (|i−2| + |j−2|)/4 ∈ [0,1] is the normalized Chebyshev-ish
 *   distance from the centre cell. uniformity = 1 → every a_ij = a0 (pure PD);
 *   uniformity = 0 → full corner-boosted schedule.
 *
 * The airframe's negative control power lives in the SIGN of (a0,b0): a
 * positive error (nose low) yields a negative U (u < 50% → nose up), exactly
 * as in the Mamdani table and the jet-pid law.
 */

import { CENTERS, fuzzifyAntecedents, type Antecedents } from './fuzzy'

/** Base local PD slopes at the degenerate (uniform) table — matched to the
 *  Mamdani centre slope and the jet-pid PD. Negative: airframe sign. */
export const A0 = -1
export const B0 = -1

/** How much stronger the corner local gains are than the centre at
 *  uniformity = 0 (s ranges 1 → 1+GAIN_SPREAD across the table). Tuned to
 *  0.6: enough corner boost to visibly bend the surface away from the flat PD
 *  plane, but gentle enough that the default flies every upset (incl. ±15°
 *  steps) without the over-driven ringing a larger spread causes. */
export const GAIN_SPREAD = 0.6

/** Normalized distance of cell (i,j) from the centre cell (2,2), ∈ [0,1]. */
export function cellDistance(i: number, j: number): number {
  return (Math.abs(i - 2) + Math.abs(j - 2)) / 4
}

/** Per-cell gain-scale factor s_ij(uniformity). uniformity=1 ⇒ all 1. */
export function gainScale(i: number, j: number, uniformity: number): number {
  const u = Math.min(1, Math.max(0, uniformity))
  const s = 1 + GAIN_SPREAD * cellDistance(i, j)
  return (1 - u) * s + u
}

/** Local (a_ij, b_ij) for cell (i,j) at this uniformity. */
export function localGains(i: number, j: number, uniformity: number): { a: number; b: number } {
  const s = gainScale(i, j, uniformity)
  return { a: A0 * s, b: B0 * s }
}

export interface TSEval extends Antecedents {
  /** Local consequent value u_ij = a_ij·E + b_ij·Ė per cell, [5][5]. */
  uLocal: number[][]
  /** Per-cell (a,b) at the current uniformity, for the Local-gains tab. */
  aTab: number[][]
  bTab: number[][]
  /** Weighted-average normalized output U ∈ [−1,1] (NO defuzzification). */
  U: number
  /** True when every cell holds the same (a,b) — the controller IS a PD law. */
  degenerate: boolean
}

/**
 * Full T-S evaluation of the normalized inputs at the given table uniformity.
 * Returns every intermediate so the analysis tabs can show the local-gain
 * table with live firing and the blended surface.
 */
export function evalTS(E: number, Edot: number, uniformity: number): TSEval {
  const ante = fuzzifyAntecedents(E, Edot)
  const uLocal: number[][] = Array.from({ length: 5 }, () => new Array(5).fill(0))
  const aTab: number[][] = Array.from({ length: 5 }, () => new Array(5).fill(0))
  const bTab: number[][] = Array.from({ length: 5 }, () => new Array(5).fill(0))
  let num = 0
  let den = 0
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const { a, b } = localGains(i, j, uniformity)
      aTab[i][j] = a
      bTab[i][j] = b
      const u = a * E + b * Edot
      uLocal[i][j] = u
      const w = ante.fire[i][j]
      num += w * u
      den += w
    }
  }
  // Σw can be ~0 only if both inputs sit exactly between sets with zero overlap,
  // which the triangular partition prevents (memberships sum to 1) — but guard.
  // Do NOT clamp U here: at uniformity=1 the weighted average must stay EXACTLY
  // a·E + b·Ė (the PD law) so the degenerate=PD lesson is exact. The controller
  // clamps ku·U to ±1 before the 50%-offset mapping; the surface view clamps
  // only for colour. (At the ±1 corners the raw PD value reaches ±2.)
  const U = den > 1e-9 ? num / den : 0
  return { ...ante, uLocal, aTab, bTab, U, degenerate: uniformity >= 0.999 }
}

/** Sample the normalized T-S control surface U(E,Ė) on an n×n grid over
 *  [−1,1]² — same axes/scale as the Mamdani surface for side-by-side compare. */
export function tsSurface(n: number, uniformity: number): number[][] {
  const grid: number[][] = []
  for (let r = 0; r < n; r++) {
    const Edot = -1 + (2 * r) / (n - 1)
    const row: number[] = []
    for (let c = 0; c < n; c++) {
      const E = -1 + (2 * c) / (n - 1)
      row.push(evalTS(E, Edot, uniformity).U)
    }
    grid.push(row)
  }
  return grid
}

/**
 * Stateful T-S controller matching the def's create(). Same derivative-on-
 * measurement filter and 50%-offset output mapping as the Mamdani FuzzyController
 * (shared convention) — only the inference core differs.
 */
export class TSController {
  private yPrev = NaN
  private dFilt = 0
  last: TSEval = evalTS(0, 0, 0)

  reset() {
    this.yPrev = NaN
    this.dFilt = 0
    this.last = evalTS(0, 0, 0)
  }

  /** One update. p: { ke, kde, ku, uniformity, wf }. Returns saturated 0–100. */
  update(sp: number, y: number, dt: number, p: Record<string, number>): number {
    const ke = p.ke ?? 0
    const kde = p.kde ?? 0
    const ku = p.ku ?? 0
    const uniformity = p.uniformity ?? 0
    const wf = p.wf || 8

    const e = sp - y
    let edot = 0
    if (Number.isFinite(this.yPrev)) {
      const raw = -(y - this.yPrev) / dt // ė = −ẏ for constant sp
      const tf = 1 / wf
      this.dFilt += ((raw - this.dFilt) * dt) / Math.max(tf, dt)
      edot = this.dFilt
    }
    this.yPrev = y

    const E = Math.min(1, Math.max(-1, ke * e))
    const Edot = Math.min(1, Math.max(-1, kde * edot))
    const ev = evalTS(E, Edot, uniformity)
    this.last = ev

    const U = Math.min(1, Math.max(-1, ku * ev.U))
    const u = 50 + U * 50
    return Math.min(100, Math.max(0, u))
  }
}

// re-export for the tabs/theory that import the universe centres alongside T-S
export { CENTERS }
