import { cAbs, cAdd, cDiv, cMul, cSub, cx, type Cx } from './complex'

/**
 * Eigenvalues of a small (n ≤ ~6) real matrix, for plant-pole display and
 * open-loop-stability checks. Leverrier–Faddeev builds the characteristic
 * polynomial; Durand–Kerner finds its roots. Plenty accurate for displaying
 * poles and flagging RHP instability — not a general-purpose eig library.
 */

/** Characteristic polynomial coefficients [1, c1, ..., cn] of det(sI − A). */
export function charPoly(A: number[][]): number[] {
  const n = A.length
  const coeffs = [1]
  // M_1 = A, c_k = −tr(M_k)/k, M_{k+1} = A·(M_k + c_k·I)
  let M = A.map((row) => row.slice())
  for (let k = 1; k <= n; k++) {
    let tr = 0
    for (let i = 0; i < n; i++) tr += M[i][i]
    const c = -tr / k
    coeffs.push(c)
    if (k === n) break
    const Mc = M.map((row, i) => row.map((v, j) => (i === j ? v + c : v)))
    M = A.map((rowA) =>
      Array.from({ length: n }, (_, j) => {
        let s = 0
        for (let m = 0; m < n; m++) s += rowA[m] * Mc[m][j]
        return s
      }),
    )
  }
  return coeffs
}

/** Roots of a monic polynomial (coeffs [1, c1, ..., cn]) via Durand–Kerner. */
export function polyRoots(coeffs: number[]): Cx[] {
  const n = coeffs.length - 1
  if (n === 0) return []
  const evalP = (z: Cx): Cx => {
    let acc = cx(coeffs[0])
    for (let i = 1; i <= n; i++) acc = cAdd(cMul(acc, z), cx(coeffs[i]))
    return acc
  }
  // standard starting points: (0.4 + 0.9i)^k — not real, not roots of unity
  const seed = cx(0.4, 0.9)
  let roots: Cx[] = []
  let p = cx(1)
  for (let i = 0; i < n; i++) {
    p = cMul(p, seed)
    roots.push(p)
  }
  for (let iter = 0; iter < 120; iter++) {
    let maxStep = 0
    const next = roots.map((zi, i) => {
      let denom = cx(1)
      for (let j = 0; j < n; j++) {
        if (j !== i) denom = cMul(denom, cSub(zi, roots[j]))
      }
      if (cAbs(denom) < 1e-30) return zi
      const step = cDiv(evalP(zi), denom)
      maxStep = Math.max(maxStep, cAbs(step))
      return cSub(zi, step)
    })
    roots = next
    if (maxStep < 1e-12) break
  }
  return roots
}

/** All eigenvalues of A. */
export function eigenvalues(A: number[][]): Cx[] {
  if (A.length === 0) return []
  return polyRoots(charPoly(A))
}

/** Largest real part among A's eigenvalues — > tol ⇒ open-loop unstable
 *  (poles at the origin, i.e. integrators, don't count as unstable). */
export function maxRealPole(A: number[][]): number {
  let max = -Infinity
  for (const r of eigenvalues(A)) max = Math.max(max, r.re)
  return max
}
