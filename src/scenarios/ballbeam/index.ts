import type { ScenarioDef } from '../types'
import { BB, ballbeamPlant } from './plant'
import { BallBeamScene, pokeBall } from './scene'
import { BallBeamTheory } from './theory'

/**
 * Ball & beam scenario — the double-integrator lesson.
 *
 * A solid sphere rolls on a beam tilted by a servo.
 *
 *   G(s) = K / (s^2 * (tau*s + 1))   with   K ~= 18.38 (cm/s^2)/%,  tau = 0.1 s
 *
 * K = (5/7) * g * (thetaMax / 50) * 100
 *   = (5/7) * 9.81 * (15*pi/180 / 50) * 100
 *   ~= 18.38 (cm/s^2)/%
 *
 * P-only Kp=1:  wn = sqrt(Kp * K_rad) = sqrt(1 * 0.1838) ~= 0.429 rad/s
 *               => period ~= 14.6 s   (visible sustained oscillation)
 *
 * Routh stability condition for PD:  Kd > tau * Kp = 0.1 * Kp
 * At Kp=1, Kd=0.3: stable. At Kp=3, Kd=0.5: wn~0.74 rad/s.
 *
 * Actuator: unipolar 0-100% => theta_cmd = ((u-50)/50)*thetaMax  (same as motor).
 * Failure: |p| > 0.35 m. Scene shows "BALL OFF" overlay. Reset recovers.
 */

// K_rad: (m/s^2)/% -- used in preset desc comments
// K = (5/7)*9.81*(15*pi/180/50) ~= 0.1838 (m/s^2)/%
// Routh s^1 row for P-only: -tau*Kp*K < 0 always => always unstable

export const ballbeamScenario: ScenarioDef = {
  id: 'ballbeam',
  title: 'Ball & beam',
  blurb: 'PID position control of a double integrator -- why P-only can never damp',

  plant: ballbeamPlant,
  // Ball starts at centre (p=0), stationary, beam horizontal
  initialX: [0, 0, 0],

  dt: 0.001,             // 1 ms -- servo tau=0.1s is slow, this is plenty
  sampleDt: 0.02,        // 20 ms sample interval (50 Hz)
  windowS: 60,           // 60 s visible history -- ring period ~14 s at Kp=1
  timeScales: [0.1, 0.25, 0.5, 1, 2],
  defaultTimeScale: 0.5,
  timeDisplay: { unit: 's', mul: 1 },

  freqDisplay: 'rad/s',
  // Sweep from 0.01 rad/s (well below ring freq ~0.4 rad/s) to 100 rad/s
  wSweep: [1e-2, 1e2],

  y: {
    label: 'Ball position p & setpoint r (cm)',
    unit: 'cm',
    min: -40,            // slightly beyond beamHalf*100 = 35 cm so failure is visible
    max: 40,
    fmt: (v) => `${v.toFixed(1)} cm`,
  },
  setpoint: {
    key: 'setpoint',
    label: 'Setpoint r',
    unit: 'cm',
    min: -25,
    max: 25,
    step: 0.5,
  },
  uLabel: 'Servo command u (%) -- 50% = horizontal',

  controllers: [
    {
      id: 'pid',
      params: [
        {
          key: 'kp',
          label: 'Kp  (proportional)',
          unit: '%/cm',
          min: 0,
          max: 10,
          step: 0.05,
        },
        {
          key: 'ki',
          label: 'Ki  (integral)',
          unit: '%/(cm*s)',
          min: 0,
          max: 2,
          step: 0.01,
        },
        {
          key: 'kd',
          label: 'Kd  (derivative)',
          unit: '%*s/cm',
          min: 0,
          max: 5,
          step: 0.01,
        },
        {
          key: 'wf',
          label: 'wf  (D filter cutoff)',
          unit: 'rad/s',
          min: 1,
          max: 100,
          step: 1,
        },
      ],
      // P only at Kp=1 => wn~0.43 rad/s, period~14.6 s, visibly oscillates
      defaults: { kp: 1, ki: 0, kd: 0, wf: 20 },
    },
  ],
  defaultControllerId: 'pid',

  distSliders: [
    {
      key: 'tilt',
      label: 'Beam tilt bias',
      unit: 'deg',
      min: -5,
      max: 5,
      step: 0.1,
      fmt: (v) => `${v.toFixed(1)}`,
    },
  ],
  distDefaults: { tilt: 0 },

  impulses: [
    { label: 'Poke +0.3 m/s', title: 'Apply +0.3 m/s velocity impulse to ball', apply: pokeBall(0.3) },
    { label: 'Poke -0.3 m/s', title: 'Apply -0.3 m/s velocity impulse to ball', apply: pokeBall(-0.3) },
    { label: 'Poke +1 m/s',   title: 'Apply +1 m/s velocity impulse (may fall off)', apply: pokeBall(1.0) },
  ],

  noise: { max: 0.5, step: 0.01, unit: 'cm', mul: 1 },

  // Aux: ball velocity in cm/s (helps read ring dynamics)
  aux: {
    label: 'Ball velocity v (cm/s)',
    unit: 'cm/s',
    get: (x) => x[1] * BB.m2cm,
  },

  presets: [
    {
      name: 'P only -- always unstable',
      desc: 'Kp=1, no D: Routh row s^1 = -tau*Kp*K < 0 for any Kp>0. P-alone gives two RHP poles -- the ball diverges and falls off every time. Watch the ball drift to the edge. D is the ONLY path to stability.',
      set: { controllerId: 'pid', ctl: { kp: 1, ki: 0, kd: 0, wf: 20 }, timeScale: 0.5, setpoint: 10 },
    },
    {
      name: 'PD -- damped (Routh stable)',
      desc: 'Kp=1, Kd=0.5: Kd > tau*Kp = 0.1 so Routh stable. Higher Kd tames the transient overshoot so the ball stays on the beam. Compare settle time vs the P-only divergence.',
      set: { controllerId: 'pid', ctl: { kp: 1, ki: 0, kd: 0.5, wf: 20 }, timeScale: 0.5, setpoint: 5 },
    },
    {
      name: 'PID -- tilt bias rejection',
      desc: 'Set tilt bias to 2 deg: P-only drifts to the edge. Add Ki=0.3 and watch integral wind up to counteract the constant gravity component from the tilted beam.',
      set: { controllerId: 'pid', ctl: { kp: 1, ki: 0.3, kd: 0.3, wf: 20 }, timeScale: 0.5, setpoint: 0, dist: { tilt: 2 } },
    },
    {
      name: 'Aggressive -- ball off beam!',
      desc: 'Kp=5, Kd=0.2: Kd < tau*Kp = 0.5, so Routh unstable. The ball diverges and falls off. Hit Reset to recover. This is what insufficient derivative looks like on a double integrator.',
      set: { controllerId: 'pid', ctl: { kp: 5, ki: 0, kd: 0.2, wf: 20 }, timeScale: 0.5, setpoint: 10 },
    },
  ],

  diagram: {
    plantLabel: 'Ball & beam  G(s)',
    plantSub: `K/(s^2(${BB.tauServo}s+1))`,
    dSummary: (d) => `tilt = ${(d.tilt ?? 0).toFixed(1)} deg`,
  },

  Scene: BallBeamScene,
  PlantTheory: BallBeamTheory,
}
