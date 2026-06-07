import { ballbeamScenario } from './ballbeam'
import { buckScenario } from './buck'
import { cruiseScenario } from './cruise'
import { jetScenario } from './jet'
import { maglevScenario } from './maglev'
import { pendulumScenario } from './pendulum'
import { motorScenario } from './motor'
import { pmsmSpeedScenario, pmsmTorqueScenario } from './pmsm'
import { tankScenario } from './tank'
import { thermalScenario } from './thermal'
import type { ScenarioDef } from './types'

/**
 * All scenarios, in display order. Adding a scenario: build its folder
 * against the ScenarioDef contract, import it here, add it to this list.
 * This file is owned by the integration lead — scenario teammates must
 * NOT edit it (it's the one merge point).
 */
export const scenarios: ScenarioDef[] = [
  tankScenario,
  cruiseScenario,
  thermalScenario,
  motorScenario,
  buckScenario,
  pmsmTorqueScenario,
  pmsmSpeedScenario,
  jetScenario,
  ballbeamScenario,
  pendulumScenario,
  maglevScenario,
]

export function getScenario(id: string): ScenarioDef {
  return scenarios.find((s) => s.id === id) ?? scenarios[0]
}

export const defaultScenarioId = (): string => {
  if (typeof window !== 'undefined') {
    const param = new URLSearchParams(window.location.search).get('scenario')
    if (param && scenarios.some((s) => s.id === param)) return param
  }
  return scenarios[0].id
}
