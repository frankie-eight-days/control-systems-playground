import { SimEngine } from '../sim/loop'

/** The one simulation engine instance. Lives outside React — components
 *  read from it in their own rAF loops; App drives engine.tick(). */
export const engine = new SimEngine()

// Dev-only observability for the Playwright E2E scripts (scripts/*.mjs):
// lets tests assert on sim time, state, and history instead of pixels.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __engine: SimEngine }).__engine = engine
}
