import type { ScenarioDef } from '../types'
import { cruisePlant } from './plant'
import { CruiseScene } from './scene'
import { CruiseTheory } from './theory'

/**
 * Cruise-control scenario: longitudinal vehicle dynamics, first-order
 * aerodynamic plant (τ ≈ 71 s at 90 km/h, K ≈ 6.9 (km/h)/%).
 *
 * Key lessons:
 *  1. P-only leaves a speed error proportional to the load (grade/wind).
 *  2. I term eliminates e_ss at the cost of some phase margin.
 *  3. No brakes: u clamped at 0 — downhill overspeed cannot be corrected.
 *  4. Operating-point dependence: τ and K both scale with 1/v₀.
 */
export const cruiseScenario: ScenarioDef = {
  id: 'cruise',
  title: 'Cruise control',
  blurb: 'PID speed control of a 1500 kg car — aero drag, rolling resistance, grade disturbance',

  plant: cruisePlant,
  initialX: [85 / 3.6], // 85 km/h → m/s

  dt: 0.01,
  sampleDt: 0.1,
  windowS: 240,
  timeScales: [1, 2, 5, 10, 25],
  defaultTimeScale: 5,
  timeDisplay: { unit: 's', mul: 1 },

  freqDisplay: 'rad/s',
  wSweep: [1e-4, 1e2],

  y: {
    label: 'Speed v & setpoint r (km/h)',
    unit: 'km/h',
    min: 0,
    max: 160,
    fmt: (v) => `${v.toFixed(1)} km/h`,
  },
  setpoint: {
    key: 'setpoint',
    label: 'Setpoint r',
    unit: 'km/h',
    min: 30,
    max: 140,
    step: 1,
  },
  uLabel: 'Throttle u (%) — 0 = coast, no brakes',

  controllers: [
    {
      id: 'pid',
      params: [
        { key: 'kp', label: 'Kp  (proportional)', unit: '%(km/h)', min: 0, max: 10, step: 0.05 },
        { key: 'ki', label: 'Ki  (integral)', unit: '%/(km/h·s)', min: 0, max: 1, step: 0.005 },
        { key: 'kd', label: 'Kd  (derivative)', unit: '%·s/(km/h)', min: 0, max: 30, step: 0.5 },
        { key: 'wf', label: 'ωf  (D filter cutoff)', unit: 'rad/s', min: 0.5, max: 50, step: 0.5 },
      ],
      defaults: { kp: 1, ki: 0.025, kd: 0, wf: 10 },
    },
    {
      id: 'onoff',
      params: [
        {
          key: 'band',
          label: 'Speed band Δ',
          unit: 'km/h',
          min: 1,
          max: 20,
          step: 0.5,
        },
      ],
      defaults: { band: 5 },
    },
  ],
  defaultControllerId: 'pid',

  distSliders: [
    {
      key: 'grade',
      label: 'Road grade',
      unit: '%',
      min: -8,
      max: 8,
      step: 0.5,
    },
    {
      key: 'wind',
      label: 'Headwind (+ = into car)',
      unit: 'm/s',
      min: -15,
      max: 15,
      step: 0.5,
    },
  ],
  distDefaults: { grade: 0, wind: 0 },

  impulses: [
    {
      label: 'Brake tap (−10 km/h)',
      title: 'Apply a sharp brake tap: v drops 10 km/h instantaneously',
      apply: (x) => {
        const next = x.slice()
        next[0] = Math.max(0, next[0] - 10 / 3.6)
        return next
      },
    },
    {
      label: '+5 km/h',
      title: 'Velocity bump: v jumps 5 km/h (e.g. tailwind gust)',
      apply: (x) => {
        const next = x.slice()
        next[0] = next[0] + 5 / 3.6
        return next
      },
    },
  ],

  // Noise in km/h display units (σ slider max = 2 km/h)
  noise: { max: 2, step: 0.05, unit: 'km/h', mul: 1 },

  aux: {
    label: 'Resistive force (kN)',
    unit: 'kN',
    get: (x, _u, d) => cruisePlant.resistiveForce(x, { grade: d.grade ?? 0, wind: d.wind ?? 0 }) / 1000,
  },

  presets: [
    {
      name: 'P only — hill offset',
      desc: 'Set grade to 5% after loading. P-only cannot reach setpoint: e_ss = load / (1 + Kp·K). Watch the permanent error.',
      set: {
        controllerId: 'pid',
        ctl: { kp: 1, ki: 0, kd: 0, wf: 10 },
        timeScale: 5,
        setpoint: 90,
        dist: { grade: 5, wind: 0 },
      },
    },
    {
      name: 'PI — offset gone',
      desc: 'Same 5% grade but with Ki added. Integrator winds up and eliminates the steady-state speed error. Compare with P-only.',
      set: {
        controllerId: 'pid',
        ctl: { kp: 1, ki: 0.025, kd: 0, wf: 10 },
        timeScale: 5,
        setpoint: 90,
        dist: { grade: 5, wind: 0 },
      },
    },
    {
      name: 'Well-damped',
      desc: 'PI at a comfortable operating point. PM > 60°, no overshoot. Good baseline.',
      set: {
        controllerId: 'pid',
        ctl: { kp: 1, ki: 0.025, kd: 0, wf: 10 },
        timeScale: 5,
        setpoint: 85,
        dist: { grade: 0, wind: 0 },
      },
    },
    {
      name: 'Aggressive PI',
      desc: 'High Ki forces faster convergence but overshoots — PM shrinks, ringing visible.',
      set: {
        controllerId: 'pid',
        ctl: { kp: 2, ki: 0.15, kd: 0, wf: 10 },
        timeScale: 5,
        setpoint: 100,
        dist: { grade: 0, wind: 0 },
      },
    },
    {
      name: 'On/off speed limiter',
      desc: 'Relay with 5 km/h band — a crude speed limiter. Watch the throttle bang-bang and the speed oscillate around the setpoint.',
      set: {
        controllerId: 'onoff',
        ctl: { band: 5 },
        timeScale: 5,
        setpoint: 90,
        dist: { grade: 0, wind: 0 },
      },
    },
  ],

  diagram: {
    plantLabel: 'Car  G(s)',
    plantSub: 'm·v̇ = F−resist',
    dSummary: (d) =>
      `grade ${(d.grade ?? 0) > 0 ? '+' : ''}${(d.grade ?? 0).toFixed(0)}%, wind ${(d.wind ?? 0).toFixed(0)} m/s`,
  },

  Scene: CruiseScene,
  PlantTheory: CruiseTheory,
}
