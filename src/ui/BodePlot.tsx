import { useEffect, useMemo, useRef, useState } from 'react'
import type uPlot from 'uplot'
import { freqAnalysis, poles2, type FreqAnalysis } from '../analysis/freq'
import { linearize } from '../analysis/linearize'
import { getController } from '../controllers/registry'
import { getScenario } from '../scenarios/registry'
import { useStore } from '../state/store'
import { BlockDiagram } from './BlockDiagram'
import { axisTheme, mountChart } from './charts'
import { seriesColors } from './colors'

/**
 * Frequency-domain panel with five views of the SAME loop:
 *   Diagram — live block diagram
 *   L — open loop C·G with stability margins
 *   T/S — closed loop: tracking T = L/(1+L) and sensitivity S = 1/(1+L)
 *   C — controller anatomy: component asymptotes stacking into C(jω)
 *   G — the linearized plant alone
 * In dB, |L| = |C| + |G| — the C and G tabs literally add to give L.
 * The x-axis displays rad/s or Hz per the scenario (internally rad/s).
 */
type Tab = 'D' | 'L' | 'T' | 'C' | 'G'
type ChartTab = 'L' | 'T' | 'C' | 'G'

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'D', label: 'Diagram', hint: 'system block diagram, live signals' },
  { id: 'L', label: 'L = C·G', hint: 'open loop + margins' },
  { id: 'T', label: 'T, S', hint: 'closed loop' },
  { id: 'C', label: 'C anatomy', hint: 'controller components' },
  { id: 'G', label: 'G', hint: 'plant' },
]

interface Analysis extends FreqAnalysis {
  u0: number
  poles: { re: number; im: number }[]
  /** Hz display: divide rad/s by 2π. */
  wDiv: number
  freqUnit: string
}

const EMPTY: Analysis = {
  w: [],
  gMagDb: [],
  gPhaseDeg: [],
  cMagDb: [],
  cParts: [],
  lMagDb: [],
  lPhaseDeg: [],
  tMagDb: [],
  sMagDb: [],
  margins: { wgc: null, pm: null, wpc: null, gmDb: null },
  closed: { wBw: null, mtDb: -200, msDb: -200 },
  u0: 0,
  poles: [],
  wDiv: 1,
  freqUnit: 'rad/s',
}

export function BodePlot() {
  const scenarioId = useStore((s) => s.scenarioId)
  const controllerId = useStore((s) => s.controllerId)
  const ctl = useStore((s) => s.ctl)
  const setpoint = useStore((s) => s.setpoint)
  const dist = useStore((s) => s.dist)
  const [tab, setTab] = useState<Tab>('L')

  const scn = getScenario(scenarioId)
  const cdef = getController(controllerId)
  // Nonlinear law (relay): the LTI views don't apply.
  const isNote = cdef.response === null && (tab === 'L' || tab === 'T' || tab === 'C')
  const isChart = tab !== 'D' && !isNote

  const data: Analysis = useMemo(() => {
    const response = cdef.response
    if (!response) return EMPTY
    const eq = scn.plant.equilibrium(setpoint, dist)
    const ss = linearize(scn.plant, eq.x, eq.u, dist)
    const parts = (cdef.parts ?? []).map((part) => ({
      label: part.label,
      color: part.color,
      mag: (w: number) => part.mag(w, ctl),
    }))
    const fa = freqAnalysis(ss, (w) => response(ctl, w), parts, scn.wSweep[0], scn.wSweep[1])
    return {
      ...fa,
      u0: eq.u,
      poles: ss.B.length === 2 ? poles2(ss.A) : [],
      wDiv: scn.freqDisplay === 'Hz' ? 2 * Math.PI : 1,
      freqUnit: scn.freqDisplay,
    }
  }, [scn, cdef, ctl, setpoint, dist])

  const dataRef = useRef(data)
  dataRef.current = data
  const chartRef = useRef<ReturnType<typeof mountChart> | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // (Re)create the chart when the view shape changes — tab, scenario (freq
  // unit), or controller (number of anatomy series).
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
  }, [tab, isChart, scenarioId, controllerId])

  // Push new data into the existing chart when params move.
  useEffect(() => {
    if (tab === 'D' || isNote) return
    chartRef.current?.chart.setData(chartData(tab, data))
  }, [data, tab, isNote])

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
        <NonlinearNote label={cdef.label} />
      ) : (
        <>
          <div ref={wrapRef} className="min-h-0 flex-1" />
          <Footer tab={tab as ChartTab} data={data} setpoint={setpoint} scnY={scn.y} />
        </>
      )}
    </div>
  )
}

function NonlinearNote({ label }: { label: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-md space-y-2 text-sm text-slate-400">
        <p className="font-semibold text-slate-200">{label} is nonlinear — there is no C(s).</p>
        <p>
          Its effective "gain" depends on signal amplitude, so the LTI views (L, T/S, C) don't
          apply. The loop doesn't settle — it <em>limit-cycles</em>; the theory panel predicts the
          cycle from the plant's rates. Compare it against the strip chart.
        </p>
        <p>
          The plant is still linearizable — the <span className="font-mono text-slate-300">G</span>{' '}
          tab works. (Describing-function analysis, which extends Bode thinking to relays, is on
          the roadmap.)
        </p>
      </div>
    </div>
  )
}

function chartData(tab: ChartTab, d: Analysis): uPlot.AlignedData {
  const wDisp = d.w.map((w) => w / d.wDiv)
  switch (tab) {
    case 'L':
      return [wDisp, d.lMagDb, d.lPhaseDeg]
    case 'T':
      return [wDisp, d.tMagDb, d.sMagDb]
    case 'C':
      return [wDisp, d.cMagDb, ...d.cParts.map((p) => p.magDb)] as uPlot.AlignedData
    case 'G':
      return [wDisp, d.gMagDb, d.gPhaseDeg]
  }
}

function buildOpts(
  tab: ChartTab,
  width: number,
  height: number,
  dataRef: React.RefObject<Analysis>,
): uPlot.Options {
  const freqUnit = dataRef.current.freqUnit
  const base: uPlot.Options = {
    width,
    height,
    title: '',
    cursor: { drag: { x: false, y: false } },
    select: { show: false, left: 0, top: 0, width: 0, height: 0 },
    scales: { x: { time: false, distr: 3, log: 10 }, dB: { auto: true } },
    axes: [{ ...axisTheme, label: `ω (${freqUnit})`, labelSize: 12, size: 36 }],
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
        title: 'Controller anatomy:  |C| with its component asymptotes',
        axes: [base.axes![0], dbAxis('|C|  (dB)', '#94a3b8')],
        series: [
          { label: 'ω' },
          { label: '|C|', scale: 'dB', stroke: '#e2e8f0', width: 2.5 },
          ...dataRef.current.cParts.map(
            (p): uPlot.Series => ({
              label: p.label,
              scale: 'dB',
              stroke: p.color,
              width: 1.25,
              dash: [5, 5],
            }),
          ),
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

function drawMarkers(u: uPlot, tab: ChartTab, d: Analysis) {
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
    const x = u.valToPos(w / d.wDiv, 'x', true)
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
  scnY,
}: {
  tab: ChartTab
  data: Analysis
  setpoint: number
  scnY: { fmt: (v: number) => string }
}) {
  const m = data.margins
  const fmtW = (w: number) => {
    const v = w / data.wDiv
    const s = v >= 0.01 ? v.toFixed(3) : v.toExponential(1)
    return `${s} ${data.freqUnit}`
  }
  const opPoint = (
    <span className="text-slate-500">
      G linearized at y₀={scnY.fmt(setpoint)}, u₀={data.u0.toFixed(1)}%
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
        The compensator |C| rides the max of its component asymptotes. In dB, |L| = |C| + |G|.
      </span>
    )
  } else {
    body = (
      <>
        {data.poles.length > 0 && (
          <span className="text-slate-400">
            poles:{' '}
            {data.poles
              .map((p) =>
                p.im === 0
                  ? `${p.re.toPrecision(3)}`
                  : `${p.re.toPrecision(3)}±j${Math.abs(p.im).toPrecision(3)}`,
              )
              .join(', ')}{' '}
            rad/s
          </span>
        )}
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
