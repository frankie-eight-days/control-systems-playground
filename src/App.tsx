import { useEffect } from 'react'
import { engine } from './state/engine'
import { useStore } from './state/store'
import { BodePlot } from './ui/BodePlot'
import { ControlPanel } from './ui/ControlPanel'
import { StripCharts } from './ui/StripCharts'
import { TankScene } from './ui/TankScene'
import { TheoryPanel } from './ui/TheoryPanel'

export default function App() {
  // Drive the simulation engine from one rAF loop. The engine itself is
  // DOM-free; components read its state in their own draw loops.
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      engine.tick((now - last) / 1000, useStore.getState())
      last = now
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-200">
      <header className="flex items-baseline gap-3 border-b border-slate-800 px-4 py-2">
        <h1 className="text-base font-bold tracking-tight">Control Systems Playground</h1>
        <span className="text-xs text-slate-500">
          PID level control of a gravity-drained tank — physics-based, runs entirely in your
          browser
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="grid min-w-0 flex-1 grid-rows-[minmax(0,1.15fr)_minmax(0,1fr)] gap-2 p-2">
          <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-2">
            <Panel>
              <TankScene />
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
