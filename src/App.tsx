import { useEffect } from 'react'
import { getController } from './controllers/registry'
import { getScenario, scenarios } from './scenarios/registry'
import { engine } from './state/engine'
import { useStore } from './state/store'
import { BodePlot } from './ui/BodePlot'
import { ControlPanel } from './ui/ControlPanel'
import { StripCharts } from './ui/StripCharts'
import { TheoryPanel } from './ui/TheoryPanel'

export default function App() {
  const scenarioId = useStore((s) => s.scenarioId)
  const loadScenario = useStore((s) => s.loadScenario)
  const scn = getScenario(scenarioId)

  // Drive the simulation engine from one rAF loop. The engine itself is
  // DOM-free; the scenario slice and controller factory are injected here.
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const s = useStore.getState()
      engine.tick((now - last) / 1000, s, getScenario(s.scenarioId), (id) =>
        getController(id).create(),
      )
      last = now
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-200">
      <header className="flex items-baseline gap-3 border-b border-slate-800 px-4 py-2">
        <h1 className="text-base font-bold tracking-tight">Control Systems Playground</h1>
        {/* Local two-port workflow: the dev server hot-reloads under active
            agent work — badge it so it can't be confused with a static build.
            Production builds (local preview AND the public site) show nothing. */}
        {import.meta.env.DEV && (
          <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
            DEV — live, hot-reloads
          </span>
        )}
        {/* 11 scenarios and counting — wrap into rows instead of overflowing */}
        <nav className="flex flex-wrap items-baseline gap-1">
          {scenarios.map((s) => (
            <button
              key={s.id}
              className={`rounded px-2 py-0.5 text-xs ${
                s.id === scenarioId
                  ? 'bg-sky-600 font-semibold text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
              onClick={() => loadScenario(s.id)}
            >
              {s.title}
            </button>
          ))}
        </nav>
        <span className="hidden text-xs text-slate-500 lg:inline">
          {scn.blurb} — physics-based, runs entirely in your browser
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="grid min-w-0 flex-1 grid-rows-[minmax(0,1.15fr)_minmax(0,1fr)] gap-2 p-2">
          <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-2">
            <Panel>
              {/* key remounts the scene (and its rAF/canvas) on scenario switch */}
              <scn.Scene key={scn.id} />
            </Panel>
            <Panel>
              <BodePlot />
            </Panel>
          </div>
          <Panel>
            <StripCharts />
          </Panel>
        </main>

        <aside className="w-[370px] shrink-0 space-y-3 overflow-y-auto border-l border-slate-800 p-2">
          <ControlPanel />
          <TheoryPanel />
        </aside>
      </div>
    </div>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-0 min-w-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40 p-1">
      {children}
    </div>
  )
}
