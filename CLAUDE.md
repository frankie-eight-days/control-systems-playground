# Control Systems Playground

Interactive, physics-based control-systems sandbox for **electrical engineers**.
Users tune controllers (PID first; on/off and fuzzy later) against simulated
plants, inject disturbances, and see both time-domain response and
frequency-domain analysis (Bode, margins) update live.

**Eventual arc**: classic plants (water tank, cruise control, ball & beam,
inverted pendulum) → power-electronics payoff (buck converter voltage/current
mode, LDO), showing that compensator design *is* the same problem.

## Core principle: theory ↔ simulation linkage

**Every simulated behavior must be traceable to the math on screen, and vice
versa.** This is the whole point of the app — not a game, not a toy. Concretely:

- The plant's ODE and its linearized transfer function are always visible,
  with **live numeric values** (gains, time constants) at the current
  operating point. KaTeX for typesetting — EEs read equations, not prose.
- The PID law is shown with current gains, and the **individual P/I/D term
  contributions are plotted live** so users see *which term* is producing
  the behavior they observe.
- Bode plots state what they are (`L(jω) = C(jω)·G(jω)`) and where the
  linearization was taken. Margins are annotated on the plot.
- When adding any feature, ask: "does this show the user *why*, or just
  *what*?" If only *what*, add the *why* before shipping.

## Hard constraints

- **100% client-side.** No server compute, no API routes, no databases.
  Deployed as a static site on Vercel's free tier. If a feature needs a
  server, it doesn't ship.
- **Audience is EEs.** Don't dumb down: show transfer functions, state-space,
  phase margin, anti-windup. Use real units (m, m³/s, %, dB, deg).
- **No physics engine.** Plants are ODEs integrated with our own fixed-timestep
  RK4. Game engines (Matter.js etc.) are banned — they're nondeterministic,
  hard to linearize, and awkward to time-accelerate.

## Tech stack

- Vite + React + TypeScript (strict)
- **uPlot** for all charts (real-time strip charts + Bode). Chosen for
  performance; do not add Chart.js/Recharts/Plotly.
- **Zustand** for state, **Tailwind v4** (via `@tailwindcss/vite`) for styling
- Canvas 2D for plant visualizations (bespoke scene per plant)

## Architecture

Keep simulation, analysis, and UI strictly separated:

```
src/
  sim/          Pure simulation — NO React/DOM imports
    integrator.ts     Fixed-timestep RK4
    pid.ts            PID w/ derivative filtering, anti-windup, saturation
    loop.ts           Sim engine: controller + plant + disturbances + time accel
    plants/           One file per plant, implementing the Plant interface
  analysis/     Pure math — NO React/DOM imports
    complex.ts        Minimal complex arithmetic (no math.js — too heavy)
    linearize.ts      Numerical linearization → state space (A, B, C, D)
    freq.ts           L(jω) sweep, gain/phase margins, crossover freqs
  state/        Zustand store(s) bridging sim ↔ UI
  ui/           React components, canvas scenes, uPlot wrappers
```

### Key interfaces (do not break these)

```ts
// Every plant is a continuous-time ODE: ẋ = f(x, u, d)
interface Plant {
  deriv(x: number[], u: number, d: DisturbanceInputs): number[];
  output(x: number[]): number;            // what the sensor measures
  equilibrium(y: number): { x: number[]; u: number };  // for linearization
}

// Every controller maps (setpoint, measurement, dt) → actuator command
interface Controller {
  update(setpoint: number, measurement: number, dt: number): number;
  reset(): void;
}
```

New plants and new controllers must slot in through these interfaces —
that's how fuzzy/on-off control and the buck converter arrive later without
rework.

### Simulation rules

- Fixed physics timestep (`dt = 5 ms` of *simulated* time). Time acceleration
  = run more substeps per animation frame; never stretch dt.
- Determinism matters: same gains + same disturbances ⇒ identical traces.
  Don't use `Math.random()` in the sim path except through the seeded noise
  generator.
- Actuator saturation is physics, always enforced in the loop — the controller
  must be *told* the saturated value (needed for anti-windup).
- Sim currently runs on the main thread (tank dynamics are slow). If a future
  plant needs >~200× acceleration, move the loop to a Web Worker — the
  `sim/` layer is DOM-free specifically so this stays cheap.

### Analysis rules

- Bode plots come from **numerical linearization** at the current operating
  point (perturb `deriv`), not symbolic math. The UI must label the operating
  point, since nonlinear plants (tank!) have level-dependent dynamics.
- PID frequency response uses the *exact same* structure as the time-domain
  implementation (including the derivative filter), so the Bode plot honestly
  describes the controller being simulated.

## PID implementation notes

Real-world PID, not the textbook toy:

- Derivative **on measurement** (not error) with first-order filter
  (coefficient N) — avoids derivative kick and noise blowup
- Anti-windup via back-calculation from the saturated actuator value
- Output clamped to actuator range; integrator state preserved across
  gain changes (bumpless-ish)

## Commands

- `npm run dev` — dev server
- `npm run build` — type-check (`tsc -b`) + production build. Run this to
  verify changes; there is no test suite yet.

## Roadmap (don't build ahead, but don't paint into corners)

1. ✅ v1: water tank + PID + strip charts + Bode + disturbances + time accel
2. Cruise control, ball & beam; A/B twin-plant comparison mode
3. Tuning-method guided modes (Ziegler–Nichols, relay autotune, Cohen–Coon)
4. On/off + hysteresis controller (thermostat), fuzzy logic controller
5. Buck converter (voltage mode → Type III ≈ PID; current mode), LDO
6. Shareable URLs (state in query string) — explicitly deferred
