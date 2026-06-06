import { onoffDef } from './onoff'
import { pidDef } from './pid'
import type { ControllerDef } from './types'

/**
 * All controller types. Scenario-specific controllers (e.g. the buck's
 * Type II/III compensators) are registered here too — they're defined in
 * their scenario folder and imported by the scenario's index.ts, which
 * calls registerController() at module load.
 */
const defs = new Map<string, ControllerDef>([
  [pidDef.id, pidDef],
  [onoffDef.id, onoffDef],
])

export function registerController(def: ControllerDef) {
  defs.set(def.id, def)
}

export function getController(id: string): ControllerDef {
  const def = defs.get(id)
  if (!def) throw new Error(`Unknown controller: ${id}`)
  return def
}
