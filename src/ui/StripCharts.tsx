import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import { engine } from '../state/engine'
import { TANK } from '../sim/plants/tank'
import { axisTheme, mountChart, seriesColors } from './charts'

function stripOpts(
  width: number,
  height: number,
  title: string,
  series: uPlot.Series[],
  yRange: [number, number] | null,
): uPlot.Options {
  return {
    width,
    height,
    title,
    cursor: { drag: { x: false, y: false } },
    select: { show: false, left: 0, top: 0, width: 0, height: 0 },
    scales: {
      x: { time: false },
      y: yRange ? { auto: false, range: yRange } : { auto: true },
    },
    axes: [
      { ...axisTheme, label: 'sim time (s)', labelSize: 12, size: 36 },
      { ...axisTheme, size: 48 },
    ],
    series: [{ label: 't (s)' }, ...series],
    legend: { live: true },
  }
}

/**
 * Real-time strip charts streaming from the engine's history buffers.
 * The P/I/D decomposition chart is deliberate theory↔sim linkage: users see
 * WHICH controller term produces the behavior in the level trace.
 */
export function StripCharts() {
  const levelRef = useRef<HTMLDivElement>(null)
  const ctrlRef = useRef<HTMLDivElement>(null)
  const termsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const level = mountChart(
      levelRef.current!,
      (w, h) =>
        stripOpts(
          w,
          h,
          'Level h & setpoint r (m)',
          [
            {
              label: 'r',
              stroke: seriesColors.setpoint,
              width: 1.5,
              dash: [6, 4],
              value: (_u, v) => (v == null ? '—' : v.toFixed(2)),
            },
            {
              label: 'h',
              stroke: seriesColors.level,
              width: 2,
              value: (_u, v) => (v == null ? '—' : v.toFixed(3)),
            },
          ],
          [0, TANK.height * 1.04],
        ),
      [[], [], []],
    )
    const ctrl = mountChart(
      ctrlRef.current!,
      (w, h) =>
        stripOpts(
          w,
          h,
          'Pump command u (%) — saturates at 0 / 100',
          [
            {
              label: 'u',
              stroke: seriesColors.control,
              width: 2,
              value: (_u, v) => (v == null ? '—' : v.toFixed(1)),
            },
          ],
          [-4, 104],
        ),
      [[], []],
    )
    const terms = mountChart(
      termsRef.current!,
      (w, h) =>
        stripOpts(
          w,
          h,
          'Controller terms: u = P + I + D (%)',
          [
            { label: 'P', stroke: seriesColors.pTerm, width: 1.5 },
            { label: 'I', stroke: seriesColors.iTerm, width: 1.5 },
            { label: 'D', stroke: seriesColors.dTerm, width: 1.5 },
          ],
          null,
        ),
      [[], [], [], []],
    )

    let raf = 0
    let lastLen = -1
    let lastT = -1
    const update = () => {
      raf = requestAnimationFrame(update)
      const h = engine.history
      const n = h.t.length
      const tEnd = n ? h.t[n - 1] : 0
      if (n === lastLen && tEnd === lastT) return
      lastLen = n
      lastT = tEnd
      level.chart.setData([h.t, h.sp, h.y])
      ctrl.chart.setData([h.t, h.u])
      terms.chart.setData([h.t, h.pTerm, h.iTerm, h.dTerm])
    }
    raf = requestAnimationFrame(update)

    return () => {
      cancelAnimationFrame(raf)
      level.dispose()
      ctrl.dispose()
      terms.dispose()
    }
  }, [])

  return (
    <div className="grid h-full min-h-0 grid-cols-3 grid-rows-[minmax(0,1fr)] gap-2">
      <div ref={levelRef} className="min-h-0 min-w-0 overflow-hidden" />
      <div ref={ctrlRef} className="min-h-0 min-w-0 overflow-hidden" />
      <div ref={termsRef} className="min-h-0 min-w-0 overflow-hidden" />
    </div>
  )
}
