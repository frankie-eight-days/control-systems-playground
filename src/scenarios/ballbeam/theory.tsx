import { useMemo } from 'react'
import { eigenvalues } from '../../analysis/eig'
import { linearize } from '../../analysis/linearize'
import { useStore } from '../../state/store'
import { Tex } from '../../ui/Math'
import { TheorySection } from '../../ui/TheorySection'
import { BB, ballbeamPlant } from './plant'

/**
 * Ball & beam theory:
 *   1. The 5/7 rolling-sphere derivation (one mechanics result EEs enjoy).
 *   2. The full ODE with parameter values.
 *   3. Linearised G(s) = K/(s^2(tau*s+1)) with live K and tau.
 *   4. "Why P-only can't damp a double integrator" with live pole readout
 *      and predicted oscillation period at current Kp.
 *   5. Servo-lag note.
 */
export function BallBeamTheory() {
  const setpoint = useStore((s) => s.setpoint)
  const tilt = useStore((s) => s.dist.tilt ?? 0)
  const controllerId = useStore((s) => s.controllerId)
  const ctl = useStore((s) => s.ctl)

  // K = (5/7)*g*(thetaMax/50%) in (cm/s^2)/%
  // thetaMax/50 is the rad/% slope of the actuator
  const Krad = BB.rollFactor * BB.g * (BB.thetaMax / 50)  // (m/s^2)/%
  const K = Krad * BB.m2cm                                 // (cm/s^2)/%

  const lin = useMemo(() => {
    const d = { tilt }
    const eq = ballbeamPlant.equilibrium(setpoint, d)
    const ss = linearize(ballbeamPlant, eq.x, eq.u, d)
    const ps = eigenvalues(ss.A)
    return { u0: eq.u, ps }
  }, [setpoint, tilt])

  // Live closed-loop figures for PID in P-only mode
  const clFig = useMemo(() => {
    if (controllerId !== 'pid') return null
    const kp = ctl.kp ?? 0
    const kd = ctl.kd ?? 0
    // Char eq for G = K/(s^2(tau*s+1)) with P+D:
    //   tau*s^3 + s^2 + Kd*K*s + Kp*K = 0
    // Routh for marginal: row3 zero => 1*Kd*K - tau*Kp*K = 0 => Kd = tau*Kp
    // For P-only (Kd=0): imaginary axis roots at +-j*sqrt(Kp*K/1)... actually:
    //   s^3 + (1/tau)*s^2 + 0*s + Kp*K/tau = 0
    //   Routh: [1, 0, Kp*K/tau], [1/tau, Kp*K/tau, 0]
    //   Row3: (1/tau*0 - 1*Kp*K/tau) / (1/tau) = -Kp*K -> always < 0 for Kp>0
    //   -> marginally stable when Kp->0, oscillates at omega from auxiliary eq
    //   Auxiliary at marginal: (1/tau)*s^2 + Kp*K/tau = 0 => omega^2 = Kp*K
    //   => omega_n = sqrt(Kp * K_rad) (using m/s^2/% for dimensional consistency)
    //   (Kp in %/cm, K in cm/s^2/%, so Kp*K in 1/s^2)
    // Routh stability condition: Kd > tau * Kp (s^1 row sign check)
    const tauServo = BB.tauServo
    const isStable = kd > tauServo * kp
    // wn for PD approximate 2nd-order: omega_n ~ sqrt(Kp*K_rad) (dominant poles)
    const wn = kp > 0 ? Math.sqrt(kp * Krad) : 0
    // Damping ratio approximation from 3rd-order Routh
    const zeta = wn > 0 ? (kd * Krad) / (2 * wn) : 0
    return { wn, isStable, zeta }
  }, [controllerId, ctl, Krad])

  const n3 = (v: number) => v.toPrecision(3)

  return (
    <>
      {/* 1. Rolling-sphere derivation */}
      <TheorySection title="Rolling-sphere dynamics: where does 5/7 come from?">
        <p className="text-xs text-slate-400">
          A solid sphere of mass m and radius r rolling without slipping has moment of inertia
          J = (2/5)mr^2. A tilted beam exerts a gravitational component m*g*sin(theta) along the
          beam. Applying Newton for translation and rotation simultaneously:
        </p>
        <Tex
          block
          tex={`m\\ddot p = F_{net} - f_{rolling}\\qquad J\\ddot\\phi = r\\,f_{rolling}`}
        />
        <p className="text-xs text-slate-400">
          Rolling constraint: p_dot = r*phi_dot. Eliminating the friction force f:
        </p>
        <Tex
          block
          tex={`\\ddot p = -\\frac{g\\sin\\theta}{1 + J/(mr^2)} = -\\frac{g\\sin\\theta}{1 + 2/5} = -\\frac{5}{7}\\,g\\sin\\theta`}
        />
        <p className="text-xs text-slate-400">
          The 2/5 (= J/mr^2) is the rolling-resistance penalty: 5/7 of the force goes into
          translation, 2/7 into spinning the ball. A hollow sphere (J = 2/3 mr^2) gives 3/5;
          a point mass gives the full g*sin(theta).
        </p>
      </TheorySection>

      {/* 2. Full ODE */}
      <TheorySection title="Plant ODE (what RK4 integrates)">
        <Tex
          block
          tex={`\\dot p = v\\qquad \\dot v = -\\tfrac{5}{7}g\\sin\\theta\\qquad \\dot\\theta = \\frac{\\theta_{cmd}-\\theta}{\\tau}`}
        />
        <Tex
          block
          tex={`\\theta_{cmd} = \\frac{u-50}{50}\\cdot\\theta_{max}\\qquad u=50\\%\\Rightarrow\\theta_{cmd}=0`}
        />
        <p className="text-xs text-slate-400">
          g = {BB.g} m/s^2, tau = {BB.tauServo} s (servo), theta_max = {(BB.thetaMax * BB.rad2deg).toFixed(0)} deg.
          Output y = p * 100 cm. Beam half-length {BB.beamHalf * 100} cm: |p| {'>'}  {BB.beamHalf * 100} cm
          triggers ball-off failure. Tilt bias {tilt.toFixed(1)} deg added to effective theta.
        </p>
      </TheorySection>

      {/* 3. Linearised TF */}
      <TheorySection
        title={`Linearised at p0 = ${setpoint.toFixed(1)} cm  (u0 = ${lin.u0.toFixed(1)}%)`}
      >
        <Tex
          block
          tex={`G(s) = \\frac{\\Delta p_{cm}}{\\Delta u} = \\frac{K}{s^2(\\tau s+1)}
            = \\frac{${n3(K)}\\;\\tfrac{\\text{cm/s}^2}{\\%}}{s^2\\,(${BB.tauServo}\\,s+1)}`}
        />
        <p className="text-xs text-slate-400">
          K = (5/7) * g * (theta_max / 50%) * 100 = {n3(K)} (cm/s^2)/%.
          Open-loop poles: 0, 0 (double integrator from the beam kinematics) and -1/tau =
          -{(1 / BB.tauServo).toFixed(0)} rad/s (servo lag). Check the G tab: eigenvalues
          should read ~0, ~0, ~-{(1 / BB.tauServo).toFixed(0)}.
        </p>
        {lin.ps.length >= 2 && (
          <p className="text-xs text-slate-400">
            Numerical poles: {lin.ps.map((p, i) =>
              `s${i+1} = ${p.re.toFixed(3)}${p.im !== 0 ? ` +j${p.im.toFixed(3)}` : ''}`
            ).join(', ')}
          </p>
        )}
      </TheorySection>

      {/* 4. P-only instability -- Routh analysis */}
      {clFig && (
        <TheorySection title="Why P-only is always unstable">
          <p className="text-xs text-slate-400">
            With P control, C(s) = Kp, the closed-loop characteristic polynomial is:
          </p>
          <Tex
            block
            tex={`\\tau s^3 + s^2 + 0\\cdot s + K_p K = 0`}
          />
          <p className="text-xs text-slate-400">
            Routh array s^1 row = (1*0 - tau*Kp*K) / 1 = -tau*Kp*K.
            This is <em>negative</em> for any Kp &gt; 0: two roots are in the RHP.
            P-only is <strong>always unstable</strong> on this plant. The ball will
            always drift to the edge and fall off, regardless of Kp.
          </p>
          {clFig.isStable && clFig.zeta > 0 && (
            <p className="text-xs text-green-400">
              Routh stable (Kd = {(ctl.kd ?? 0).toFixed(3)} &gt; tau*Kp =&nbsp;
              {(BB.tauServo * (ctl.kp ?? 0)).toFixed(3)}).
              Approximate zeta ~ {clFig.zeta.toFixed(3)}.
            </p>
          )}
          {!clFig.isStable && (ctl.kd ?? 0) === 0 && (ctl.kp ?? 0) > 0 && (
            <p className="text-xs text-red-400">
              Kd = 0: Routh s^1 row is negative. System is unstable -- ball diverges.
              Add Kd &gt; tau*Kp = {(BB.tauServo * (ctl.kp ?? 0)).toFixed(3)} to stabilise.
            </p>
          )}
          {!clFig.isStable && (ctl.kd ?? 0) > 0 && (
            <p className="text-xs text-amber-400">
              Routh unstable: need Kd &gt; tau*Kp = {(BB.tauServo * (ctl.kp ?? 0)).toFixed(3)}.
              Current Kd = {(ctl.kd ?? 0).toFixed(3)}: increase it or reduce Kp.
            </p>
          )}
          {(ctl.kp ?? 0) === 0 && (
            <p className="text-xs text-slate-500">
              Set Kp &gt; 0 to see the Routh analysis.
            </p>
          )}
        </TheorySection>
      )}

      {/* 5. Servo-lag note */}
      <TheorySection title="Servo lag and the third pole">
        <p className="text-xs text-slate-400">
          The servo adds a pole at s = -1/tau = -{(1 / BB.tauServo).toFixed(0)} rad/s
          (tau = {BB.tauServo} s). For crossover frequencies well below {(1 / BB.tauServo).toFixed(0)} rad/s
          the servo looks like a pure gain and the system behaves like a double integrator.
          But the servo's phase lag becomes significant near crossover: a derivative filter
          at wf around {(1 / BB.tauServo).toFixed(0)} rad/s or higher avoids re-introducing
          the very lag the D term is trying to compensate.
        </p>
        <Tex
          block
          tex={`\\text{Phase(servo)} = -\\arctan(\\tau\\omega) \\approx ${
            ctl.wf
              ? `${(-(Math.atan(BB.tauServo * (ctl.wf ?? 100)) * BB.rad2deg)).toFixed(1)}^\\circ \\text{ at }\\omega_f=${(ctl.wf ?? 100).toFixed(0)}`
              : `-\\arctan(0.1\\omega)`
          }`}
        />
      </TheorySection>
    </>
  )
}
