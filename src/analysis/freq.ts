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

/**
 * Controller frequency response — the EXACT structure simulated in sim/pid.ts:
 *   C(s) = Kp + Ki/s + Kd·s/(τf·s + 1),   τf = 1/ωf
 * (Derivative-on-measurement changes the error response, not the loop gain,
 * so L(jω) = C(jω)·G(jω) is still the honest open loop.)
 */
export function pidResponse(kp: number, ki: number, kd: number, wf: number, w: number): Cx {
  const s = cx(0, w)
  let c = cx(kp)
  if (ki > 0) c = cAdd(c, cDiv(cx(ki), s))
  if (kd > 0) {
    const tf = 1 / wf
    c = cAdd(c, cDiv(cMul(cx(kd), s), cAdd(cx(1), cMul(cx(tf), s))))
  }
  return c
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

export interface BodeData {
  w: number[]
  /** Open-loop |L| in dB, clamped at −200 to keep charts finite. */
  magDb: number[]
  /** Open-loop phase, degrees, unwrapped. */
  phaseDeg: number[]
  margins: Margins
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

export interface PidGains {
  kp: number
  ki: number
  kd: number
  wf: number
}

/** Sweep L(jω) = C(jω)·G(jω) and extract stability margins. */
export function bode(
  ss: StateSpace,
  pid: PidGains,
  wMin = 1e-4,
  wMax = 1e3,
  nPoints = 600,
): BodeData {
  const w: number[] = []
  const magDb: number[] = []
  const phaseDeg: number[] = []
  const logMin = Math.log10(wMin)
  const logMax = Math.log10(wMax)

  for (let i = 0; i < nPoints; i++) {
    const wi = 10 ** (logMin + ((logMax - logMin) * i) / (nPoints - 1))
    const L = cMul(plantResponse(ss, wi), pidResponse(pid.kp, pid.ki, pid.kd, pid.wf, wi))
    w.push(wi)
    magDb.push(Math.max(-200, 20 * Math.log10(Math.max(cAbs(L), 1e-12))))
    phaseDeg.push((cArg(L) * 180) / Math.PI)
  }

  // Unwrap phase (remove ±360° jumps from atan2 branch cuts).
  for (let i = 1; i < phaseDeg.length; i++) {
    while (phaseDeg[i] - phaseDeg[i - 1] > 180) phaseDeg[i] -= 360
    while (phaseDeg[i] - phaseDeg[i - 1] < -180) phaseDeg[i] += 360
  }

  return { w, magDb, phaseDeg, margins: findMargins(w, magDb, phaseDeg) }
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
