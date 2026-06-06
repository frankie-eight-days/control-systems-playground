import type { ScenarioDef } from '../types'
import { TANK, tankPlant } from './plant'
import { dumpVolume, TankScene } from './scene'
import { TankTheory } from './theory'

/**
 * Scenario #1 and the reference implementation of the ScenarioDef contract.
 * The marginal preset gain is exact theory: ∠L = −180° at ω = 1/√(τ₁τ₂) ≈
 * 0.128 rad/s, and pure-I control reaches |L| = 1 there at Ki ≈ 16.8.
 */
export const tankScenario: ScenarioDef = {
  id: 'tank',
  title: 'Water tank',
  blurb: 'PID level control of a gravity-drained tank',

  plant: tankPlant,
  initialX: [0.2, 0],

  dt: 0.005,
  sampleDt: 0.1,
  windowS: 240,
  timeScales: [1, 2, 5, 10, 25, 50, 100],
  defaultTimeScale: 10,
  timeDisplay: { unit: 's', mul: 1 },

  freqDisplay: 'rad/s',
  wSweep: [1e-4, 1e3],

  y: {
    label: 'Level h & setpoint r (m)',
    unit: 'm',
    min: 0,
    max: TANK.height * 1.04,
    fmt: (v) => `${v.toFixed(3)} m`,
  },
  setpoint: { key: 'setpoint', label: 'Setpoint r', unit: 'm', min: 0.1, max: 1.9, step: 0.01 },
  uLabel: 'Pump command u (%) — saturates at 0 / 100',

  controllers: [
    {
      id: 'pid',
      params: [
        { key: 'kp', label: 'Kp  (proportional)', unit: '%/m', min: 0, max: 300, step: 1 },
        { key: 'ki', label: 'Ki  (integral)', unit: '%/(m·s)', min: 0, max: 20, step: 0.1 },
        { key: 'kd', label: 'Kd  (derivative)', unit: '%·s/m', min: 0, max: 300, step: 1 },
        { key: 'wf', label: 'ωf  (D filter cutoff)', unit: 'rad/s', min: 0.5, max: 50, step: 0.5 },
      ],
      defaults: { kp: 60, ki: 1.5, kd: 0, wf: 10 },
    },
    {
      id: 'onoff',
      params: [
        { key: 'band', label: 'Hysteresis band Δ', unit: 'm', min: 0.01, max: 0.5, step: 0.01 },
      ],
      defaults: { band: 0.1 },
    },
  ],
  defaultControllerId: 'pid',

  distSliders: [
    {
      key: 'valve',
      label: 'Drain valve opening',
      unit: '%',
      min: 0,
      max: 1,
      step: 0.01,
      fmt: (v) => (v * 100).toFixed(0),
    },
  ],
  distDefaults: { valve: 0.5 },
  impulses: [
    { label: '+50 L', title: 'Dump 50 L in', apply: dumpVolume(0.05) },
    { label: '−50 L', title: 'Scoop 50 L out', apply: dumpVolume(-0.05) },
  ],
  noise: { max: 0.02, step: 0.0005, unit: 'mm', mul: 1000 },

  aux: {
    label: 'Outflow q_out (L/s)',
    unit: 'L/s',
    get: (x, _u, d) => tankPlant.outflow(x[0], d.valve ?? 0.5) * 1000,
  },

  presets: [
    {
      name: 'Well-damped',
      desc: 'PI, PM ≈ 75° — clean approach, no overshoot to speak of',
      set: { controllerId: 'pid', ctl: { kp: 60, ki: 1.5, kd: 0, wf: 10 }, timeScale: 10 },
    },
    {
      name: 'Underdamped',
      desc: 'Too much Ki, PM ≈ 35° — overshoot and ringing',
      set: { controllerId: 'pid', ctl: { kp: 60, ki: 10, kd: 0, wf: 10 }, timeScale: 25 },
    },
    {
      name: 'Marginal',
      desc: 'Pure I at the critical gain, PM ≈ 0° — oscillates forever',
      set: { controllerId: 'pid', ctl: { kp: 0, ki: 16.8, kd: 0, wf: 10 }, timeScale: 50 },
    },
    {
      name: 'Unstable',
      desc: 'PM < 0 — grows until the pump saturates into a limit cycle',
      set: { controllerId: 'pid', ctl: { kp: 0, ki: 20, kd: 0, wf: 10 }, timeScale: 50 },
    },
  ],

  diagram: {
    plantLabel: 'Tank  G(s)',
    plantSub: 'ẋ = f(x,u,d)',
    dSummary: (d) => `d: valve ${((d.valve ?? 0.5) * 100).toFixed(0)}%, dumps`,
  },

  Scene: TankScene,
  PlantTheory: TankTheory,
}
