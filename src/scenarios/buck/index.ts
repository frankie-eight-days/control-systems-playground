import { registerController } from '../../controllers/registry'
import type { ScenarioDef } from '../types'
import { BUCK_T } from './compensator'
import { typeIIDef, typeIIIDef } from './controllers'
import { BuckDiagram } from './diagram'
import { buckPlant } from './plant'
import { BuckScene } from './scene'
import { BuckTheory } from './theory'

// Buck-local controller types, registered at module load so their ids
// resolve before first render. Direct calls are safe: the registry is
// cycle-proof (lazy `var` map — see controllers/registry.ts).
registerController(typeIIIDef)
registerController(typeIIDef)

/**
 * The power-electronics payoff scenario: a 12 V → 3.3 V voltage-mode
 * synchronous buck. Hand-calc anchors (verify on the G tab / theory panel):
 * f₀ = 1/2π√(LC) ≈ 1.565 kHz, ESR zero ≈ 6.8 kHz @ 50 mΩ / 67.7 kHz @ 5 mΩ,
 * DC gain Vin/100 = 0.12 V/% (−18.4 dB). Default Type III: fc ≈ 20 kHz,
 * PM ≈ 65°. The Type II presets demo the classic cap-swap field failure.
 */
export const buckScenario: ScenarioDef = {
  id: 'buck',
  title: 'Buck converter',
  blurb: 'Type II / III compensation of a voltage-mode buck — the LC, the ESR zero, the cap swap',

  plant: buckPlant,
  initialX: [2, 3.3], // at the default operating point (io = 2 A, vo = 3.3 V)

  // BUCK_T is the single source of truth for the discrete timestep, shared with
  // the compensator's backward-Euler law and its Bode response C(e^{jωT}).
  // Change it in compensator.ts and both the sim and the plotted TF follow.
  // sampleDt 1 µs: every physics step is captured so no switching edge is lost.
  dt: BUCK_T,
  sampleDt: 1e-6,
  windowS: 0.002,            // 2 ms window — a 20 kHz switching period is ~50 µs, plenty visible
  timeScales: [0.0001, 0.0002, 0.0005, 0.001, 0.005],
  defaultTimeScale: 0.0005,  // 0.5 ms/s: a load-step transient fills the window in ~4 s
  timeDisplay: { unit: 'ms', mul: 1000 },

  freqDisplay: 'Hz',
  // 10 Hz – 100 kHz (decade-aligned). Everything that matters lives here:
  // f₀ 1.57 k, ESR zeros 6.8 k / 67.7 k, fc ≈ 20 k, poles ≤ 68 k. Also keeps
  // the sweep well under the 1 MHz Nyquist of the 0.5 µs step (BUCK_T) — the
  // compensator response is plotted as the exact discrete law C(e^{jωT}),
  // which stops being meaningful up there (and aliases at f_s itself).
  wSweep: [2 * Math.PI * 10, 2 * Math.PI * 1e5],

  y: {
    label: 'Output voltage vo & ref (V)',
    unit: 'V',
    min: 0,
    max: 13,   // raised from 6: windup can push vo toward Vin ≈ 12 V; 13 keeps it visible
    fmt: (v) => `${v.toFixed(3)} V`,
    // Oscilloscope-style: auto-range around the live data with ≥50 mV span.
    // mV-scale transients are otherwise invisible on a 0–13 V fixed axis.
    autoZoom: { minSpan: 0.05 },
  },
  setpoint: { key: 'setpoint', label: 'Reference Vref', unit: 'V', min: 1.1, max: 5.5, step: 0.05 },
  uLabel: 'Duty command u (%) — saturates at 0 / 100',

  controllers: [
    {
      id: 'buck-typeiii',
      params: [
        { key: 'fI', label: 'fI  (integrator unity gain)', unit: 'kHz', min: 0.01, max: 5, step: 0.01 },
        { key: 'fz1', label: 'fz1  (zero 1 → park on f₀)', unit: 'kHz', min: 0.2, max: 10, step: 0.05 },
        { key: 'fz2', label: 'fz2  (zero 2 → park on f₀)', unit: 'kHz', min: 0.2, max: 10, step: 0.05 },
        { key: 'fp1', label: 'fp1  (pole 1 → kill ESR zero)', unit: 'kHz', min: 1, max: 100, step: 0.1 },
        { key: 'fp2', label: 'fp2  (pole 2 → HF roll-off)', unit: 'kHz', min: 10, max: 500, step: 1 },
      ],
      // fc ≈ 20 kHz, PM ≈ 65° at the default electrolytic (50 mΩ) cap
      defaults: { fI: 1.59, fz1: 1.5, fz2: 1.5, fp1: 6.8, fp2: 60 },
    },
    {
      id: 'buck-typeii',
      params: [
        { key: 'fI', label: 'fI  (integrator unity gain)', unit: 'kHz', min: 0.2, max: 20, step: 0.05 },
        { key: 'fz', label: 'fz  (zero → park on f₀)', unit: 'kHz', min: 0.2, max: 20, step: 0.05 },
        { key: 'fp', label: 'fp  (pole → HF roll-off)', unit: 'kHz', min: 5, max: 500, step: 1 },
      ],
      // fc ≈ 13 kHz, PM ≈ 52° — but ONLY thanks to the electrolytic's ESR zero
      defaults: { fI: 3.9, fz: 1.5, fp: 150 },
    },
    {
      id: 'pid',
      params: [
        { key: 'kp', label: 'Kp  (proportional)', unit: '%/V', min: 0, max: 500, step: 1 },
        { key: 'ki', label: 'Ki  (integral)', unit: '%/(V·s)', min: 0, max: 200000, step: 100 },
        { key: 'kd', label: 'Kd  (derivative)', unit: '%·s/V', min: 0, max: 0.05, step: 0.0005 },
        {
          key: 'wf',
          label: 'ωf  (D filter cutoff)',
          unit: 'rad/s',
          min: 1000,
          max: 1e6,
          step: 1000,
          fmt: (v) => `${(v / 1000).toFixed(0)}k`,
        },
      ],
      // Note the units: at these time scales Ki lives in the tens of
      // thousands and Kd in the milli-range — same law, power-supply clock.
      defaults: { kp: 150, ki: 80000, kd: 0.004, wf: 200000 },
    },
    {
      // Hysteretic (bang-bang) voltage-mode control: the relay IS the
      // switching. u=100% → high FET on (inductor charging), u=0% →
      // low FET on (inductor freewheeling). No PWM carrier — fsw emerges
      // from band / ESR / L / Vin / duty. Band in VOLTS internally;
      // displayed in mV via fmt. Works beautifully with electrolytic caps
      // (high ESR = fast ripple slope = predictable fsw ≈ 22 kHz);
      // ceramic caps make the slope capacitive and slow fsw dramatically.
      id: 'onoff',
      params: [
        {
          key: 'band',
          label: 'Hysteresis band ΔV',
          unit: 'mV',
          min: 0.1,
          max: 0.5,
          step: 0.01,
          fmt: (v) => (v * 1000).toFixed(0),
        },
      ],
      defaults: { band: 0.25 },
    },
  ],
  defaultControllerId: 'buck-typeiii',

  distSliders: [
    { key: 'io', label: 'Load current io', unit: 'A', min: 0.2, max: 8, step: 0.1 },
    { key: 'vin', label: 'Input voltage Vin', unit: 'V', min: 8, max: 16, step: 0.1 },
    {
      key: 'esr',
      label: 'Output-cap ESR',
      unit: 'mΩ',
      min: 0.005,
      max: 0.1,
      step: 0.001,
      fmt: (v) => (v * 1000).toFixed(0),
    },
  ],
  distDefaults: { io: 2, vin: 12, esr: 0.05 },
  impulses: [], // the scene owns the signature buttons (load step, cap swap)
  noise: { max: 0.02, step: 0.0005, unit: 'mV', mul: 1000 },

  aux: {
    label: 'Inductor current iL (A)',
    unit: 'A',
    get: (x) => x[0],
  },

  presets: [
    {
      name: "Electrolytic + Type II",
      desc: "Works: the 6.8 kHz ESR zero hands phase back right where the LC took it. WATCH fc 13 kHz, PM 52 deg on the L tab. Hit load +2 A: the voltage dip and recovery should fit neatly inside the 2 ms window.",
      set: {
        controllerId: "buck-typeii",
        ctl: { fI: 3.9, fz: 1.5, fp: 150 },
        dist: { io: 2, vin: 12, esr: 0.05 },
        timeScale: 0.001,
      },
    },
    {
      // Intentional-failure preset -- name announces it so users know before clicking
      name: "Ceramic + Type II (intentional failure!)",
      desc: "Same compensator, 5 mOhm cap: the ESR zero flees to 68 kHz, PM collapses below 0 deg. WATCH: vo immediately breaks into ~9 kHz oscillation -- you can see it without a load step. This is THE classic cap-substitution field failure. Hit cap-swap to cure it without changing a compensator value.",
      set: {
        controllerId: "buck-typeii",
        ctl: { fI: 3.9, fz: 1.5, fp: 150 },
        dist: { io: 2, vin: 12, esr: 0.005 },
        timeScale: 0.005,
      },
    },
    {
      name: "Ceramic + Type III",
      desc: "Two compensator zeros on f0 replace the missing ESR zero; one pole kills the cap's own 68 kHz zero. WATCH: fc 20 kHz, PM 61 deg on the L tab -- stable with no help from the cap. Hit load +2 A: the same clean recovery as preset 1, proving the compensator, not the cap, owns stability.",
      set: {
        controllerId: "buck-typeiii",
        ctl: { fI: 1.59, fz1: 1.5, fz2: 1.5, fp1: 60, fp2: 68 },
        dist: { io: 2, vin: 12, esr: 0.005 },
        timeScale: 0.001,
      },
    },
    {
      name: "Sluggish but bulletproof",
      desc: "fc 120 Hz, a decade below the LC: PM 90 deg. WATCH: the G tab shows the LC resonant peak above 0 dB -- but the loop is too slow to fight it. Hit load +2 A: vo dips ~0.3 V and rings at f0 = 1.6 kHz (count the cycles) before recovering. Fast fc trades stability margin for speed; slow fc keeps the peak under control but can't reject disturbances quickly.",
      set: {
        controllerId: "buck-typeiii",
        ctl: { fI: 0.01, fz1: 1.5, fz2: 1.5, fp1: 6.8, fp2: 60 },
        dist: { io: 2, vin: 12, esr: 0.05 },
        timeScale: 0.005,
      },
    },
    {
      // Hysteretic preset: shows the ESR-dependent fsw lesson
      name: "Hysteretic -- electrolytic (fsw ~22 kHz)",
      desc: "The relay IS the switcher: no carrier, no compensator. WATCH: the duty chart toggles 0/100% at ~22 kHz -- switching edges should be visible in the 2 ms window. The theory panel shows predicted vs measured fsw. Now hit cap-swap to ceramic: ESR drops to 5 mOhm, ripple slope becomes capacitive, and fsw plummets to ~2 kHz (coarser voltage ripple visible in the band). The band slider trades ripple for switching loss.",
      set: {
        controllerId: "onoff",
        ctl: { band: 0.25 },
        dist: { io: 2, vin: 12, esr: 0.05 },
        timeScale: 0.0005,
        setpoint: 3.3,
      },
    },
  ],

  diagram: {
    plantLabel: 'Buck  G_vd(s)',
    plantSub: 'avg model, 0.5 µs',
    dSummary: (d) =>
      `d: io ${(d.io ?? 2).toFixed(1)} A · Vin ${(d.vin ?? 12).toFixed(1)} V · ESR ${((d.esr ?? 0.05) * 1e3).toFixed(0)} mΩ`,
  },

  Scene: BuckScene,
  PlantTheory: BuckTheory,
  DiagramView: BuckDiagram,
}
