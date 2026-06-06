import { rk4 } from './integrator'
import { SeededNoise } from './noise'
import type { Plant } from './plant'

/** Live controller instance, structurally identical to controllers/types.ts
 *  ControllerImpl (declared here too so sim/ stays import-clean of UI). */
export interface ControllerImpl {
  reset(): void
  update(setpoint: number, y: number, dt: number, p: Record<string, number>): number
  termValues?(): number[]
}

/** The slice of a ScenarioDef the engine needs — sim/ never imports React,
 *  so the full descriptor (which carries components) stays out of here. */
export interface EngineScenario {
  id: string
  plant: Plant
  initialX: number[]
  dt: number
  sampleDt: number
  windowS: number
  aux?: { get(x: number[], u: number, d: Record<string, number>): number }
}

/** Store snapshot consumed each tick. */
export interface SimParams {
  scenarioId: string
  running: boolean
  timeScale: number
  setpoint: number
  controllerId: string
  ctl: Record<string, number>
  dist: Record<string, number>
  noiseSigma: number
}

export interface History {
  t: number[]
  sp: number[]
  y: number[]
  u: number[]
  /** Controller term decomposition, parallel to the def's termInfo. */
  terms: number[][]
  /** Scenario aux signal (e.g. inductor current), if defined. */
  aux: number[]
}

/** Absolute ceiling on physics substeps per animation frame. */
const HARD_STEP_CAP = 50_000

/**
 * The simulation engine: plant + controller + disturbances advanced with a
 * fixed-timestep accumulator. Scenario- and controller-agnostic: the active
 * scenario slice and a controller factory are passed into tick() by the
 * state layer, so this file stays DOM-free and Worker-portable.
 */
export class SimEngine {
  scn: EngineScenario | null = null
  private controllerId = ''
  private ctl: ControllerImpl | null = null
  private noise = new SeededNoise()

  x: number[] = []
  t = 0
  u = 0
  yMeas = 0

  history: History = { t: [], sp: [], y: [], u: [], terms: [], aux: [] }
  private acc = 0
  private sampleAcc = 0

  /** Reset plant + controller state for the current scenario. */
  reset() {
    if (!this.scn) return
    this.x = this.scn.initialX.slice()
    this.t = 0
    this.u = 0
    this.yMeas = this.scn.plant.output(this.x)
    this.acc = 0
    this.sampleAcc = 0
    this.ctl?.reset()
    this.noise.reset()
    const h = this.history
    h.t.length = h.sp.length = h.y.length = h.u.length = h.aux.length = 0
    for (const arr of h.terms) arr.length = 0
  }

  /** Instantaneous state disturbance (click-to-disturb). */
  applyImpulse(fn: (x: number[]) => number[]) {
    if (this.scn) this.x = fn(this.x)
  }

  /** Advance by dtReal wall-clock seconds at the given time scale. */
  tick(
    dtReal: number,
    p: SimParams,
    scn: EngineScenario,
    makeController: (id: string) => ControllerImpl,
  ) {
    if (this.scn?.id !== scn.id) {
      // Scenario switch: adopt and hard-reset.
      this.scn = scn
      this.controllerId = ''
      this.ctl = null
      this.reset()
    }
    if (this.controllerId !== p.controllerId) {
      this.controllerId = p.controllerId
      this.ctl = makeController(p.controllerId)
      this.ctl.reset()
      // Term shape changes with the controller — clear that chart's data.
      this.history.terms = []
    }
    if (!p.running || !this.ctl) return

    // Clamp huge frame gaps (backgrounded tab), then cap substeps to what
    // the configured time scale implies, plus an absolute CPU ceiling.
    this.acc += Math.min(dtReal, 0.25) * p.timeScale
    const cap = Math.min(HARD_STEP_CAP, Math.ceil((0.3 * p.timeScale) / scn.dt) + 8)
    let steps = Math.floor(this.acc / scn.dt)
    if (steps > cap) {
      steps = cap
      this.acc = 0 // drop unprocessable backlog rather than spiraling
    } else {
      this.acc -= steps * scn.dt
    }
    for (let i = 0; i < steps; i++) this.step(p, scn)
  }

  private step(p: SimParams, scn: EngineScenario) {
    const dt = scn.dt
    // Sense (+ optional gaussian noise), control, then actuate with the
    // SATURATED command held over the step (zero-order hold).
    const yTrue = scn.plant.output(this.x)
    this.yMeas = yTrue + (p.noiseSigma > 0 ? p.noiseSigma * this.noise.gauss() : 0)
    this.u = this.ctl!.update(p.setpoint, this.yMeas, dt, p.ctl)

    const u = this.u
    this.x = rk4((x) => scn.plant.deriv(x, u, p.dist), this.x, dt)
    this.t += dt

    this.sampleAcc += dt
    if (this.sampleAcc >= scn.sampleDt - 1e-12) {
      this.sampleAcc = 0
      this.record(p, scn)
    }
  }

  private record(p: SimParams, scn: EngineScenario) {
    const h = this.history
    h.t.push(this.t)
    h.sp.push(p.setpoint)
    h.y.push(this.yMeas)
    h.u.push(this.u)
    const tv = this.ctl!.termValues?.()
    if (tv) {
      while (h.terms.length < tv.length) h.terms.push(new Array(h.t.length - 1).fill(0))
      for (let i = 0; i < tv.length; i++) h.terms[i].push(tv[i])
    }
    h.aux.push(scn.aux ? scn.aux.get(this.x, this.u, p.dist) : 0)

    const maxSamples = Math.ceil(scn.windowS / scn.sampleDt)
    if (h.t.length > maxSamples) {
      const drop = h.t.length - maxSamples
      h.t.splice(0, drop)
      h.sp.splice(0, drop)
      h.y.splice(0, drop)
      h.u.splice(0, drop)
      h.aux.splice(0, drop)
      for (const arr of h.terms) arr.splice(0, drop)
    }
  }
}
