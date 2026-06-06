import { create } from 'zustand'
import { defaultScenarioId, getScenario } from '../scenarios/registry'
import type { ScenarioDef } from '../scenarios/types'

export interface StoreState {
  scenarioId: string
  running: boolean
  timeScale: number
  setpoint: number
  controllerId: string
  /** Current controller params (keys per the scenario's controller config). */
  ctl: Record<string, number>
  /** Current disturbance values (keys per the scenario's dist sliders). */
  dist: Record<string, number>
  noiseSigma: number
  set: (partial: Partial<Omit<StoreState, 'set' | 'loadScenario' | 'setController'>>) => void
  /** Switch scenario: resets all params to that scenario's defaults. */
  loadScenario: (id: string) => void
  /** Switch controller type within the scenario: loads its default params. */
  setController: (id: string) => void
}

function scenarioDefaults(scn: ScenarioDef) {
  const cfg =
    scn.controllers.find((c) => c.id === scn.defaultControllerId) ?? scn.controllers[0]
  return {
    scenarioId: scn.id,
    timeScale: scn.defaultTimeScale,
    setpoint: defaultSetpoint(scn),
    controllerId: cfg.id,
    ctl: { ...cfg.defaults },
    dist: { ...scn.distDefaults },
    noiseSigma: 0,
  }
}

function defaultSetpoint(scn: ScenarioDef) {
  // midpoint-ish default, snapped to the slider step
  const mid = (scn.setpoint.min + scn.setpoint.max) / 2
  return Math.round(mid / scn.setpoint.step) * scn.setpoint.step
}

export const useStore = create<StoreState>((set) => ({
  running: true,
  ...scenarioDefaults(getScenario(defaultScenarioId())),
  set: (partial) => set(partial),
  loadScenario: (id) => {
    const scn = getScenario(id)
    set(scenarioDefaults(scn))
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('scenario', scn.id)
      window.history.replaceState(null, '', url)
    }
  },
  setController: (id) =>
    set((s) => {
      const scn = getScenario(s.scenarioId)
      const cfg = scn.controllers.find((c) => c.id === id)
      return cfg ? { controllerId: id, ctl: { ...cfg.defaults } } : {}
    }),
}))
