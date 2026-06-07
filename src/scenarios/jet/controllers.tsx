import { cAdd, cDiv, cMul, cx, type Cx } from '../../analysis/complex'
import type { ControllerDef } from '../../controllers/types'
import { useStore } from '../../state/store'
import { seriesColors } from '../../ui/colors'
import { Tex } from '../../ui/Math'
import { TheorySection } from '../../ui/TheorySection'
import { FuzzyController } from './fuzzy'
import { FuzzifyTab, RulesSurfaceTab } from './fuzzyTabs'
import { FuzzyTheory } from './fuzzyTheory'
import { A0, B0, GAIN_SPREAD, TSController } from './fuzzyTS'
import { BlendedSurfaceTab, LocalGainsTab, useLiveTS } from './tsTabs'

/**
 * Jet-local controller types, registered from index.ts at module load
 * (cycle-proof registry — same pattern as the buck Type II/III defs):
 *
 *   fuzzy-pitch : Mamdani FLC (nonlinear, response: null — the marquee)
 *   jet-pid     : a PD/PID baseline written for THIS airframe (50% trim
 *                 datum + negative control effectiveness), so the comparison
 *                 is honest and its Bode plot is the real loop.
 *
 * Why a jet-local PID instead of the shared controllers/pid.tsx: that one
 * centers its output at 0% and assumes a positive plant gain. This elevator
 * is bidirectional about a 50% trim (faired) datum and has NEGATIVE control
 * effectiveness (M_δ < 0 ⇒ u > 50% pitches nose DOWN). The honest law is
 *   u = 50 − [K_p e + K_i∫e − K_d ẏ_f],   saturated to 0–100%
 * and its frequency twin C(jω) carries that sign, so L(jω) = C·G is truthful.
 */

/* ------------------------------ jet-pid -------------------------------- */

/**
 * PID for the negative-effectiveness, 50%-trim elevator. Structurally the
 * shared real-world PID (derivative-on-measurement, first-order filtered,
 * back-calculation anti-windup), but output = 50 − (P+I+D) and clamped 0–100.
 */
class JetPID {
  private integ = 0
  private dTerm = 0
  private yPrev: number | null = null
  private tt = 0.5 // anti-windup tracking time constant, s
  terms = { p: 0, i: 0, d: 0 }

  reset() {
    this.integ = 0
    this.dTerm = 0
    this.yPrev = null
    this.terms = { p: 0, i: 0, d: 0 }
  }

  update(sp: number, y: number, dt: number, p: Record<string, number>): number {
    const kp = p.kp ?? 0
    const ki = p.ki ?? 0
    const kd = p.kd ?? 0
    const wf = p.wf || 20
    const e = sp - y

    const tf = 1 / wf
    const d = this.yPrev === null ? 0 : (tf * this.dTerm + kd * (this.yPrev - y)) / (tf + dt)
    this.dTerm = d
    this.yPrev = y

    const pTerm = kp * e
    const ctl = pTerm + this.integ + d // the "demand"; output is 50 − demand
    const uRaw = 50 - ctl
    const uSat = Math.min(100, Math.max(0, uRaw))

    // Anti-windup back-calculation through the −1 output gain: the integrator
    // tracks toward consistency with the actually-applied (saturated) command.
    if (ki > 0) {
      this.integ += ki * e * dt + ((uRaw - uSat) * dt) / this.tt
    } else {
      this.integ = 0
    }

    // Term contributions are reported as their effect on u (the −1 included),
    // so the strip chart reads in the same %-of-command units as everything else.
    this.terms = { p: -pTerm, i: -this.integ, d: -d }
    return uSat
  }
}

/** C(jω) of u = 50 − (Kp + Ki/s + Kd·s/(τf s+1))·e. The −1 (airframe sign)
 *  and the actuator are part of G, so the controller TF carries the gains
 *  with the explicit minus that makes L = C·G honest for THIS plant. */
function jetPidResponse(p: Record<string, number>, w: number): Cx {
  const s = cx(0, w)
  let c = cx(p.kp ?? 0)
  if ((p.ki ?? 0) > 0) c = cAdd(c, cDiv(cx(p.ki), s))
  if ((p.kd ?? 0) > 0) {
    const tf = 1 / (p.wf || 20)
    c = cAdd(c, cDiv(cMul(cx(p.kd), s), cAdd(cx(1), cMul(cx(tf), s))))
  }
  return cMul(cx(-1), c) // negative control effectiveness datum
}

function JetPidTheory() {
  const ctl = useStore((s) => s.ctl)
  const kp = ctl.kp ?? 0
  const ki = ctl.ki ?? 0
  const kd = ctl.kd ?? 0
  const wf = ctl.wf || 20
  const tf = 1 / wf
  return (
    <TheorySection title="Controller — fly-by-wire PD/PID (this airframe's sign)">
      <Tex
        block
        tex={`u = 50 - \\Big[\\,${kp.toFixed(1)}\\,e + \\tfrac{${ki.toFixed(1)}}{s}\\,e + \\tfrac{${kd.toFixed(1)}\\,s}{${tf.toPrecision(2)}\\,s+1}\\,y\\,\\Big]\\%`}
      />
      <p className="text-xs text-slate-400">
        The 50% datum is faired-elevator trim; the leading minus is the elevator's negative
        control power (M<sub>δ</sub> &lt; 0 — nose-down for u &gt; 50%). Derivative on measurement,
        filtered at ω<sub>f</sub>={wf.toFixed(0)} rad/s, with back-calculation anti-windup.
      </p>
      <p className="text-xs text-amber-300/90">
        D is not optional here. With an open-loop RHP pole, <strong>pure PI cannot stabilize</strong>{' '}
        at any gain — it adds lag, not the phase lead the unstable airframe needs. Set K<sub>d</sub>=0
        and watch it diverge. This is the same job the fuzzy rule table's ė column does.
      </p>
      <p className="text-xs text-slate-500">
        Read the L-tab margin with care: the simple phase-margin formula (180° + ∠L at crossover)
        assumes an <em>open-loop-stable</em> plant. This airframe is open-loop unstable, so the RHP
        pole's +90° makes the displayed PM meaningless (it reads &gt;180°). Honest closed-loop
        stability here is the Nyquist encirclement count, or simply the time-domain proof: the jet
        holds trim and recovers gusts in the scene. The L/G shapes are still informative; the single
        PM number is not.
      </p>
    </TheorySection>
  )
}

export const jetPidDef: ControllerDef = {
  id: 'jet-pid',
  label: 'PID (fly-by-wire)',
  create() {
    const pid = new JetPID()
    return {
      reset: () => pid.reset(),
      update: (sp, y, dt, p) => pid.update(sp, y, dt, p),
      termValues: () => [pid.terms.p, pid.terms.i, pid.terms.d],
    }
  },
  response: jetPidResponse,
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
    `−[${(p.kp ?? 0).toFixed(1)} + ${(p.ki ?? 0).toFixed(1)}/s + ${(p.kd ?? 0).toFixed(1)}·s]`,
  Theory: JetPidTheory,
}

/* ----------------------------- fuzzy-pitch ----------------------------- */

export const fuzzyDef: ControllerDef = {
  id: 'fuzzy-pitch',
  label: 'Fuzzy (Mamdani 5×5)',
  create() {
    const flc = new FuzzyController()
    return {
      reset: () => flc.reset(),
      update: (sp, y, dt, p) => flc.update(sp, y, dt, p),
    }
  },
  // Nonlinear law — there is no C(s). The LTI Bode tabs show the standard
  // "nonlinear controller" explainer; stability is demonstrated empirically
  // in the scene + strip charts and dissected in the fuzzy Theory panel.
  response: null,
  // Replace the dead L/T/C tabs (a fuzzy law has no C(jω)) with live views of
  // what the controller actually IS — fuzzify → rules → defuzzify — at full
  // panel size. The Bode panel renders [Diagram, ...these, G].
  analysisTabs: [
    { id: 'fuzzify', label: 'Fuzzify', hint: 'live membership functions', View: FuzzifyTab },
    {
      id: 'rules',
      label: 'Rules + Surface',
      hint: 'live rule activations & control surface',
      View: RulesSurfaceTab,
    },
  ],
  summary: (p) =>
    `fuzzy 5×5, ke=${(p.ke ?? 0).toFixed(2)} kde=${(p.kde ?? 0).toFixed(2)} ku=${(p.ku ?? 0).toFixed(2)}`,
  Theory: FuzzyTheory,
}

/* ------------------------------- fuzzy-ts ------------------------------- */

function TSTheory() {
  const live = useLiveTS()
  return (
    <TheorySection title="Controller — Takagi–Sugeno fuzzy (interpolated local PD)">
      <Tex
        block
        tex={`U = \\frac{\\sum_{ij} w_{ij}\\,(a_{ij}E + b_{ij}\\dot E)}{\\sum_{ij} w_{ij}},\\quad w_{ij}=\\min(\\mu_{E,i},\\mu_{\\dot E,j})`}
      />
      <p className="text-[11px] text-slate-400">
        Same fuzzifier and 5×5 antecedents as the Mamdani law (min-AND firing), but each rule's
        consequent is a <em>local linear controller</em> u<sub>ij</sub> = a<sub>ij</sub>E + b
        <sub>ij</sub>Ė, and the output is their firing-weighted <strong>average — there is no
        defuzzification step</strong>. That is the whole difference: Mamdani aggregates output sets
        and finds a centroid; T-S interpolates between local linear laws. Then u = 50 + k<sub>u</sub>·U·50
        with the airframe's negative-control-power sign baked into (a<sub>0</sub>, b<sub>0</sub>) = ({A0},{' '}
        {B0}).
      </p>
      <p className="text-[11px] text-slate-400">
        This is <strong>gain scheduling, formalized</strong>: away from trim the corner cells run
        hotter (gain spread {GAIN_SPREAD.toFixed(1)}× at the edges), so big upsets get more aggressive
        local gains — but smoothly blended, never switched. The <span className="font-mono">uniformity</span>{' '}
        slider equalises the table: at 1 every cell is identical and the weighted average collapses to
        U = a·E + b·Ė exactly.
      </p>
      <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-[11px]">
        {live.degenerate ? (
          <span className="text-emerald-300">
            ✓ uniformity = {live.uniformity.toFixed(2)} → all cells equal → this is{' '}
            <strong>currently exactly a linear PD</strong> (a={live.aTab[2][2].toFixed(2)}, b=
            {live.bTab[2][2].toFixed(2)}). Match it against PID (fly-by-wire) at K<sub>p</sub>=k
            <sub>u</sub>k<sub>e</sub>·50, K<sub>d</sub>=k<sub>u</sub>k<sub>de</sub>·50 — the responses
            coincide.
          </span>
        ) : (
          <span className="text-amber-300/90">
            uniformity = {live.uniformity.toFixed(2)} → cells differ (centre a=
            {live.aTab[2][2].toFixed(2)} vs corner a={live.aTab[0][0].toFixed(2)}) → a genuinely
            nonlinear schedule. Slide uniformity → 1 to collapse it to exactly PD.
          </span>
        )}
      </div>
      <p className="text-[11px] text-slate-500">
        Stability, honestly: unlike Mamdani, a T-S model is a convex blend of linear subsystems, so
        the <em>plant-side</em> T-S framework admits LMI / parallel-distributed-compensation (PDC)
        certificates — a common quadratic Lyapunov function across the local models proves closed-loop
        stability when one exists. That machinery is real but applies to a T-S <em>plant</em> model;
        here it motivates why T-S is the analyzable cousin of fuzzy control. For this controller-only
        demo, stability is still shown empirically (the jet flies) — no overclaim.
      </p>
    </TheorySection>
  )
}

export const fuzzyTSDef: ControllerDef = {
  id: 'fuzzy-ts',
  label: 'Fuzzy (Takagi–Sugeno)',
  create() {
    const ts = new TSController()
    return {
      reset: () => ts.reset(),
      update: (sp, y, dt, p) => ts.update(sp, y, dt, p),
    }
  },
  // Nonlinear law (weighted-average of local PDs) — no C(jω). Its analysis
  // tabs show the local-gain table and the blended surface (comparable to the
  // Mamdani surface). The G plant tab remains.
  response: null,
  analysisTabs: [
    { id: 'gains', label: 'Local gains', hint: 'live (a,b) per cell — local linear controllers', View: LocalGainsTab },
    { id: 'surface', label: 'Blended surface', hint: 'u(e,ė) surface — compare with Mamdani', View: BlendedSurfaceTab },
  ],
  summary: (p) =>
    `T-S 5×5, ke=${(p.ke ?? 0).toFixed(2)} ku=${(p.ku ?? 0).toFixed(2)}, unif=${(p.uniformity ?? 0).toFixed(2)}`,
  Theory: TSTheory,
}
