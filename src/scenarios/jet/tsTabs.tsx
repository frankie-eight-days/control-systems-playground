import { useEffect, useRef, useState } from 'react'
import { engine } from '../../state/engine'
import { useStore } from '../../state/store'
import { TERMS } from './fuzzy'
import { evalTS, tsSurface, type TSEval } from './fuzzyTS'
import { JET } from './plant'
import { surfColor } from './fuzzyTabs'

const rad2deg = 180 / Math.PI

/**
 * Takagi–Sugeno analysis views, promoted into the Bode-panel tab slots (same
 * mechanism as the Mamdani tabs from task #13). Where Mamdani's tabs tell an
 * output-membership-function story, T-S has none — so these show what T-S
 * actually is: a 5×5 table of LOCAL LINEAR controllers (a,b) that the firing
 * weights blend, and the resulting surface (drawn on the SAME axes/scale as
 * the Mamdani surface so the two are directly comparable).
 */

/** Live T-S evaluation from the plant + gains, recomputed each frame. */
function useLiveTS(): TSEval & { e: number; edot: number; ke: number; kde: number; ku: number; uniformity: number; uPct: number; deltaCmd: number } {
  const ke = useStore((s) => s.ctl.ke ?? 0.06)
  const kde = useStore((s) => s.ctl.kde ?? 0.08)
  const ku = useStore((s) => s.ctl.ku ?? 0.6)
  const uniformity = useStore((s) => s.ctl.uniformity ?? 0.35)
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
  const ev = evalTS(E, Edot, uniformity)
  const uPct = Math.min(100, Math.max(0, 50 + Math.min(1, Math.max(-1, ku * ev.U)) * 50))
  const deltaCmd = ((uPct - 50) / 50) * JET.dmax * rad2deg
  return { ...ev, e, edot, ke, kde, ku, uniformity, uPct, deltaCmd }
}

/** Tab — "Local gains": the 5×5 table of (a,b) local linear controllers with
 *  live firing-strength highlighting. Cells tinted by their consequent value
 *  at the current operating point (so the active region glows in surface
 *  colours), labelled with (a, b). */
function LocalGainsTab() {
  const live = useLiveTS()
  const cell = 70
  const labW = 24
  const W = labW + 5 * cell + 2
  const H = labW + 5 * cell + 2
  return (
    <div className="space-y-3 p-3">
      <p className="text-[12px] text-slate-400">
        Each rule (i, j) carries a <strong>local linear controller</strong> u<sub>ij</sub> = a
        <sub>ij</sub>·E + b<sub>ij</sub>·Ė — not an output fuzzy set. The firing weights w
        <sub>ij</sub> = min(μ<sub>E</sub>, μ<sub>Ė</sub>) blend them by weighted average. The yellow
        borders are the cells firing right now; the table is the local-gain schedule (corner cells
        run hotter than the centre by the spread set via the uniformity slider).
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxWidth: 460 }}>
        <text x={labW + (5 * cell) / 2} y={9} fontSize={10} fill="#64748b" textAnchor="middle">Ė →</text>
        <text x={8} y={labW + (5 * cell) / 2} fontSize={10} fill="#64748b" textAnchor="middle" transform={`rotate(-90 8 ${labW + (5 * cell) / 2})`}>E →</text>
        {TERMS.map((t, j) => (
          <text key={`c${j}`} x={labW + j * cell + cell / 2} y={labW - 5} fontSize={11} fill="#94a3b8" textAnchor="middle" fontFamily="ui-monospace, monospace">{t}</text>
        ))}
        {TERMS.map((t, i) => (
          <text key={`r${i}`} x={labW - 7} y={labW + i * cell + cell / 2 + 4} fontSize={11} fill="#94a3b8" textAnchor="middle" fontFamily="ui-monospace, monospace">{t}</text>
        ))}
        {live.aTab.map((row, i) =>
          row.map((a, j) => {
            const b = live.bTab[i][j]
            const w = live.fire[i]?.[j] ?? 0
            const uLoc = live.uLocal[i][j]
            const x = labW + j * cell
            const y = labW + i * cell
            return (
              <g key={`${i}-${j}`}>
                <rect
                  x={x + 1.5}
                  y={y + 1.5}
                  width={cell - 3}
                  height={cell - 3}
                  rx={4}
                  fill={surfColor(Math.max(-1, Math.min(1, uLoc)))}
                  opacity={0.3 + 0.7 * w}
                  stroke={w > 0.05 ? '#fbbf24' : '#0f172a'}
                  strokeWidth={w > 0.05 ? 2.5 : 0.75}
                />
                <text x={x + cell / 2} y={y + cell / 2 - 4} fontSize={12} fill="#e2e8f0" textAnchor="middle" fontFamily="ui-monospace, monospace">
                  a={a.toFixed(1)}
                </text>
                <text x={x + cell / 2} y={y + cell / 2 + 11} fontSize={12} fill="#cbd5e1" textAnchor="middle" fontFamily="ui-monospace, monospace">
                  b={b.toFixed(1)}
                </text>
              </g>
            )
          }),
        )}
      </svg>
      <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 font-mono text-[12px] text-sky-300">
        Σw·u<sub>ij</sub> / Σw = <span className="text-amber-300">{live.U.toFixed(3)}</span>
        <span className="text-slate-500"> (weighted average — NO defuzzification)</span> → ×k
        <sub>u</sub>({live.ku.toFixed(2)}) → u = <span className="text-amber-300">{live.uPct.toFixed(1)}%</span> → δ
        <sub>cmd</sub> = <span className="text-amber-300">{live.deltaCmd.toFixed(1)}°</span>
      </div>
      <p className="text-[11px] text-amber-300/90">
        {live.degenerate ? (
          <>
            <strong>Uniformity = 1: every cell holds the same (a, b)</strong> — the weighted average
            collapses to U = a·E + b·Ė, so this controller is <strong>exactly a linear PD law</strong>{' '}
            right now. Compare it with the PID (fly-by-wire) controller at matched gains: the
            responses coincide. Drop uniformity to bend the schedule and watch the surface curve.
          </>
        ) : (
          <>
            Lower the <span className="font-mono">uniformity</span> slider and the corner gains grow,
            curving the surface; raise it to 1 and all cells equalise — the controller becomes{' '}
            <strong>exactly a linear PD</strong>. Fuzzy ↔ linear is one continuous knob.
          </>
        )}
      </p>
    </div>
  )
}

/** Tab — "Blended surface": the T-S U(e,ė) surface on the SAME axes/scale as
 *  the Mamdani surface, with the live operating-point dot. Recomputed when
 *  uniformity changes (the surface shape is the lesson). */
function BlendedSurfaceTab() {
  const live = useLiveTS()
  const n = 41
  // Recompute the surface only when the uniformity changes (not every frame).
  const surfRef = useRef<{ uni: number; grid: number[][] } | null>(null)
  if (!surfRef.current || surfRef.current.uni !== live.uniformity) {
    surfRef.current = { uni: live.uniformity, grid: tsSurface(n, live.uniformity) }
  }
  const surf = surfRef.current.grid
  const S = 300
  const px = S / n
  const Xc = ((live.E + 1) / 2) * S
  const Yc = (1 - (live.Edot + 1) / 2) * S
  return (
    <div className="space-y-3 p-3">
      <p className="text-[12px] text-slate-400">
        The blended T-S control surface U(e, ė) — the firing-weighted average of the local linear
        controllers across the whole input plane. Drawn on the same axes and colour scale as the
        Mamdani surface (switch controllers to flip between them). At uniformity = 1 this is a flat
        tilted plane (a PD law); lower it and the corners bow outward as the local gains diverge.
      </p>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div>
          <svg viewBox={`0 0 ${S} ${S}`} className="w-full" style={{ maxWidth: 320 }}>
            {surf.map((row, r) =>
              row.map((u, c) => (
                <rect key={`${r}-${c}`} x={c * px} y={(n - 1 - r) * px} width={px + 0.6} height={px + 0.6} fill={surfColor(Math.max(-1, Math.min(1, u)))} />
              )),
            )}
            <line x1={S / 2} y1={0} x2={S / 2} y2={S} stroke="#0f172a" strokeWidth={1} opacity={0.6} />
            <line x1={0} y1={S / 2} x2={S} y2={S / 2} stroke="#0f172a" strokeWidth={1} opacity={0.6} />
            <circle cx={Xc} cy={Yc} r={9} fill="#fbbf24" opacity={0.25} />
            <circle cx={Xc} cy={Yc} r={5} fill="#fbbf24" stroke="#0f172a" strokeWidth={1.5} />
          </svg>
          <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
            <span>← e &lt; 0 (nose high)</span>
            <span>e &gt; 0 (nose low) →</span>
          </div>
          <div className="text-center font-mono text-[10px] text-slate-500">↑ ė &gt; 0 · U(e, ė) · ė &lt; 0 ↓</div>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 font-mono text-[12px] text-sky-300">
            E = <span className="text-amber-300">{live.E.toFixed(2)}</span>, Ė ={' '}
            <span className="text-amber-300">{live.Edot.toFixed(2)}</span> → U ={' '}
            <span className="text-amber-300">{live.U.toFixed(3)}</span> → u ={' '}
            <span className="text-amber-300">{live.uPct.toFixed(1)}%</span>
          </div>
          <div className="font-mono text-[11px] text-slate-400">
            uniformity = <span className="text-amber-300">{live.uniformity.toFixed(2)}</span>{' '}
            {live.degenerate ? '(flat plane → PD)' : '(curved → scheduled)'}
          </div>
          <p className="text-[11px] text-slate-400">
            Compare against the Mamdani <span className="font-mono text-sky-300">Rules + Surface</span>{' '}
            tab: Mamdani builds its surface by clipping/aggregating output sets, T-S by interpolating
            local slopes. Both are nonlinear gain schedules; T-S just states the local gains
            explicitly, which is what lets the LMI/PDC stability machinery work on it (see theory).
          </p>
          <p className="text-[11px] text-amber-300/90">
            Still no C(jω): the L / T,S / C tabs are replaced by these views for both fuzzy laws.
            Switch to PID (fly-by-wire) for the LTI Bode tabs.
          </p>
        </div>
      </div>
    </div>
  )
}

export { LocalGainsTab, BlendedSurfaceTab, useLiveTS }
