import { useMemo } from 'react'
import { dcGain } from '../../analysis/freq'
import { linearize } from '../../analysis/linearize'
import { useStore } from '../../state/store'
import { Tex } from '../../ui/Math'
import { TheorySection } from '../../ui/TheorySection'
import { TANK, tankPlant } from './plant'

/**
 * Tank plant theory: the exact nonlinear ODE being integrated and its
 * transfer function linearized LIVE at the current operating point. In
 * on/off mode, adds the limit-cycle period prediction (plant × controller
 * coupling lives with the plant that knows the rates).
 */
export function TankTheory() {
  const setpoint = useStore((s) => s.setpoint)
  const valve = useStore((s) => s.dist.valve ?? 0.5)
  const controllerId = useStore((s) => s.controllerId)
  const band = useStore((s) => s.ctl.band ?? 0.1)

  const lin = useMemo(() => {
    const d = { valve }
    const eq = tankPlant.equilibrium(setpoint, d)
    const ss = linearize(tankPlant, eq.x, eq.u, d)
    const a11 = ss.A[0][0]
    const tauTank = a11 < -1e-9 ? -1 / a11 : Infinity
    const K = dcGain(ss)
    const kv = TANK.qMax / 100 / TANK.area
    return { u0: eq.u, tauTank, K, kv }
  }, [setpoint, valve])

  const num = (v: number, digits = 3) => (Number.isFinite(v) ? v.toPrecision(digits) : '\\infty')

  return (
    <>
      <TheorySection title="Plant — nonlinear ODE (what RK4 integrates)">
        <Tex
          block
          tex={`A_t\\,\\dot h = q_{in} - \\underbrace{C_d\\,a_v\\sqrt{2gh}}_{\\text{Torricelli}}\\qquad \\tau_p\\,\\dot q_{in} = \\tfrac{u}{100}Q_{max} - q_{in}`}
        />
        <p className="text-xs text-slate-400">
          A<sub>t</sub>={TANK.area} m², Q<sub>max</sub>={TANK.qMax * 1000} L/s, τ<sub>p</sub>=
          {TANK.pumpTau} s, C<sub>d</sub>={TANK.cd}, a<sub>v</sub>={valve.toFixed(2)}·
          {TANK.aOrificeMax} m²
        </p>
      </TheorySection>

      <TheorySection
        title={`Linearized at h₀ = ${setpoint.toFixed(2)} m  (u₀ = ${lin.u0.toFixed(1)}%)`}
      >
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
      </TheorySection>

      {controllerId === 'onoff' && <LimitCycle setpoint={setpoint} valve={valve} band={band} />}
    </>
  )
}

/** Live limit-cycle prediction for relay control — check it on the chart. */
function LimitCycle({
  setpoint,
  valve,
  band,
}: {
  setpoint: number
  valve: number
  band: number
}) {
  const qOut = tankPlant.outflow(setpoint, valve)
  const rise = (TANK.qMax - qOut) / TANK.area // m/s, pump on
  const fall = qOut / TANK.area // m/s, pump off
  const period = rise > 0 && fall > 0 ? band / rise + band / fall : null

  return (
    <TheorySection title="Predicted limit cycle (relay mode)">
      <p className="text-xs text-slate-400">
        Rates at h₀: rise (pump on) ≈ {(rise * 1000).toFixed(1)} mm/s, fall (pump off) ≈{' '}
        {(fall * 1000).toFixed(1)} mm/s, so across the band Δ={band.toFixed(2)} m:
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
    </TheorySection>
  )
}
