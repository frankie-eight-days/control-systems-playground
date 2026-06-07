import { useEffect, useRef, useState } from 'react'
import { engine } from '../../state/engine'
import { useStore } from '../../state/store'
import { CENTERS, controlSurface, evalFuzzy, RULES, TERMS, type FuzzyEval } from './fuzzy'
import { JET } from './plant'

const rad2deg = 180 / Math.PI

/**
 * The fuzzy controller's analysis views, promoted into the Bode-panel tab slots
 * (where L / T,S / C anatomy live for a linear controller). A Mamdani FLC has
 * no C(jω), so instead of dead LTI tabs the panel shows what the controller
 * actually IS — fuzzify → rules → defuzzify — at full panel size and live.
 *
 * Drawing primitives + the live-input hook are shared with the slimmed sidebar
 * theory (fuzzyTheory.tsx) so nothing is duplicated or can drift.
 */

/** Blue/red ramp for the normalized output U ∈ [−1,1]:
 *  −1 (full nose-up, u→0%) sky · 0 slate · +1 (full nose-down, u→100%) red. */
export function surfColor(u: number): string {
  const t = Math.max(-1, Math.min(1, u))
  if (t >= 0) {
    return `rgb(${Math.round(30 + 218 * t)}, ${Math.round(41 + 72 * t)}, ${Math.round(59 - 6 * t)})`
  }
  const k = -t
  return `rgb(${Math.round(30 + 26 * k)}, ${Math.round(41 + 148 * k)}, ${Math.round(59 + 189 * k)})`
}

/**
 * Live crisp fuzzy inputs (E, Ė) from the plant + gains, recomputed each frame
 * via a rAF tick. ė is a lightly-filtered −ẏ (the controller owns the
 * authoritative filter; this is a faithful render-time read for the markers).
 * Shared by the tabs and the sidebar theory.
 */
export function useLiveFuzzy(): FuzzyEval & { e: number; edot: number; ke: number; kde: number; ku: number; uPct: number; deltaCmd: number } {
  const ke = useStore((s) => s.ctl.ke ?? 0.06)
  const kde = useStore((s) => s.ctl.kde ?? 0.08)
  const ku = useStore((s) => s.ctl.ku ?? 0.6)
  const wf = useStore((s) => s.ctl.wf ?? 10)
  const [, force] = useState(0)
  const filt = useRef({ y: NaN, d: 0, t: 0 })

  useEffect(() => {
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      force((n) => (n + 1) & 0xffff)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const sp = useStore.getState().setpoint
  const y = engine.x.length >= 3 ? engine.x[2] * rad2deg : 0
  const now = engine.t
  const f = filt.current
  if (Number.isFinite(f.y) && now > f.t) {
    const dt = Math.max(1e-3, now - f.t)
    const raw = -(y - f.y) / dt
    f.d += (raw - f.d) * Math.min(1, dt * (wf || 8))
  }
  f.y = y
  f.t = now

  const e = sp - y
  const edot = f.d
  const E = Math.min(1, Math.max(-1, ke * e))
  const Edot = Math.min(1, Math.max(-1, kde * edot))
  const ev = evalFuzzy(E, Edot)
  const uPct = Math.min(100, Math.max(0, 50 + Math.min(1, Math.max(-1, ku * ev.U)) * 50))
  const deltaCmd = ((uPct - 50) / 50) * JET.dmax * rad2deg
  return { ...ev, e, edot, ke, kde, ku, uPct, deltaCmd }
}

const TERM_COLORS = ['#60a5fa', '#7dd3fc', '#a3a3a3', '#fca5a5', '#f87171']

/**
 * Large membership-function fan: the 5 triangular sets across the normalized
 * universe, the live crisp tick, and shaded firing memberships μ. `h` lets the
 * caller size it for the big panel. SVG with a fixed viewBox scaled to w-full.
 */
function MFFan({
  title,
  sub,
  value,
  mu,
  vbW = 520,
  vbH = 150,
}: {
  title: string
  sub: string
  value: number
  mu: number[]
  vbW?: number
  vbH?: number
}) {
  const padX = 10
  const x0 = padX
  const x1 = vbW - padX
  const yBase = vbH - 26
  const yTop = 14
  const X = (v: number) => x0 + ((v + 1) / 2) * (x1 - x0)
  const Y = (m: number) => yBase - m * (yBase - yTop)
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-slate-300">{title}</span>
        <span className="font-mono text-[12px] text-amber-300">{sub}</span>
      </div>
      <svg viewBox={`0 0 ${vbW} ${vbH}`} className="w-full" preserveAspectRatio="none" style={{ height: 150 }}>
        {/* baseline + μ gridlines */}
        <line x1={x0} y1={yBase} x2={x1} y2={yBase} stroke="#475569" strokeWidth={1} />
        {[0.5, 1].map((g) => (
          <line key={g} x1={x0} y1={Y(g)} x2={x1} y2={Y(g)} stroke="#1e293b" strokeWidth={1} />
        ))}
        {/* triangles */}
        {CENTERS.map((c, i) => {
          const pL = i === 0 ? `${X(-1)},${Y(1)}` : `${X(c - 0.5)},${Y(0)}`
          const pR = i === 4 ? `${X(1)},${Y(1)}` : `${X(c + 0.5)},${Y(0)}`
          return (
            <g key={i}>
              <polyline points={`${pL} ${X(c)},${Y(1)} ${pR}`} fill="none" stroke={TERM_COLORS[i]} strokeWidth={1.5} opacity={0.6} />
              {mu[i] > 0.01 && (
                <polygon
                  points={`${X(c)},${Y(mu[i])} ${X(Math.max(-1, c - 0.5 * mu[i]))},${Y(0)} ${X(Math.min(1, c + 0.5 * mu[i]))},${Y(0)}`}
                  fill={TERM_COLORS[i]}
                  opacity={0.4}
                />
              )}
              <text x={X(c)} y={vbH - 8} fontSize={12} fill={TERM_COLORS[i]} textAnchor="middle" fontFamily="ui-monospace, monospace">
                {TERMS[i]}
              </text>
              {mu[i] > 0.01 && (
                <text x={X(c)} y={Y(mu[i]) - 4} fontSize={10} fill="#fde68a" textAnchor="middle" fontFamily="ui-monospace, monospace">
                  {mu[i].toFixed(2)}
                </text>
              )}
            </g>
          )
        })}
        {/* live crisp value marker */}
        <line x1={X(value)} y1={yTop - 6} x2={X(value)} y2={yBase} stroke="#fbbf24" strokeWidth={2} />
        <circle cx={X(value)} cy={yTop - 6} r={3.5} fill="#fbbf24" />
      </svg>
    </div>
  )
}

/** Large 5×5 rule grid; cells tinted by output set, lit by live firing μ. */
function RuleGridBig({ fire }: { fire: number[][] }) {
  const cell = 40
  const labW = 22
  const W = labW + 5 * cell + 2
  const H = labW + 5 * cell + 2
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxWidth: 280 }}>
      {/* axis captions */}
      <text x={labW + (5 * cell) / 2} y={9} fontSize={9} fill="#64748b" textAnchor="middle">ė →</text>
      <text x={7} y={labW + (5 * cell) / 2} fontSize={9} fill="#64748b" textAnchor="middle" transform={`rotate(-90 7 ${labW + (5 * cell) / 2})`}>e →</text>
      {TERMS.map((t, j) => (
        <text key={`c${j}`} x={labW + j * cell + cell / 2} y={labW - 4} fontSize={10} fill="#94a3b8" textAnchor="middle" fontFamily="ui-monospace, monospace">{t}</text>
      ))}
      {TERMS.map((t, i) => (
        <text key={`r${i}`} x={labW - 6} y={labW + i * cell + cell / 2 + 3} fontSize={10} fill="#94a3b8" textAnchor="middle" fontFamily="ui-monospace, monospace">{t}</text>
      ))}
      {RULES.map((row, i) =>
        row.map((out, j) => {
          const w = fire[i]?.[j] ?? 0
          const x = labW + j * cell
          const y = labW + i * cell
          return (
            <g key={`${i}-${j}`}>
              <rect
                x={x + 1.5}
                y={y + 1.5}
                width={cell - 3}
                height={cell - 3}
                rx={3}
                fill={surfColor(CENTERS[out])}
                opacity={0.32 + 0.68 * w}
                stroke={w > 0.05 ? '#fbbf24' : '#0f172a'}
                strokeWidth={w > 0.05 ? 2 : 0.5}
              />
              <text x={x + cell / 2} y={y + cell / 2 + 4} fontSize={11} fill={w > 0.4 ? '#0f172a' : '#cbd5e1'} textAnchor="middle" fontFamily="ui-monospace, monospace">
                {TERMS[out]}
              </text>
            </g>
          )
        }),
      )}
    </svg>
  )
}

/** Large control-surface heatmap U(E,Ė) with the live operating-point dot. */
function SurfaceBig({ E, Edot }: { E: number; Edot: number }) {
  const n = 41
  const surfRef = useRef<number[][] | null>(null)
  if (!surfRef.current) surfRef.current = controlSurface(n)
  const surf = surfRef.current
  const S = 260
  const px = S / n
  const Xc = ((E + 1) / 2) * S
  const Yc = (1 - (Edot + 1) / 2) * S
  return (
    <div className="min-w-0">
      <svg viewBox={`0 0 ${S} ${S}`} className="w-full" style={{ maxWidth: 280 }}>
        {surf.map((row, r) =>
          row.map((u, c) => (
            <rect key={`${r}-${c}`} x={c * px} y={(n - 1 - r) * px} width={px + 0.6} height={px + 0.6} fill={surfColor(u)} />
          )),
        )}
        {/* zero axes */}
        <line x1={S / 2} y1={0} x2={S / 2} y2={S} stroke="#0f172a" strokeWidth={1} opacity={0.6} />
        <line x1={0} y1={S / 2} x2={S} y2={S / 2} stroke="#0f172a" strokeWidth={1} opacity={0.6} />
        {/* operating point with a soft halo */}
        <circle cx={Xc} cy={Yc} r={8} fill="#fbbf24" opacity={0.25} />
        <circle cx={Xc} cy={Yc} r={4.5} fill="#fbbf24" stroke="#0f172a" strokeWidth={1.5} />
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
        <span>← e &lt; 0 (nose high)</span>
        <span>e &gt; 0 (nose low) →</span>
      </div>
      <div className="text-center font-mono text-[10px] text-slate-500">↑ ė &gt; 0 · U(e, ė) · ė &lt; 0 ↓</div>
    </div>
  )
}

/** The centroid → ×ku → δcmd readout strip, shared by both tabs. */
function OutputStrip({ live }: { live: ReturnType<typeof useLiveFuzzy> }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 font-mono text-[12px] text-sky-300">
      centroid U = <span className="text-amber-300">{live.U.toFixed(3)}</span>
      <span className="text-slate-500"> → ×k</span>
      <sub className="text-slate-500">u</sub>
      <span className="text-slate-500">({live.ku.toFixed(2)})</span> → u ={' '}
      <span className="text-amber-300">{live.uPct.toFixed(1)}%</span>
      <span className="text-slate-500"> → δ</span>
      <sub className="text-slate-500">cmd</sub> = <span className="text-amber-300">{live.deltaCmd.toFixed(1)}°</span>
    </div>
  )
}

/* ------------------------------- Tab views ------------------------------- */

/** Tab 1 — "Fuzzify": the two MF fans at full panel size + the scaling chain. */
export function FuzzifyTab() {
  const live = useLiveFuzzy()
  return (
    <div className="space-y-3 p-3">
      <p className="text-[12px] text-slate-400">
        Two crisp inputs are scaled by the tuning gains, clamped to the normalized universe ±1, and
        fuzzified into five triangular sets (NB NS ZE PS PB). The yellow tick is the live operating
        value; shaded triangles are the firing memberships μ that feed the rule base.
      </p>
      <div className="flex flex-wrap gap-2 font-mono text-[12px]">
        <span className="rounded bg-slate-800 px-2 py-1 text-slate-300">
          e = <span className="text-sky-300">{live.e.toFixed(2)}°</span> ×k<sub>e</sub>(
          {live.ke.toFixed(3)}) → E = <span className="text-amber-300">{live.E.toFixed(2)}</span>
        </span>
        <span className="rounded bg-slate-800 px-2 py-1 text-slate-300">
          ė = <span className="text-sky-300">{live.edot.toFixed(2)}°/s</span> ×k<sub>de</sub>(
          {live.kde.toFixed(3)}) → Ė = <span className="text-amber-300">{live.Edot.toFixed(2)}</span>
        </span>
      </div>
      <div className="flex flex-col gap-3 lg:flex-row">
        <MFFan title="μ(E) — pitch error e = θ* − θ" sub={`E = ${live.E.toFixed(2)}`} value={live.E} mu={live.muE} />
        <MFFan title="μ(Ė) — error rate ė (filtered)" sub={`Ė = ${live.Edot.toFixed(2)}`} value={live.Edot} mu={live.muEdot} />
      </div>
      <p className="text-[11px] text-slate-500">
        ė is the derivative on measurement, low-pass filtered at ω<sub>f</sub> — the damping channel
        the rule base needs to stabilize the open-loop-unstable airframe. See the firing rules and
        the resulting control surface in the <span className="text-slate-300">Rules + Surface</span> tab.
      </p>
    </div>
  )
}

/** Tab 2 — "Rules + Surface": the 5×5 grid + control surface side by side. */
export function RulesSurfaceTab() {
  const live = useLiveFuzzy()
  return (
    <div className="space-y-3 p-3">
      <p className="text-[12px] text-slate-400">
        Each fired (E, Ė) pair lights cells of the 5×5 rule base (min of the two memberships); the
        outputs aggregate and defuzzify by centroid into one crisp command. The control surface is
        that whole map at once — a nonlinear gain schedule written linguistically.
      </p>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Rule base — live activation
          </div>
          <RuleGridBig fire={live.fire} />
          <div className="mt-1 font-mono text-[10px] text-slate-500">cell = output set; lit border = firing now</div>
        </div>
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Control surface U(e, ė)
          </div>
          <SurfaceBig E={live.E} Edot={live.Edot} />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <OutputStrip live={live} />
          <p className="text-[11px] text-slate-400">
            The table is skew-symmetric and oriented for this airframe's <em>negative</em> control
            power: a positive error (nose too low) commands a negative output (u &lt; 50% → nose up).
            Near the centre the surface slopes smoothly — essentially a fixed PD law whose K<sub>p</sub>
            /K<sub>d</sub> match the PID controller — but it saturates toward the corners, easing off
            on huge upsets instead of demanding impossible deflection.
          </p>
          <p className="text-[11px] text-amber-300/90">
            There is no C(jω) here — that's why these tabs replace the L / T,S / C views. Stability is
            empirical: watch the operating-point dot get driven back to the centre after a gust, not a
            phase margin. Switch to the PID controller to get the LTI Bode tabs back.
          </p>
        </div>
      </div>
    </div>
  )
}
