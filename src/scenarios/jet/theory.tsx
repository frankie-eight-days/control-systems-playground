import { useMemo } from 'react'
import { useStore } from '../../state/store'
import { Tex } from '../../ui/Math'
import { TheorySection } from '../../ui/TheorySection'
import { JET, MaOfCg } from './plant'

const rad2deg = 180 / Math.PI

/** Eigenvalues of the short-period 2×2 block A_sp = [[Zv,1],[Mα,Mq]]. */
function shortPeriodPoles(Ma: number): { re: number; im: number }[] {
  const tr = JET.Zv + JET.Mq
  const det = JET.Zv * JET.Mq - Ma
  const disc = tr * tr - 4 * det
  if (disc >= 0) {
    const r = Math.sqrt(disc)
    return [
      { re: (tr - r) / 2, im: 0 },
      { re: (tr + r) / 2, im: 0 },
    ]
  }
  const r = Math.sqrt(-disc) / 2
  return [
    { re: tr / 2, im: -r },
    { re: tr / 2, im: r },
  ]
}

function fmtPole(p: { re: number; im: number }): string {
  if (Math.abs(p.im) < 1e-6) return p.re.toFixed(2)
  return `${p.re.toFixed(2)} ${p.im < 0 ? '−' : '+'} ${Math.abs(p.im).toFixed(2)}j`
}

/**
 * Plant theory: the short-period ODEs with live coefficients, the LIVE
 * eigenvalues of the linearized A (short-period pair computed from the 2×2
 * block, plus the θ integrator at 0 and the actuator at −1/τ) with
 * time-to-double when unstable (red), and the fly-by-wire rationale +
 * honesty notes. Everything recomputes as the CG slider moves.
 */
export function JetTheory() {
  const cg = useStore((s) => s.dist.cg ?? 0.75)

  const m = useMemo(() => {
    const Ma = MaOfCg(cg) // nominal (small-α) static derivative
    const poles = shortPeriodPoles(Ma)
    const reMax = Math.max(poles[0].re, poles[1].re)
    const unstable = reMax > 1e-4
    const t2 = unstable ? Math.LN2 / reMax : Infinity
    // dynamic boundary: det = 0 ⇒ Mα = Zv·Mq; classic neutral point: Mα = 0
    const cgBoundary = (JET.Zv * JET.Mq + 4) / 16
    const cgNeutral = 4 / 16
    return { Ma, poles, reMax, unstable, t2, cgBoundary, cgNeutral }
  }, [cg])

  const actPole = -1 / JET.tauAct

  return (
    <>
      <TheorySection title="Plant — longitudinal short period (what RK4 integrates)">
        <Tex
          block
          tex={`\\begin{aligned}
            \\dot\\alpha &= Z_v\\,\\alpha + q &
            \\dot q &= M_{\\alpha}^{\\text{eff}}\\,\\alpha + M_q\\,q + M_\\delta\\,\\delta \\\\
            \\dot\\theta &= q &
            \\dot\\delta &= (\\delta_{cmd}-\\delta)/\\tau_{act}
          \\end{aligned}`}
        />
        <p className="text-xs text-slate-400">
          Z<sub>v</sub>={JET.Zv} s⁻¹, M<sub>q</sub>={JET.Mq} s⁻¹, M<sub>δ</sub>={JET.Mdelta} s⁻²,
          τ<sub>act</sub>={JET.tauAct} s, δ<sub>max</sub>=±{(JET.dmax * rad2deg).toFixed(0)}°.
          δ<sub>cmd</sub>=((u−50)/50)·δ<sub>max</sub>, so u=50% fairs the elevator (trim).
        </p>
        <Tex
          block
          tex={`M_{\\alpha}^{\\text{eff}}(\\text{cg}) = -4 + 16\\,\\text{cg} = ${m.Ma.toFixed(2)}\\ \\text{s}^{-2}\\quad(\\text{cg}=${cg.toFixed(2)})`}
        />
        <p className="text-xs text-slate-400">
          The CG slider sets the static stability derivative. Forward CG (small cg) → M
          <sub>α</sub> negative → restoring → stable; aft CG → M<sub>α</sub> positive →
          divergent → the airframe wants to pitch away from trim. Drag the CG slider and watch the
          poles below walk across the imaginary axis.
        </p>
      </TheorySection>

      <TheorySection title="Linearized poles — live (recomputed as CG moves)">
        <div className="space-y-1.5 font-mono text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">short period:</span>
            {m.poles.map((p, i) => {
              const red = p.re > 1e-4
              return (
                <span
                  key={i}
                  className={red ? 'rounded bg-red-950/60 px-1.5 py-0.5 text-red-300' : 'text-sky-300'}
                >
                  {fmtPole(p)}
                </span>
              )
            })}
            <span className="text-slate-500">rad/s</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <span className="text-slate-500">θ integrator:</span>
            <span>0.00</span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-500">actuator:</span>
            <span>{actPole.toFixed(2)}</span>
            <span className="text-slate-500">rad/s</span>
          </div>
        </div>

        {m.unstable ? (
          <p className="mt-2 rounded bg-red-950/40 px-2 py-1 text-xs text-red-300">
            ⚠ OPEN-LOOP UNSTABLE — a right-half-plane pole at +{m.reMax.toFixed(2)} rad/s. Any
            disturbance doubles in <strong>t₂ = ln2 / {m.reMax.toFixed(2)} = {m.t2.toFixed(2)} s</strong>.
            Hands-off, the jet departs; only the controller keeps it flying.
          </p>
        ) : (
          <p className="mt-2 rounded bg-emerald-950/40 px-2 py-1 text-xs text-emerald-300">
            ✓ Open-loop stable — all poles in the left half-plane. A forward-CG airframe flies
            itself; the controller only sharpens the response.
          </p>
        )}

        <p className="mt-2 text-xs text-slate-400">
          A<sub>sp</sub> = [[Z<sub>v</sub>, 1], [M<sub>α</sub>, M<sub>q</sub>]] has trace Z<sub>v</sub>
          +M<sub>q</sub> = −2.2 (fixed) and det = Z<sub>v</sub>M<sub>q</sub>−M<sub>α</sub> ={' '}
          {(JET.Zv * JET.Mq - m.Ma).toFixed(2)}. A real pole reaches the RHP when det = 0 ⇒ M
          <sub>α</sub> = Z<sub>v</sub>M<sub>q</sub> = +{(JET.Zv * JET.Mq).toFixed(1)}, i.e.{' '}
          <strong>cg = {m.cgBoundary.toFixed(3)}</strong> (the dynamic boundary). The classic static
          neutral point (M<sub>α</sub> = 0) is at cg = {m.cgNeutral.toFixed(2)}, but pitch damping
          M<sub>q</sub> holds the airframe dynamically stable a little past it.
        </p>
      </TheorySection>

      <TheorySection title="Why fly-by-wire exists">
        <p className="text-xs text-slate-400">
          A statically stable jet (forward CG) trims itself but resists manoeuvre — the same
          restoring moment that returns it to level fights every commanded pitch change. Designers
          therefore move the CG aft, <em>relaxing</em> static stability to buy crisp,
          low-stick-force manoeuvrability. Past the neutral point the airframe is genuinely
          unstable (the poles above), un-flyable by a human in the loop — so a flight-control
          computer closes a fast inner loop that synthesises the missing stability electronically.
          This scenario is that inner loop: a fuzzy (or PID) law turning an open-loop-unstable
          airframe into a docile one. Relaxed stability buys agility; the computer buys back
          control.
        </p>
      </TheorySection>

      <TheorySection title="Honest about the simplifications">
        <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-slate-400">
          <li>
            No airspeed or altitude states — this is the short-period approximation at one flight
            condition (the slow phugoid and speed/Mach effects are omitted). Coefficients are
            constant, not scheduled with q̄ or Mach.
          </li>
          <li>
            Written in perturbation form about trimmed level flight, so the equilibrium is the
            origin (α=0, δ=0) with a 50% quiescent command — not a solved nonlinear trim with a
            nonzero α<sub>trim</sub>.
          </li>
          <li>
            Post-stall aerodynamics simplified: above |α| = {(JET.alphaStall * rad2deg).toFixed(0)}°
            the moment slope fades toward a mild −2 and lift slope is scaled via a smooth sigmoid —
            enough to make big upsets "mush" and become hard to recover, but not a real separated-flow
            model.
          </li>
        </ul>
      </TheorySection>
    </>
  )
}
