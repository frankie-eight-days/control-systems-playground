import type { ScenarioDef } from '../types'
import { PmsmDiagram } from './diagram'
import { elecPole, Kt, PMSM, radsToRpm, rpmToRads } from './model'
import { PmsmScene } from './scene'
import { PmsmTheory } from './theory'
import { torquePlant } from './torquePlant'
import { speedPlant, TAU_I } from './speedPlant'

/*
 * PMSM field-oriented control — the capstone pair. Both demos share model.ts
 * and the mode-aware scene/theory; they differ only in plant + descriptor.
 *
 * FINALIZED PHYSICS (model.ts): p=4, R=0.5 Ω, Ld=Lq=2 mH, λm=0.022 Wb,
 * J=5e-4, b=2e-4, Imax=10 A, Kt=(3/2)pλm=0.132 N·m/A. Electrical pole
 * R/L=250 rad/s (39.8 Hz); mechanical pole b/J=0.4 rad/s.
 *
 * V_dc was RAISED from the suggested 60 V to 80 V (V_max=V_dc/√3=46.2 V).
 * Rationale — headroom: at 3000 rpm the electrical frequency is p·ω_m=1257
 * rad/s (200 Hz) and the back-EMF ω_e·λm alone is 27.6 V (60% of a 46.2 V
 * V_max). Holding the torque demo's max setpoint (1.0 N·m, i_q=7.6 A) at
 * 3000 rpm needs |v_dq|≈36.8 V = 79.6% of V_max → ~20% margin (>15% target).
 * At V_dc=60 the same point needs 118% of V_max — the loop could not hold
 * torque at speed. Keeping Kt and R/L fixed (both on-screen anchors) left
 * V_dc as the honest knob. The vdc disturbance slider spans 48–90 V so the
 * "back-EMF ambush" can still starve the loop on purpose.
 */

const fmtRpm = (v: number) => v.toFixed(0)

/* ====================================================================== *
 *  DEMO 1 — pmsm-torque : the current loop on a dynamometer              *
 *  States [i_d, i_q]; speed imposed by the dyno (a disturbance).         *
 *  Marquee gains: Kp=82.4, Ki=20611 ⇒ Ki/Kp=250=R/L, fc≈800 Hz, PM≈90°.  *
 * ====================================================================== */
export const pmsmTorqueScenario: ScenarioDef = {
  id: 'pmsm-torque',
  title: 'PMSM torque (FOC current loop)',
  blurb: 'Field-oriented torque control of a surface PMSM on a dynamometer — the pole-zero recipe',

  plant: torquePlant,
  initialX: [0, 0], // [i_d, i_q]

  // Electrical dynamics: τ_e = L/R = 4 ms, pole at 250 rad/s. dt=20 µs keeps
  // RK4 well inside the 4 ms time constant; sampleDt=0.1 ms captures the loop.
  dt: 2e-5,
  sampleDt: 1e-4,
  windowS: 0.2,
  timeScales: [0.005, 0.01, 0.02, 0.05, 0.2],
  defaultTimeScale: 0.02,
  timeDisplay: { unit: 'ms', mul: 1000 },

  freqDisplay: 'Hz',
  // 1 rad/s .. 10 krad/s: spans the 250 rad/s plant pole (39.8 Hz), the
  // fc≈800 Hz crossover, and the PI zero — everything that matters.
  wSweep: [2 * Math.PI * 1, 2 * Math.PI * 1e4],

  y: {
    label: 'Torque T & setpoint (N·m)',
    unit: 'N·m',
    min: -1.4,
    max: 1.4,
    fmt: (v) => `${v.toFixed(3)} N·m`,
    autoZoom: { minSpan: 0.1 },
  },
  // ±1.0 N·m: i_q = ±7.6 A (within Imax=10 A) and ≤20% voltage margin at
  // 3000 rpm. y-range ±1.4 leaves room for transient overshoot.
  setpoint: { key: 'setpoint', label: 'Torque setpoint T*', unit: 'N·m', min: -1.0, max: 1.0, step: 0.01 },
  uLabel: 'q-axis command u (%) — v_q=((u−50)/50)·Vmax, u=50 ⇒ 0 V',

  controllers: [
    {
      id: 'pid',
      // Acts on the torque error (N·m). Marquee Kp=82.4 %/(N·m), Ki=20611.
      params: [
        { key: 'kp', label: 'Kp  (proportional)', unit: '%/(N·m)', min: 0, max: 200, step: 0.5 },
        { key: 'ki', label: 'Ki  (integral)', unit: '%/(N·m·s)', min: 0, max: 40000, step: 50 },
        { key: 'kd', label: 'Kd  (derivative)', unit: '%·s/(N·m)', min: 0, max: 5, step: 0.01 },
        {
          key: 'wf',
          label: 'ωf  (D filter cutoff)',
          unit: 'rad/s',
          min: 500,
          max: 50000,
          step: 500,
          fmt: (v) => `${(v / 1000).toFixed(1)}k`,
        },
      ],
      defaults: { kp: 82.4, ki: 20611, kd: 0, wf: 20000 },
    },
  ],
  defaultControllerId: 'pid',

  distSliders: [
    { key: 'dynoRpm', label: 'Dyno speed (imposed)', unit: 'rpm', min: 0, max: 3000, step: 10, fmt: fmtRpm },
    {
      key: 'decouple',
      label: 'Decoupling FF gain',
      unit: '',
      min: 0,
      max: 1,
      step: 0.05,
      fmt: (v) => v.toFixed(2),
    },
    { key: 'vdc', label: 'Bus voltage Vdc', unit: 'V', min: 48, max: 90, step: 1 },
  ],
  // Default dyno at 1500 rpm (not 0): the rotor spins and the back-EMF is alive
  // out of the box. The 0-rpm locked-rotor case is kept as an explicit preset.
  distDefaults: { dynoRpm: 1500, decouple: 1, vdc: PMSM.Vdc },
  impulses: [
    {
      label: 'i_q +3 A',
      title: 'Inject a +3 A current spike on the q-axis',
      apply: (x) => {
        const n = x.slice()
        n[1] = n[1] + 3
        return n
      },
    },
  ],
  // torque-sensor noise σ up to 0.05 N·m (shown in mN·m)
  noise: { max: 0.05, step: 0.001, unit: 'mN·m', mul: 1000 },

  aux: {
    // i_d — the decoupling-quality meter. Perfect FOC keeps it pinned at 0.
    label: 'i_d (A) — decoupling quality',
    unit: 'A',
    get: (x) => x[0],
  },

  presets: [
    {
      name: 'Pole-zero cancellation (the FOC recipe)',
      desc:
        'THE marquee tune. Ki/Kp = R/L = 250, so the PI zero cancels the electrical pole and the loop becomes a pure integrator. WATCH the L tab: clean −20 dB/dec straight through fc≈800 Hz, PM≈90°. Step the setpoint: a crisp first-order rise, no overshoot, ~0.8 ms settle. (Rotor spins at the 1500 rpm dyno speed — the loop margins are speed-independent, so it stays PM≈90°.)',
      set: {
        controllerId: 'pid',
        ctl: { kp: 82.4, ki: 20611, kd: 0, wf: 20000 },
        dist: { dynoRpm: 1500, decouple: 1, vdc: PMSM.Vdc },
        setpoint: 0.5,
        timeScale: 0.02,
      },
    },
    {
      name: 'Sluggish',
      desc:
        'Same pole-zero cancellation but fc dropped to ≈100 Hz (Kp=10.3, Ki=2576). Still PM≈90° and clean, just slow — the rise takes ~8× longer. Bandwidth is a design choice; cancellation alone does not set speed.',
      set: {
        controllerId: 'pid',
        ctl: { kp: 10.3, ki: 2576, kd: 0, wf: 20000 },
        dist: { dynoRpm: 1500, decouple: 1, vdc: PMSM.Vdc },
        setpoint: 0.5,
        timeScale: 0.05,
      },
    },
    {
      name: 'Zero misplaced (Ki/Kp ≠ R/L — watch the tail)',
      desc:
        'Same Kp as the marquee but Ki/Kp≈60 ≪ R/L=250: the zero sits well below the pole, so cancellation is imperfect and a slow closed-loop pole (~58 rad/s) survives. WATCH the step: a long ~11 ms tail even though PM still looks fine. The theory panel flags Ki/Kp≠R/L in amber.',
      set: {
        controllerId: 'pid',
        ctl: { kp: 82.4, ki: 4944, kd: 0, wf: 20000 },
        dist: { dynoRpm: 1500, decouple: 1, vdc: PMSM.Vdc },
        setpoint: 0.5,
        timeScale: 0.02,
      },
    },
    {
      name: 'Locked rotor (0 rpm — the bench start)',
      desc:
        'Dyno clamped at 0 rpm: the rotor is PARKED and there is no back-EMF, so the q-axis sees only R and L. This is the classic locked-rotor current-loop test — physically real and the easiest place to identify R/L. Marquee gains still give PM≈90° (the loop margins do not depend on speed). Spin the dyno back up to watch the back-EMF reappear.',
      set: {
        controllerId: 'pid',
        ctl: { kp: 82.4, ki: 20611, kd: 0, wf: 20000 },
        dist: { dynoRpm: 0, decouple: 1, vdc: PMSM.Vdc },
        setpoint: 0.5,
        timeScale: 0.02,
      },
    },
    {
      name: 'Back-EMF ambush',
      desc:
        'Marquee gains, but now drag the Dyno-speed slider 0 → 3000 rpm and watch the loop fight. The back-EMF ω_e·λm climbs (the headroom meter in the theory panel rises toward 100% of Vmax); v_q saturates and the current can no longer hold T* at the top end — this is why drives field-weaken. Drop Decoupling FF to 0 and i_d (the aux trace) jumps off zero — the un-cancelled cross-coupling.',
      set: {
        controllerId: 'pid',
        ctl: { kp: 82.4, ki: 20611, kd: 0, wf: 20000 },
        dist: { dynoRpm: 2400, decouple: 1, vdc: PMSM.Vdc },
        setpoint: 0.8,
        timeScale: 0.02,
      },
    },
  ],

  diagram: {
    plantLabel: 'PMSM iq-loop  G(s)',
    plantSub: 'dq @ imposed ω',
    dSummary: (d) =>
      `d: dyno ${(d.dynoRpm ?? 0).toFixed(0)} rpm · decouple ${(d.decouple ?? 1).toFixed(2)} · Vdc ${(d.vdc ?? PMSM.Vdc).toFixed(0)} V`,
  },

  Scene: PmsmScene,
  PlantTheory: PmsmTheory,
  DiagramView: PmsmDiagram,
}

/* ====================================================================== *
 *  DEMO 2 — pmsm-speed : cascade (outer speed around the inner lag)      *
 *  States [i_q, ω_m]; the inner current loop is a τ_i=0.3 ms lag.        *
 *  Controller acts on rpm error: textbook Kp=0.863 %/rpm, Ki=75.9.       *
 * ====================================================================== */
export const pmsmSpeedScenario: ScenarioDef = {
  id: 'pmsm-speed',
  title: 'PMSM speed (cascade FOC)',
  blurb: 'Cascade speed control — the inner current loop becomes a τ=0.3 ms actuator lag',

  plant: speedPlant,
  // Start spinning at ~1200 rpm (i_q at its friction-holding value) rather than
  // dead rest, so the default step to the ~1550 rpm midpoint setpoint is a
  // gentle ~8% overshoot — a healthy textbook transient — instead of the 78%
  // integrator-windup overshoot a 0→1550 step would show (that windup is real;
  // it's documented in the theory panel and reachable by dragging the setpoint).
  initialX: [0.19, 125.7], // [i_q (A), ω_m (rad/s)] ≈ 1200 rpm holding


  // Mechanical time scale (b/J=0.4 rad/s) is slow; dt=50 µs resolves the 0.3 ms
  // inner lag, sampleDt=2 ms / windowS 4 s show the mechanical transient.
  dt: 5e-5,
  sampleDt: 2e-3,
  windowS: 4,
  timeScales: [0.5, 1, 2, 5],
  defaultTimeScale: 1,
  timeDisplay: { unit: 's', mul: 1 },

  freqDisplay: 'Hz',
  // 0.05 rad/s .. 5 krad/s: spans the b/J mech pole (0.064 Hz), the outer
  // fc≈70 Hz, and the inner-lag pole 1/(2πτ_i)≈530 Hz.
  wSweep: [2 * Math.PI * 0.05, 2 * Math.PI * 5e3],

  y: {
    label: 'Speed ω & setpoint (rpm)',
    unit: 'rpm',
    min: 0,
    max: 3300,
    fmt: (v) => `${v.toFixed(0)} rpm`,
  },
  setpoint: { key: 'setpoint', label: 'Speed setpoint ω*', unit: 'rpm', min: 100, max: 3000, step: 10, fmt: fmtRpm },
  uLabel: 'Torque-current command u (%) — i_q*=((u−50)/50)·Imax',

  controllers: [
    {
      id: 'pid',
      // Acts on the speed error (rpm). Textbook 10× separation:
      // Kp≈0.863 %/rpm, Ki≈75.9 ⇒ fc≈70 Hz, PM≈71°. Ranges also reach the
      // flywheel-retune (Kp≈3.45,Ki≈304) and too-fast (Kp≈18,Ki≈1133) presets.
      params: [
        { key: 'kp', label: 'Kp  (proportional)', unit: '%/rpm', min: 0, max: 30, step: 0.01 },
        { key: 'ki', label: 'Ki  (integral)', unit: '%/(rpm·s)', min: 0, max: 1500, step: 1 },
        { key: 'kd', label: 'Kd  (derivative)', unit: '%·s/rpm', min: 0, max: 2, step: 0.005 },
        { key: 'wf', label: 'ωf  (D filter cutoff)', unit: 'rad/s', min: 20, max: 5000, step: 20 },
      ],
      defaults: { kp: 0.863, ki: 75.9, kd: 0, wf: 600 },
    },
    {
      // Bang-bang speed control: i_q* slams ±Imax across the band. It chatters
      // (the relay switches ~500×/s) but is bounded/stable to simulate, so it
      // earns a slot — the lesson is exactly that chatter.
      id: 'onoff',
      params: [{ key: 'band', label: 'Hysteresis band Δ', unit: 'rpm', min: 5, max: 200, step: 5 }],
      defaults: { band: 40 },
    },
  ],
  defaultControllerId: 'pid',

  distSliders: [
    { key: 'tload', label: 'Load torque T_load', unit: 'N·m', min: -1, max: 1, step: 0.02 },
    {
      key: 'jmult',
      label: 'Inertia ×  (flywheel)',
      unit: '×',
      min: 1,
      max: 5,
      step: 0.5,
      fmt: (v) => v.toFixed(1),
    },
  ],
  distDefaults: { tload: 0, jmult: 1 },
  impulses: [
    {
      label: 'Load whack',
      title: 'Knock the speed down 20 rad/s (≈191 rpm)',
      apply: (x) => {
        const n = x.slice()
        n[1] = n[1] - 20
        return n
      },
    },
  ],
  // speed-sensor noise σ up to 30 rpm
  noise: { max: 30, step: 0.5, unit: 'rpm', mul: 1 },

  aux: {
    // i_q — the cascade's inner command, i.e. the "torque current".
    label: 'i_q (A) — torque current (inner cmd)',
    unit: 'A',
    get: (x) => x[0],
  },

  presets: [
    {
      name: '10× separation (textbook)',
      desc:
        'Outer fc≈70 Hz — a decade below the inner-lag pole at 530 Hz. WATCH the L tab: PM≈71°, crossover ≈70 Hz; the inner lag is invisible. A SMALL setpoint nudge (e.g. 1500→1700) tracks with ~1% overshoot, exactly as PM≈71° predicts. The big 0→1500 step from rest overshoots far more — that is integrator WINDUP, not the linear tune: u pins at 100% for the whole acceleration and Ki keeps integrating. Real speed drives add a velocity feedforward / trajectory to avoid it; the linear margins describe only the small-signal loop.',
      set: {
        controllerId: 'pid',
        ctl: { kp: 0.863, ki: 75.9, kd: 0, wf: 600 },
        dist: { tload: 0, jmult: 1 },
        setpoint: 1500,
        timeScale: 1,
      },
    },
    {
      name: 'Outer too fast — fights the inner loop',
      desc:
        'Crank the gains until crossover ≈800 Hz, ABOVE the inner-lag pole at 530 Hz. WATCH the L tab: the τ_i lag dumps phase right at crossover and PM collapses to ≈33°; the step rings. The separation cue in the theory panel turns amber (<5×). The inner loop is no longer "infinitely fast".',
      set: {
        controllerId: 'pid',
        ctl: { kp: 18.0, ki: 1133, kd: 0, wf: 4000 },
        dist: { tload: 0, jmult: 1 },
        setpoint: 1500,
        timeScale: 1,
      },
    },
    {
      name: 'Flywheel ambush (retune!)',
      desc:
        'Bolt on a 4× flywheel with the SAME textbook gains. The plant changed: crossover drops to ≈21 Hz and the loop crawls (PM≈54° but sluggish). Lesson: gains live with a plant, not a motor. Re-tuning Kp,Ki up ≈4× (Kp≈3.45, Ki≈304) restores fc≈70 Hz — try it.',
      set: {
        controllerId: 'pid',
        ctl: { kp: 0.863, ki: 75.9, kd: 0, wf: 600 },
        dist: { tload: 0, jmult: 4 },
        setpoint: 1500,
        timeScale: 2,
      },
    },
    {
      name: 'Load step rejection (the Ki story)',
      desc:
        'Textbook tune at 1500 rpm, then ramp T_load to +0.6 N·m (or hit Load whack). WATCH: speed dips, then the integrator drives the steady error back to zero — i_q (the aux trace) climbs to (b·ω+T_load)/Kt ≈ 4.8 A. Set Ki=0 and the same load leaves a permanent droop. Integral action is what holds speed against load.',
      set: {
        controllerId: 'pid',
        ctl: { kp: 0.863, ki: 75.9, kd: 0, wf: 600 },
        dist: { tload: 0.6, jmult: 1 },
        setpoint: 1500,
        timeScale: 1,
      },
    },
    {
      name: 'Bang-bang (relay) — chatter',
      desc:
        'Replace the PI with a hysteresis relay: i_q* slams between ±Imax across a 40 rpm band. WATCH: speed holds inside the band but i_q (the aux) is a square wave switching ~500×/s — brutal on the inverter. No C(s); this is why linear cascade control wins for speed loops.',
      set: {
        controllerId: 'onoff',
        ctl: { band: 40 },
        dist: { tload: 0, jmult: 1 },
        setpoint: 1500,
        timeScale: 1,
      },
    },
  ],

  diagram: {
    plantLabel: 'PMSM speed  G(s)',
    plantSub: `inner lag τ=${(TAU_I * 1e3).toFixed(1)} ms`,
    dSummary: (d) => `d: T_load ${(d.tload ?? 0).toFixed(2)} N·m · J×${(d.jmult ?? 1).toFixed(1)}`,
  },

  Scene: PmsmScene,
  PlantTheory: PmsmTheory,
  DiagramView: PmsmDiagram,
}

// Keep these re-exported so tree-shaking-safe local references stay valid.
export { Kt, elecPole, radsToRpm, rpmToRads }
