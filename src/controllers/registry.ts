import { onoffDef } from './onoff'
import { pidDef } from './pid'
import type { ControllerDef } from './types'

/**
 * All controller types. Scenario-owned controllers (e.g. the buck's
 * Type II/III compensators) call registerController() at module load from
 * their scenario folder.
 *
 * IMPORTANT — why `var` + lazy init: there is an import cycle
 *   registry → pid.tsx → state/store → scenarios/registry → <scenario>/index
 * and scenario modules call registerController() while THIS module's body
 * has not run yet (ESM evaluates imports before the body). `const defs`
 * would be in its temporal dead zone at that moment and throw, taking the
 * whole app down. A `var` binding exists (as undefined) from instantiation,
 * and function declarations are hoisted — so lazy `??=` init makes
 * registration safe at any point of module evaluation. Builtins are added
 * on first lookup instead of at module load for the same reason.
 */
// eslint-disable-next-line no-var
var defs: Map<string, ControllerDef> | undefined

export function registerController(def: ControllerDef) {
  ;(defs ??= new Map()).set(def.id, def)
}

export function getController(id: string): ControllerDef {
  defs ??= new Map()
  if (!defs.has(pidDef.id)) {
    defs.set(pidDef.id, pidDef)
    defs.set(onoffDef.id, onoffDef)
  }
  const def = defs.get(id)
  if (!def) throw new Error(`Unknown controller: ${id}`)
  return def
}
