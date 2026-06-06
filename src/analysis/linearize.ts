import type { Disturbances, Plant } from '../sim/plant'

/** Linear state-space model  ẋ = Ax + Bu,  y = Cx  (D ≡ 0 for our plants). */
export interface StateSpace {
  A: number[][]
  B: number[]
  C: number[]
}

/**
 * Numerical linearization of a plant about (x₀, u₀) via central differences
 * on `deriv` and `output`. No symbolic math anywhere — this is what makes
 * Bode plots fall out automatically for ANY plant added later.
 */
export function linearize<D extends Disturbances>(
  plant: Plant<D>,
  x0: number[],
  u0: number,
  d: D,
): StateSpace {
  const n = x0.length
  const eps = (v: number) => Math.max(1e-6, 1e-5 * Math.abs(v))

  const A: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let j = 0; j < n; j++) {
    const e = eps(x0[j])
    const xp = x0.slice()
    const xm = x0.slice()
    xp[j] += e
    xm[j] -= e
    const fp = plant.deriv(xp, u0, d)
    const fm = plant.deriv(xm, u0, d)
    for (let i = 0; i < n; i++) A[i][j] = (fp[i] - fm[i]) / (2 * e)
  }

  const eu = eps(u0)
  const fup = plant.deriv(x0, u0 + eu, d)
  const fum = plant.deriv(x0, u0 - eu, d)
  const B = fup.map((v, i) => (v - fum[i]) / (2 * eu))

  const C = new Array<number>(n).fill(0)
  for (let j = 0; j < n; j++) {
    const e = eps(x0[j])
    const xp = x0.slice()
    const xm = x0.slice()
    xp[j] += e
    xm[j] -= e
    C[j] = (plant.output(xp) - plant.output(xm)) / (2 * e)
  }

  return { A, B, C }
}
