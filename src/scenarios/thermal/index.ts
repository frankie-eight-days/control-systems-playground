import type { ScenarioDef } from '../types'
import { ThermalDiagram } from './diagram'
import { THERMAL, thermalPlant } from './plant'
import { ThermalScene } from './scene'
import { ThermalTheory } from './theory'

/**
 * Espresso-boiler FOPDT scenario — the dead-time lesson.
 *
 * Key physics: FOPDT G(s) = K·e^{−θs}/(τs+1), K=3 °C/%, τ=160 s, θ=3 s.
 * Dead time is realised via 2nd-order Padé on the input (3 ODE states total).
 *
 * ZN tuning (nominal, lossMult=1):
 *   P:   Kp = τ/(K·θ) = 160/(3·3) ≈ 17.8
 *   PI:  Kp = 0.9·τ/(K·θ) ≈ 16.0, Ki = Kp/(Ti) with Ti=θ/0.3=10 → Ki≈1.60
 *   PID: Kp = 1.2·τ/(K·θ) ≈ 21.3, Ti=2θ=6 → Ki≈3.56, Td=θ/2=1.5 → Kd≈31.9
 */
export const thermalScenario: ScenarioDef = {
  id: 'thermal',
  title: 'Boiler (dead time)',
  blurb: 'FOPDT espresso boiler — why dead time limits every controller',

  plant: thermalPlant,
  // Initial state: [T (°C), p1 (Padé state 1), p2 (Padé state 2)]
  // Start at ambient with heater off.
  initialX: [22, 0, 0],

  dt: 0.01,       // 10 ms physics timestep
  sampleDt: 0.5,  // chart sample every 0.5 s sim-time
  windowS: 1200,  // 20 min strip-chart window
  timeScales: [1, 5, 10, 50, 100, 500],
  defaultTimeScale: 50,
  timeDisplay: { unit: 's', mul: 1 },

  freqDisplay: 'rad/s',
  wSweep: [1e-5, 1e2],

  y: {
    label: 'Temperature T & setpoint r (°C)',
    unit: '°C',
    min: 15,
    max: 160,
    fmt: (v) => `${v.toFixed(1)} °C`,
  },
  setpoint: {
    key: 'setpoint',
    label: 'Setpoint r',
    unit: '°C',
    min: 30,
    max: 150,
    step: 1,
  },
  uLabel: 'Heater command u (%) — 0 = off, 100 = full ' + THERMAL.Pmax + 'W',

  controllers: [
    {
      id: 'pid',
      params: [
        { key: 'kp', label: 'Kp  (proportional)', unit: '%/°C', min: 0, max: 60, step: 0.2 },
        { key: 'ki', label: 'Ki  (integral)', unit: '%/(°C·s)', min: 0, max: 8, step: 0.05 },
        { key: 'kd', label: 'Kd  (derivative)', unit: '%·s/°C', min: 0, max: 150, step: 1 },
        { key: 'wf', label: 'ωf  (D filter cutoff)', unit: 'rad/s', min: 0.1, max: 20, step: 0.1 },
      ],
      // Start with modest gains — user should tune from here
      defaults: { kp: 10, ki: 0.5, kd: 0, wf: 2 },
    },
    {
      id: 'onoff',
      params: [
        { key: 'band', label: 'Hysteresis band Δ', unit: '°C', min: 1, max: 20, step: 0.5 },
      ],
      defaults: { band: 4 },
    },
  ],
  defaultControllerId: 'pid',

  distSliders: [
    {
      key: 'tamb',
      label: 'Ambient temp T_amb',
      unit: '°C',
      min: 5,
      max: 35,
      step: 1,
    },
    {
      key: 'lossMult',
      label: 'Loss multiplier (lid open)',
      unit: '×k',
      min: 1,
      max: 3,
      step: 0.05,
      fmt: (v) => v.toFixed(2),
    },
  ],
  distDefaults: { tamb: 22, lossMult: 1 },

  impulses: [
    {
      label: 'Cold water −15°C',
      title: 'Add cold water (drops T by 15 °C)',
      apply: (x) => {
        const next = x.slice()
        next[0] = Math.max(0, next[0] - 15)
        return next
      },
    },
    {
      label: 'Steam draw −5°C',
      title: 'Steam draw from group head (drops T by 5 °C)',
      apply: (x) => {
        const next = x.slice()
        next[0] = Math.max(0, next[0] - 5)
        return next
      },
    },
  ],

  noise: { max: 2, step: 0.05, unit: '°C', mul: 1 },

  // Aux channel: commanded heater power (W) — shows the undistorted command
  // before dead time (the delayed power is not directly observable from state
  // without recomputing, so we show the commanded side for simplicity).
  aux: {
    label: 'Heater power commanded (W)',
    unit: 'W',
    get: (_x, u, _d) => (u / 100) * THERMAL.Pmax,
  },

  presets: [
    {
      name: 'Untuned (sluggish)',
      desc: 'Low Kp, no integral — watch the offset and the 160 s time constant',
      set: {
        controllerId: 'pid',
        ctl: { kp: 5, ki: 0, kd: 0, wf: 2 },
        timeScale: 100,
        setpoint: 90,
      },
    },
    {
      name: 'ZN — P only',
      desc: 'Classic 1942 recipe from K, τ, θ: Kp=τ/(Kθ)≈17.8. Steady-state offset visible.',
      set: {
        controllerId: 'pid',
        ctl: { kp: 17.8, ki: 0, kd: 0, wf: 2 },
        timeScale: 50,
        setpoint: 90,
      },
    },
    {
      name: 'ZN — PI',
      desc: 'Classic 1942 recipe: Kp≈16.0, Ki≈1.60 (Ti=10 s). ~25% overshoot expected.',
      set: {
        controllerId: 'pid',
        ctl: { kp: 16.0, ki: 1.6, kd: 0, wf: 2 },
        timeScale: 50,
        setpoint: 90,
      },
    },
    {
      name: 'ZN — PID',
      desc: 'Classic 1942 recipe: Kp≈21.3, Ki≈3.56, Kd≈31.9. Derivative tames dead-time ringing.',
      set: {
        controllerId: 'pid',
        ctl: { kp: 21.3, ki: 3.56, kd: 31.9, wf: 2 },
        timeScale: 50,
        setpoint: 90,
      },
    },
    {
      name: 'Relay (thermostat)',
      desc: 'On/off control, band=4°C. Dead time causes overshoot on every cycle — see theory.',
      set: {
        controllerId: 'onoff',
        ctl: { band: 4 },
        timeScale: 50,
        setpoint: 90,
      },
    },
  ],

  diagram: {
    plantLabel: 'Boiler  G(s)',
    plantSub: 'FOPDT + Padé',
    dSummary: (d) =>
      `T_amb=${(d.tamb ?? 22).toFixed(0)}°C, loss×${(d.lossMult ?? 1).toFixed(1)}`,
  },

  Scene: ThermalScene,
  PlantTheory: ThermalTheory,
  DiagramView: ThermalDiagram,
}
