import { useMemo } from 'react'
import { dcGain } from '../../analysis/freq'
import { linearize } from '../../analysis/linearize'
import { useStore } from '../../state/store'
import { Tex } from '../../ui/Math'
import { TheorySection } from '../../ui/TheorySection'
import { THERMAL, thermalPlant } from './plant'

/**
 * Thermal boiler theory: the exact ODE + Padé approximation being integrated,
 * the FOPDT form with LIVE K/τ (both depend on lossMult), why dead time is
 * the hard part (phase −ωθ), the ZN table with live numbers, and — in relay
 * mode — the delay-aware limit-cycle amplitude prediction.
 */
export function ThermalTheory() {
  const setpoint = useStore((s) => s.setpoint)
  const lossMult = useStore((s) => s.dist.lossMult ?? 1)
  const tamb = useStore((s) => s.dist.tamb ?? 22)
  const controllerId = useStore((s) => s.controllerId)
  const band = useStore((s) => s.ctl.band ?? 4)

  // Live FOPDT parameters (K and τ change with lossMult)
  const fopdt = thermalPlant.fopdt(lossMult)

  // Numerical linearization at the current setpoint
  const lin = useMemo(() => {
    const d = { tamb, lossMult }
    const eq = thermalPlant.equilibrium(setpoint, d)
    const ss = linearize(thermalPlant, eq.x, eq.u, d)
    const K = dcGain(ss)
    return { u0: eq.u, K, ss }
  }, [setpoint, lossMult, tamb])

  const n3 = (v: number) => v.toFixed(3)
  const n2 = (v: number) => v.toFixed(2)
  const n1 = (v: number) => v.toFixed(1)

  // ZN tuning from FOPDT: K, tau, theta
  const { K, tau, theta } = fopdt
  const zn = {
    p: { kp: tau / (K * theta) },
    pi: { kp: 0.9 * tau / (K * theta), ki: 0.9 * tau / (K * theta) / (theta / 0.3) },
    pid: {
      kp: 1.2 * tau / (K * theta),
      ki: 1.2 * tau / (K * theta) / (2 * theta),
      kd: 1.2 * tau / (K * theta) * (theta / 2),
    },
  }

  return (
    <>
      <TheorySection title="Plant — exact ODE (what RK4 integrates)">
        <Tex
          block
          tex={`C_{th}\\,\\dot T = P_{\\text{delayed}} - k_{\\text{eff}}\\,(T - T_{\\text{amb}})`}
        />
        <p className="text-xs text-slate-400">
          C<sub>th</sub>={THERMAL.Cth} J/K, P<sub>max</sub>={THERMAL.Pmax} W,
          k<sub>eff</sub>={THERMAL.kNom}&thinsp;×&thinsp;{n1(lossMult)} = {(THERMAL.kNom * lossMult).toFixed(1)} W/K,
          T<sub>amb</sub>={n1(tamb)}°C.
          P<sub>delayed</sub> = (u/100)·P<sub>max</sub> passed through the Padé filter below.
        </p>
      </TheorySection>

      <TheorySection title="Dead-time realisation — 2nd-order Padé (honest note)">
        <Tex
          block
          tex={`e^{-\\theta s} \\approx \\frac{1 - \\tfrac{\\theta}{2}s + \\tfrac{\\theta^2}{12}s^2}{1 + \\tfrac{\\theta}{2}s + \\tfrac{\\theta^2}{12}s^2}\\qquad (\\theta = ${theta}\\,\\text{s})`}
        />
        <p className="text-xs text-slate-400">
          This is an <em>approximation</em> of true dead time, accurate to within 1 dB and 5° up to
          ω ≈ 1/θ = {n2(1/theta)} rad/s. It is realised as 2 extra ODE states (p1, p2) in
          controllable canonical form so that the numerical lineariser sees the full 3-state system
          and the Bode plot inherits the correct phase lag &minus;ωθ without any symbolic tricks.
          True dead time would require a delay buffer and cannot be linearised this way — the Padé
          is the standard engineering workaround and is labelled as such.
        </p>
        <Tex
          block
          tex={`\\begin{aligned}\\dot p_1 &= p_2\\\\ \\dot p_2 &= -\\tfrac{1}{b}p_1 - \\tfrac{a}{b}p_2 + \\tfrac{1}{b}\\,\\tfrac{u}{100}\\end{aligned}\\qquad a=\\tfrac{\\theta}{2},\\; b=\\tfrac{\\theta^2}{12}`}
        />
        <Tex
          block
          tex={`P_{\\text{delayed}} = \\left(\\tfrac{u}{100} - 2a\\,p_2\\right)\\cdot P_{\\max}`}
        />
      </TheorySection>

      <TheorySection
        title={`FOPDT approximation — at u₀ = ${lin.u0.toFixed(1)}% (K, τ live with lossMult)`}
      >
        <Tex
          block
          tex={`G(s) = \\frac{K\\,e^{-\\theta s}}{\\tau s + 1} = \\frac{${n2(fopdt.K)}\\ {^{\\circ}\\!C}/{\\%}\\;\\cdot\\;e^{-${theta}s}}{${n1(fopdt.tau)}s + 1}`}
        />
        <p className="text-xs text-slate-400">
          K = P<sub>max</sub>/(100·k<sub>eff</sub>) = {THERMAL.Pmax}/(100·{(THERMAL.kNom * lossMult).toFixed(1)}) = {n2(fopdt.K)}&thinsp;°C/%,&emsp;
          τ = C<sub>th</sub>/k<sub>eff</sub> = {THERMAL.Cth}/{(THERMAL.kNom * lossMult).toFixed(1)} = {n1(fopdt.tau)}&thinsp;s.
          Open the lid (lossMult&gt;1) and watch both K and τ shrink — the boiler becomes faster but
          also needs more power to hold the same temperature.
        </p>
        <p className="text-xs text-slate-400">
          Numerical linearization DC gain: {Number.isFinite(lin.K) ? n3(lin.K) : '∞'}&thinsp;°C/%
          (matches FOPDT K when linearized from equilibrium).
        </p>
      </TheorySection>

      <TheorySection title="Why dead time kills phase margin">
        <p className="text-xs text-slate-400">
          The delay contributes <em>unbounded</em> phase lag:
        </p>
        <Tex
          block
          tex={`\\angle\\,e^{-j\\omega\\theta} = -\\omega\\theta\\;\\text{rad}\\quad\\Longrightarrow\\quad\\angle G(j\\omega) = -\\omega\\theta - \\arctan(\\omega\\tau)`}
        />
        <p className="text-xs text-slate-400">
          At gain-crossover ω<sub>gc</sub> (where |L(jω)| = 1), the phase margin is 180° minus the
          total phase. The &minus;ωθ term grows without bound, so every system with dead time has a
          finite maximum gain — Ziegler–Nichols ultimate-gain is the gain at which PM hits 0. You
          can see this on the Bode G tab: the phase curve descends steeply past &minus;90° due
          entirely to the Padé block.
        </p>
        <Tex
          block
          tex={`\\text{ZN critical frequency: }\\omega_u = \\frac{\\pi}{\\theta + \\arctan(\\omega_u\\tau)/\\omega_u} \\approx \\frac{\\pi/\\tau}{1 + \\pi\\theta/\\tau}`}
        />
      </TheorySection>

      <TheorySection title="Ziegler–Nichols tuning table (from FOPDT K, τ, θ)">
        <p className="text-xs text-slate-400 mb-1">
          ZN 1942 step-response recipe: R = K/τ (reaction rate), L = θ (lag). The presets use these
          values.
        </p>
        <div className="font-mono text-xs text-slate-300 grid grid-cols-4 gap-x-3 gap-y-0.5">
          <span className="text-slate-500">Rule</span>
          <span className="text-slate-500">Kp</span>
          <span className="text-slate-500">Ki</span>
          <span className="text-slate-500">Kd</span>
          <span>P</span>
          <span>{n2(zn.p.kp)}</span>
          <span>—</span>
          <span>—</span>
          <span>PI</span>
          <span>{n2(zn.pi.kp)}</span>
          <span>{n2(zn.pi.ki)}</span>
          <span>—</span>
          <span>PID</span>
          <span>{n2(zn.pid.kp)}</span>
          <span>{n2(zn.pid.ki)}</span>
          <span>{n2(zn.pid.kd)}</span>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          τ={n1(tau)}&thinsp;s, K={n2(K)}&thinsp;°C/%, θ={theta}&thinsp;s.
          These are the 1942 recipe — aggressive by modern standards, often ~25% overshoot. Use as a
          starting point and add derivative to tame the dead-time ringing.
        </p>
      </TheorySection>

      {controllerId === 'onoff' && (
        <DelayCycle setpoint={setpoint} lossMult={lossMult} tamb={tamb} band={band} />
      )}
    </>
  )
}

/**
 * Delay-aware limit-cycle prediction for relay (on/off) control.
 *
 * With dead time θ, the heater keeps delivering power for θ seconds after
 * the relay switches off.  The overshoot above the upper band edge is
 * approximately:  Δ_overshoot ≈ slope_on × θ  (where slope_on = K·Pmax/100 / τ).
 * Similarly, the undershoot below the lower edge ≈ slope_off × θ.
 */
function DelayCycle({
  setpoint,
  lossMult,
  tamb,
  band,
}: {
  setpoint: number
  lossMult: number
  tamb: number
  band: number
}) {
  const kEff = THERMAL.kNom * Math.max(1, lossMult)
  const fopdt = thermalPlant.fopdt(lossMult)

  // Steady-state equilibrium power (W) needed to hold setpoint
  const Pss = kEff * (setpoint - tamb)

  // On: full power Pmax; off: 0 W
  // Net heating rate at setpoint (°C/s)
  const slopeOn = (THERMAL.Pmax - Pss) / THERMAL.Cth   // Ṫ when heater on
  const slopeOff = -Pss / THERMAL.Cth                   // Ṫ when heater off (cooling)

  // Time to cross the band (ignoring dead time, first-order approximation)
  const tOn = slopeOn > 1e-4 ? band / slopeOn : null    // s to rise across band
  const tOff = -slopeOff > 1e-4 ? band / (-slopeOff) : null

  // Dead-time overshoot on each side
  const overOn = slopeOn * THERMAL.theta                  // °C above upper edge
  const overOff = (-slopeOff) * THERMAL.theta             // °C below lower edge

  const period = tOn != null && tOff != null ? tOn + tOff : null

  return (
    <TheorySection title="Predicted limit cycle (relay mode, delay-aware)">
      <p className="text-xs text-slate-400">
        At T₀ = {setpoint.toFixed(0)}°C: heating slope ≈ {slopeOn.toFixed(3)}°C/s (on),
        cooling slope ≈ {slopeOff.toFixed(3)}°C/s (off).
      </p>
      {period != null ? (
        <>
          <Tex
            block
            tex={`T_{\\text{cycle}} \\approx \\frac{\\Delta}{\\dot T_{\\text{on}}} + \\frac{\\Delta}{|\\dot T_{\\text{off}}|} = ${tOn!.toFixed(1)} + ${tOff!.toFixed(1)} \\approx ${period.toFixed(0)}\\,\\text{s}`}
          />
          <p className="text-xs text-slate-400">
            With dead time θ={THERMAL.theta}&thinsp;s, the relay overshoots the band by
            ≈ {overOn.toFixed(2)}°C on the high side and ≈ {overOff.toFixed(2)}°C on the low side,
            giving a real peak-to-peak amplitude of Δ + {overOn.toFixed(2)} + {overOff.toFixed(2)}
            ≈ {(band + overOn + overOff).toFixed(2)}°C total.
            Check it on the strip chart — dead time is the dominant source of overshoot here, not
            the band width (K={fopdt.K.toFixed(2)}&thinsp;°C/%, τ={fopdt.tau.toFixed(0)}&thinsp;s).
          </p>
        </>
      ) : (
        <p className="text-xs text-red-400">
          Insufficient heat margin — boiler cannot cycle here (T_amb too close to setpoint or
          Pmax too low for losses).
        </p>
      )}
    </TheorySection>
  )
}
