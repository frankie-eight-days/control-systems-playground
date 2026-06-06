import { cAbs, cAdd, cArg, cDiv, cMul, cSolve, cx, type Cx } from './complex'
import type { StateSpace } from './linearize'

/** Plant frequency response  G(jω) = C·(jωI − A)⁻¹·B. */
export function plantResponse(ss: StateSpace, w: number): Cx {
  const n = ss.B.length
  const M: Cx[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => cx(-ss.A[i][j], i === j ? w : 0)),
  )
  const v = cSolve(
    M,
    ss.B.map((b) => cx(b)),
  )
  let g = cx(0)
  for (let i = 0; i < n; i++) g = cAdd(g, cMul(cx(ss.C[i]), v[i]))
  return g
}

/** DC gain G(0) = −C·A⁻¹·B (real solve; ∞ for integrating plants). */
export function dcGain(ss: StateSpace): number {
  const n = ss.B.length
  const M: Cx[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => cx(-ss.A[i][j])),
  )
  // Singular A (integrating plant) → elimination produces non-finite values.
  const v = cSolve(
    M,
    ss.B.map((b) => cx(b)),
  )
  let g = 0
  for (let i = 0; i < n; i++) g += ss.C[i] * v[i].re
  return Number.isFinite(g) ? g : Infinity
}

export interface Margins {
  /** Gain-crossover frequency (|L| = 1), rad/s. Null if no crossover. */
  wgc: number | null
  /** Phase margin at wgc, degrees. */
  pm: number | null
  /** Phase-crossover frequency (∠L = −180°), rad/s. */
  wpc: number | null
  /** Gain margin at wpc, dB. */
  gmDb: number | null
}

/** Closed-loop summary figures. */
export interface ClosedLoopStats {
  /** −3 dB closed-loop bandwidth of T, rad/s. Null if |T| never reaches −3 dB. */
  wBw: number | null
  /** Peak |T| in dB (resonant peaking — grows as PM shrinks). */
  mtDb: number
  /** Peak |S| in dB (worst-case disturbance amplification). */
  msDb: number
}

/** One labeled component curve of the controller (for the C-anatomy tab). */
export interface PartCurve {
  label: string
  color: string
  magDb: (number | null)[]
}

/**
 * Full frequency-response family over one log-ω sweep:
 *   G  — plant (linearized)             C  — controller, with component parts
 *   L  = C·G  open loop  →  margins     T  = L/(1+L)  closed loop (r → y)
 *   S  = 1/(1+L)  sensitivity (output disturbance → y)
 * In dB the buck-converter intuition holds exactly: |L| = |C| + |G|.
 */
export interface FreqAnalysis {
  w: number[]
  gMagDb: number[]
  gPhaseDeg: number[]
  cMagDb: number[]
  cParts: PartCurve[]
  lMagDb: number[]
  lPhaseDeg: number[]
  tMagDb: number[]
  sMagDb: number[]
  margins: Margins
  closed: ClosedLoopStats
}

const db = (mag: number) => Math.max(-200, 20 * Math.log10(Math.max(mag, 1e-12)))

export function freqAnalysis(
  ss: StateSpace,
  /** Controller response C(jω) — any LTI law (PID, Type II/III, ...). */
  response: (w: number) => Cx,
  /** Component decomposition |part(jω)| in absolute magnitude (null = off). */
  parts: { label: string; color: string; mag: (w: number) => number | null }[],
  wMin = 1e-4,
  wMax = 1e3,
  nPoints = 600,
): FreqAnalysis {
  const w: number[] = []
  const gMagDb: number[] = []
  const gPhaseDeg: number[] = []
  const cMagDb: number[] = []
  const cParts: PartCurve[] = parts.map((p) => ({ label: p.label, color: p.color, magDb: [] }))
  const lMagDb: number[] = []
  const lPhaseDeg: number[] = []
  const tMagDb: number[] = []
  const sMagDb: number[] = []

  const logMin = Math.log10(wMin)
  const logMax = Math.log10(wMax)
  const one = cx(1)

  for (let i = 0; i < nPoints; i++) {
    const wi = 10 ** (logMin + ((logMax - logMin) * i) / (nPoints - 1))
    const G = plantResponse(ss, wi)
    const C = response(wi)
    const L = cMul(G, C)
    const onePlusL = cAdd(one, L)
    const T = cDiv(L, onePlusL)
    const S = cDiv(one, onePlusL)

    w.push(wi)
    gMagDb.push(db(cAbs(G)))
    gPhaseDeg.push((cArg(G) * 180) / Math.PI)
    cMagDb.push(db(cAbs(C)))
    for (let k = 0; k < parts.length; k++) {
      const m = parts[k].mag(wi)
      cParts[k].magDb.push(m == null ? null : db(m))
    }
    lMagDb.push(db(cAbs(L)))
    lPhaseDeg.push((cArg(L) * 180) / Math.PI)
    tMagDb.push(db(cAbs(T)))
    sMagDb.push(db(cAbs(S)))
  }

  unwrap(lPhaseDeg)
  unwrap(gPhaseDeg)

  return {
    w,
    gMagDb,
    gPhaseDeg,
    cMagDb,
    cParts,
    lMagDb,
    lPhaseDeg,
    tMagDb,
    sMagDb,
    margins: findMargins(w, lMagDb, lPhaseDeg),
    closed: closedStats(w, tMagDb, sMagDb),
  }
}

/** Remove ±360° jumps from atan2 branch cuts. */
function unwrap(phaseDeg: number[]) {
  for (let i = 1; i < phaseDeg.length; i++) {
    while (phaseDeg[i] - phaseDeg[i - 1] > 180) phaseDeg[i] -= 360
    while (phaseDeg[i] - phaseDeg[i - 1] < -180) phaseDeg[i] += 360
  }
}

function closedStats(w: number[], tMagDb: number[], sMagDb: number[]): ClosedLoopStats {
  let mtDb = -Infinity
  let msDb = -Infinity
  for (let i = 0; i < w.length; i++) {
    if (tMagDb[i] > mtDb) mtDb = tMagDb[i]
    if (sMagDb[i] > msDb) msDb = sMagDb[i]
  }
  // Bandwidth: last downward crossing of −3 dB (T may dip then peak first).
  let wBw: number | null = null
  for (let i = 0; i < w.length - 1; i++) {
    if (tMagDb[i] >= -3 && tMagDb[i + 1] < -3) {
      const frac = (tMagDb[i] + 3) / (tMagDb[i] - tMagDb[i + 1])
      wBw = 10 ** (Math.log10(w[i]) + (Math.log10(w[i + 1]) - Math.log10(w[i])) * frac)
    }
  }
  return { wBw, mtDb, msDb }
}

function findMargins(w: number[], magDb: number[], phaseDeg: number[]): Margins {
  // Interpolate in log-ω at a sign change of `f` between samples i and i+1.
  const crossings = (f: number[]): { wi: number; frac: number }[] => {
    const out: { wi: number; frac: number }[] = []
    for (let i = 0; i < f.length - 1; i++) {
      if ((f[i] > 0 && f[i + 1] <= 0) || (f[i] <= 0 && f[i + 1] > 0)) {
        out.push({ wi: i, frac: f[i] / (f[i] - f[i + 1]) })
      }
    }
    return out
  }
  const interp = (arr: number[], c: { wi: number; frac: number }) =>
    arr[c.wi] + (arr[c.wi + 1] - arr[c.wi]) * c.frac
  const interpW = (c: { wi: number; frac: number }) =>
    10 ** (Math.log10(w[c.wi]) + (Math.log10(w[c.wi + 1]) - Math.log10(w[c.wi])) * c.frac)

  // Phase margin: at |L| = 1 crossings, PM = 180° + ∠L. Report the worst.
  let pm: number | null = null
  let wgc: number | null = null
  for (const c of crossings(magDb)) {
    const pmHere = 180 + interp(phaseDeg, c)
    if (pm === null || Math.abs(pmHere) < Math.abs(pm)) {
      pm = pmHere
      wgc = interpW(c)
    }
  }

  // Gain margin: at ∠L = −180° crossings, GM = −|L|dB. Report the worst.
  let gmDb: number | null = null
  let wpc: number | null = null
  for (const c of crossings(phaseDeg.map((p) => p + 180))) {
    const gmHere = -interp(magDb, c)
    if (gmDb === null || gmHere < gmDb) {
      gmDb = gmHere
      wpc = interpW(c)
    }
  }

  return { wgc, pm, wpc, gmDb }
}

/** Eigenvalues of a 2×2 A matrix — the linearized plant poles, for display. */
export function poles2(A: number[][]): { re: number; im: number }[] {
  if (A.length !== 2) return []
  const tr = A[0][0] + A[1][1]
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0]
  const disc = tr * tr - 4 * det
  if (disc >= 0) {
    const r = Math.sqrt(disc)
    return [
      { re: (tr - r) / 2, im: 0 },
      { re: (tr + r) / 2, im: 0 },
    ]
  }
  const r = Math.sqrt(-disc) / 2
  return [
    { re: tr / 2, im: -r },
    { re: tr / 2, im: r },
  ]
}
