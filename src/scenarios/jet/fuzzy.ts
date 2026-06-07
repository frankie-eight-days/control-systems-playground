/**
 * Mamdani fuzzy logic controller (FLC) — pure logic, no DOM. Shared by the
 * controller def (sim law) and the theory panel (live MF / rule / surface
 * visualization), so the picture you see is exactly the law that runs.
 *
 * Structure (textbook PD-type FLC):
 *   inputs  : e  = setpoint − y,  ė = filtered derivative of e
 *   scaling : E = clamp(ke·e, ±1),  Ė = clamp(kde·ė, ±1)   (normalize to ±1)
 *   fuzzify : 5 triangular MFs each over [−1,1] — NB NS ZE PS PB
 *   inference: 25-rule skew-symmetric table, min for AND, max-aggregation
 *   defuzzify: centroid over a 5-singleton output universe {−1,−.5,0,.5,1}
 *             (Mamdani with symmetric triangular output sets reduces exactly
 *              to this weighted average — same surface, far cheaper)
 *   output  : U = clamp(Σ wᵢ cᵢ / Σ wᵢ, ±1),  then u% = 50 + ku·U·50
 *
 * The normalized surface U(E,Ė) is a fixed nonlinear gain schedule; the
 * scaling gains ke, kde, ku stretch it onto the real plant — the standard way
 * an FLC is tuned. There is no C(s): the law is nonlinear, so the LTI Bode
 * tabs show an explainer and stability is demonstrated empirically.
 */

export const TERMS = ['NB', 'NS', 'ZE', 'PS', 'PB'] as const
export type Term = (typeof TERMS)[number]

/** Triangular MF centres on the normalized [−1,1] universe (shoulders at ±1). */
export const CENTERS = [-1, -0.5, 0, 0.5, 1] as const

/**
 * Membership of x in each of the 5 triangular sets. Triangles are 0.5 wide
 * (peak at its centre, zero at the neighbours); the two end sets saturate to 1
 * outside ±1 (shoulders), which is what makes large errors command full deflection.
 */
export function memberships(x: number): number[] {
  const mu = new Array(5).fill(0)
  for (let i = 0; i < 5; i++) {
    const c = CENTERS[i]
    let m = Math.max(0, 1 - Math.abs(x - c) / 0.5)
    // Shoulder saturation on the outer sets.
    if (i === 0 && x <= -1) m = 1
    if (i === 4 && x >= 1) m = 1
    mu[i] = m
  }
  return mu
}

/**
 * Skew-symmetric PD rule table, indexed [eTerm][edotTerm] → output term index
 * (output-set indices 0..4 = NB..PB). Read a row as a fixed e, columns
 * sweeping ė from NB→PB.
 *
 * Standard Macvicar-Whelan diagonal form, oriented for THIS airframe's sign:
 * the elevator has NEGATIVE control effectiveness (M_δ < 0 ⇒ a positive
 * deflection / u > 50% pitches the NOSE DOWN). A positive error e = θ_cmd − θ
 * (nose too low) must therefore command a NEGATIVE output (u < 50% → nose up),
 * so the surface slopes down as e+ė grow positive — antisymmetric through
 * ZE/ZE. (A conventional positive-gain plant would use the mirror table; the
 * airframe sets this one sign, exactly as M_δ's sign does in the ODE.)
 */
// prettier-ignore
export const RULES: number[][] = [
  //  ė: NB NS ZE PS PB     e =
  [    4, 4, 4, 3, 2 ], //  NB
  [    4, 4, 3, 2, 1 ], //  NS
  [    4, 3, 2, 1, 0 ], //  ZE
  [    3, 2, 1, 0, 0 ], //  PS
  [    2, 1, 0, 0, 0 ], //  PB
]

/** Shared antecedent stage: fuzzify both inputs and fire every (i,j) rule with
 *  the min-AND. Used by BOTH the Mamdani and the Takagi–Sugeno laws — the only
 *  thing that differs downstream is the consequent (output sets vs. local
 *  linear functions). Returns the membership vectors and the 5×5 firing grid. */
export interface Antecedents {
  E: number
  Edot: number
  muE: number[]
  muEdot: number[]
  /** Per-rule firing strength (min of the two antecedents), [5][5]. */
  fire: number[][]
}

export function fuzzifyAntecedents(E: number, Edot: number): Antecedents {
  const muE = memberships(E)
  const muEdot = memberships(Edot)
  const fire: number[][] = Array.from({ length: 5 }, () => new Array(5).fill(0))
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      fire[i][j] = Math.min(muE[i], muEdot[j]) // AND = min
    }
  }
  return { E, Edot, muE, muEdot, fire }
}

export interface FuzzyEval extends Antecedents {
  /** Aggregated weight on each output singleton, NB..PB. */
  outW: number[]
  /** Defuzzified normalized output U ∈ [−1,1]. */
  U: number
}

/**
 * Full Mamdani evaluation of the normalized inputs. `E`,`Edot` are the already
 * scaled-and-clamped crisp inputs. Shares the antecedent stage with T-S; the
 * Mamdani-specific part is the max-aggregation onto output singletons + centroid
 * defuzzification. Returns every intermediate for the live visualizations.
 */
export function evalFuzzy(E: number, Edot: number): FuzzyEval {
  const ante = fuzzifyAntecedents(E, Edot)
  const outW = new Array(5).fill(0)
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const out = RULES[i][j]
      if (ante.fire[i][j] > outW[out]) outW[out] = ante.fire[i][j] // aggregate = max
    }
  }
  let num = 0
  let den = 0
  for (let k = 0; k < 5; k++) {
    num += outW[k] * CENTERS[k]
    den += outW[k]
  }
  const U = den > 1e-9 ? num / den : 0
  return { ...ante, outW, U }
}

/** Sample the normalized control surface U(E,Ė) on an n×n grid over [−1,1]². */
export function controlSurface(n: number): number[][] {
  const grid: number[][] = []
  for (let r = 0; r < n; r++) {
    const Edot = -1 + (2 * r) / (n - 1)
    const row: number[] = []
    for (let cI = 0; cI < n; cI++) {
      const E = -1 + (2 * cI) / (n - 1)
      row.push(evalFuzzy(E, Edot).U)
    }
    grid.push(row)
  }
  return grid
}

/**
 * Stateful FLC matching the def's `create()`. Keeps the derivative filter
 * state. The derivative of the error is taken on the MEASUREMENT (like the
 * PID's derivative-on-measurement) and first-order low-pass filtered at ωf to
 * keep sensor noise from saturating Ė — documented in the theory panel.
 */
export class FuzzyController {
  private yPrev = NaN
  private dFilt = 0
  private lastU = 50
  /** Cached last evaluation, for the live theory visualization. */
  last: FuzzyEval = evalFuzzy(0, 0)

  reset() {
    this.yPrev = NaN
    this.dFilt = 0
    this.lastU = 50
    this.last = evalFuzzy(0, 0)
  }

  /**
   * One update. p: { ke, kde, ku, wf }. Returns saturated 0–100 command.
   * e = sp − y; ė is the filtered derivative of e. With a constant setpoint
   * ė = −ẏ, so this is derivative-on-measurement (no setpoint-step kick).
   */
  update(sp: number, y: number, dt: number, p: Record<string, number>): number {
    const ke = p.ke ?? 0
    const kde = p.kde ?? 0
    const ku = p.ku ?? 0
    const wf = p.wf || 8

    const e = sp - y
    // Filtered derivative of error. Δe/Δt from the measurement, then a
    // one-pole IIR at ωf:  dFilt += (raw − dFilt)·(dt/τf),  τf = 1/ωf.
    let edot = 0
    if (Number.isFinite(this.yPrev)) {
      const raw = (sp - y - (sp - this.yPrev)) / dt // = −(y − yPrev)/dt
      const tf = 1 / wf
      this.dFilt += ((raw - this.dFilt) * dt) / Math.max(tf, dt)
      edot = this.dFilt
    }
    this.yPrev = y

    const E = Math.min(1, Math.max(-1, ke * e))
    const Edot = Math.min(1, Math.max(-1, kde * edot))
    const ev = evalFuzzy(E, Edot)
    this.last = ev

    const U = Math.min(1, Math.max(-1, ku * ev.U))
    const u = 50 + U * 50 // map ±1 → 0..100, 50% = trim (elevator faired)
    this.lastU = Math.min(100, Math.max(0, u))
    return this.lastU
  }
}
