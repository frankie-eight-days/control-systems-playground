import { useMemo } from 'react'
import { eigenvalues } from '../../analysis/eig'
import { linearize } from '../../analysis/linearize'
import { useStore } from '../../state/store'
import { Tex } from '../../ui/Math'
import { TheorySection } from '../../ui/TheorySection'
import { currentForGap, MAGLEV, maglevPlant, rhpPole } from './plant'

/**
 * Maglev plant theory: the inverse-square ODE with live values, the elegant
 * λ = √(2g/z₀) derivation, and the LIVE eigenvalues of the 3-state
 * linearization (from the shared numerical linearizer) tracking the SETPOINT —
 * the operating point IS the commanded gap, so dragging the setpoint walks the
 * pole, exactly like the jet's CG slider but driven by the reference.
 */
export function MaglevTheory() {
  const sp = useStore((s) => s.setpoint) // mm
  const mass = useStore((s) => s.dist.mass ?? 1)
  const vSupply = useStore((s) => s.dist.vSupply ?? 1)

  const m = useMemo(() => {
    const d = { mass, vSupply }
    const eq = maglevPlant.equilibrium(sp, d)
    const ss = linearize(maglevPlant, eq.x, eq.u, d)
    const ev = eigenvalues(ss.A)
      .map((r) => ({ re: r.re, im: r.im }))
      .sort((a, b) => b.re - a.re)
    const z = sp / 1000
    const lam = rhpPole(z) // analytic +√(2g/z)
    const t2ms = (Math.LN2 / lam) * 1000
    return { eq, ev, lam, t2ms, i0: currentForGap(z, mass) }
  }, [sp, mass, vSupply])

  const fmtPole = (p: { re: number; im: number }) =>
    Math.abs(p.im) < 1e-3 ? p.re.toFixed(1) : `${p.re.toFixed(1)} ± ${Math.abs(p.im).toFixed(1)}j`

  return (
    <>
      <TheorySection title="Plant — inverse-square levitation (what RK4 integrates)">
        <Tex
          block
          tex={`m\\,\\ddot z = m g - \\frac{C\\,i^2}{z^2}, \\qquad \\tau_{coil}\\,\\dot i = i_{cmd} - i`}
        />
        <p className="text-xs text-slate-400">
          m={MAGLEV.m * 1000} g, C={MAGLEV.C.toExponential(2)} N·m²/A², τ<sub>coil</sub>=
          {MAGLEV.tauCoil * 1000} ms, i<sub>max</sub>={MAGLEV.iMax} A. z = air gap (mm), measured
          DOWN from the magnet — the ball hangs below, so a wider gap is a weaker pull. i<sub>cmd</sub>
          = (u/100)·i<sub>max</sub>·v<sub>supply</sub>, and i² ≥ 0 always:{' '}
          <strong className="text-slate-300">the magnet can only PULL.</strong>
        </p>
      </TheorySection>

      <TheorySection title="Why it's unstable — λ = √(2g/z₀), two lines">
        <Tex
          block
          tex={`\\ddot z = g - \\tfrac{C}{m}\\tfrac{i^2}{z^2}\\;\\Rightarrow\\; \\left.\\frac{\\partial \\ddot z}{\\partial z}\\right|_0 = +\\frac{2C}{m}\\frac{i_0^2}{z_0^3} = +\\frac{2g}{z_0}`}
        />
        <p className="text-xs text-slate-400">
          (using the trim balance <Tex tex="\frac{C}{m}\frac{i_0^2}{z_0^2}=g" />). So the gap
          subsystem is <Tex tex="\ddot{\Delta z} = \tfrac{2g}{z_0}\,\Delta z" /> with poles
        </p>
        <Tex block tex={`s = \\pm\\sqrt{\\tfrac{2g}{z_0}}\\quad\\Rightarrow\\quad \\lambda = +\\sqrt{\\tfrac{2g}{z_0}}`} />
        <p className="text-xs text-slate-400">
          The unstable pole depends ONLY on g and the gap — not m, not C, not i₀. Wider gap → slower
          instability; tighter gap → faster. That is the whole control problem in one square root.
        </p>
      </TheorySection>

      <TheorySection title={`Linearized poles — live at z* = ${sp.toFixed(1)} mm (i₀ = ${m.i0.toFixed(3)} A)`}>
        <div className="space-y-1.5 font-mono text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500">eigenvalues:</span>
            {m.ev.map((p, k) => {
              const red = p.re > 1e-3
              return (
                <span
                  key={k}
                  className={
                    red ? 'rounded bg-red-950/60 px-1.5 py-0.5 text-red-300' : 'text-sky-300'
                  }
                >
                  {fmtPole(p)}
                </span>
              )
            })}
            <span className="text-slate-500">rad/s</span>
          </div>
        </div>
        <p className="mt-2 rounded bg-red-950/40 px-2 py-1 text-xs text-red-300">
          ⚠ OPEN-LOOP UNSTABLE — RHP pole at +{m.lam.toFixed(1)} rad/s. Time-to-double{' '}
          <strong>t₂ = ln2 / {m.lam.toFixed(1)} = {m.t2ms.toFixed(0)} ms</strong> — the fastest plant
          in the app. Unaided the ball departs in a few flaps; only the controller (with derivative
          action) keeps it floating.
        </p>
        <p className="mt-2 text-xs text-slate-400">
          The third pole is the coil at −1/τ<sub>coil</sub> = {(-1 / MAGLEV.tauCoil).toFixed(0)} rad/s.
          <strong className="text-slate-300"> Drag the setpoint</strong> and watch the RHP pole move:
          this is the operating point, so the pole you must stabilize changes with the gap you ask for
          — the unstable cousin of the tank's level-dependent √h pole. Gains tuned at one gap are not
          right at another.
        </p>
      </TheorySection>

      <TheorySection title="The one-sided actuator, and where the linear story ends">
        <p className="text-xs text-slate-400">
          The coil only pulls UP; gravity is the only DOWN. A bipolar actuator could push the ball
          either way, but a magnet cannot repel a steel ball — so the controller fights a fundamentally
          one-sided fight, and at u = 0 the ball is in free fall. That is why the command saturates
          hard at 0% (let go) and 100% (max pull), and why losing the gap to either failure stop is
          terminal.
        </p>
        <p className="mt-1 text-xs text-amber-300/90">
          Linearization-validity warning: the i²/z² nonlinearity is steep. The Bode/pole picture holds
          only in a thin band around z*; push the gap a few mm and the gain and the pole have already
          moved (i₀ scales like z, the pole like 1/√z). That is why every frequency plot here is
          labelled with its operating point — there is no single G(s) for this plant, only a family.
        </p>
      </TheorySection>
    </>
  )
}
