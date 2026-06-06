/**
 * Classic fixed-step RK4 for ẋ = f(x). The control input u and disturbances
 * are held constant over the step (zero-order hold), which matches how a
 * sampled controller actually drives a continuous plant.
 */
export function rk4(f: (x: number[]) => number[], x: number[], dt: number): number[] {
  const n = x.length
  const k1 = f(x)
  const x2 = new Array<number>(n)
  for (let i = 0; i < n; i++) x2[i] = x[i] + (dt / 2) * k1[i]
  const k2 = f(x2)
  const x3 = new Array<number>(n)
  for (let i = 0; i < n; i++) x3[i] = x[i] + (dt / 2) * k2[i]
  const k3 = f(x3)
  const x4 = new Array<number>(n)
  for (let i = 0; i < n; i++) x4[i] = x[i] + dt * k3[i]
  const k4 = f(x4)
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) out[i] = x[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])
  return out
}
