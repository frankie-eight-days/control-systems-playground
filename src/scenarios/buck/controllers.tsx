import { cAdd, cDiv, cMul, cAbs, cx, type Cx } from '../../analysis/complex'
import type { ControllerDef } from '../../controllers/types'
import { useStore } from '../../state/store'
import { seriesColors } from '../../ui/colors'
import { Tex } from '../../ui/Math'
import { TheorySection } from '../../ui/TheorySection'
import { BUCK_T, Compensator } from './compensator'

/**
 * Buck-local controller types: Type II and Type III compensators.
 *
 * HONESTY RULE: response() is the EXACT discrete-time frequency response of
 * the backward-Euler law create() runs — C(z) evaluated at z = e^{jωT} via
 * s_BE(ω) = (1 − e^{−jωT})/T — not the s-domain idealization. Below ~f_s/20
 * the two are indistinguishable (<1° at a 20 kHz crossover); near the top of
 * the sweep you can see the discrete integrator's phase warp. T is the buck
 * scenario's fixed step (BUCK_T, shared with the running law), so these defs
 * are only valid on that scenario.
 */
const T = BUCK_T

/** Backward-Euler frequency variable s_BE(ω) = (1 − e^{−jωT})/T. */
function sBE(w: number): Cx {
  const th = w * T
  return cx((1 - Math.cos(th)) / T, Math.sin(th) / T)
}

const one = cx(1)
/** kHz → rad/s. */
const kRad = (fKHz: number) => 2000 * Math.PI * fKHz
/** (1 + s/ωz)/(1 + s/ωp) with corners in kHz. */
const leadLag = (s: Cx, fzKHz: number, fpKHz: number): Cx =>
  cDiv(
    cAdd(one, cDiv(s, cx(kRad(Math.max(fzKHz, 1e-6))))),
    cAdd(one, cDiv(s, cx(kRad(Math.max(fpKHz, 1e-6))))),
  )

/** u is 0–100 % duty, so the "modulator" contributes a flat ×100 the analog
 *  designer usually hides inside 1/V_ramp. Shown explicitly — it's a lesson. */
const KMOD = 100

const fmtK = (v: number) => (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2))
/** 1.0e+6 → KaTeX 1.0\times10^{6}. */
const texExp = (v: number) => {
  const [m, e] = v.toExponential(1).split('e')
  return `${m}\\times10^{${Number(e)}}`
}

/* ------------------------------- Type III ------------------------------- */

function typeIIIResponse(p: Record<string, number>, w: number): Cx {
  const s = sBE(w)
  let c = cMul(cx(KMOD), cDiv(cx(kRad(p.fI ?? 0)), s))
  c = cMul(c, leadLag(s, p.fz1 ?? 1, p.fp1 ?? 100))
  c = cMul(c, leadLag(s, p.fz2 ?? 1, p.fp2 ?? 100))
  return c
}

function TypeIIITheory() {
  const ctl = useStore((s) => s.ctl)
  const fI = ctl.fI ?? 1.59
  const fz1 = ctl.fz1 ?? 1.5
  const fz2 = ctl.fz2 ?? 1.5
  const fp1 = ctl.fp1 ?? 6.8
  const fp2 = ctl.fp2 ?? 60
  const wI = kRad(fI)
  const kiEq = KMOD * wI
  const kpEq = KMOD * wI * (1 / kRad(fz1) + 1 / kRad(fz2))
  const kdEq = (KMOD * wI) / (kRad(fz1) * kRad(fz2))
  return (
    <TheorySection title="Controller — Type III compensator">
      <Tex
        block
        tex={`C(s) = \\underbrace{100}_{\\%/\\text{duty}}\\cdot\\frac{\\omega_I}{s}\\cdot\\frac{(1+s/\\omega_{z1})(1+s/\\omega_{z2})}{(1+s/\\omega_{p1})(1+s/\\omega_{p2})}`}
      />
      <p className="font-mono text-xs text-sky-300">
        fI = {fmtK(fI)} kHz · fz = {fmtK(fz1)}, {fmtK(fz2)} kHz · fp = {fmtK(fp1)}, {fmtK(fp2)}{' '}
        kHz
      </p>
      <p className="text-xs text-slate-400">
        Recipe: park both zeros on the LC double pole f₀ to pay back its −180°, put one pole on
        the ESR zero to flatten it, the other above crossover to dump switching noise, then set
        f<sub>I</sub> for the crossover you want.
      </p>
      <Tex
        block
        tex={`100\\,\\tfrac{\\omega_I}{s}(1+\\tfrac{s}{\\omega_{z1}})(1+\\tfrac{s}{\\omega_{z2}}) = \\underbrace{\\tfrac{${texExp(kiEq)}}{s}}_{K_i/s} + \\underbrace{${kpEq.toFixed(0)}}_{K_p} + \\underbrace{${kdEq.toFixed(4)}\\,s}_{K_d\\,s}`}
      />
      <p className="text-xs text-slate-400">
        Type III ≈ PID + filters — expand the numerator and it <em>is</em> the tank's PID (the
        two poles then filter the D term). The same compensator in a trench coat. Switch to the
        PID controller and type those gains in.
      </p>
      <p className="text-xs text-slate-500">
        Runs as backward-Euler sections at T = 0.5 µs; the Bode tabs plot the exact discrete
        response C(e^jωT) — within 1° of C(s) at crossover, visibly warped only near the top of
        the sweep. The law you see is the law that runs.
      </p>
    </TheorySection>
  )
}

export const typeIIIDef: ControllerDef = {
  id: 'buck-typeiii',
  label: 'Type III',
  create() {
    const comp = new Compensator(2)
    return {
      reset: () => comp.reset(),
      update(sp, y, dt, p) {
        return comp.update(sp - y, dt, p.fI ?? 0, [
          [p.fz1 ?? 1, p.fp1 ?? 100],
          [p.fz2 ?? 1, p.fp2 ?? 100],
        ])
      },
    }
  },
  response: typeIIIResponse,
  parts: [
    {
      label: '∫ ωI/s',
      color: seriesColors.iTerm,
      mag: (w, p) => ((p.fI ?? 0) > 0 ? kRad(p.fI) / cAbs(sBE(w)) : null),
    },
    {
      label: 'lead z1/p1',
      color: seriesColors.dTerm,
      mag: (w, p) => cAbs(leadLag(sBE(w), p.fz1 ?? 1, p.fp1 ?? 100)),
    },
    {
      label: 'lead z2/p2',
      color: seriesColors.pTerm,
      mag: (w, p) => cAbs(leadLag(sBE(w), p.fz2 ?? 1, p.fp2 ?? 100)),
    },
    { label: '×100 (u in %)', color: '#64748b', mag: () => KMOD },
  ],
  summary: (p) =>
    `${fmtK(p.fI ?? 0)}k|z${fmtK(p.fz1 ?? 0)},${fmtK(p.fz2 ?? 0)}|p${fmtK(p.fp1 ?? 0)},${fmtK(p.fp2 ?? 0)}`,
  Theory: TypeIIITheory,
}

/* -------------------------------- Type II ------------------------------- */

function typeIIResponse(p: Record<string, number>, w: number): Cx {
  const s = sBE(w)
  const c = cMul(cx(KMOD), cDiv(cx(kRad(p.fI ?? 0)), s))
  return cMul(c, leadLag(s, p.fz ?? 1, p.fp ?? 100))
}

function TypeIITheory() {
  const ctl = useStore((s) => s.ctl)
  const fI = ctl.fI ?? 3.9
  const fz = ctl.fz ?? 1.5
  const fp = ctl.fp ?? 150
  const wI = kRad(fI)
  const kpEq = (KMOD * fI) / fz
  const kiEq = KMOD * wI
  return (
    <TheorySection title="Controller — Type II compensator">
      <Tex
        block
        tex={`C(s) = \\underbrace{100}_{\\%/\\text{duty}}\\cdot\\frac{\\omega_I}{s}\\cdot\\frac{1+s/\\omega_z}{1+s/\\omega_p}`}
      />
      <p className="font-mono text-xs text-sky-300">
        fI = {fmtK(fI)} kHz · fz = {fmtK(fz)} kHz · fp = {fmtK(fp)} kHz
      </p>
      <Tex
        block
        tex={`100\\,\\tfrac{\\omega_I}{s}(1+\\tfrac{s}{\\omega_z}) = \\underbrace{${kpEq.toFixed(0)}}_{K_p} + \\underbrace{\\tfrac{${texExp(kiEq)}}{s}}_{K_i/s}`}
      />
      <p className="text-xs text-slate-400">
        Type II ≈ PI + filter — one zero gives at most +90° of boost, so it can NOT pay back the
        LC's −180° alone. It only works when the output cap's ESR zero donates the other +90°
        inside the loop band. That bet is the whole cap-swap story (presets 1 vs 2).
      </p>
      <p className="text-xs text-slate-500">
        Runs as backward-Euler sections at T = 0.5 µs; the Bode tabs plot the exact discrete
        response C(e^jωT). The law you see is the law that runs.
      </p>
    </TheorySection>
  )
}

export const typeIIDef: ControllerDef = {
  id: 'buck-typeii',
  label: 'Type II',
  create() {
    const comp = new Compensator(1)
    return {
      reset: () => comp.reset(),
      update(sp, y, dt, p) {
        return comp.update(sp - y, dt, p.fI ?? 0, [[p.fz ?? 1, p.fp ?? 100]])
      },
    }
  },
  response: typeIIResponse,
  parts: [
    {
      label: '∫ ωI/s',
      color: seriesColors.iTerm,
      mag: (w, p) => ((p.fI ?? 0) > 0 ? kRad(p.fI) / cAbs(sBE(w)) : null),
    },
    {
      label: 'lead z/p',
      color: seriesColors.dTerm,
      mag: (w, p) => cAbs(leadLag(sBE(w), p.fz ?? 1, p.fp ?? 100)),
    },
    { label: '×100 (u in %)', color: '#64748b', mag: () => KMOD },
  ],
  summary: (p) => `${fmtK(p.fI ?? 0)}k|z${fmtK(p.fz ?? 0)}|p${fmtK(p.fp ?? 0)}`,
  Theory: TypeIITheory,
}
