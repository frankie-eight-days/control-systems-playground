import { SimEngine } from '../sim/loop'

/** The one simulation engine instance. Lives outside React — components
 *  read from it in their own rAF loops; App drives engine.tick(). */
export const engine = new SimEngine()
