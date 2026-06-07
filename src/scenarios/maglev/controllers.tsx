import { cAdd, cDiv, cMul, cx, type Cx } from '../../analysis/complex'
import type { ControllerDef } from '../../controllers/types'
import { useStore } from '../../state/store'
import { seriesColors } from '../../ui/colors'
import { Tex } from '../../ui/Math'
import { TheorySection } from '../../ui/TheorySection'
import { MAGLEV } from './plant'

/**
 * Maglev-local PID, registered from index.ts at module load (cycle-proof
 * registry — same pattern as the jet/buck local defs).
 *
 * Why a maglev-local PID instead of the shared controllers/pid.tsx: this coil
 * has NEGATIVE control effectiveness about its bias (more current → stronger
 * UP pull → the gap z SHRINKS, so ∂z̈/∂u < 0), and the quiescent command is the
 * design-gap bias U₀ ≈ 40 % (i₀ = 0.8 A at 15 mm), not 0 %. The honest law is
 *   u = U₀ − [K_p e + K_i∫e − K_d ż_f],   e = z* − z,   saturated 0–100 %
 * and its frequency twin carries that −1 so L(jω) = C·G is truthful.
 *
 * NO setpoint feed-forward: the bias is fixed at the 15 mm design point, which
 * is what makes the lessons honest — a bare PD holds 15 mm but DROOPS at other
 * gaps (the integral has to find the new current), and tuning at 15 mm then
 * commanding far away walks the unstable pole out from under the gains.
 */

/** Design-gap bias: i₀ = 0.8 A at 15 mm ⇒ 0.8/2.0 = 40 % of i_max. */
const U0 = (MAGLEV.i0 / MAGLEV.iMax) * 100

class MaglevPID {
  private integ = 0
  private dTerm = 0
  private zPrev: number | null = null
  private tt = 0.03 // anti-windup tracking time constant, s
  terms = { p: 0, i: 0, d: 0 }

  reset() {
    this.integ = 0
    this.dTerm = 0
    this.zPrev = null
    this.terms = { p: 0, i: 0, d: 0 }
  }

  update(sp: number, z: number, dt: number, p: Record<string, number>): number {
    const kp = p.kp ?? 0
    const ki = p.ki ?? 0
    const kd = p.kd ?? 0
    const wf = p.wf || 400
    const e = sp - z

    // Derivative on measurement (gap z), first-order filtered, backward-Euler.
    const tf = 1 / wf
    const d = this.zPrev === null ? 0 : (tf * this.dTerm + kd * (this.zPrev - z)) / (tf + dt)
    this.dTerm = d
    this.zPrev = z

    const pTerm = kp * e
    const ctl = pTerm + this.integ + d
    const uRaw = U0 - ctl // bias minus demand (negative effectiveness)
    const uSat = Math.min(100, Math.max(0, uRaw))

    if (ki > 0) {
      this.integ += ki * e * dt + ((uRaw - uSat) * dt) / this.tt
    } else {
      this.integ = 0
    }
    // Report term effect on u (the −1 folded in), so the chart reads in %.
    this.terms = { p: -pTerm, i: -this.integ, d: -d }
    return uSat
  }
}

/** C(jω) of u = U₀ − (Kp + Ki/s + Kd·s/(τf s+1))·e. The −1 (coil's negative
 *  effectiveness) is part of the controller TF so L = C·G is honest. */
function maglevPidResponse(p: Record<string, number>, w: number): Cx {
  const s = cx(0, w)
  let c = cx(p.kp ?? 0)
  if ((p.ki ?? 0) > 0) c = cAdd(c, cDiv(cx(p.ki), s))
  if ((p.kd ?? 0) > 0) {
    const tf = 1 / (p.wf || 400)
    c = cAdd(c, cDiv(cMul(cx(p.kd), s), cAdd(cx(1), cMul(cx(tf), s))))
  }
  return cMul(cx(-1), c)
}

function MaglevPidTheory() {
  const ctl = useStore((s) => s.ctl)
  const kp = ctl.kp ?? 0
  const ki = ctl.ki ?? 0
  const kd = ctl.kd ?? 0
  const wf = ctl.wf || 400
  const tf = 1 / wf
  return (
    <TheorySection title="Controller — gap PD/PID (coil's negative sign, 40% bias)">
      <Tex
        block
        tex={`u = ${U0.toFixed(0)} - \\Big[\\,${kp.toFixed(1)}\\,e + \\tfrac{${ki.toFixed(0)}}{s}\\,e + \\tfrac{${kd.toFixed(2)}\\,s}{${tf.toPrecision(2)}\\,s+1}\\,z\\,\\Big]\\%,\\quad e = z^* - z`}
      />
      <p className="text-xs text-slate-400">
        The {U0.toFixed(0)}% bias is the i₀ = {MAGLEV.i0} A that holds the {MAGLEV.z0 * 1000} mm
        design gap; the leading minus is the coil's negative control power (more current → stronger
        pull → the gap <em>shrinks</em>). Derivative on the gap measurement, filtered at ω
        <sub>f</sub> = {wf.toFixed(0)} rad/s — it must be FAST: the plant doubles in ~19 ms.
      </p>
      <p className="text-xs text-amber-300/90">
        D is load-bearing. With an open-loop RHP pole, <strong>P or PI alone cannot stabilize</strong>
        — proportional gain on an inverse-square pull just rings up and the ball slams or drops
        (set K<sub>d</sub> = 0 and watch). Only the derivative supplies the phase lead that damps the
        unstable mode. Same job D does on the jet and the inverted pendulum — here 20× faster.
      </p>
      <p className="text-xs text-slate-500">
        No setpoint feed-forward: the bias is fixed at the {MAGLEV.z0 * 1000} mm point. So a bare PD
        holds {MAGLEV.z0 * 1000} mm but DROOPS at other gaps (steady error — the integral has to find
        the new current, the heavy-ball lesson), and tuning here then commanding far away walks the
        pole out from under the gains.
      </p>
    </TheorySection>
  )
}

export const maglevPidDef: ControllerDef = {
  id: 'maglev-pid',
  label: 'PID (gap)',
  create() {
    const pid = new MaglevPID()
    return {
      reset: () => pid.reset(),
      update: (sp, z, dt, p) => pid.update(sp, z, dt, p),
      termValues: () => [pid.terms.p, pid.terms.i, pid.terms.d],
    }
  },
  response: maglevPidResponse,
  parts: [
    { label: 'P', color: seriesColors.pTerm, mag: (_w, p) => ((p.kp ?? 0) > 0 ? p.kp : null) },
    { label: 'I', color: seriesColors.iTerm, mag: (w, p) => ((p.ki ?? 0) > 0 ? p.ki / w : null) },
    {
      label: 'D',
      color: seriesColors.dTerm,
      mag: (w, p) => ((p.kd ?? 0) > 0 ? (p.kd * w) / Math.hypot(1, w / (p.wf || 400)) : null),
    },
  ],
  termInfo: [
    { label: 'P', color: seriesColors.pTerm },
    { label: 'I', color: seriesColors.iTerm },
    { label: 'D', color: seriesColors.dTerm },
  ],
  summary: (p) =>
    `${U0.toFixed(0)} − [${(p.kp ?? 0).toFixed(1)} + ${(p.ki ?? 0).toFixed(0)}/s + ${(p.kd ?? 0).toFixed(2)}·s]`,
  Theory: MaglevPidTheory,
}
