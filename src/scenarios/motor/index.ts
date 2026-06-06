import type { ScenarioDef } from '../types'
import { motorPlant } from './plant'
import { MotorScene, whackOmega } from './scene'
import { MotorTheory } from './theory'

/**
 * DC motor position servo — the near-double-integrator lesson.
 *
 * G(s) = Kv / (s(s + b/J))   with  Kv ≈ 57.3 (°/s²)/%,  b/J = 0.2 rad/s.
 *
 * P-only at Kp = 1:  ωn = √(Kv) ≈ 7.6 rad/s,  ζ = (b/J)/(2ωn) ≈ 0.013.
 * The servo rings for minutes — D control is the only way to add damping.
 *
 * Actuator: unipolar 0–100% → τ_m = ((u−50)/50)·τmax
 * u = 50% → zero torque (equilibrium with no load).
 */
export const motorScenario: ScenarioDef = {
  id: 'motor',
  title: 'DC motor position servo',
  blurb: 'PID angle control of a near-double-integrator — why D kills ringing',

  plant: motorPlant,
  // Start at 0° with zero velocity — u₀ = 50% (zero torque) at equilibrium
  initialX: [0, 0],

  dt: 0.0005,          // 0.5 ms — fast plant needs small step
  sampleDt: 0.005,     // 5 ms sample interval for strip charts
  windowS: 20,         // 20 s visible history
  timeScales: [0.25, 0.5, 1, 2, 5],
  defaultTimeScale: 1,
  timeDisplay: { unit: 's', mul: 1 },

  freqDisplay: 'rad/s',
  wSweep: [1e-1, 1e4],

  y: {
    label: 'Angle θ & setpoint r (°)',
    unit: '°',
    min: -190,
    max: 190,
    fmt: (v) => `${v.toFixed(1)}°`,
  },
  setpoint: { key: 'setpoint', label: 'Setpoint r', unit: '°', min: -170, max: 170, step: 1 },
  uLabel: 'Motor command u (%) — 50% = zero torque',

  controllers: [
    {
      id: 'pid',
      params: [
        { key: 'kp', label: 'Kp  (proportional)', unit: '%/°',   min: 0,  max: 20,   step: 0.05 },
        { key: 'ki', label: 'Ki  (integral)',      unit: '%/(°·s)', min: 0, max: 20, step: 0.1 },
        { key: 'kd', label: 'Kd  (derivative)',   unit: '%·s/°', min: 0,  max: 1,    step: 0.005 },
        {
          key: 'wf',
          label: 'ωf  (D filter cutoff)',
          unit: 'rad/s',
          min: 10,
          max: 2000,
          step: 10,
        },
      ],
      // P only at Kp=1 → ζ≈0.013, rings visibly
      defaults: { kp: 1, ki: 0, kd: 0, wf: 200 },
    },
    {
      id: 'onoff',
      params: [
        { key: 'band', label: 'Hysteresis band Δ', unit: '°', min: 2, max: 40, step: 1 },
      ],
      defaults: { band: 10 },
    },
  ],
  defaultControllerId: 'pid',

  distSliders: [
    {
      key: 'load',
      label: 'Load torque τ_load',
      unit: 'N·m',
      min: -0.2,
      max: 0.2,
      step: 0.005,
      fmt: (v) => `${v.toFixed(3)}`,
    },
  ],
  distDefaults: { load: 0 },

  impulses: [
    { label: 'Whack +5 rad/s', title: 'Apply +5 rad/s velocity impulse', apply: whackOmega(5) },
    { label: 'Whack −5 rad/s', title: 'Apply −5 rad/s velocity impulse', apply: whackOmega(-5) },
  ],

  // Noise in degrees; σ slider up to 2°
  noise: { max: 2, step: 0.05, unit: '°', mul: 1 },

  aux: {
    label: 'Velocity ω (°/s)',
    unit: '°/s',
    // x[1] is ω in rad/s; convert to °/s for display
    get: (x) => x[1] * (180 / Math.PI),
  },

  presets: [
    {
      name: 'P only — rings (ζ≈0.01)',
      desc: 'Kp=1, no D: ωn≈7.6 rad/s, ζ≈0.013. Watch the sustained ringing in the position chart. This is the near-double-integrator problem — P adds gain but zero phase lead.',
      set: { controllerId: 'pid', ctl: { kp: 1, ki: 0, kd: 0, wf: 200 }, timeScale: 1, setpoint: 90 },
    },
    {
      name: 'PD — damped (ζ≈0.7)',
      desc: 'Kp=1, Kd=0.2: ζ≈0.75. The derivative term acts as viscous friction, absorbing kinetic energy. Compare ring period with P-only — or the absence of it.',
      set: {
        controllerId: 'pid',
        ctl: { kp: 1, ki: 0, kd: 0.2, wf: 200 },
        timeScale: 1,
        setpoint: 90,
      },
    },
    {
      name: 'PID — load rejection',
      desc: 'Kp=1, Kd=0.2, Ki=0.5: now set the load torque to ±0.1 N·m and watch I eliminate the steady-state droop. Without Ki the servo would never reach the setpoint under constant load.',
      set: {
        controllerId: 'pid',
        ctl: { kp: 1, ki: 0.5, kd: 0.2, wf: 200 },
        timeScale: 1,
        setpoint: 90,
        dist: { load: 0.1 },
      },
    },
    {
      name: 'Filtered to death',
      desc: 'Good PD gains but ωf=20 rad/s: the derivative filter is so slow that it introduces a lag near the ring frequency, re-introducing ringing and eating all the D-term phase lead.',
      set: {
        controllerId: 'pid',
        ctl: { kp: 1, ki: 0, kd: 0.2, wf: 20 },
        timeScale: 1,
        setpoint: 90,
      },
    },
  ],

  diagram: {
    plantLabel: 'Motor  G(s)',
    plantSub: 'Kv/(s(s+b/J))',
    dSummary: (d) =>
      `τ_load = ${((d.load ?? 0)).toFixed(3)} N·m`,
  },

  Scene: MotorScene,
  PlantTheory: MotorTheory,
}
