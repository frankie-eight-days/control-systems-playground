import { rk4 } from './integrator'
import { OnOffController } from './onoff'
import { PID } from './pid'
import { SeededNoise } from './noise'
import { TankPlant, TANK, type TankDisturbances } from './plants/tank'

export type ControllerType = 'pid' | 'onoff'

/** Fixed physics timestep (simulated seconds). Never stretched — time
 *  acceleration runs MORE substeps per animation frame. */
export const DT = 0.005
/** History sampling period (simulated seconds). */
export const SAMPLE_DT = 0.1
/** History window: 240 s of simulated time. */
const MAX_SAMPLES = 2400
/** Safety cap on physics substeps per tick (≈ 400× realtime at 60 fps). */
const MAX_STEPS_PER_TICK = 8000

export interface SimParams {
  running: boolean
  timeScale: number
  setpoint: number
  controller: ControllerType
  kp: number
  ki: number
  kd: number
  wf: number
  band: number // m, on/off hysteresis width Δ
  valve: number // 0..1
  noiseSigma: number // m, gaussian σ on the level sensor
}

export interface History {
  t: number[]
  sp: number[]
  y: number[] // measured (noisy) level
  u: number[]
  pTerm: number[]
  iTerm: number[]
  dTerm: number[]
}

/**
 * The simulation engine: plant + controller + disturbances, advanced with a
 * fixed-timestep accumulator. Pure of any DOM/React dependency so it can be
 * moved into a Web Worker later without changes.
 */
export class SimEngine {
  readonly plant = new TankPlant()
  readonly pid = new PID()
  readonly onoff = new OnOffController()
  private noise = new SeededNoise()

  x: number[] = [0.2, 0]
  t = 0
  /** Live values for the visualization layer. */
  u = 0
  yMeas = 0.2
  qOut = 0
  overflow = false

  history: History = { t: [], sp: [], y: [], u: [], pTerm: [], iTerm: [], dTerm: [] }
  private acc = 0
  private sampleAcc = 0

  reset() {
    this.x = [0.2, 0]
    this.t = 0
    this.u = 0
    this.yMeas = 0.2
    this.qOut = 0
    this.overflow = false
    this.acc = 0
    this.sampleAcc = 0
    this.pid.reset()
    this.onoff.reset()
    this.noise.reset()
    for (const k of Object.keys(this.history) as (keyof History)[]) this.history[k].length = 0
  }

  /** Instantly add/remove volume (m³) — the click-to-disturb bucket dump. */
  dump(volume: number) {
    this.x[0] = Math.min(TANK.height, Math.max(0, this.x[0] + volume / TANK.area))
  }

  /** Advance the sim by dtReal wall-clock seconds at the given time scale. */
  tick(dtReal: number, p: SimParams) {
    if (!p.running) return
    this.pid.setGains(p.kp, p.ki, p.kd, p.wf)
    // Clamp huge frame gaps (tab was backgrounded) to avoid step explosions.
    this.acc += Math.min(dtReal, 0.25) * p.timeScale
    let steps = Math.floor(this.acc / DT)
    if (steps > MAX_STEPS_PER_TICK) {
      steps = MAX_STEPS_PER_TICK
      this.acc = 0 // drop unprocessable backlog rather than spiraling
    } else {
      this.acc -= steps * DT
    }
    const d: TankDisturbances = { valve: p.valve }
    for (let i = 0; i < steps; i++) this.step(p, d)
  }

  private step(p: SimParams, d: TankDisturbances) {
    // Sense (with optional gaussian noise), control, then actuate the plant
    // with the SATURATED command held over the step (zero-order hold).
    const yTrue = this.plant.output(this.x)
    this.yMeas = yTrue + (p.noiseSigma > 0 ? p.noiseSigma * this.noise.gauss() : 0)
    this.u =
      p.controller === 'onoff'
        ? this.onoff.update(p.setpoint, this.yMeas, p.band)
        : this.pid.update(p.setpoint, this.yMeas, DT)

    const u = this.u
    this.x = rk4((x) => this.plant.deriv(x, u, d), this.x, DT)

    // Physical limits: the tank floor and rim are hard constraints.
    this.overflow = this.x[0] > TANK.height
    this.x[0] = Math.min(TANK.height, Math.max(0, this.x[0]))
    this.x[1] = Math.max(0, this.x[1])
    this.qOut = this.plant.outflow(this.x[0], p.valve)
    this.t += DT

    this.sampleAcc += DT
    if (this.sampleAcc >= SAMPLE_DT - 1e-9) {
      this.sampleAcc = 0
      this.record(p)
    }
  }

  private record(p: SimParams) {
    const h = this.history
    h.t.push(this.t)
    h.sp.push(p.setpoint)
    h.y.push(this.yMeas)
    h.u.push(this.u)
    // P/I/D decomposition only exists in PID mode; record zeros for on/off.
    const pidMode = p.controller === 'pid'
    h.pTerm.push(pidMode ? this.pid.terms.p : 0)
    h.iTerm.push(pidMode ? this.pid.terms.i : 0)
    h.dTerm.push(pidMode ? this.pid.terms.d : 0)
    if (h.t.length > MAX_SAMPLES) {
      const drop = h.t.length - MAX_SAMPLES
      for (const k of Object.keys(h) as (keyof History)[]) h[k].splice(0, drop)
    }
  }
}
