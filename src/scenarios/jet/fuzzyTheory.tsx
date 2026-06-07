import { useEffect, useRef, useState } from 'react'
import { engine } from '../../state/engine'
import { useStore } from '../../state/store'
import { TheorySection } from '../../ui/TheorySection'
import { JET } from './plant'
import { CENTERS, controlSurface, evalFuzzy, RULES, TERMS, type FuzzyEval } from './fuzzy'

const rad2deg = 180 / Math.PI

/** Blue/red surface ramp for the normalized output U ∈ [−1,1]:
 *  −1 (full nose-up, u→0%) sky-blue · 0 slate · +1 (full nose-down, u→100%) red. */
function surfColor(u: number): string {
  const t = Math.max(-1, Math.min(1, u))
  if (t >= 0) {
    // 0 = dark slate → +1 = red (nose-down command)
    return `rgb(${Math.round(30 + 218 * t)}, ${Math.round(41 + 72 * t)}, ${Math.round(59 - 6 * t)})`
  }
  // 0 = dark slate → −1 = sky (nose-up command)
  const k = -t
  return `rgb(${Math.round(30 + 26 * k)}, ${Math.round(41 + 148 * k)}, ${Math.round(59 + 189 * k)})`
}

/**
 * Recompute the current crisp fuzzy inputs (E, Ė) from the live plant + gains,
 * matching the controller's scaling and derivative filter closely enough for a
 * faithful operating-point marker. (The controller owns the authoritative
 * filter state; this is a render-time read of e and a lightly-filtered ė.)
 */
function useLiveFuzzy(ke: number, kde: number): FuzzyEval & { e: number; edot: number } {
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
    const raw = -(y - f.y) / dt // ė ≈ −ẏ for constant sp
    f.d += (raw - f.d) * Math.min(1, dt * 8) // ~ωf = 8 rad/s low-pass
  }
  f.y = y
  f.t = now

  const e = sp - y
  const edot = f.d
  const E = Math.min(1, Math.max(-1, ke * e))
  const Edot = Math.min(1, Math.max(-1, kde * edot))
  return { ...evalFuzzy(E, Edot), e, edot }
}

/** One membership-function strip: 5 triangles + the live crisp value marked,
 *  active sets shaded by their membership μ. */
function MFPlot({
  title,
  value,
  mu,
  unit,
}: {
  title: string
  value: number // normalized crisp input ∈ [−1,1]
  mu: number[]
  unit: string
}) {
  const W = 250
  const H = 74
  const padL = 6
  const padR = 6
  const x0 = padL
  const x1 = W - padR
  const yBase = H - 16
  const yTop = 6
  const X = (v: number) => x0 + ((v + 1) / 2) * (x1 - x0)
  const Y = (m: number) => yBase - m * (yBase - yTop)
  const termColors = ['#60a5fa', '#7dd3fc', '#a3a3a3', '#fca5a5', '#f87171']

  return (
    <div>
      <div className="mb-0.5 flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {title}
        </span>
        <span className="font-mono text-[10px] text-sky-300">{unit}</span>
      </div>
      <svg width={W} height={H} className="w-full" viewBox={`0 0 ${W} ${H}`}>
        {/* axis */}
        <line x1={x0} y1={yBase} x2={x1} y2={yBase} stroke="#475569" strokeWidth={1} />
        {/* triangles */}
        {CENTERS.map((c, i) => {
          const left = c - 0.5
          const right = c + 0.5
          // shoulders on the end sets
          const pL = i === 0 ? `${X(-1)},${Y(1)}` : `${X(left)},${Y(0)}`
          const pR = i === 4 ? `${X(1)},${Y(1)}` : `${X(right)},${Y(0)}`
          return (
            <g key={i}>
              <polyline
                points={`${pL} ${X(c)},${Y(1)} ${pR}`}
                fill="none"
                stroke={termColors[i]}
                strokeWidth={1}
                opacity={0.5}
              />
              {/* shade active membership */}
              {mu[i] > 0.01 && (
                <polygon
                  points={`${X(c)},${Y(mu[i])} ${X(Math.max(-1, c - 0.5 * mu[i]))},${Y(0)} ${X(Math.min(1, c + 0.5 * mu[i]))},${Y(0)}`}
                  fill={termColors[i]}
                  opacity={0.32}
                />
              )}
              <text x={X(c)} y={H - 4} fontSize={8} fill={termColors[i]} textAnchor="middle">
                {TERMS[i]}
              </text>
            </g>
          )
        })}
        {/* live crisp value marker */}
        <line x1={X(value)} y1={yTop - 2} x2={X(value)} y2={yBase} stroke="#fbbf24" strokeWidth={1.5} />
        <circle cx={X(value)} cy={yTop - 2} r={2.5} fill="#fbbf24" />
      </svg>
    </div>
  )
}

/** 5×5 rule grid; each cell tinted by its output set, lit by live firing μ. */
function RuleGrid({ fire }: { fire: number[][] }) {
  const cell = 26
  const labW = 16
  const W = labW + 5 * cell + 2
  const H = labW + 5 * cell + 2
  return (
    <svg width={W} height={H} className="w-full max-w-[200px]" viewBox={`0 0 ${W} ${H}`}>
      {/* column (ė) labels */}
      {TERMS.map((t, j) => (
        <text key={`c${j}`} x={labW + j * cell + cell / 2} y={11} fontSize={8} fill="#94a3b8" textAnchor="middle">
          {t}
        </text>
      ))}
      {/* row (e) labels */}
      {TERMS.map((t, i) => (
        <text key={`r${i}`} x={8} y={labW + i * cell + cell / 2 + 3} fontSize={8} fill="#94a3b8" textAnchor="middle">
          {t}
        </text>
      ))}
      {RULES.map((row, i) =>
        row.map((out, j) => {
          const w = fire[i]?.[j] ?? 0
          const x = labW + j * cell
          const y = labW + i * cell
          return (
            <g key={`${i}-${j}`}>
              <rect
                x={x + 1}
                y={y + 1}
                width={cell - 2}
                height={cell - 2}
                rx={2}
                fill={surfColor(CENTERS[out])}
                opacity={0.35 + 0.65 * w}
                stroke={w > 0.05 ? '#fbbf24' : 'transparent'}
                strokeWidth={w > 0.05 ? 1.5 : 0}
              />
              <text
                x={x + cell / 2}
                y={y + cell / 2 + 3}
                fontSize={7.5}
                fill={w > 0.4 ? '#0f172a' : '#cbd5e1'}
                textAnchor="middle"
              >
                {TERMS[out]}
              </text>
            </g>
          )
        }),
      )}
    </svg>
  )
}

/** Control surface heatmap U(E,Ė) with the live operating-point dot. */
function SurfacePlot({ E, Edot }: { E: number; Edot: number }) {
  const n = 21
  const surfRef = useRef<number[][] | null>(null)
  if (!surfRef.current) surfRef.current = controlSurface(n)
  const surf = surfRef.current
  const S = 150
  const px = S / n
  const Xc = ((E + 1) / 2) * S
  const Yc = ((1 - (Edot + 1) / 2)) * S // Ė up = positive
  return (
    <div>
      <svg width={S} height={S} className="w-full max-w-[170px]" viewBox={`0 0 ${S} ${S}`}>
        {surf.map((row, r) =>
          row.map((u, c) => (
            <rect
              key={`${r}-${c}`}
              x={c * px}
              y={(n - 1 - r) * px}
              width={px + 0.5}
              height={px + 0.5}
              fill={surfColor(u)}
            />
          )),
        )}
        {/* zero axes */}
        <line x1={S / 2} y1={0} x2={S / 2} y2={S} stroke="#0f172a" strokeWidth={0.5} opacity={0.5} />
        <line x1={0} y1={S / 2} x2={S} y2={S / 2} stroke="#0f172a" strokeWidth={0.5} opacity={0.5} />
        {/* operating point */}
        <circle cx={Xc} cy={Yc} r={4} fill="#fbbf24" stroke="#0f172a" strokeWidth={1.5} />
      </svg>
      <div className="mt-0.5 flex justify-between font-mono text-[9px] text-slate-500">
        <span>← e&lt;0</span>
        <span>U(e, ė)</span>
        <span>e&gt;0 →</span>
      </div>
    </div>
  )
}

/**
 * The fuzzy controller's marquee theory panel: live membership plots, the live
 * rule grid, and the control surface with a moving operating-point dot — plus
 * the "what fuzzy buys / costs" paragraph that ties the blank LTI tabs to the
 * fact that an FLC has no C(jω).
 */
export function FuzzyTheory() {
  const ke = useStore((s) => s.ctl.ke ?? 0.06)
  const kde = useStore((s) => s.ctl.kde ?? 0.08)
  const ku = useStore((s) => s.ctl.ku ?? 0.6)
  const live = useLiveFuzzy(ke, kde)
  const uPct = 50 + Math.min(1, Math.max(-1, ku * live.U)) * 50

  return (
    <>
      <TheorySection title="Fuzzy inference — live (Mamdani 5×5)">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <MFPlot
            title="μ(E) — error e = θcmd − θ"
            value={live.E}
            mu={live.muE}
            unit={`e = ${live.e.toFixed(1)}° → E=${live.E.toFixed(2)}`}
          />
          <MFPlot
            title="μ(Ė) — error rate ė (filtered)"
            value={live.Edot}
            mu={live.muEdot}
            unit={`ė = ${live.edot.toFixed(1)}°/s → Ė=${live.Edot.toFixed(2)}`}
          />
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          Crisp inputs are scaled by k<sub>e</sub>={ke.toFixed(2)}, k<sub>de</sub>={kde.toFixed(2)},
          clamped to ±1, and fuzzified into the five triangular sets. The yellow tick is the live
          operating value; shaded triangles are the firing memberships μ.
        </p>
      </TheorySection>

      <TheorySection title="Rule base & control surface — live activation">
        <div className="flex flex-wrap items-start gap-4">
          <div>
            <div className="mb-1 text-[10px] text-slate-400">
              rules: rows = e (NB→PB), cols = ė; cell = output set
            </div>
            <RuleGrid fire={live.fire} />
          </div>
          <div>
            <SurfacePlot E={live.E} Edot={live.Edot} />
          </div>
        </div>
        <p className="mt-1.5 font-mono text-[11px] text-sky-300">
          centroid U = {live.U.toFixed(2)} → ×k<sub>u</sub>({ku.toFixed(2)}) → u ={' '}
          {uPct.toFixed(1)}% → δ<sub>cmd</sub> ={' '}
          {(((Math.min(100, Math.max(0, uPct)) - 50) / 50) * JET.dmax * rad2deg).toFixed(1)}°
        </p>
        <p className="text-[11px] text-slate-400">
          The skew-symmetric table is oriented for this airframe's negative control power: a
          positive error (nose too low) commands a negative output (u &lt; 50% → nose up). Its ė
          diagonal is exactly the derivative (damping) action that lets the FLC stabilize the
          open-loop-unstable airframe — the linguistic twin of PID's K<sub>d</sub>.
        </p>
      </TheorySection>

      <TheorySection title="What fuzzy buys — and what it costs">
        <p className="text-[11px] text-slate-400">
          The surface above <em>is</em> a nonlinear gain schedule written in words: near the centre
          it slopes smoothly (≈ a fixed PD law — compare the PID controller, whose Kp/Kd match the
          surface's centre slope), but toward the corners it saturates, easing off authority on huge
          upsets instead of demanding impossible deflection. Encoding control as rules lets a
          designer shape that schedule by intent ("big positive error and still climbing → full nose
          down") without ever writing a transfer function.
        </p>
        <p className="mt-1 text-[11px] text-amber-300/90">
          The cost: there is no C(jω), so <strong>the L / C / T / S Bode tabs are blank for this
          controller</strong> (they show the nonlinear-law explainer). You cannot read a phase
          margin off a fuzzy loop — its stability is empirical, shown by the jet actually holding
          trim and recovering gusts in the scene and strip charts, not proven by a margin. That is
          the honest trade: linguistic flexibility for the loss of the linear toolbox.
        </p>
      </TheorySection>
    </>
  )
}
