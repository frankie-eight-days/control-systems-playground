import { useMemo } from 'react'
import { dcGain } from '../../analysis/freq'
import { linearize } from '../../analysis/linearize'
import { useStore } from '../../state/store'
import { Tex } from '../../ui/Math'
import { TheorySection } from '../../ui/TheorySection'
import { elecPole, Kt, mechPole, PMSM, rpmToRads, tauE, vMax } from './model'
import { torquePlant } from './torquePlant'
import { speedPlant, TAU_I } from './speedPlant'

const num = (v: number, d = 3) => (Number.isFinite(v) ? v.toPrecision(d) : '\\infty')

/** Mode-aware plant theory: the Park/Clarke transforms, the dq ODEs with live
 *  params, T=(3/2)pλi_q, and the per-mode design recipe with LIVE numbers. */
export function PmsmTheory() {
  const scenarioId = useStore((s) => s.scenarioId)
  return scenarioId === 'pmsm-speed' ? <SpeedTheory /> : <TorqueTheory />
}

/* ----- shared: the field-oriented machine (transforms + dq model) ----- */
function FocCommon() {
  return (
    <>
      <TheorySection title="FOC — rotate the frame until AC looks DC">
        <p className="mb-1 text-xs text-slate-400">
          Clarke takes the 3 phase currents to a 2-axis stationary frame (α,β); Park rotates that
          by the rotor angle θ<sub>e</sub> into the frame spinning WITH the magnet (d,q). In that
          frame the sinusoids become constants — i<sub>d</sub> is flux, i<sub>q</sub> is torque.
        </p>
        <Tex
          block
          tex={`\\begin{bmatrix}i_\\alpha\\\\i_\\beta\\end{bmatrix}=\\tfrac23\\begin{bmatrix}1&-\\tfrac12&-\\tfrac12\\\\0&\\tfrac{\\sqrt3}{2}&-\\tfrac{\\sqrt3}{2}\\end{bmatrix}\\begin{bmatrix}i_a\\\\i_b\\\\i_c\\end{bmatrix},\\quad \\begin{bmatrix}i_d\\\\i_q\\end{bmatrix}=\\begin{bmatrix}\\cos\\theta_e&\\sin\\theta_e\\\\-\\sin\\theta_e&\\cos\\theta_e\\end{bmatrix}\\begin{bmatrix}i_\\alpha\\\\i_\\beta\\end{bmatrix}`}
        />
        <p className="text-xs text-slate-400">
          The scene runs these <em>backwards</em> (inverse Park+Clarke) to light the windings from
          the live (i<sub>d</sub>,i<sub>q</sub>,θ<sub>e</sub>) — the AC you see IS this DC state.
        </p>
      </TheorySection>

      <TheorySection title="Machine — dq voltage equations (what RK4 integrates)">
        <Tex
          block
          tex={`L_d\\dot i_d = v_d - R\\,i_d + \\omega_e L_q i_q,\\qquad L_q\\dot i_q = v_q - R\\,i_q - \\omega_e(L_d i_d + \\lambda_m)`}
        />
        <Tex block tex={`T = \\tfrac32 p\\,\\lambda_m\\, i_q = K_t i_q,\\qquad J\\dot\\omega_m = T - T_{load} - b\\,\\omega_m`} />
        <p className="text-xs text-slate-400">
          R={PMSM.R} Ω, L<sub>d</sub>=L<sub>q</sub>={PMSM.Ld * 1e3} mH, λ<sub>m</sub>=
          {PMSM.lambdaM} Wb, p={PMSM.p}, J={PMSM.J} kg·m², b={PMSM.b} N·m·s/rad ⇒ K<sub>t</sub>=
          {Kt.toFixed(3)} N·m/A, electrical pole R/L={elecPole.toFixed(0)} rad/s (
          {(elecPole / (2 * Math.PI)).toFixed(1)} Hz), mech pole b/J={mechPole.toFixed(2)} rad/s.
        </p>
      </TheorySection>
    </>
  )
}

/* ----------------------------- TORQUE mode ----------------------------- */
function TorqueTheory() {
  const setpoint = useStore((s) => s.setpoint) // N·m
  const dynoRpm = useStore((s) => s.dist.dynoRpm ?? 0)
  const decouple = useStore((s) => s.dist.decouple ?? 1)
  const vdc = useStore((s) => s.dist.vdc ?? PMSM.Vdc)
  const kp = useStore((s) => s.ctl.kp ?? 0)
  const ki = useStore((s) => s.ctl.ki ?? 0)

  const lin = useMemo(() => {
    const d = { dynoRpm, decouple, vdc }
    const eq = torquePlant.equilibrium(setpoint, d)
    const ss = linearize(torquePlant, eq.x, eq.u, d)
    const K = dcGain(ss) // u → T DC gain
    return { u0: eq.u, K, ss }
  }, [setpoint, dynoRpm, decouple, vdc])

  const we = PMSM.p * rpmToRads(dynoRpm)
  const vm = vMax(vdc)
  const kU = vm / 50 // V per % command
  const dcHand = (Kt * kU) / PMSM.R // hand DC gain u→T
  const zRatio = kp > 0 ? ki / kp : 0 // PI zero location
  const cancels = kp > 0 && Math.abs(zRatio - elecPole) / elecPole < 0.05

  // headroom at the present operating point
  const iq = setpoint / Kt
  const vq = PMSM.R * iq + we * PMSM.lambdaM
  const vmagPct = (Math.hypot(decouple ? 0 : -we * PMSM.Lq * iq, vq) / vm) * 100

  return (
    <>
      <FocCommon />
      <TheorySection title={`Torque-loop plant — linearized at T₀=${setpoint.toFixed(2)} N·m, ${dynoRpm.toFixed(0)} rpm`}>
        <p className="mb-1 text-xs text-slate-400">
          The dyno fixes ω<sub>m</sub>, so the plant is just the i<sub>q</sub> current dynamics
          (i<sub>d</sub> held at 0 by the decoupler). v<sub>q</sub>=((u−50)/50)·V<sub>max</sub>,
          V<sub>max</sub>=V<sub>dc</sub>/√3={vm.toFixed(1)} V.
        </p>
        <Tex
          block
          tex={`G(s)=\\frac{T}{u}=\\frac{K_t\\,(V_{max}/50)/R}{\\tau_e s+1}=\\frac{${num(dcHand)}\\,\\text{N·m/\\%}}{${num(tauE * 1e3)}\\text{ms}\\;s+1},\\quad \\text{pole }=\\tfrac{R}{L}=${elecPole.toFixed(0)}\\,\\text{rad/s}`}
        />
        <p className="text-xs text-slate-400">
          On-screen linearization DC gain ={num(lin.K)} N·m/% (matches the hand value
          {num(dcHand)}). Pole sits at {(elecPole / (2 * Math.PI)).toFixed(1)} Hz on the G tab.
        </p>
      </TheorySection>

      <TheorySection title="The FOC recipe — pole-zero cancellation">
        <p className="mb-1 text-xs text-slate-400">
          A PI controller C(s)=K<sub>p</sub>+K<sub>i</sub>/s places a zero at −K<sub>i</sub>/K
          <sub>p</sub>. Park it ON the electrical pole R/L and the loop collapses to a pure
          integrator → first-order closed loop, PM≈90°.
        </p>
        <Tex
          block
          tex={`\\frac{K_i}{K_p}=${num(zRatio)}\\ \\text{rad/s}\\ \\;${cancels ? '=' : '\\neq'}\\;\\ \\frac{R}{L}=${elecPole.toFixed(0)}\\ \\text{rad/s}`}
        />
        <p className={`text-xs font-semibold ${cancels ? 'text-emerald-400' : 'text-amber-400'}`}>
          {cancels
            ? '✓ zero ON the pole — clean cancellation; expect a crisp first-order step and PM≈90°.'
            : '✗ zero is off the pole — a slow leftover closed-loop pole gives a visible tail (or peaking). Check the L/T tabs.'}
        </p>
      </TheorySection>

      <TheorySection title="Voltage headroom (why V_dc was raised to 80 V)">
        <p className="text-xs text-slate-400">
          At {dynoRpm.toFixed(0)} rpm the back-EMF ω<sub>e</sub>λ<sub>m</sub>=
          {(we * PMSM.lambdaM).toFixed(1)} V already uses{' '}
          {((we * PMSM.lambdaM) / vm * 100).toFixed(0)}% of V<sub>max</sub>. Holding T₀ here needs
          |v<sub>dq</sub>| ≈ {vmagPct.toFixed(0)}% of V<sub>max</sub>. The loop saturates when this
          hits 100% — that is the &quot;back-EMF ambush&quot;: crank the dyno and watch v<sub>q</sub>
          run out of room.
        </p>
      </TheorySection>
    </>
  )
}

/* ----------------------------- SPEED mode ------------------------------ */
function SpeedTheory() {
  const setpoint = useStore((s) => s.setpoint) // rpm
  const tload = useStore((s) => s.dist.tload ?? 0)
  const jmult = useStore((s) => s.dist.jmult ?? 1)
  const kp = useStore((s) => s.ctl.kp ?? 0)
  const ki = useStore((s) => s.ctl.ki ?? 0)

  const lin = useMemo(() => {
    const d = { tload, jmult }
    const eq = speedPlant.equilibrium(setpoint, d)
    const ss = linearize(speedPlant, eq.x, eq.u, d)
    const K = dcGain(ss) // u → rpm DC gain
    return { u0: eq.u, K, ss }
  }, [setpoint, tload, jmult])

  const innerHz = 1 / (2 * Math.PI * TAU_I)
  const Jeff = PMSM.J * jmult
  const mechHz = PMSM.b / Jeff / (2 * Math.PI)

  // live outer crossover estimate (approx): the plant magnitude is integrator-
  // like; for a PI with zero z=Ki/Kp we report the designed fc only loosely —
  // the exact value is on the L tab. Here we just compute the SEPARATION cue.
  const fcGuess = useMemo(() => approxCrossoverHz(kp, ki, Jeff), [kp, ki, Jeff])
  const sep = fcGuess > 0 ? innerHz / fcGuess : Infinity
  const wellSep = sep >= 5

  return (
    <>
      <FocCommon />
      <TheorySection title="Cascade — the inner loop IS demo 1's closed current loop">
        <p className="mb-1 text-xs text-slate-400">
          The torque demo&apos;s well-tuned current loop (pole-zero-cancellation preset) is
          first-order and fast. Here it becomes this demo&apos;s <em>actuator</em>, modeled as a
          single lag τ<sub>i</sub>={(TAU_I * 1e3).toFixed(1)} ms. The outer loop commands
          i<sub>q</sub>*=((u−50)/50)·I<sub>max</sub>.
        </p>
        <Tex
          block
          tex={`\\dot i_q=\\frac{i_q^*-i_q}{\\tau_i},\\qquad J\\dot\\omega_m=K_t i_q-T_{load}-b\\,\\omega_m`}
        />
        <Tex
          block
          tex={`G(s)=\\frac{\\omega_m[\\text{rpm}]}{u}=\\frac{${num(lin.K, 4)}}{(\\tau_i s+1)(\\tfrac{J}{b}s+1)},\\;\\; \\tfrac1{2\\pi\\tau_i}=${innerHz.toFixed(0)}\\,\\text{Hz},\\;\\tfrac{b}{J}=${(PMSM.b / Jeff).toFixed(2)}\\,\\text{rad/s}`}
        />
        <p className="text-xs text-slate-400">
          Inner-lag pole at {innerHz.toFixed(0)} Hz and the mechanical pole at {mechHz.toFixed(3)}{' '}
          Hz are both visible on the G tab. On-screen DC gain ={num(lin.K, 4)} rpm/%.
        </p>
      </TheorySection>

      <TheorySection title="Separation of time scales">
        <p className="mb-1 text-xs text-slate-400">
          Cascade design works when the outer crossover sits well below the inner-loop pole — a
          decade is the textbook rule. Push the outer loop too fast and it fights the lag it
          assumed was infinitely fast.
        </p>
        <Tex
          block
          tex={`\\frac{1/(2\\pi\\tau_i)}{f_{c,\\text{outer}}}\\approx\\frac{${innerHz.toFixed(0)}}{${fcGuess > 0 ? fcGuess.toFixed(0) : '?'}}\\approx ${Number.isFinite(sep) ? sep.toFixed(1) : '\\infty'}\\times`}
        />
        <p className={`text-xs font-semibold ${wellSep ? 'text-emerald-400' : 'text-amber-400'}`}>
          {wellSep
            ? '✓ ≥5× separation — the inner lag is invisible to the outer loop; healthy PM.'
            : '✗ <5× separation — the inner lag eats phase at crossover; PM collapses (see the L tab).'}
        </p>
        <p className="text-xs text-slate-500">
          f<sub>c</sub> here is an estimate; read the exact crossover and PM off the L tab. With the
          flywheel (J×{jmult.toFixed(1)}) the same gains give a different f<sub>c</sub> — the plant
          changed, so retune.
        </p>
      </TheorySection>

      <TheorySection title="Large-signal caveat — integrator windup">
        <p className="text-xs text-slate-400">
          The margins above describe the <em>small-signal</em> loop. A big step from rest saturates
          the torque current at I<sub>max</sub> for the whole acceleration; while u is pinned the
          integrator keeps charging, so the speed overshoots far more than PM≈
          {/* purely informative */}71° would suggest, then unwinds. That is windup, not a bad tune
          — nudge the setpoint a little (e.g. {Math.min(3000, Math.round(setpoint / 10) * 10 + 200)}{' '}
          rpm) and the small step matches the linear prediction. Real drives add velocity
          feedforward / a motion profile so the loop never saturates; the back-calculation
          anti-windup here only partly tames it.
        </p>
      </TheorySection>
    </>
  )
}

/**
 * Rough outer-loop crossover (Hz) for the cue only. The mechanical plant is
 * near-integrator (b/J ≪ ω of interest), so |G(jω)| ≈ DC·(b/J)/ω over the band;
 * with a PI whose |C| ≈ Kp at crossover, |L|=1 ⇒ ω_c ≈ Kp·DC·(b/J). We fold in
 * the τ_i and zero only weakly — the exact figure lives on the L tab.
 */
function approxCrossoverHz(kp: number, ki: number, Jeff: number): number {
  if (kp <= 0 && ki <= 0) return 0
  // DC gain rpm/% of the full plant (= Imax/50 · Kt · (60/2π) / b).
  const dcRpmPerPct = ((PMSM.Imax / 50) * Kt * (60 / (2 * Math.PI))) / PMSM.b
  const bJ = PMSM.b / Jeff // mechanical pole, rad/s
  // |G(jω)| for (τ_i s+1)(J/b s+1): DC / (|1+jωJ/b|·|1+jωτ_i|).
  const gMag = (w: number) =>
    dcRpmPerPct / (Math.hypot(1, w / bJ) * Math.hypot(1, w * TAU_I))
  const cMag = (w: number) => Math.hypot(kp, ki / w)
  // Solve |C·G| = 1 by log-domain fixed point (the plant rolls off ≥1st order,
  // so this converges); the EXACT crossover is read off the L tab.
  let w = Math.max(1e-3, kp * dcRpmPerPct * bJ)
  for (let i = 0; i < 60; i++) {
    const L = cMag(w) * gMag(w)
    if (!Number.isFinite(L) || L <= 0) return 0
    w *= Math.pow(L, 0.4)
    if (!Number.isFinite(w) || w <= 0) return 0
  }
  return w / (2 * Math.PI)
}
