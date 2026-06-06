import { useMemo } from 'react'
import { dcGain } from '../../analysis/freq'
import { linearize } from '../../analysis/linearize'
import { useStore } from '../../state/store'
import { Tex } from '../../ui/Math'
import { TheorySection } from '../../ui/TheorySection'
import { CAR, cruisePlant } from './plant'

/**
 * Cruise-control plant theory: the exact nonlinear ODE being integrated plus
 * the linearized transfer function evaluated live at the current operating
 * point. Includes the P-only steady-state error formula and a note on the
 * no-brakes asymmetry.
 */
export function CruiseTheory() {
  const setpoint = useStore((s) => s.setpoint)
  const grade = useStore((s) => s.dist.grade ?? 0)
  const wind = useStore((s) => s.dist.wind ?? 0)
  const kp = useStore((s) => s.ctl.kp ?? 0)
  const ki = useStore((s) => s.ctl.ki ?? 0)
  const controllerId = useStore((s) => s.controllerId)

  const lin = useMemo(() => {
    const d = { grade, wind }
    const eq = cruisePlant.equilibrium(setpoint, d)
    const ss = linearize(cruisePlant, eq.x, eq.u, d)
    // First-order plant: A = [[a]], B = [b], C = [c]
    // τ = -1/a,  K = -c·b/a  (DC gain in (km/h)/%)
    const a = ss.A[0][0]
    const tau = a < -1e-9 ? -1 / a : Infinity
    const K = dcGain(ss)
    return { u0: eq.u, tau, K }
  }, [setpoint, grade, wind])

  const num = (v: number, d = 3) => (Number.isFinite(v) ? v.toPrecision(d) : '\\infty')

  // Steady-state error with P-only: e_ss = dist / (1 + Kp·K)
  // where dist is the incremental force load expressed in km/h output units.
  // We compute as: at the current grade/wind the eq u changes — that delta u × K = dist in km/h.
  const eSSPOnly = useMemo(() => {
    if (!Number.isFinite(lin.K) || lin.K <= 0) return null
    // With P-only, the closed-loop error at steady-state satisfies:
    // u_eq = Kp · e_ss  →  e_ss = u_eq / Kp (if we started at r with u0=0)
    // More precisely: e_ss = (u_eq − u0_flat) / Kp  ... but the lesson is:
    // e_ss = d_output / (1 + Kp·K), where d_output = (u_eq × K) roughly.
    // Use the disturbance contribution: delta_u_dist = u_eq, equiv output = lin.K · lin.u0
    // For a clean formula we note K = Δy/Δu → e_ss when load = Kp·K × e gives:
    // e_ss = load_in_kmh / (1 + Kp·K), load_in_kmh = u0 × K (force/actuator)
    // This captures the "grade shifts u0" lesson accurately.
    return (lin.u0 * lin.K) / (1 + kp * lin.K)
  }, [lin.K, lin.u0, kp])

  return (
    <>
      <TheorySection title="Plant — nonlinear ODE (what RK4 integrates)">
        <Tex
          block
          tex={`m\\,\\dot v = \\underbrace{\\tfrac{u}{100}F_{\\max}}_{\\text{traction}} - \\underbrace{\\tfrac{1}{2}\\rho C_d A(v+w)\\lvert v+w\\rvert}_{\\text{aero}} - \\underbrace{\\mu m g}_{\\text{roll}} - \\underbrace{mg\\tfrac{G}{100}}_{\\text{grade}}`}
        />
        <p className="text-xs text-slate-400">
          m={CAR.mass} kg, F<sub>max</sub>={CAR.fMax} N, ρ={CAR.rho} kg/m³, C<sub>d</sub>A={CAR.cdA} m²,{' '}
          μ={CAR.mu}, g={CAR.g} m/s². Output y=3.6·v (km/h). u∈[0,100]% — no brakes.
        </p>
      </TheorySection>

      <TheorySection
        title={`Linearized at v₀ = ${(setpoint / 3.6).toFixed(1)} m/s  (r=${setpoint.toFixed(0)} km/h, u₀=${lin.u0.toFixed(1)}%)`}
      >
        {Number.isFinite(lin.tau) ? (
          <>
            <Tex
              block
              tex={`G(s) = \\frac{\\Delta y_{\\text{km/h}}}{\\Delta u} = \\frac{${num(lin.K)}\\ \\tfrac{\\text{km/h}}{\\%}}{${num(lin.tau)}\\,s + 1}`}
            />
            <p className="text-xs text-slate-400">
              The aero drag slope is{' '}
              <Tex tex={`2\\cdot\\tfrac{1}{2}\\rho C_d A\\,v_0 = ${(CAR.rho * CAR.cdA * (setpoint / 3.6)).toFixed(1)}`} />{' '}
              N/(m/s). τ = m / drag_slope, K = (F<sub>max</sub>/100) / drag_slope × 3.6.
              Both depend on v₀ — change the setpoint and watch them shift.
            </p>
          </>
        ) : (
          <p className="text-xs text-slate-400">
            Car is stalled (v₀ ≈ 0) — no aerodynamic restoring force, dynamics not first-order here.
          </p>
        )}
      </TheorySection>

      {controllerId === 'pid' && (
        <TheorySection title="Steady-state error — P-only vs PI">
          <Tex
            block
            tex={`e_{ss} = \\frac{\\text{load}}{1 + K_p K}${kp > 0 && Number.isFinite(eSSPOnly) ? `\\approx ${eSSPOnly!.toFixed(1)}\\ \\text{km/h}` : ''}`}
          />
          <p className="text-xs text-slate-400">
            With P-only, a grade or headwind shifts the equilibrium throttle by Δu = u₀.
            The controller only produces that Δu when the error is e<sub>ss</sub> = Δu / K<sub>p</sub>.
            {ki > 0
              ? ' With Ki > 0 the integrator eliminates e_ss — watch it vanish on the strip chart.'
              : ' Add Ki to eliminate it (press "PI — offset gone" preset).'}
          </p>
        </TheorySection>
      )}

      <TheorySection title="No-brakes asymmetry">
        <p className="text-xs text-slate-400">
          The actuator is one-sided: u ∈ [0, 100]%. On a steep downhill the controller saturates
          at u = 0 (engine off / coasting) and cannot decelerate. The car overshoots the setpoint
          and stays above it until the road levels out. This is not a PID tuning problem — it is
          a physical limit. Real cruise control uses engine braking or ABS; this simulation
          deliberately omits both.
        </p>
      </TheorySection>
    </>
  )
}
