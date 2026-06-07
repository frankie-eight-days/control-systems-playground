import { registerController } from '../../controllers/registry'
import type { ScenarioDef } from '../types'
import { fuzzyDef, jetPidDef } from './controllers'
import { JetDiagram } from './diagram'
import { jetPlant, MaOfCg } from './plant'
import { gustHit, JetScene, noseWhack } from './scene'
import { JetTheory } from './theory'

// Jet-local controllers, registered at module load so their ids resolve
// before first render. Direct calls are safe — the registry is cycle-proof
// (lazy `var` map; see controllers/registry.ts), exactly like buck Type II/III.
registerController(fuzzyDef)
registerController(jetPidDef)

const rad2deg = 180 / Math.PI

/**
 * Relaxed-static-stability fighter — the app's FIRST open-loop-unstable plant
 * and its FIRST fuzzy controller. Hand-verified anchors (confirm on the theory
 * panel): at the default cg = 0.75, Mα_eff = +8 ⇒ short-period eigenvalues
 * +1.73 / −3.93 rad/s (time-to-double 0.40 s); the θ integrator sits at 0 and
 * the actuator at −20 rad/s. The real pole crosses into the RHP at cg = 0.325
 * (det = 0); the classic static neutral point (Mα = 0) is at cg = 0.25.
 *
 * Default fuzzy (ke .06, kde .08, ku .6) holds trim against the RHP pole and
 * recovers the +5° gust; pure PI cannot stabilize at any gain (it has no phase
 * lead) — both verified in simulation and stated in the presets.
 */
export const jetScenario: ScenarioDef = {
  id: 'jet',
  title: 'Fighter pitch (fuzzy)',
  blurb:
    'Mamdani fuzzy stabilization of a relaxed-static-stability fighter — the first open-loop-unstable plant',

  plant: jetPlant,
  initialX: [0, 0, 0, 0], // trimmed level flight (α=q=θ=δ=0, u=50%)

  dt: 1e-3,
  sampleDt: 0.02,
  windowS: 30,
  timeScales: [0.25, 0.5, 1, 2, 5],
  defaultTimeScale: 1,
  timeDisplay: { unit: 's', mul: 1 },

  freqDisplay: 'rad/s', // aero convention
  wSweep: [1e-2, 1e3],

  y: {
    label: 'Pitch attitude θ & setpoint r (°)',
    unit: '°',
    min: -30,
    max: 30,
    fmt: (v) => `${v.toFixed(1)}°`,
  },
  setpoint: { key: 'setpoint', label: 'Setpoint θ', unit: '°', min: -20, max: 20, step: 0.5 },
  uLabel: 'Elevator command u (%) — 50% = faired (trim), <50 nose-up / >50 nose-down',

  controllers: [
    {
      id: 'fuzzy-pitch',
      params: [
        // Error e is in degrees, ė in °/s — gains sized so a ~15° error and a
        // ~15°/s rate reach the saturated ends of the normalized universe.
        { key: 'ke', label: 'ke  (error gain)', unit: '1/°', min: 0.0, max: 0.3, step: 0.005 },
        { key: 'kde', label: 'kde  (rate gain)', unit: 's/°', min: 0.0, max: 0.4, step: 0.005 },
        { key: 'ku', label: 'ku  (output gain)', unit: '', min: 0.0, max: 2.5, step: 0.05 },
        { key: 'wf', label: 'ωf  (ė filter cutoff)', unit: 'rad/s', min: 2, max: 40, step: 1 },
      ],
      // Verified: holds trim against the RHP pole + recovers the +5° gust.
      defaults: { ke: 0.06, kde: 0.08, ku: 0.6, wf: 10 },
    },
    {
      id: 'jet-pid',
      params: [
        { key: 'kp', label: 'Kp  (proportional)', unit: '%/°', min: 0, max: 12, step: 0.1 },
        { key: 'ki', label: 'Ki  (integral)', unit: '%/(°·s)', min: 0, max: 8, step: 0.1 },
        { key: 'kd', label: 'Kd  (derivative)', unit: '%·s/°', min: 0, max: 6, step: 0.1 },
        { key: 'wf', label: 'ωf  (D filter cutoff)', unit: 'rad/s', min: 5, max: 60, step: 1 },
      ],
      // Verified: PD-heavy stabilizes; the same gains with kd=0 (pure PI) diverge.
      defaults: { kp: 4, ki: 0, kd: 2, wf: 20 },
    },
  ],
  defaultControllerId: 'fuzzy-pitch',

  distSliders: [
    {
      key: 'cg',
      label: 'CG position (fwd→aft)',
      unit: '',
      min: 0,
      max: 1,
      step: 0.01,
      // show the implied Mα_eff so the lesson is legible while dragging
      fmt: (v) => `${v.toFixed(2)} (Mα=${MaOfCg(v).toFixed(1)})`,
    },
    {
      key: 'gust',
      label: 'Steady vertical gust (α bias)',
      unit: '°',
      // ±12°: a strong updraft can park the wing near the 15° stall, which the
      // Departure preset exploits. Small biases (±5°) are gentle trim upsets.
      min: -12,
      max: 12,
      step: 0.5,
      fmt: (v) => `${v.toFixed(1)}`,
    },
  ],
  distDefaults: { cg: 0.75, gust: 0 },
  impulses: [
    { label: 'Gust hit (+5° α)', title: 'Inject a +5° angle-of-attack gust', apply: gustHit },
    { label: 'Nose whack (q +0.5)', title: 'Apply a +0.5 rad/s pitch-rate kick', apply: noseWhack },
  ],
  noise: { max: 1, step: 0.05, unit: '°', mul: 1 }, // sensor noise σ up to 1°, default 0

  aux: {
    label: 'Angle of attack α (deg) — stall proximity',
    unit: '°',
    // include the steady gust bias so the aux reads true aerodynamic α
    get: (x, _u, d) => (x[0] + (d.gust ?? 0) * (Math.PI / 180)) * rad2deg,
  },

  presets: [
    {
      name: 'Fuzzy — default (flies)',
      desc: 'ke .06 / kde .08 / ku .6 at the unstable default CG. The FLC synthesises the missing stability: trim holds and a Gust hit (+5° α) is damped out in ~3.5 s. Watch the operating-point dot crawl on the control surface in the theory panel.',
      set: {
        controllerId: 'fuzzy-pitch',
        ctl: { ke: 0.06, kde: 0.08, ku: 0.6, wf: 10 },
        dist: { cg: 0.75, gust: 0 },
        setpoint: 0,
        timeScale: 1,
      },
    },
    {
      name: 'Fuzzy — ku too hot (limit cycles)',
      desc: 'Same FLC, output gain ku = 2.5: the surface saturates on tiny errors, so the elevator slams 0↔100% and the jet never settles — a fuzzy limit cycle. Lesson: output scaling is a real gain and over-driving it costs stability margin.',
      set: {
        controllerId: 'fuzzy-pitch',
        ctl: { ke: 0.06, kde: 0.08, ku: 2.5, wf: 10 },
        dist: { cg: 0.75, gust: 0 },
        setpoint: 0,
        timeScale: 1,
      },
    },
    {
      name: 'PID comparison (PD-heavy)',
      desc: 'A conventional fly-by-wire PID (Kp 4, Kd 2, Ki 0) does the same job — its Bode tabs now populate (the fuzzy law has none). Crucially, drag Kd to 0: pure PI CANNOT stabilize this RHP-pole airframe at any gain. The D term is the phase lead the fuzzy rule table encodes in its ė column.',
      set: {
        controllerId: 'jet-pid',
        ctl: { kp: 4, ki: 0, kd: 2, wf: 20 },
        dist: { cg: 0.75, gust: 0 },
        setpoint: 0,
        timeScale: 1,
      },
    },
    {
      name: 'CG forward (stable airframe — both relax)',
      desc: 'Slide the CG forward to 0.15: Mα goes negative, the RHP pole walks into the LHP — the live "Linearized poles" readout flips to all-LHP and the airframe flies itself. (For the plant Bode G(jω) of this stable case, switch to the PID controller — the LTI tabs need a linear law.) Either controller now barely works: there is no instability left to fight.',
      set: {
        controllerId: 'fuzzy-pitch',
        ctl: { ke: 0.06, kde: 0.08, ku: 0.6, wf: 10 },
        dist: { cg: 0.15, gust: 0 },
        setpoint: 0,
        timeScale: 1,
      },
    },
    {
      name: 'Departure demo',
      desc: 'Aft CG (0.9), a strong steady updraft (+12° α bias) holding the wing near stall, and weak gains. Hit Gust hit (+5° α): α punches past 15° into the soft-stall region — the moment slope fades and the jet mushes, unable to recover. This is why authority margin matters near the edge of the envelope. (Post-stall aerodynamics simplified.)',
      set: {
        controllerId: 'fuzzy-pitch',
        ctl: { ke: 0.03, kde: 0.02, ku: 0.45, wf: 10 },
        dist: { cg: 0.9, gust: 12 },
        setpoint: 0,
        timeScale: 1,
      },
    },
  ],

  diagram: {
    plantLabel: 'Airframe  G(s)',
    plantSub: 'short period, 4-state',
    dSummary: (d) =>
      `cg ${(d.cg ?? 0.75).toFixed(2)} (Mα=${MaOfCg(d.cg ?? 0.75).toFixed(1)}), gust ${(d.gust ?? 0).toFixed(1)}°`,
  },

  Scene: JetScene,
  PlantTheory: JetTheory,
  // The generic single-loop block diagram is the wrong PICTURE for a Mamdani
  // FLC (it'd show a C(s) box). Draw the fuzzify→rules→defuzzify pipeline; fall
  // back to a generic loop for the linear jet-pid controller.
  DiagramView: JetDiagram,
}
