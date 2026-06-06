import { useEffect, useMemo, useRef } from 'react'
import type uPlot from 'uplot'
import { bode, type Margins } from '../analysis/freq'
import { linearize } from '../analysis/linearize'
import { engine } from '../state/engine'
import { useStore } from '../state/store'
import { axisTheme, mountChart, seriesColors } from './charts'

/**
 * Open-loop Bode plot of L(jω) = C(jω)·G(jω), recomputed live as gains and
 * operating point change. G comes from numerical linearization of the
 * NONLINEAR tank at the setpoint — the label says so, because that honesty
 * is part of the lesson.
 */
export function BodePlot() {
  const kp = useStore((s) => s.kp)
  const ki = useStore((s) => s.ki)
  const kd = useStore((s) => s.kd)
  const wf = useStore((s) => s.wf)
  const setpoint = useStore((s) => s.setpoint)
  const valve = useStore((s) => s.valve)

  const data = useMemo(() => {
    const d = { valve }
    const eq = engine.plant.equilibrium(setpoint, d)
    const ss = linearize(engine.plant, eq.x, eq.u, d)
    return { ...bode(ss, { kp, ki, kd, wf }), u0: eq.u }
  }, [kp, ki, kd, wf, setpoint, valve])

  const chartRef = useRef<ReturnType<typeof mountChart> | null>(null)
  const marginsRef = useRef<Margins>(data.margins)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const drawMarkers = (u: uPlot) => {
      const m = marginsRef.current
      const ctx = u.ctx
      const { left, top, width, height } = u.bbox
      ctx.save()
      ctx.setLineDash([5, 5])
      ctx.lineWidth = 1
      // reference lines: 0 dB and −180°
      const href = (val: number, scale: string, color: string) => {
        const y = u.valToPos(val, scale, true)
        if (y < top || y > top + height) return
        ctx.strokeStyle = color
        ctx.beginPath()
        ctx.moveTo(left, y)
        ctx.lineTo(left + width, y)
        ctx.stroke()
      }
      href(0, 'dB', 'rgba(56, 189, 248, 0.35)')
      href(-180, 'deg', 'rgba(251, 191, 36, 0.35)')
      // crossover frequencies
      const vref = (w: number | null, color: string) => {
        if (w == null) return
        const x = u.valToPos(w, 'x', true)
        if (x < left || x > left + width) return
        ctx.strokeStyle = color
        ctx.beginPath()
        ctx.moveTo(x, top)
        ctx.lineTo(x, top + height)
        ctx.stroke()
      }
      vref(m.wgc, 'rgba(74, 222, 128, 0.8)')
      vref(m.wpc, 'rgba(248, 113, 113, 0.8)')
      ctx.restore()
    }

    const mounted = mountChart(
      wrapRef.current!,
      (w, h) => ({
        width: w,
        height: h,
        title: 'Open loop  L(jω) = C(jω)·G(jω)',
        cursor: { drag: { x: false, y: false } },
        select: { show: false, left: 0, top: 0, width: 0, height: 0 },
        scales: {
          x: { time: false, distr: 3, log: 10 },
          dB: { auto: true },
          deg: { auto: true },
        },
        axes: [
          { ...axisTheme, label: 'ω (rad/s)', labelSize: 12, size: 36 },
          {
            ...axisTheme,
            scale: 'dB',
            label: '|L|  (dB)',
            labelSize: 12,
            size: 52,
            stroke: seriesColors.mag,
          },
          {
            ...axisTheme,
            scale: 'deg',
            label: '∠L  (deg)',
            labelSize: 12,
            side: 1,
            size: 52,
            stroke: seriesColors.phase,
            grid: { show: false },
          },
        ],
        series: [
          { label: 'ω' },
          { label: '|L|', scale: 'dB', stroke: seriesColors.mag, width: 2 },
          { label: '∠L', scale: 'deg', stroke: seriesColors.phase, width: 2 },
        ],
        hooks: { draw: [drawMarkers] },
      }),
      [[], [], []],
    )
    chartRef.current = mounted
    return () => {
      mounted.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    marginsRef.current = data.margins
    chartRef.current?.chart.setData([data.w, data.magDb, data.phaseDeg])
  }, [data])

  const m = data.margins
  const pmClass =
    m.pm == null
      ? 'text-slate-400'
      : m.pm > 45
        ? 'text-green-400'
        : m.pm > 20
          ? 'text-yellow-400'
          : 'text-red-400'
  const gmClass =
    m.gmDb == null
      ? 'text-slate-400'
      : m.gmDb > 10
        ? 'text-green-400'
        : m.gmDb > 4
          ? 'text-yellow-400'
          : 'text-red-400'

  return (
    <div className="flex h-full flex-col">
      <div ref={wrapRef} className="min-h-0 flex-1" />
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-2 pb-1 font-mono text-[11px]">
        <span className={pmClass}>
          PM = {m.pm == null ? '∞' : `${m.pm.toFixed(1)}°`}
          {m.wgc != null && <span className="text-slate-500"> @ ω₍gc₎={fmtW(m.wgc)}</span>}
        </span>
        <span className={gmClass}>
          GM = {m.gmDb == null ? '∞' : `${m.gmDb.toFixed(1)} dB`}
          {m.wpc != null && <span className="text-slate-500"> @ ω₍pc₎={fmtW(m.wpc)}</span>}
        </span>
        <span className="text-slate-500">
          G linearized at h₀={setpoint.toFixed(2)} m, valve={(valve * 100).toFixed(0)}%, u₀=
          {data.u0.toFixed(1)}%
        </span>
      </div>
    </div>
  )
}

function fmtW(w: number): string {
  return w >= 0.01 ? `${w.toFixed(3)} rad/s` : `${w.toExponential(1)} rad/s`
}
