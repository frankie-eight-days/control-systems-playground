import { registerController } from '../../controllers/registry'
import type { ScenarioDef } from '../types'
import { maglevPidDef } from './controllers'
import { MAGLEV, maglevPlant } from './plant'
import { MaglevScene, tapDown, tapUp } from './scene'
import { MaglevTheory } from './theory'

// Maglev-local controller, registered at module load (cycle-proof registry —
// same pattern as the jet/buck local defs).
registerController(maglevPidDef)

/**
 * Magnetic levitation — the EE-flavoured unstable classic and the FASTEST
 * plant in the app. Hand-verified anchors (confirm on the theory panel's live
 * eigenvalue readout, which tracks the SETPOINT): the RHP pole is λ = +√(2g/z₀),
 * depending only on g and the gap, so at z₀ = 15 mm λ = +36.2 rad/s
 * (time-to-double ≈ 19 ms); 10 mm → +44.3 (15.6 ms); 25 mm → +28.0 (24.7 ms).
 * The coil adds a pole at −1/τ = −50 rad/s. Equilibrium current i₀ = 0.8·(z/15mm)
 * A (0.8 A at the 15 mm design point). PD/lead stabilizes; P or PI alone cannot.
 */
export const maglevScenario: ScenarioDef = {
  id: 'maglev',
  title: 'Magnetic levitation',
  blurb: 'Lead/PD stabilization of a steel ball under an electromagnet — the app’s fastest unstable plant',

  plant: maglevPlant,
  initialX: [MAGLEV.z0, 0, MAGLEV.i0], // levitating at 15 mm, 0.8 A

  dt: 1e-4,
  sampleDt: 5e-4,
  windowS: 2,
  // Slow-motion is first-class: t₂ is 19 ms, so 1× is a blur. 0.1× default.
  timeScales: [0.02, 0.05, 0.1, 0.25, 1],
  defaultTimeScale: 0.1,
  timeDisplay: { unit: 'ms', mul: 1000 },

  freqDisplay: 'rad/s',
  wSweep: [1, 1e4],

  y: {
    label: 'Air gap z & setpoint z* (mm)',
    unit: 'mm',
    min: MAGLEV.zStuck * 1000,
    max: MAGLEV.zDrop * 1000,
    fmt: (v) => `${v.toFixed(2)} mm`,
  },
  // Range 6–24 mm: the midpoint (15 mm) is the design point, so the store's
  // auto-default setpoint lands exactly on it (where the 40% bias holds the ball
  // with pure PD, no droop — the clean first-load experience). 24 mm still spans
  // a 2× pole range (λ 57→29 rad/s) for the drag-the-setpoint lesson.
  setpoint: { key: 'setpoint', label: 'Setpoint z*', unit: 'mm', min: 6, max: 24, step: 0.5 },
  uLabel: 'Coil command u (%) — UNIPOLAR (0 = let go, 100 = max pull)',

  controllers: [
    {
      id: 'maglev-pid',
      params: [
        // e is in mm, u in %. Gap PD around the 40% bias. ωf must be high
        // (the plant doubles in ~19 ms); D is load-bearing.
        { key: 'kp', label: 'Kp  (proportional)', unit: '%/mm', min: 0, max: 20, step: 0.5 },
        { key: 'ki', label: 'Ki  (integral)', unit: '%/(mm·s)', min: 0, max: 150, step: 5 },
        { key: 'kd', label: 'Kd  (derivative)', unit: '%·s/mm', min: 0, max: 0.8, step: 0.01 },
        {
          key: 'wf',
          label: 'ωf  (D filter cutoff)',
          unit: 'rad/s',
          min: 50,
          max: 1500,
          step: 10,
        },
      ],
      // Verified: holds 15 mm, recovers a tap; P or PI alone (Kd=0) fails.
      defaults: { kp: 6, ki: 0, kd: 0.25, wf: 400 },
    },
  ],
  defaultControllerId: 'maglev-pid',

  distSliders: [
    {
      key: 'mass',
      label: 'Ball mass (swap)',
      unit: '×',
      min: 0.6,
      max: 1.6,
      step: 0.05,
      fmt: (v) => `${(v * MAGLEV.m * 1000).toFixed(0)} g`,
    },
    {
      key: 'vSupply',
      label: 'Coil supply',
      unit: '%',
      min: 0.7,
      max: 1.1,
      step: 0.02,
      fmt: (v) => `${(v * 100).toFixed(0)}`,
    },
  ],
  distDefaults: { mass: 1, vSupply: 1 },
  impulses: [
    { label: 'Tap ball down (+0.3 m/s)', title: 'Nudge the ball downward', apply: tapDown },
    { label: 'Tap up (−0.3 m/s)', title: 'Nudge the ball upward', apply: tapUp },
  ],
  noise: { max: 0.3, step: 0.01, unit: 'mm', mul: 1 },

  aux: {
    label: 'Coil current i (A)',
    unit: 'A',
    get: (x) => x[2],
  },

  presets: [
    {
      name: 'Lead/PD — levitates',
      desc: 'Kp 6, Kd 0.25, no I, ωf 400. The derivative supplies the phase lead that tames the +36 rad/s RHP pole: the ball holds 15 mm and shrugs off a tap. This is the whole game — fast D on a fast unstable plant.',
      set: {
        controllerId: 'maglev-pid',
        ctl: { kp: 6, ki: 0, kd: 0.25, wf: 400 },
        dist: { mass: 1, vSupply: 1 },
        setpoint: 15,
        timeScale: 0.1,
      },
    },
    {
      name: 'Tuned at 15 mm, commanded to 24 mm (intentional!)',
      desc: 'Same PD, but drag (or jump) the setpoint to 24 mm. The 40% bias and 15 mm-tuned gains can’t supply the 1.28 A that wider gap needs, and the unstable pole has moved (slower, but the bias is now badly wrong) — the ball DROPS. The unstable version of the tank’s √h lesson: gains tuned at one operating point don’t hold at another. Add integral (Ki) to find the new current, or retune.',
      set: {
        controllerId: 'maglev-pid',
        ctl: { kp: 6, ki: 0, kd: 0.25, wf: 400 },
        dist: { mass: 1, vSupply: 1 },
        setpoint: 24,
        timeScale: 0.05,
      },
    },
    {
      name: 'P only — slams or drops',
      desc: 'Kd = 0. Proportional gain on an inverse-square pull has no phase lead: the unstable mode rings up and the ball slams into the magnet or falls. Hit Tap down to break the knife-edge. Proof that D — not P, not I — is what stabilizes an RHP pole.',
      set: {
        controllerId: 'maglev-pid',
        ctl: { kp: 6, ki: 0, kd: 0, wf: 400 },
        dist: { mass: 1, vSupply: 1 },
        setpoint: 15,
        timeScale: 0.05,
      },
    },
    {
      name: 'Heavy ball ambush (PID)',
      desc: 'Swap to a 70 g ball (mass 1.4×) with PID (Ki 60). A bare PD would droop — the heavier ball needs more current than the 40% bias gives. Watch the integral wind the coil up to ≈0.95 A and pull the gap back to 15 mm. The maglev’s version of the motor/tank load-rejection lesson.',
      set: {
        controllerId: 'maglev-pid',
        ctl: { kp: 8, ki: 60, kd: 0.3, wf: 400 },
        dist: { mass: 1.4, vSupply: 1 },
        setpoint: 15,
        timeScale: 0.1,
      },
    },
  ],

  diagram: {
    plantLabel: 'Maglev  G(s)',
    plantSub: 'inverse-square, 3-state',
    dSummary: (d) =>
      `mass ${((d.mass ?? 1) * MAGLEV.m * 1000).toFixed(0)} g, supply ${((d.vSupply ?? 1) * 100).toFixed(0)}%`,
  },

  Scene: MaglevScene,
  PlantTheory: MaglevTheory,
}
