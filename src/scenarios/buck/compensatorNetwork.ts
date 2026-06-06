/**
 * Op-amp RC network synthesis for the Type II / Type III voltage-mode
 * compensators — the values drawn live in the scene's feedback path.
 *
 * These are the textbook datasheet formulas, inverted to give component values
 * from the SAME corner frequencies the controller runs (controllers.tsx). The
 * reference resistor R1 (the upper feedback / input resistor) is fixed; every
 * other part follows. The synthesis round-trips to the controller's corners to
 * 0% on fI/fz1/fp1/fp2 and to the standard R1+R3≈R1 approximation on fz2.
 *
 *   Type III (Zf = R2·C1·C2 branch, Zin = R1 ∥ (R3·C3) branch):
 *     fz1 = 1/(2π R2 C1)      fp1 = 1/(2π R2 C2)         (C1 ≫ C2)
 *     fz2 = 1/(2π (R1+R3) C3) fp2 = 1/(2π R3 C3)         (R1 ≫ R3)
 *     integrator gain 1/(R1 C1) ≡ K_mod·ω_I  ⇒  C1 = 1/(K_mod·ω_I·R1)
 *   Type II: drop the R3/C3 branch (R1, C1, R2, C2 only).
 *
 * K_mod = 100 (%/duty) is folded into C1 exactly as controllers.tsx folds it
 * into the loop gain, so the network's |C(jω)| matches the simulated law.
 */

/** Upper feedback / input reference resistor. Everything scales off this. */
export const R1_REF = 10e3 // Ω
const KMOD = 100
const TWO_PI = 2 * Math.PI
/** kHz → rad/s (controller params are in kHz). */
const wkHz = (fKHz: number) => TWO_PI * fKHz * 1e3

export interface NetworkPart {
  name: string
  /** Engineering-formatted value, e.g. "1.06 MΩ" or "100 pF". */
  value: string
}

export interface CompensatorNetwork {
  kind: 'typeiii' | 'typeii' | 'pid' | 'onoff' | 'none'
  parts: NetworkPart[]
}

/** Engineering notation: pF/nF/µF for capacitance, Ω/kΩ/MΩ for resistance. */
export function fmtCap(farads: number): string {
  if (!Number.isFinite(farads) || farads <= 0) return '—'
  if (farads >= 1e-6) return `${trim(farads * 1e6)} µF`
  if (farads >= 1e-9) return `${trim(farads * 1e9)} nF`
  if (farads >= 1e-12) return `${trim(farads * 1e12)} pF`
  return `${(farads * 1e12).toFixed(2)} pF` // sub-pF: keep 2 decimals, don't floor to 0
}

export function fmtRes(ohms: number): string {
  if (!Number.isFinite(ohms) || ohms <= 0) return '—'
  if (ohms >= 1e6) return `${trim(ohms / 1e6)} MΩ`
  if (ohms >= 1e3) return `${trim(ohms / 1e3)} kΩ`
  return `${ohms.toFixed(0)} Ω`
}

/** 2 sig-fig-ish trim: 2 decimals under 10, 1 under 100, 0 above. */
function trim(x: number): string {
  const a = Math.abs(x)
  if (a >= 100) return x.toFixed(0)
  if (a >= 10) return x.toFixed(1)
  return x.toFixed(2)
}

/**
 * Synthesize the network for the active controller from its live params.
 * Unknown / non-buck controllers fall back to a generic box (pid) or the
 * hysteresis comparator (onoff).
 */
export function synthNetwork(
  controllerId: string,
  ctl: Record<string, number>,
): CompensatorNetwork {
  if (controllerId === 'buck-typeiii') {
    const C1 = 1 / (KMOD * wkHz(ctl.fI ?? 0) * R1_REF)
    const R2 = 1 / (wkHz(ctl.fz1 ?? 1) * C1)
    const C2 = 1 / (wkHz(ctl.fp1 ?? 1) * R2)
    const C3 = 1 / (wkHz(ctl.fz2 ?? 1) * R1_REF)
    const R3 = 1 / (wkHz(ctl.fp2 ?? 1) * C3)
    return {
      kind: 'typeiii',
      parts: [
        { name: 'R1', value: fmtRes(R1_REF) },
        { name: 'R2', value: fmtRes(R2) },
        { name: 'R3', value: fmtRes(R3) },
        { name: 'C1', value: fmtCap(C1) },
        { name: 'C2', value: fmtCap(C2) },
        { name: 'C3', value: fmtCap(C3) },
      ],
    }
  }
  if (controllerId === 'buck-typeii') {
    const C1 = 1 / (KMOD * wkHz(ctl.fI ?? 0) * R1_REF)
    const R2 = 1 / (wkHz(ctl.fz ?? 1) * C1)
    const C2 = 1 / (wkHz(ctl.fp ?? 1) * R2)
    return {
      kind: 'typeii',
      parts: [
        { name: 'R1', value: fmtRes(R1_REF) },
        { name: 'R2', value: fmtRes(R2) },
        { name: 'C1', value: fmtCap(C1) },
        { name: 'C2', value: fmtCap(C2) },
      ],
    }
  }
  if (controllerId === 'pid') {
    return { kind: 'pid', parts: [] }
  }
  if (controllerId === 'onoff') {
    const band = ctl.band ?? 0
    return {
      kind: 'onoff',
      parts: [{ name: 'ΔV', value: `${(band * 1e3).toFixed(0)} mV` }],
    }
  }
  return { kind: 'none', parts: [] }
}
