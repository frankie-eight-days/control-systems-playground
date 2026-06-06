/**
 * Seeded RNG (mulberry32) + Box–Muller gaussian. The sim must stay
 * deterministic: same seed + same inputs ⇒ identical traces.
 */
export class SeededNoise {
  private s: number
  constructor(seed = 0x12345678) {
    this.s = seed | 0
  }
  reset(seed = 0x12345678) {
    this.s = seed | 0
  }
  /** Uniform in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  /** Standard normal (μ=0, σ=1). */
  gauss(): number {
    const u1 = Math.max(this.next(), 1e-12)
    const u2 = this.next()
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  }
}
