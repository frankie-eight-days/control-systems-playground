import { registerController } from '../../controllers/registry'
import type { ScenarioDef } from '../types'
import { pendulumPidDef } from './controllers'
import { PendulumScene, pokeCart, pokePole } from './scene'
import { CART, pendulumPlant } from './plant'
import { PendulumTheory } from './theory'

// Pendulum-local PID (trim-centred, sign-flipped) registered at module load.
// The fuzzy 'fuzzy-pitch' controller is already registered globally by the jet
// module (imported earlier in the registry), so we just reference its id.
registerController(pendulumPidDef)

/**
 * Inverted pendulum / cart-pole — the boss fight. Open-loop UNSTABLE about
 * upright. Hand-verified anchors (confirm on the theory panel's live readout):
 * linearizing the EoM about φ=0 gives A eigenvalues {0, −4.81, −0.143, +4.757}
 * rad/s — a real RHP pole at +4.757 (time-to-double t₂ = ln2/4.757 = 0.146 s)
 * and a pole at the ORIGIN (the uncontrolled cart position x). PD stabilises
 * the angle; pure P leaves an undamped wobble and pure PI topples — all
 * verified in sim and stated in the presets.
 *
 * THE HONEST SISO LESSON (the headline): the output is the pole angle ONLY.
 * Angle-only feedback can hold φ upright but can NEVER recentre the cart — that
 * origin pole stays put, so x drifts and eventually hits a rail end. This is a
 * real classical result (the cart state is not stabilisable from φ alone; full
 * stabilisation needs state feedback / LQR). The "Stabilized… until the wall"
 * preset + the nudge slider make it tangible; the theory panel plants the flag
 * for a future state-feedback chapter.
 *
 * Swing-up (getting from hanging to upright) is explicitly OUT of scope —
 * roadmap, noted in the theory.
 */
export const pendulumScenario: ScenarioDef = {
  id: 'pendulum',
  title: 'Inverted pendulum',
  blurb: 'Cart-pole stabilization — an open-loop-unstable RHP plant, and the limit of angle-only feedback',

  plant: pendulumPlant,
  // Start with a 6° lean (not perfect upright): the controller must visibly
  // CATCH it, which is what exposes the cart drift afterwards. PI topples from
  // here; P wobbles; PD catches it then the cart wanders to the wall.
  initialX: [0, 0, 6 * CART.deg2rad, 0],

  dt: 5e-4,
  sampleDt: 0.005,
  windowS: 20,
  timeScales: [0.25, 0.5, 1, 2],
  defaultTimeScale: 1,
  timeDisplay: { unit: 's', mul: 1 },

  freqDisplay: 'rad/s',
  wSweep: [1e-1, 1e3],

  y: {
    label: 'Pole angle φ & setpoint (°)',
    unit: '°',
    min: -25,
    max: 25,
    fmt: (v) => `${v.toFixed(2)}°`,
  },
  // Setpoint stays at upright; a small range lets you lean the target a touch.
  setpoint: { key: 'setpoint', label: 'Angle setpoint φ', unit: '°', min: -10, max: 10, step: 0.5 },
  uLabel: 'Cart force command u (%) — 50% = no push, F=((u−50)/50)·10 N',

  controllers: [
    {
      id: 'pendulum-pid',
      // PD-heavy: the D term is the phase lead that beats the RHP pole. Ranges
      // sized so the presets land mid-scale. wf high (fast loop, t₂≈0.15 s).
      params: [
        { key: 'kp', label: 'Kp  (proportional)', unit: '%/°', min: 0, max: 40, step: 0.5 },
        { key: 'ki', label: 'Ki  (integral)', unit: '%/(°·s)', min: 0, max: 30, step: 0.5 },
        { key: 'kd', label: 'Kd  (derivative)', unit: '%·s/°', min: 0, max: 10, step: 0.1 },
        { key: 'wf', label: 'ωf  (D filter cutoff)', unit: 'rad/s', min: 10, max: 120, step: 2 },
      ],
      defaults: { kp: 16, ki: 0, kd: 3, wf: 50 },
    },
    {
      // STRETCH that genuinely works: the jet's Mamdani rule table flies the
      // pendulum too. Same fuzzifier + skew-symmetric table; only the scaling
      // gains change (pendulum error in °, faster RHP pole ⇒ hotter gains).
      id: 'fuzzy-pitch',
      params: [
        { key: 'ke', label: 'ke  (error gain)', unit: '1/°', min: 0.0, max: 0.4, step: 0.005 },
        { key: 'kde', label: 'kde  (rate gain)', unit: 's/°', min: 0.0, max: 0.5, step: 0.005 },
        { key: 'ku', label: 'ku  (output gain)', unit: '', min: 0.0, max: 2.5, step: 0.05 },
        { key: 'wf', label: 'ωf  (ė filter cutoff)', unit: 'rad/s', min: 5, max: 60, step: 1 },
      ],
      // Verified: catches the 6° lean and recovers a pole poke; the cart still
      // drifts to the wall (the SISO limit is the plant's, not the law's).
      defaults: { ke: 0.1, kde: 0.18, ku: 1.0, wf: 25 },
    },
  ],
  defaultControllerId: 'pendulum-pid',

  distSliders: [
    {
      key: 'nudge',
      label: 'Cart bias force (steer the drift)',
      unit: 'N',
      min: -2,
      max: 2,
      step: 0.1,
      fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`,
    },
  ],
  distDefaults: { nudge: 0 },
  impulses: [
    {
      label: 'Poke pole (+0.3 rad/s)',
      title: 'Kick the pole tip: φ̇ += 0.3 rad/s',
      apply: pokePole,
    },
    {
      label: 'Poke cart (+0.5 m/s)',
      title: 'Shove the cart: ẋ += 0.5 m/s',
      apply: pokeCart,
    },
  ],
  noise: { max: 0.5, step: 0.01, unit: '°', mul: 1 }, // angle-sensor σ up to 0.5°

  aux: {
    // x — THE drift meter: angle-only feedback leaves this uncontrolled.
    label: 'Cart position x (m) — the drift the loop can’t see',
    unit: 'm',
    get: (x) => x[0],
  },

  presets: [
    {
      name: 'PD — balanced',
      desc:
        'Kp 16 / Kd 3. The D term supplies the phase lead that cancels the +4.76 rad/s RHP pole: the pole snaps upright in well under a second and shrugs off a Poke pole. WATCH the aux trace (cart position x): it drifts — angle-only feedback can’t recentre the cart — and around t≈9 s the cart reaches the rail end. That is the SISO limit, not a tuning flaw.',
      set: {
        controllerId: 'pendulum-pid',
        ctl: { kp: 16, ki: 0, kd: 3, wf: 50 },
        dist: { nudge: 0 },
        setpoint: 0,
        timeScale: 1,
      },
    },
    {
      name: 'Stabilized… until the wall (intentional!)',
      desc:
        'The same balanced PD, plus a steady +1.5 N cart bias (nudge). The pole stays perfectly upright the whole time — and the cart marches straight into the rail end (HIT TRACK END) because nothing in an angle-only loop pushes x back. This is the classical cart-pole result and the reason the next chapter is state feedback / LQR: you must feed back x and ẋ too. Steer the nudge slider to feel it.',
      set: {
        controllerId: 'pendulum-pid',
        ctl: { kp: 16, ki: 0, kd: 3, wf: 50 },
        dist: { nudge: 1.5 },
        setpoint: 0,
        timeScale: 1,
      },
    },
    {
      name: 'P only — wobbles, never settles (no damping)',
      desc:
        'Kd 0: pure proportional. P is a restoring spring with NO damping, so the closed loop sits on the imaginary axis — the pole oscillates and never settles (a sustained wobble), and a firm Poke pole tips it over. The inverted pendulum cannot be stabilised by P alone: it needs the phase lead of D. Compare against the PD preset.',
      set: {
        controllerId: 'pendulum-pid',
        ctl: { kp: 16, ki: 0, kd: 0, wf: 50 },
        dist: { nudge: 0 },
        setpoint: 0,
        timeScale: 1,
      },
    },
    {
      name: 'PI — falls (worse)',
      desc:
        'Kp 12 / Ki 15 / Kd 0. Integral action is exactly wrong here: it adds phase LAG where the RHP pole already demands lead, and the integrator winds up as it chases the lean — the pole diverges past 30° and FALLS in a few seconds. P and PI both fail; only the D term saves an inverted pendulum.',
      set: {
        controllerId: 'pendulum-pid',
        ctl: { kp: 12, ki: 15, kd: 0, wf: 50 },
        dist: { nudge: 0 },
        setpoint: 0,
        timeScale: 1,
      },
    },
    {
      name: 'Sluggish — survives small pokes only',
      desc:
        'Kp 8 / Kd 1.6, a low-bandwidth PD. It still stabilises the pole (the loop crosses over above the 4.76 rad/s instability) but with little margin: it rights the initial lean and a gentle Poke pole, yet a hard Poke cart or stacked pokes outrun it and it falls. Lesson: against an unstable plant you must act faster than t₂ ≈ 0.15 s — barely is not enough.',
      set: {
        controllerId: 'pendulum-pid',
        ctl: { kp: 8, ki: 0, kd: 1.6, wf: 30 },
        dist: { nudge: 0 },
        setpoint: 0,
        timeScale: 1,
      },
    },
    {
      name: 'Fuzzy — the jet’s rule table flies this too',
      desc:
        'Switch to the Mamdani FLC — literally the fighter-pitch controller’s rule table, only the scaling gains differ (ke .10 / kde .18 / ku 1.0). It synthesises the same phase lead from its ė column and balances the pole, catching the lean and recovering a Poke pole. The cart still drifts to the wall: the SISO limit belongs to the plant, not the controller. The same skew-symmetric table stabilises a fighter and an inverted pendulum — that is the point of a rule base.',
      set: {
        controllerId: 'fuzzy-pitch',
        ctl: { ke: 0.1, kde: 0.18, ku: 1.0, wf: 25 },
        dist: { nudge: 0 },
        setpoint: 0,
        timeScale: 1,
      },
    },
  ],

  diagram: {
    plantLabel: 'Cart-pole  G(s)',
    plantSub: 'unstable, 4-state',
    dSummary: (d) => `nudge ${(d.nudge ?? 0) >= 0 ? '+' : ''}${(d.nudge ?? 0).toFixed(1)} N`,
  },

  Scene: PendulumScene,
  PlantTheory: PendulumTheory,
}
