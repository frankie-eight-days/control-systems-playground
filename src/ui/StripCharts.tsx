import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import { getController } from '../controllers/registry'
import { getScenario } from '../scenarios/registry'
import { engine } from '../state/engine'
import { useStore } from '../state/store'
import { axisTheme, mountChart } from './charts'
import { seriesColors } from './colors'

function stripOpts(
  width: number,
  height: number,
  title: string,
  timeUnit: string,
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
      { ...axisTheme, label: `sim time (${timeUnit})`, labelSize: 12, size: 36 },
      { ...axisTheme, size: 48 },
    ],
    series: [{ label: 't' }, ...series],
    legend: { live: true },
  }
}

/**
 * Real-time strip charts streaming from the engine's history buffers, fully
 * configured by the scenario descriptor. The third chart shows the
 * controller's term decomposition (theory ↔ sim linkage) when the controller
 * provides one, else the scenario's aux signal.
 */
export function StripCharts() {
  const scenarioId = useStore((s) => s.scenarioId)
  const controllerId = useStore((s) => s.controllerId)
  const yRef = useRef<HTMLDivElement>(null)
  const uRef = useRef<HTMLDivElement>(null)
  const thirdRef = useRef<HTMLDivElement>(null)

  const scn = getScenario(scenarioId)
  const cdef = getController(controllerId)
  const termInfo = cdef.termInfo
  const showThird = !!termInfo || !!scn.aux

  useEffect(() => {
    const scn = getScenario(scenarioId)
    const cdef = getController(controllerId)
    const termInfo = cdef.termInfo
    const tUnit = scn.timeDisplay.unit
    const tMul = scn.timeDisplay.mul

    const yChart = mountChart(
      yRef.current!,
      (w, h) =>
        stripOpts(
          w,
          h,
          scn.y.label,
          tUnit,
          [
            {
              label: 'r',
              stroke: seriesColors.setpoint,
              width: 1.5,
              dash: [6, 4],
              value: (_u, v) => (v == null ? '—' : scn.y.fmt(v)),
            },
            {
              label: 'y',
              stroke: seriesColors.level,
              width: 2,
              value: (_u, v) => (v == null ? '—' : scn.y.fmt(v)),
            },
          ],
          [scn.y.min, scn.y.max],
        ),
      [[], [], []],
    )
    const uChart = mountChart(
      uRef.current!,
      (w, h) =>
        stripOpts(
          w,
          h,
          scn.uLabel,
          tUnit,
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
    const third = !termInfo && !scn.aux
      ? null
      : mountChart(
          thirdRef.current!,
          (w, h) =>
            stripOpts(
              w,
              h,
              termInfo ? 'Controller terms: u = Σ terms (%)' : scn.aux!.label,
              tUnit,
              termInfo
                ? termInfo.map((ti) => ({ label: ti.label, stroke: ti.color, width: 1.5 }))
                : [{ label: scn.aux!.unit, stroke: seriesColors.aux, width: 1.5 }],
              null,
            ),
          termInfo ? ([[], ...termInfo.map(() => [])] as uPlot.AlignedData) : [[], []],
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
      const t = tMul === 1 ? h.t : h.t.map((v) => v * tMul)
      yChart.chart.setData([t, h.sp, h.y])
      uChart.chart.setData([t, h.u])
      if (third) {
        if (termInfo) {
          // engine may not have terms yet right after a controller switch
          const cols = termInfo.map((_ti, i) => h.terms[i] ?? [])
          if (cols.every((c) => c.length === n)) third.chart.setData([t, ...cols])
        } else {
          third.chart.setData([t, h.aux])
        }
      }
    }
    raf = requestAnimationFrame(update)

    return () => {
      cancelAnimationFrame(raf)
      yChart.dispose()
      uChart.dispose()
      third?.dispose()
    }
  }, [scenarioId, controllerId])

  return (
    <div
      className={`grid h-full min-h-0 ${showThird ? 'grid-cols-3' : 'grid-cols-2'} grid-rows-[minmax(0,1fr)] gap-2`}
    >
      <div ref={yRef} className="min-h-0 min-w-0 overflow-hidden" />
      <div ref={uRef} className="min-h-0 min-w-0 overflow-hidden" />
      {showThird && <div ref={thirdRef} className="min-h-0 min-w-0 overflow-hidden" />}
    </div>
  )
}
