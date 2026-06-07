import { cAdd, cDiv, cMul, cx, type Cx } from '../../analysis/complex'
import type { ControllerDef } from '../../controllers/types'
import { PID } from '../../sim/pid'
import { useStore } from '../../state/store'
import { seriesColors } from '../../ui/colors'
import { Tex } from '../../ui/Math'
import { TheorySection } from '../../ui/TheorySection'

/**
 * Pendulum-local PID. Two deviations from the generic `pidDef`, both forced by
 * THIS plant and documented for the user:
 *
 *  1. Output is centred on the actuator trim: u = 50 + (PID terms). The
 *     50%-offset force actuator (F=0 at u=50%) needs a quiescent command of 50,
 *     not 0 — a 0-centred PID would slam full force at t=0 and topple the pole.
 *
 *  2. The plant has NEGATIVE control effectiveness (∂φ̈/∂F < 0 — pushing the
 *     cart +x tips the pole −φ), so the loop sign is flipped: positive error
 *     (pole fallen to −φ ⇒ e=−y>0) must DECREASE u (push the cart −x to get
 *     under it). The law is u = 50 − (Kp·e + Ki∫e − Kd·ẏ_f). Identical in
 *     spirit to the jet (M_δ<0); the sign lives in one place.
 *
 * The frequency response below is that exact signed structure, so the L tab
 * honestly shows C·G — and, with the plant's RHP pole, the generic
 * unstable-plant warning fires (classical PM/GM read with care there).
 */

/** C(s) = −[Kp + Ki/s + Kd·s/(τf·s+1)] — the sign-flipped PD/PID law. */
function pendPidResponse(p: Record<string, number>, w: number): Cx {
  const s = cx(0, w)
  let c = cx(p.kp ?? 0)
  if ((p.ki ?? 0) > 0) c = cAdd(c, cDiv(cx(p.ki), s))
  if ((p.kd ?? 0) > 0) {
    const tf = 1 / (p.wf || 20)
    c = cAdd(c, cDiv(cMul(cx(p.kd), s), cAdd(cx(1), cMul(cx(tf), s))))
  }
  // negative effectiveness ⇒ stabilizing loop sign is the negated compensator
  return cx(-c.re, -c.im)
}

/**
 * Sign-flipped, trim-centred PID wrapping the shared PID core. The core
 * computes the standard 0-centred terms; we map them to u = 50 − core so the
 * command sits at trim and pushes the cart the right way.
 */
class PendulumPID {
  private pid = new PID()
  reset() {
    this.pid.reset()
  }
  update(sp: number, y: number, dt: number, p: Record<string, number>): number {
    this.pid.uMin = -50
    this.pid.uMax = 50 // let the core swing ±50 about trim; we add the 50
    this.pid.setGains(p.kp ?? 0, p.ki ?? 0, p.kd ?? 0, p.wf || 20)
    // core ∈ [−50,50]; negative-effectiveness plant ⇒ u = 50 − core.
    const core = this.pid.update(sp, y, dt)
    return Math.min(100, Math.max(0, 50 - core))
  }
  terms() {
    // report the SIGNED contributions actually applied (negated), so the strip
    // chart matches what moves u away from the 50% trim line.
    return [-this.pid.terms.p, -this.pid.terms.i, -this.pid.terms.d]
  }
}

function PendPidTheory() {
  const ctl = useStore((s) => s.ctl)
  const kp = ctl.kp ?? 0
  const ki = ctl.ki ?? 0
  const kd = ctl.kd ?? 0
  const wf = ctl.wf || 20
  return (
    <TheorySection title="Controller — trim-centred, sign-flipped PID">
      <Tex
        block
        tex={`u = 50 - \\Big(${kp.toFixed(0)}\\,e + \\tfrac{${ki.toFixed(0)}}{s}e - \\tfrac{${kd.toFixed(0)}\\,s}{${(1 / wf).toPrecision(2)}\\,s+1}\\,y\\Big)`}
      />
      <p className="text-xs text-slate-400">
        Two plant-forced tweaks vs a textbook PID: the output is centred on the 50% actuator trim
        (F=0 at u=50, so a 0-centred PID would slam full force at t=0), and the loop sign is flipped
        because the cart force tips the pole the opposite way (∂φ̈/∂F&lt;0). The derivative is on the
        measurement, filtered at ω<sub>f</sub>={wf.toFixed(0)} rad/s — it is the phase lead that
        stabilises the right-half-plane pole. Pure P or PI (K<sub>d</sub>=0) cannot: no lead, no
        stability.
      </p>
    </TheorySection>
  )
}

export const pendulumPidDef: ControllerDef = {
  id: 'pendulum-pid',
  label: 'PID',
  create() {
    const c = new PendulumPID()
    return {
      reset: () => c.reset(),
      update: (sp, y, dt, p) => c.update(sp, y, dt, p),
      termValues: () => c.terms(),
    }
  },
  response: pendPidResponse,
  parts: [
    { label: 'P', color: seriesColors.pTerm, mag: (_w, p) => ((p.kp ?? 0) > 0 ? p.kp : null) },
    { label: 'I', color: seriesColors.iTerm, mag: (w, p) => ((p.ki ?? 0) > 0 ? p.ki / w : null) },
    {
      label: 'D',
      color: seriesColors.dTerm,
      mag: (w, p) => ((p.kd ?? 0) > 0 ? (p.kd * w) / Math.hypot(1, w / (p.wf || 20)) : null),
    },
  ],
  termInfo: [
    { label: 'P', color: seriesColors.pTerm },
    { label: 'I', color: seriesColors.iTerm },
    { label: 'D', color: seriesColors.dTerm },
  ],
  summary: (p) =>
    `u=50−(${(p.kp ?? 0).toFixed(0)} + ${(p.ki ?? 0).toFixed(0)}/s + ${(p.kd ?? 0).toFixed(0)}·s)`,
  Theory: PendPidTheory,
}
