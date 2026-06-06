import { useMemo } from 'react'
import { dcGain } from '../analysis/freq'
import { linearize } from '../analysis/linearize'
import { TANK } from '../sim/plants/tank'
import { engine } from '../state/engine'
import { useStore } from '../state/store'
import { Tex } from './Math'

/**
 * The theory ↔ simulation bridge: the exact equations being integrated, the
 * linearized transfer function with LIVE numeric values at the current
 * operating point, and the controller law with current gains.
 */
export function TheoryPanel() {
  const kp = useStore((s) => s.kp)
  const ki = useStore((s) => s.ki)
  const kd = useStore((s) => s.kd)
  const wf = useStore((s) => s.wf)
  const setpoint = useStore((s) => s.setpoint)
  const valve = useStore((s) => s.valve)
  const controller = useStore((s) => s.controller)
  const band = useStore((s) => s.band)

  const lin = useMemo(() => {
    const d = { valve }
    const eq = engine.plant.equilibrium(setpoint, d)
    const ss = linearize(engine.plant, eq.x, eq.u, d)
    const a11 = ss.A[0][0]
    const tauTank = a11 < -1e-9 ? -1 / a11 : Infinity
    const K = dcGain(ss)
    // velocity gain for the integrating (valve closed) case: ḣ per % command
    const kv = TANK.qMax / 100 / TANK.area
    return { u0: eq.u, tauTank, K, kv }
  }, [setpoint, valve])

  const num = (v: number, digits = 3) => (Number.isFinite(v) ? v.toPrecision(digits) : '\\infty')
  const tf = 1 / wf

  return (
    <div className="space-y-3 text-sm">
      <Section title="Plant — nonlinear ODE (what RK4 integrates)">
        <Tex
          block
          tex={`A_t\\,\\dot h = q_{in} - \\underbrace{C_d\\,a_v\\sqrt{2gh}}_{\\text{Torricelli}}\\qquad \\tau_p\\,\\dot q_{in} = \\tfrac{u}{100}Q_{max} - q_{in}`}
        />
        <p className="text-xs text-slate-400">
          A<sub>t</sub>={TANK.area} m², Q<sub>max</sub>={TANK.qMax * 1000} L/s, τ<sub>p</sub>=
          {TANK.pumpTau} s, C<sub>d</sub>={TANK.cd}, a<sub>v</sub>={valve.toFixed(2)}·
          {TANK.aOrificeMax} m²
        </p>
      </Section>

      <Section title={`Linearized at h₀ = ${setpoint.toFixed(2)} m  (u₀ = ${lin.u0.toFixed(1)}%)`}>
        {Number.isFinite(lin.tauTank) ? (
          <Tex
            block
            tex={`G(s) = \\frac{\\Delta h}{\\Delta u} = \\frac{${num(lin.K)}\\ \\tfrac{\\text{m}}{\\%}}{(${num(lin.tauTank)}\\,s+1)(${TANK.pumpTau}\\,s+1)}`}
          />
        ) : (
          <Tex
            block
            tex={`G(s) = \\frac{${num(lin.kv)}\\ \\tfrac{\\text{m/s}}{\\%}}{s\\,(${TANK.pumpTau}\\,s+1)}\\quad\\text{(valve closed → integrating!)}`}
          />
        )}
        <p className="text-xs text-slate-400">
          The <Tex tex="\sqrt{h}" /> outflow makes both K and τ depend on the operating level —
          move the setpoint or valve and watch them (and the Bode plot) change. Gains tuned at one
          level are not optimal at another.
        </p>
      </Section>

      {controller === 'pid' ? (
        <Section title="Controller — parallel PID, derivative on measurement">
          <Tex
            block
            tex={`u = K_p e + K_i\\!\\int\\! e\\,d\\tau - K_d \\tfrac{d y_f}{dt},\\qquad C(s) = ${kp.toFixed(0)} + \\frac{${ki.toFixed(1)}}{s} + \\frac{${kd.toFixed(0)}\\,s}{${tf.toPrecision(2)}\\,s+1}`}
          />
          <p className="text-xs text-slate-400">
            y<sub>f</sub> is the measurement low-passed at ω<sub>f</sub>={wf.toFixed(1)} rad/s.
            Output saturates at 0–100% with back-calculation anti-windup. The strip chart shows
            each term's contribution to u live.
          </p>
        </Section>
      ) : (
        <RelaySection setpoint={setpoint} valve={valve} band={band} />
      )}

      <Section title="Loop algebra (the Bode panel tabs)">
        <Tex
          block
          tex={`L = C\\,G \\qquad T = \\frac{L}{1+L} \\qquad S = \\frac{1}{1+L}`}
        />
        <p className="text-xs text-slate-400">
          In dB the compensator and plant <em>add</em>: |L| = |C| + |G|. Where |L| ≫ 1, T ≈ 1
          (output tracks setpoint) and S ≈ 1/L (disturbances crushed — the integrator makes S → 0
          at DC). Where |L| ≪ 1, the loop does nothing: T ≈ L, S ≈ 1. All the action is at the
          0 dB crossover: the phase margin there{' '}
          <span className="text-green-400">(green line)</span> sets the closed-loop peaking in |T|
          and the ringing you see in the level trace. Rule of thumb: ζ ≈ PM/100, T + S = 1 always.
        </p>
      </Section>
    </div>
  )
}

/**
 * Relay-mode theory with a LIVE limit-cycle prediction: rise/fall rates from
 * the plant constants give the cycle period — go check it on the strip chart.
 */
function RelaySection({
  setpoint,
  valve,
  band,
}: {
  setpoint: number
  valve: number
  band: number
}) {
  const qOut = engine.plant.outflow(setpoint, valve)
  const rise = (TANK.qMax - qOut) / TANK.area // m/s, pump on
  const fall = qOut / TANK.area // m/s, pump off
  const period = rise > 0 && fall > 0 ? band / rise + band / fall : null

  return (
    <Section title="Controller — relay with hysteresis (thermostat)">
      <Tex
        block
        tex={`u = \\begin{cases} 100\\% & e > ${(band / 2).toFixed(3)}\\text{ m} \\\\ 0\\% & e < -${(band / 2).toFixed(3)}\\text{ m} \\\\ \\text{hold} & \\text{otherwise} \\end{cases}`}
      />
      <p className="text-xs text-slate-400">
        No equilibrium — the loop limit-cycles across the band Δ={band.toFixed(2)} m. Rates at
        h₀: rise (pump on) ≈ {(rise * 1000).toFixed(1)} mm/s, fall (pump off) ≈{' '}
        {(fall * 1000).toFixed(1)} mm/s, so the predicted period is
      </p>
      {period != null ? (
        <Tex
          block
          tex={`T \\approx \\frac{\\Delta}{\\text{rise}} + \\frac{\\Delta}{\\text{fall}} = ${period.toFixed(1)}\\ \\text{s}`}
        />
      ) : (
        <p className="text-xs text-red-400">
          Pump can't both raise and lower the level here (valve closed or fully open) — no cycle.
        </p>
      )}
      <p className="text-xs text-slate-400">
        Check it against the strip chart. The real cycle overshoots the band slightly — the pump
        lag τ<sub>p</sub> keeps flow coming after switching, the same lag that limits PID gains.
      </p>
    </Section>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {title}
      </h3>
      {children}
    </section>
  )
}
