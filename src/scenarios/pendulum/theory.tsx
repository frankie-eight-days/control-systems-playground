import { useMemo } from 'react'
import { eigenvalues } from '../../analysis/eig'
import { linearize } from '../../analysis/linearize'
import { useStore } from '../../state/store'
import { Tex } from '../../ui/Math'
import { TheorySection } from '../../ui/TheorySection'
import { CART, pendulumPlant } from './plant'

function fmtPole(re: number, im: number): string {
  if (Math.abs(im) < 1e-4) return re.toFixed(2)
  return `${re.toFixed(2)} ${im < 0 ? '−' : '+'} ${Math.abs(im).toFixed(2)}j`
}

/**
 * Cart-pole theory: the exact nonlinear EoM with live parameter values, the
 * LIVE eigenvalues of the linearization about upright (via analysis/eig —
 * the RHP pole flagged red with its time-to-double), the SISO-limitation
 * paragraph (why angle-only feedback can't hold the cart — the LQR teaser),
 * and the minimum-bandwidth note. The linearization is taken at the current
 * setpoint/nudge so the readout matches the operating point on screen.
 */
export function PendulumTheory() {
  const setpoint = useStore((s) => s.setpoint)
  const nudge = useStore((s) => s.dist.nudge ?? 0)

  const m = useMemo(() => {
    const d = { nudge }
    const eq = pendulumPlant.equilibrium(setpoint, d)
    const ss = linearize(pendulumPlant, eq.x, eq.u, d)
    const ev = eigenvalues(ss.A)
      .map((p) => ({ re: p.re, im: p.im }))
      .sort((a, b) => b.re - a.re)
    const reMax = ev[0]?.re ?? 0
    const unstable = reMax > 1e-3
    const t2 = unstable ? Math.LN2 / reMax : Infinity
    return { ev, reMax, unstable, t2 }
  }, [setpoint, nudge])

  return (
    <>
      <TheorySection title="Plant — cart-pole nonlinear EoM (what RK4 integrates)">
        <Tex
          block
          tex={`\\begin{aligned}
            \\ddot x &= \\frac{F - b\\dot x + m l\\dot\\varphi^2\\sin\\varphi - m g\\sin\\varphi\\cos\\varphi}{M + m\\sin^2\\varphi}\\\\[4pt]
            \\ddot\\varphi &= \\frac{-(F - b\\dot x)\\cos\\varphi + (M{+}m)g\\sin\\varphi - m l\\dot\\varphi^2\\sin\\varphi\\cos\\varphi}{l\\,(M + m\\sin^2\\varphi)}
          \\end{aligned}`}
        />
        <p className="text-xs text-slate-400">
          M={CART.M} kg, m={CART.m} kg, l={CART.l} m, b={CART.b} N·s/m, g={CART.g}. φ is measured
          from UPRIGHT (φ=0 ↑). F=((u−50)/50)·{CART.Fmax} N, so u=50% ⇒ F=0. The control
          effectiveness is negative (∂φ̈/∂F&lt;0 — push the cart toward the fall). Rail half-length{' '}
          {CART.track} m; |φ|&gt;{CART.fallen}° ⇒ FALLEN.
        </p>
      </TheorySection>

      <TheorySection title="Linearized about upright — live eigenvalues">
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <span className="text-slate-500">poles:</span>
          {m.ev.map((p, i) => {
            const red = p.re > 1e-3
            const zero = Math.abs(p.re) < 1e-3 && Math.abs(p.im) < 1e-3
            return (
              <span
                key={i}
                className={
                  red
                    ? 'rounded bg-red-950/60 px-1.5 py-0.5 text-red-300'
                    : zero
                      ? 'rounded bg-amber-950/50 px-1.5 py-0.5 text-amber-300'
                      : 'text-sky-300'
                }
              >
                {fmtPole(p.re, p.im)}
              </span>
            )
          })}
          <span className="text-slate-500">rad/s</span>
        </div>

        {m.unstable && (
          <p className="mt-2 rounded bg-red-950/40 px-2 py-1 text-xs text-red-300">
            ⚠ OPEN-LOOP UNSTABLE — a right-half-plane pole at +{m.reMax.toFixed(2)} rad/s. Any lean
            doubles in <strong>t₂ = ln2 / {m.reMax.toFixed(2)} = {m.t2.toFixed(3)} s</strong>.
            Hands-off, the pole falls; only the controller holds it up.
          </p>
        )}
        <p className="mt-2 rounded bg-amber-950/30 px-2 py-1 text-xs text-amber-300">
          The pole at <strong>0</strong> (amber) is the cart position x — a free integrator. No
          angle-only law can move it (see below). The LTI tabs use this same linearization; with a
          right-half-plane pole the Bode gain/phase margins are read with care — the L-tab flags it.
        </p>
      </TheorySection>

      <TheorySection title="The honest SISO limit — why the cart drifts (LQR teaser)">
        <p className="text-xs text-slate-400">
          The sensor is the pole angle φ <em>only</em>. A controller can pour all its effort into
          holding φ=0, but the cart position x is <strong>unobservable from φ and uncontrolled by
          an angle loop</strong> — that pole at the origin never moves. So the cart wanders (a
          steady nudge, sensor noise, or just the recovery transient sets it off) and eventually
          hits a rail end, even while the pole stays dead upright. Watch the cart-position aux
          trace: that is the failure the loop literally cannot see.
        </p>
        <Tex
          block
          tex={`\\text{angle loop stabilises }\\varphi\\ \\Rightarrow\\ \\text{pole at }0\\text{ for }x\\ \\Rightarrow\\ x\\text{ drifts} \\;\\rightsquigarrow\\; \\text{rail end}`}
        />
        <p className="text-xs text-slate-400">
          The fix is to stop pretending this is SISO: feed back all four states (x, ẋ, φ, φ̇) with a
          gain vector K — full state feedback / LQR — so the controller can trade a little pole
          angle to recentre the cart. That state-feedback chapter is the sequel this scenario sets
          up. (Swing-up from hanging is a separate nonlinear problem, also roadmap.)
        </p>
      </TheorySection>

      <TheorySection title="Minimum bandwidth — you must act faster than t₂">
        <p className="text-xs text-slate-400">
          Stabilising a right-half-plane pole sets a <em>floor</em> on loop bandwidth: the crossover
          must sit comfortably above the instability ({m.unstable ? m.reMax.toFixed(2) : '4.76'}{' '}
          rad/s) or the loop can’t correct a lean before it doubles (t₂ ≈{' '}
          {m.unstable ? m.t2.toFixed(2) : '0.15'} s). The D term provides the phase lead to get
          there; pure P sits on the imaginary axis (undamped wobble) and pure PI adds the wrong-way
          phase lag — neither stabilises. Drop Kd to 0 on the PD preset and watch the pole let go.
        </p>
      </TheorySection>
    </>
  )
}
