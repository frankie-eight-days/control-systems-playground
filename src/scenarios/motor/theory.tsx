import { useMemo } from 'react'
import { poles2 } from '../../analysis/freq'
import { linearize } from '../../analysis/linearize'
import { useStore } from '../../state/store'
import { Tex } from '../../ui/Math'
import { TheorySection } from '../../ui/TheorySection'
import { MOTOR, motorPlant } from './plant'

/**
 * Motor plant theory:
 *   1. Nonlinear ODE (what RK4 integrates), with parameter values.
 *   2. Linearized transfer function G(s) at the current operating point —
 *      live Kv and τ_m. For this plant, linearization is exact (it's already
 *      linear), but we compute numerically so the Bode plot updates
 *      automatically if parameters ever change.
 *   3. Closed-loop ζ formula vs current gains — quantifies "P alone can't damp".
 *   4. Actuator mapping (u=50% offset) prominently explained.
 */
export function MotorTheory() {
  const setpoint = useStore((s) => s.setpoint)
  const load = useStore((s) => s.dist.load ?? 0)
  const controllerId = useStore((s) => s.controllerId)
  const ctl = useStore((s) => s.ctl)

  // Kv = (τmax / 50 / J) · (180/π)  — open-loop velocity gain in (°/s²)/%
  const Kv = (MOTOR.tauMax / 50 / MOTOR.J) * MOTOR.rad2deg
  // τ_m = J/b — mechanical time constant (s)
  const tauM = MOTOR.J / MOTOR.b

  const lin = useMemo(() => {
    const d = { load }
    const eq = motorPlant.equilibrium(setpoint, d)
    const ss = linearize(motorPlant, eq.x, eq.u, d)
    const ps = poles2(ss.A)
    return { u0: eq.u, ss, ps }
  }, [setpoint, load])

  // Live closed-loop figures for PID
  const clFig = useMemo(() => {
    if (controllerId !== 'pid') return null
    const kp = ctl.kp ?? 0
    const kd = ctl.kd ?? 0
    // G(s) = Kv / (s(s + b/J)), so open-loop: C(s)·G(s) = (Kp + Kd·s)·Kv / (s(s + b/J))
    // Closed-loop char poly: s² + (b/J + Kd·Kv)s + Kp·Kv = 0
    const bOverJ = MOTOR.b / MOTOR.J   // = 0.2 rad/s
    const wn = kp > 0 ? Math.sqrt(kp * Kv) : 0
    const zeta = wn > 0 ? (bOverJ + kd * Kv) / (2 * wn) : 0
    const ringHz = wn > 0 ? (wn * Math.sqrt(Math.max(0, 1 - zeta * zeta))) / (2 * Math.PI) : null
    return { wn, zeta, ringHz }
  }, [controllerId, ctl, Kv])

  const n3 = (v: number) => (Number.isFinite(v) ? v.toPrecision(3) : '\\infty')

  return (
    <>
      {/* ---- 1. Actuator mapping — documented prominently ---- */}
      <TheorySection title="Actuator: unipolar PWM + H-bridge offset">
        <Tex
          block
          tex={`\\tau_m = \\frac{u - 50}{50}\\cdot\\tau_{\\max}
            \\qquad u\\in[0,100]\\%,\\quad \\tau_{\\max}=${MOTOR.tauMax}\\,\\text{N·m}`}
        />
        <p className="text-xs text-slate-400">
          u = 50% ⇒ zero torque; u = 100% ⇒ +{MOTOR.tauMax} N·m; u = 0% ⇒ −{MOTOR.tauMax} N·m.
          This is how real unipolar-only PWM drives work: the H-bridge is always on at 50% duty
          providing the quiescent "hold" torque, and the command deviates from that center.
          Equilibrium (load torque = 0) runs at u = 50%, not u = 0%.
        </p>
      </TheorySection>

      {/* ---- 2. Nonlinear ODE ---- */}
      <TheorySection title="Plant — ODE (what RK4 integrates)">
        <Tex
          block
          tex={`J\\,\\dot\\omega = \\tau_m - b\\,\\omega - \\tau_{load}
            \\qquad\\dot\\theta = \\omega`}
        />
        <p className="text-xs text-slate-400">
          J = {MOTOR.J} kg·m², b = {MOTOR.b} N·m·s/rad, τ<sub>max</sub> = {MOTOR.tauMax} N·m.
          Output y = θ·(180/π) degrees. Load torque τ<sub>load</sub> = {load.toFixed(3)} N·m
          (set via disturbance slider — "someone leaning on the shaft").
        </p>
      </TheorySection>

      {/* ---- 3. Linearized transfer function ---- */}
      <TheorySection
        title={`Linearized at θ₀ = ${setpoint.toFixed(1)}°  (u₀ = ${lin.u0.toFixed(1)}%)`}
      >
        <Tex
          block
          tex={`G(s) = \\frac{\\Delta\\theta_{\\deg}}{\\Delta u}
            = \\frac{K_v}{s\\,(s + b/J)}
            = \\frac{${n3(Kv)}\\;\\tfrac{^\\circ/s^2}{\\%}}{s\\,(s + ${n3(MOTOR.b / MOTOR.J)})}`}
        />
        <Tex
          block
          tex={`\\equiv\\frac{K_v / (b/J)}{s\\,(\\tau_m s + 1)}
            = \\frac{${n3((Kv * tauM) / (tauM))}\\ }{s\\,(${n3(tauM)}\\,s+1)}`}
        />
        <p className="text-xs text-slate-400">
          This is a near-double integrator: the pole at s = −b/J = −{n3(MOTOR.b / MOTOR.J)} rad/s
          is very close to the origin. At frequencies above ≈ {n3(MOTOR.b / MOTOR.J)} rad/s the
          plant looks like a true 1/s² — P-only control cannot add phase lead, leaving ζ ≈ 0.01.
        </p>
        {lin.ps.length === 2 && (
          <p className="text-xs text-slate-400">
            Plant poles (open-loop): s = {lin.ps[0].re.toFixed(3)}
            {lin.ps[0].im !== 0 && ` ± j${Math.abs(lin.ps[0].im).toFixed(3)}`},{' '}
            s = {lin.ps[1].re.toFixed(3)}
            {lin.ps[1].im !== 0 && ` ± j${Math.abs(lin.ps[1].im).toFixed(3)}`}
          </p>
        )}
      </TheorySection>

      {/* ---- 4. Closed-loop ζ with live gains ---- */}
      {clFig && (
        <TheorySection title="Closed-loop stability (P + D only)">
          <Tex
            block
            tex={`\\omega_n = \\sqrt{K_p K_v} \\approx ${n3(clFig.wn)}\\,\\text{rad/s}
              \\qquad
              \\zeta = \\frac{b/J + K_d K_v}{2\\omega_n}\\approx${n3(clFig.zeta)}`}
          />
          {clFig.zeta < 0.1 && (
            <p className="text-xs text-amber-400">
              ζ ≈ {clFig.zeta.toFixed(3)} — severely underdamped! Ring frequency ≈{' '}
              {clFig.ringHz != null ? `${clFig.ringHz.toFixed(3)} Hz (≈ ${n3(clFig.wn)} rad/s)` : 'N/A'}.
              Look for the oscillation in the strip chart.
            </p>
          )}
          {clFig.zeta >= 0.1 && clFig.zeta < 0.5 && (
            <p className="text-xs text-sky-400">
              ζ ≈ {clFig.zeta.toFixed(3)} — underdamped. Some ringing visible.
            </p>
          )}
          {clFig.zeta >= 0.5 && (
            <p className="text-xs text-green-400">
              ζ ≈ {clFig.zeta.toFixed(3)} — well-damped. Clean step response.
            </p>
          )}
          <p className="text-xs text-slate-400 mt-1">
            With Kd = 0 (P only): ζ ≈ (b/J)/(2ωn). For Kp = 1 this gives ζ ≈ 0.013 — the plant
            rings for minutes because P control adds no damping. Add Kd to move ζ toward 0.7.
          </p>
          <Tex
            block
            tex={`\\zeta = \\frac{b/J + K_d K_v}{2\\sqrt{K_p K_v}}
              = \\frac{${n3(MOTOR.b / MOTOR.J)} + K_d \\cdot ${n3(Kv)}}{2\\sqrt{K_p \\cdot ${n3(Kv)}}}`}
          />
        </TheorySection>
      )}

      {/* ---- 5. On/off mode note ---- */}
      {controllerId === 'onoff' && (
        <TheorySection title="Relay control on a near-double integrator">
          <p className="text-xs text-slate-400">
            Bang-bang control on a pure inertia produces a parabolic position trajectory between
            switching events. The relay chatter frequency is much faster than the PID ring frequency
            because the plant integrates velocity — small position error bands lead to rapid
            back-and-forth ω switching. Observe in the strip chart.
          </p>
        </TheorySection>
      )}
    </>
  )
}
