import { cAdd, cDiv, cMul, cx, type Cx } from '../analysis/complex'
import { PID } from '../sim/pid'
import { useStore } from '../state/store'
import { seriesColors } from '../ui/colors'
import { Tex } from '../ui/Math'
import { TheorySection } from '../ui/TheorySection'
import type { ControllerDef } from './types'

/**
 * Frequency response of the EXACT structure simulated by sim/pid.ts:
 *   C(s) = Kp + Ki/s + Kd·s/(τf·s + 1),   τf = 1/ωf
 * (Derivative-on-measurement changes the error response, not the loop gain,
 * so L(jω) = C(jω)·G(jω) is still the honest open loop.)
 */
function pidResponse(p: Record<string, number>, w: number): Cx {
  const s = cx(0, w)
  let c = cx(p.kp ?? 0)
  if (p.ki > 0) c = cAdd(c, cDiv(cx(p.ki), s))
  if (p.kd > 0) {
    const tf = 1 / (p.wf || 10)
    c = cAdd(c, cDiv(cMul(cx(p.kd), s), cAdd(cx(1), cMul(cx(tf), s))))
  }
  return c
}

function PidTheory() {
  const ctl = useStore((s) => s.ctl)
  const kp = ctl.kp ?? 0
  const ki = ctl.ki ?? 0
  const kd = ctl.kd ?? 0
  const wf = ctl.wf || 10
  const tf = 1 / wf
  return (
    <TheorySection title="Controller — parallel PID, derivative on measurement">
      <Tex
        block
        tex={`u = K_p e + K_i\\!\\int\\! e\\,d\\tau - K_d \\tfrac{d y_f}{dt},\\qquad C(s) = ${kp.toFixed(0)} + \\frac{${ki.toFixed(1)}}{s} + \\frac{${kd.toFixed(0)}\\,s}{${tf.toPrecision(2)}\\,s+1}`}
      />
      <p className="text-xs text-slate-400">
        y<sub>f</sub> is the measurement low-passed at ω<sub>f</sub>={wf.toFixed(1)} rad/s. Output
        saturates at 0–100% with back-calculation anti-windup. The strip chart shows each term's
        contribution to u live.
      </p>
    </TheorySection>
  )
}

export const pidDef: ControllerDef = {
  id: 'pid',
  label: 'PID',
  create() {
    const pid = new PID()
    return {
      reset: () => pid.reset(),
      update(sp, y, dt, p) {
        pid.setGains(p.kp ?? 0, p.ki ?? 0, p.kd ?? 0, p.wf || 10)
        return pid.update(sp, y, dt)
      },
      termValues: () => [pid.terms.p, pid.terms.i, pid.terms.d],
    }
  },
  response: pidResponse,
  parts: [
    {
      label: 'P',
      color: seriesColors.pTerm,
      mag: (_w, p) => ((p.kp ?? 0) > 0 ? p.kp : null),
    },
    {
      label: 'I',
      color: seriesColors.iTerm,
      mag: (w, p) => ((p.ki ?? 0) > 0 ? p.ki / w : null),
    },
    {
      label: 'D',
      color: seriesColors.dTerm,
      mag: (w, p) => ((p.kd ?? 0) > 0 ? (p.kd * w) / Math.hypot(1, w / (p.wf || 10)) : null),
    },
  ],
  termInfo: [
    { label: 'P', color: seriesColors.pTerm },
    { label: 'I', color: seriesColors.iTerm },
    { label: 'D', color: seriesColors.dTerm },
  ],
  summary: (p) => `${(p.kp ?? 0).toFixed(0)} + ${(p.ki ?? 0).toFixed(1)}/s + ${(p.kd ?? 0).toFixed(0)}·s`,
  Theory: PidTheory,
}
