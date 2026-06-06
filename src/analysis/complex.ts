/** Minimal complex arithmetic — deliberately no math.js (too heavy). */
export interface Cx {
  re: number
  im: number
}

export const cx = (re: number, im = 0): Cx => ({ re, im })
export const cAdd = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im })
export const cSub = (a: Cx, b: Cx): Cx => ({ re: a.re - b.re, im: a.im - b.im })
export const cMul = (a: Cx, b: Cx): Cx => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
})
export const cDiv = (a: Cx, b: Cx): Cx => {
  const den = b.re * b.re + b.im * b.im
  return { re: (a.re * b.re + a.im * b.im) / den, im: (a.im * b.re - a.re * b.im) / den }
}
export const cAbs = (a: Cx): number => Math.hypot(a.re, a.im)
export const cArg = (a: Cx): number => Math.atan2(a.im, a.re)
export const cScale = (a: Cx, s: number): Cx => ({ re: a.re * s, im: a.im * s })

/**
 * Solve the complex linear system M·v = b in place (Gaussian elimination,
 * partial pivoting). Sized for control work: n ≤ ~6.
 */
export function cSolve(M: Cx[][], b: Cx[]): Cx[] {
  const n = b.length
  const A = M.map((row) => row.map((e) => ({ ...e })))
  const v = b.map((e) => ({ ...e }))
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (cAbs(A[r][col]) > cAbs(A[piv][col])) piv = r
    if (piv !== col) {
      ;[A[col], A[piv]] = [A[piv], A[col]]
      ;[v[col], v[piv]] = [v[piv], v[col]]
    }
    const diag = A[col][col]
    for (let r = col + 1; r < n; r++) {
      const f = cDiv(A[r][col], diag)
      for (let c = col; c < n; c++) A[r][c] = cSub(A[r][c], cMul(f, A[col][c]))
      v[r] = cSub(v[r], cMul(f, v[col]))
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let acc = v[r]
    for (let c = r + 1; c < n; c++) acc = cSub(acc, cMul(A[r][c], v[c]))
    v[r] = cDiv(acc, A[r][r])
  }
  return v
}
