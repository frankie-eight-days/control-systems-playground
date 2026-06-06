import uPlot from 'uplot'

export { seriesColors } from './colors'

/** Shared dark-theme axis/grid styling for all uPlot charts. */
export const axisTheme: Partial<uPlot.Axis> = {
  stroke: '#94a3b8',
  grid: { stroke: 'rgba(148, 163, 184, 0.12)', width: 1 },
  ticks: { stroke: 'rgba(148, 163, 184, 0.25)', width: 1 },
}

/**
 * Create a uPlot bound to a container div, kept sized to it with a
 * ResizeObserver. Returns the chart and a dispose function.
 */
export function mountChart(
  el: HTMLDivElement,
  makeOpts: (width: number, height: number) => uPlot.Options,
  data: uPlot.AlignedData,
): { chart: uPlot; dispose: () => void } {
  const chart = new uPlot(
    makeOpts(Math.max(80, el.clientWidth), Math.max(80, el.clientHeight - 60)),
    data,
    el,
  )
  // uPlot's width/height are the plot area only; title + legend add chrome.
  // Measure the chrome and refit so the whole chart stays inside `el`.
  const fit = () => {
    const chrome = chart.root.offsetHeight - chart.height
    const width = Math.max(80, el.clientWidth)
    const height = Math.max(80, el.clientHeight - chrome)
    // Only resize on real change — otherwise a content-sized container and
    // this fit can feed each other and grow the chart unbounded.
    if (width !== chart.width || height !== chart.height) chart.setSize({ width, height })
  }
  fit()
  const ro = new ResizeObserver(fit)
  ro.observe(el)
  return {
    chart,
    dispose: () => {
      ro.disconnect()
      chart.destroy()
    },
  }
}
