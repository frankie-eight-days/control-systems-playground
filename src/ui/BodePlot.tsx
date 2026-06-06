import { useEffect, useMemo, useRef, useState } from 'react'
import type uPlot from 'uplot'
import { freqAnalysis, poles2, type FreqAnalysis } from '../analysis/freq'
import { linearize } from '../analysis/linearize'
import { engine } from '../state/engine'
import { useStore } from '../state/store'
import { axisTheme, mountChart, seriesColors } from './charts'
import { BlockDiagram } from './BlockDiagram'

/**
 * Frequency-domain panel with four views of the SAME loop:
 *   L — open loop C·G with stability margins
 *   T/S — closed loop: tracking T = L/(1+L) and sensitivity S = 1/(1+L)
 *   C — controller anatomy: how P, I, D stack into the compensator
 *   G — the linearized plant alone
 * In dB, |L| = |C| + |G| — the C and G tabs literally add to give L.
 */
type Tab = 'L' | 'T' | 'C' | 'G' | 'D'
/** Tabs that render a uPlot chart (everything but the block diagram). */
type ChartTab = 'L' | 'T' | 'C' | 'G'

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'D', label: 'Diagram', hint: 'system block diagram, live signals' },
  { id: 'L', label: 'L = C·G', hint: 'open loop + margins' },
  { id: 'T', label: 'T, S', hint: 'closed loop' },
  { id: 'C', label: 'C = P+I+D', hint: 'controller anatomy' },
  { id: 'G', label: 'G', hint: 'plant' },
]

interface Analysis extends FreqAnalysis {
  u0: number
  poles: { re: number; im: number }[]
}

export function BodePlot() {
  const kp = useStore((s) => s.kp)
  const ki = useStore((s) => s.ki)
  const kd = useStore((s) => s.kd)
  const wf = useStore((s) => s.wf)
  const setpoint = useStore((s) => s.setpoint)
  const valve = useStore((s) => s.valve)
  const controller = useStore((s) => s.controller)
  const [tab, setTab] = useState<Tab>('L')
  // Relay control is nonlinear — the LTI views (L, T, C) don't apply.
  const isNote = controller === 'onoff' && (tab === 'L' || tab === 'T' || tab === 'C')
  const isChart = tab !== 'D' && !isNote

  const data: Analysis = useMemo(() => {
    const d = { valve }
    const eq = engine.plant.equilibrium(setpoint, d)
    const ss = linearize(engine.plant, eq.x, eq.u, d)
    return { ...freqAnalysis(ss, { kp, ki, kd, wf }), u0: eq.u, poles: poles2(ss.A) }
  }, [kp, ki, kd, wf, setpoint, valve])

  const dataRef = useRef(data)
  dataRef.current = data
  const chartRef = useRef<ReturnType<typeof mountChart> | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // (Re)create the chart when the tab changes — series/axes differ per view.
  useEffect(() => {
    if (!isChart) return
    const chartTab = tab as ChartTab
    const mounted = mountChart(
      wrapRef.current!,
      (w, h) => buildOpts(chartTab, w, h, dataRef),
      chartData(chartTab, dataRef.current),
    )
    chartRef.current = mounted
    return () => {
      mounted.dispose()
      chartRef.current = null
    }
  }, [tab, isChart])

  // Push new data into the existing chart when gains / operating point move.
  useEffect(() => {
    if (tab === 'D') return
    chartRef.current?.chart.setData(chartData(tab, data))
  }, [data, tab])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 px-1 pt-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`rounded px-2 py-0.5 font-mono text-[11px] ${
              tab === t.id
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title={t.hint}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <span className="ml-2 hidden text-[10px] text-slate-500 xl:inline">
          {TABS.find((t) => t.id === tab)?.hint}
        </span>
      </div>
      {tab === 'D' ? (
        <BlockDiagram />
      ) : isNote ? (
        <RelayNote />
      ) : (
        <>
          <div ref={wrapRef} className="min-h-0 flex-1" />
          <Footer tab={tab} data={data} setpoint={setpoint} valve={valve} />
        </>
      )}
    </div>
  )
}

function RelayNote() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-md space-y-2 text-sm text-slate-400">
        <p className="font-semibold text-slate-200">
          On/off control is nonlinear — there is no C(s).
        </p>
        <p>
          A relay's "gain" depends on the signal amplitude, so the LTI views (L, T/S, C) don't
          apply. The loop doesn't settle — it <em>limit-cycles</em>, and the theory panel predicts
          the cycle period from the plant's fill/drain rates. Compare it against the strip chart.
        </p>
        <p>
          The plant is still linear — the <span className="font-mono text-slate-300">G</span> tab
          works. (Describing-function analysis, which extends Bode thinking to relays, is on the
          roadmap.)
        </p>
      </div>
    </div>
  )
}

function chartData(tab: ChartTab, d: Analysis): uPlot.AlignedData {
  switch (tab) {
    case 'L':
      return [d.w, d.lMagDb, d.lPhaseDeg]
    case 'T':
      return [d.w, d.tMagDb, d.sMagDb]
    case 'C':
      return [d.w, d.cMagDb, d.pMagDb, d.iMagDb, d.dMagDb] as uPlot.AlignedData
    case 'G':
      return [d.w, d.gMagDb, d.gPhaseDeg]
  }
}

function buildOpts(
  tab: ChartTab,
  width: number,
  height: number,
  dataRef: React.RefObject<Analysis>,
): uPlot.Options {
  const base: uPlot.Options = {
    width,
    height,
    title: '',
    cursor: { drag: { x: false, y: false } },
    select: { show: false, left: 0, top: 0, width: 0, height: 0 },
    scales: { x: { time: false, distr: 3, log: 10 }, dB: { auto: true } },
    axes: [{ ...axisTheme, label: 'ω (rad/s)', labelSize: 12, size: 36 }],
    series: [{ label: 'ω' }],
    hooks: { draw: [(u: uPlot) => drawMarkers(u, tab, dataRef.current)] },
  }
  const dbAxis = (label: string, stroke: string): uPlot.Axis => ({
    ...axisTheme,
    scale: 'dB',
    label,
    labelSize: 12,
    size: 52,
    stroke,
  })
  const degAxis = (label: string): uPlot.Axis => ({
    ...axisTheme,
    scale: 'deg',
    label,
    labelSize: 12,
    side: 1,
    size: 52,
    stroke: seriesColors.phase,
    grid: { show: false },
  })

  switch (tab) {
    case 'L':
      return {
        ...base,
        title: 'Open loop  L(jω) = C(jω)·G(jω)',
        scales: { ...base.scales, deg: { auto: true } },
        axes: [base.axes![0], dbAxis('|L|  (dB)', seriesColors.mag), degAxis('∠L  (deg)')],
        series: [
          { label: 'ω' },
          { label: '|L|', scale: 'dB', stroke: seriesColors.mag, width: 2 },
          { label: '∠L', scale: 'deg', stroke: seriesColors.phase, width: 2 },
        ],
      }
    case 'T':
      return {
        ...base,
        title: 'Closed loop:  T = L/(1+L)  tracking,   S = 1/(1+L)  sensitivity',
        axes: [base.axes![0], dbAxis('|T|, |S|  (dB)', '#94a3b8')],
        series: [
          { label: 'ω' },
          { label: '|T| r→y', scale: 'dB', stroke: seriesColors.mag, width: 2 },
          { label: '|S| dist→y', scale: 'dB', stroke: seriesColors.iTerm, width: 2 },
        ],
      }
    case 'C':
      return {
        ...base,
        title: 'Controller anatomy:  |C| with its P, I, D asymptotes',
        axes: [base.axes![0], dbAxis('|C|  (dB)', '#94a3b8')],
        series: [
          { label: 'ω' },
          { label: '|C|', scale: 'dB', stroke: '#e2e8f0', width: 2.5 },
          { label: 'P', scale: 'dB', stroke: seriesColors.pTerm, width: 1.25, dash: [5, 5] },
          { label: 'I', scale: 'dB', stroke: seriesColors.iTerm, width: 1.25, dash: [5, 5] },
          { label: 'D', scale: 'dB', stroke: seriesColors.dTerm, width: 1.25, dash: [5, 5] },
        ],
      }
    case 'G':
      return {
        ...base,
        title: 'Plant  G(jω) — linearized at the operating point',
        scales: { ...base.scales, deg: { auto: true } },
        axes: [base.axes![0], dbAxis('|G|  (dB)', seriesColors.mag), degAxis('∠G  (deg)')],
        series: [
          { label: 'ω' },
          { label: '|G|', scale: 'dB', stroke: seriesColors.mag, width: 2 },
          { label: '∠G', scale: 'deg', stroke: seriesColors.phase, width: 2 },
        ],
      }
  }
}

function drawMarkers(u: uPlot, tab: Tab, d: Analysis) {
  const ctx = u.ctx
  const { left, top, width, height } = u.bbox
  ctx.save()
  ctx.setLineDash([5, 5])
  ctx.lineWidth = 1
  const hline = (val: number, scale: string, color: string) => {
    const y = u.valToPos(val, scale, true)
    if (y < top || y > top + height) return
    ctx.strokeStyle = color
    ctx.beginPath()
    ctx.moveTo(left, y)
    ctx.lineTo(left + width, y)
    ctx.stroke()
  }
  const vline = (w: number | null, color: string) => {
    if (w == null) return
    const x = u.valToPos(w, 'x', true)
    if (x < left || x > left + width) return
    ctx.strokeStyle = color
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, top + height)
    ctx.stroke()
  }

  if (tab === 'L') {
    hline(0, 'dB', 'rgba(56, 189, 248, 0.35)')
    hline(-180, 'deg', 'rgba(251, 191, 36, 0.35)')
    vline(d.margins.wgc, 'rgba(74, 222, 128, 0.8)')
    vline(d.margins.wpc, 'rgba(248, 113, 113, 0.8)')
  } else if (tab === 'T') {
    hline(0, 'dB', 'rgba(148, 163, 184, 0.3)')
    hline(-3, 'dB', 'rgba(56, 189, 248, 0.4)')
    vline(d.closed.wBw, 'rgba(74, 222, 128, 0.8)')
    vline(d.margins.wgc, 'rgba(148, 163, 184, 0.35)')
  } else if (tab === 'C') {
    // corner frequencies where the I and D asymptotes meet P
    if (d.margins) {
      const s = useStore.getState()
      if (s.kp > 0 && s.ki > 0) vline(s.ki / s.kp, 'rgba(167, 139, 250, 0.5)')
      if (s.kp > 0 && s.kd > 0) vline(s.kp / s.kd, 'rgba(52, 211, 153, 0.5)')
      if (s.kd > 0) vline(s.wf, 'rgba(148, 163, 184, 0.4)')
    }
  } else if (tab === 'G') {
    hline(0, 'dB', 'rgba(148, 163, 184, 0.3)')
    for (const p of d.poles) if (p.im === 0 && p.re < 0) vline(-p.re, 'rgba(251, 191, 36, 0.5)')
  }
  ctx.restore()
}

function Footer({
  tab,
  data,
  setpoint,
  valve,
}: {
  tab: Tab
  data: Analysis
  setpoint: number
  valve: number
}) {
  const m = data.margins
  const opPoint = (
    <span className="text-slate-500">
      G linearized at h₀={setpoint.toFixed(2)} m, valve={(valve * 100).toFixed(0)}%, u₀=
      {data.u0.toFixed(1)}%
    </span>
  )

  let body: React.ReactNode
  if (tab === 'L') {
    const pmClass = colorFor(m.pm, 45, 20)
    const gmClass = colorFor(m.gmDb, 10, 4)
    body = (
      <>
        <span className={pmClass}>
          PM = {m.pm == null ? '∞' : `${m.pm.toFixed(1)}°`}
          {m.wgc != null && <span className="text-slate-500"> @ ω₍gc₎={fmtW(m.wgc)}</span>}
        </span>
        <span className={gmClass}>
          GM = {m.gmDb == null ? '∞' : `${m.gmDb.toFixed(1)} dB`}
          {m.wpc != null && <span className="text-slate-500"> @ ω₍pc₎={fmtW(m.wpc)}</span>}
        </span>
      </>
    )
  } else if (tab === 'T') {
    const peakClass = colorFor(data.closed.mtDb == null ? null : -data.closed.mtDb, -2, -6)
    body = (
      <>
        <span className="text-green-400">
          BW₋₃dB = {data.closed.wBw == null ? '—' : fmtW(data.closed.wBw)}
        </span>
        <span className={peakClass}>peak |T| = {data.closed.mtDb.toFixed(1)} dB</span>
        <span className="text-slate-400">peak |S| = {data.closed.msDb.toFixed(1)} dB</span>
        <span className="text-slate-500">low PM → closed-loop peaking → time-domain ringing</span>
      </>
    )
  } else if (tab === 'C') {
    body = (
      <span className="text-slate-400">
        |I| falls −20 dB/dec, |P| is flat, |D| rises +20 dB/dec until ω<sub>f</sub> — the
        compensator |C| rides the max of the three. In dB, |L| = |C| + |G|.
      </span>
    )
  } else {
    body = (
      <>
        <span className="text-slate-400">
          poles:{' '}
          {data.poles
            .map((p) =>
              p.im === 0 ? `${p.re.toPrecision(3)}` : `${p.re.toPrecision(3)}±j${Math.abs(p.im).toPrecision(3)}`,
            )
            .join(', ')}{' '}
          rad/s
        </span>
        <span className="text-slate-500">each real pole: −20 dB/dec break + 90° phase lag</span>
      </>
    )
  }

  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-2 pb-1 font-mono text-[11px]">
      {body}
      {opPoint}
    </div>
  )
}

function colorFor(v: number | null, good: number, ok: number): string {
  if (v == null) return 'text-slate-400'
  return v > good ? 'text-green-400' : v > ok ? 'text-yellow-400' : 'text-red-400'
}

function fmtW(w: number): string {
  return w >= 0.01 ? `${w.toFixed(3)} rad/s` : `${w.toExponential(1)} rad/s`
}
