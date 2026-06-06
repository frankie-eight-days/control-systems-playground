import type { Plant } from '../sim/plant'
import { TheorySection } from '../ui/TheorySection'
import type { ScenarioDef } from './types'

/**
 * Placeholder scenario factory. Each upcoming scenario folder starts as one
 * of these so the registry is wired ONCE (by the integration lead) and each
 * scenario teammate only ever edits their own folder. Replace the stub by
 * exporting a real ScenarioDef from the folder's index.ts.
 */
class StubPlant implements Plant {
  deriv(x: number[], u: number): number[] {
    // first-order placeholder: y → u/100 with τ = 2 s
    return [(u / 100 - x[0]) / 2]
  }
  output(x: number[]): number {
    return x[0]
  }
  equilibrium(y: number): { x: number[]; u: number } {
    return { x: [y], u: Math.min(100, Math.max(0, y * 100)) }
  }
}

export function makeStubScenario(id: string, title: string): ScenarioDef {
  const Scene = () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-500">
      «{title}» scene — under construction
    </div>
  )
  const PlantTheory = () => (
    <TheorySection title={`${title} — under construction`}>
      <p className="text-xs text-slate-400">
        This scenario is being built. The placeholder plant is a unit first-order lag.
      </p>
    </TheorySection>
  )
  return {
    id,
    title,
    blurb: `${title} (under construction)`,
    plant: new StubPlant(),
    initialX: [0],
    dt: 0.005,
    sampleDt: 0.05,
    windowS: 60,
    timeScales: [1, 2, 5, 10],
    defaultTimeScale: 1,
    timeDisplay: { unit: 's', mul: 1 },
    freqDisplay: 'rad/s',
    wSweep: [1e-3, 1e3],
    y: { label: 'Output y', unit: '', min: 0, max: 1.2, fmt: (v) => v.toFixed(3) },
    setpoint: { key: 'setpoint', label: 'Setpoint r', unit: '', min: 0.1, max: 1, step: 0.01 },
    uLabel: 'Command u (%)',
    controllers: [
      {
        id: 'pid',
        params: [
          { key: 'kp', label: 'Kp', unit: '%/unit', min: 0, max: 500, step: 1 },
          { key: 'ki', label: 'Ki', unit: '%/(unit·s)', min: 0, max: 100, step: 0.5 },
          { key: 'kd', label: 'Kd', unit: '%·s/unit', min: 0, max: 100, step: 1 },
          { key: 'wf', label: 'ωf', unit: 'rad/s', min: 1, max: 100, step: 1 },
        ],
        defaults: { kp: 100, ki: 20, kd: 0, wf: 20 },
      },
    ],
    defaultControllerId: 'pid',
    distSliders: [],
    distDefaults: {},
    impulses: [],
    noise: { max: 0.02, step: 0.001, unit: 'm-unit', mul: 1000 },
    presets: [],
    diagram: { plantLabel: `${title} G(s)`, dSummary: () => 'd: (none yet)' },
    Scene,
    PlantTheory,
  }
}
