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
  sim/          Pure simulation — NO React/DOM imports (Worker-portable)
    integrator.ts     Fixed-timestep RK4
    pid.ts, onoff.ts  Controller LOGIC (classes, no UI)
    loop.ts           SimEngine — scenario-agnostic; scenario slice +
                      controller factory are injected via tick()
  analysis/     Pure math — NO React/DOM imports
    complex.ts        Minimal complex arithmetic (no math.js — too heavy)
    linearize.ts      Numerical linearization → state space (A, B, C)
    freq.ts           freqAnalysis(): G/C/L/T/S sweep + margins + closed-loop stats
  controllers/  ControllerDef registry: sim law + matching C(jω) + UI metadata
    types.ts          ControllerDef / ControllerImpl — THE controller contract
    pid.tsx, onoff.tsx, registry.ts
  scenarios/    One folder per scenario — THE unit of parallel work
    types.ts          ScenarioDef — THE scenario contract (read this first)
    registry.ts       Display-order list. OWNED BY THE INTEGRATION LEAD.
    stub.tsx          Placeholder factory for not-yet-built scenarios
    tank/             Reference implementation: plant.ts, scene.tsx,
                      theory.tsx, index.ts (descriptor)
    cruise/ thermal/ motor/ buck/    (one folder per scenario)
  state/        Zustand store + engine instance bridging sim ↔ UI
  ui/           Generic, descriptor-driven panels: BodePlot (5 tabs incl.
                block diagram), StripCharts, ControlPanel, TheoryPanel
```

The contracts live in `src/scenarios/types.ts` (ScenarioDef) and
`src/controllers/types.ts` (ControllerDef). The generic UI consumes ONLY
those contracts — there is no scenario-specific code outside scenario
folders. `src/scenarios/tank/` is the reference implementation; when in
doubt, copy its patterns.

### Simulation rules

- Fixed physics timestep per scenario (`ScenarioDef.dt`, *simulated* time —
  tank 5 ms, buck ~1 µs). Time scale = run more (or fewer) substeps per
  animation frame; never stretch dt. Time scales < 1 are slow motion.
- Determinism matters: same gains + same disturbances ⇒ identical traces.
  Don't use `Math.random()` in the sim path except through the seeded noise
  generator.
- Actuator saturation is physics: controllers return the SATURATED command
  (0–100) and handle their own anti-windup. Plants with hard state limits
  (tank rim/floor) enforce them inside `deriv` by zeroing the derivative at
  the boundary.
- Sim runs on the main thread. If a future plant needs more substeps than
  the per-frame cap allows, move the loop to a Web Worker — the `sim/`
  layer is DOM-free specifically so this stays cheap.

## Scenario authoring contract (for parallel scenario work)

Each scenario teammate owns exactly one folder: `src/scenarios/<id>/`.

**Hard rules — violating these breaks parallel work:**

1. Edit ONLY files inside your folder. Do NOT touch `scenarios/registry.ts`
   (already wired to your `index.ts` stub), the engine, the store, shared UI,
   other scenarios, or package.json. If the contract seems to be missing
   something you need, STOP and message the team lead — do not "fix" shared
   code yourself.
2. Your `index.ts` must export the same symbol name the stub exports
   (e.g. `cruiseScenario`), typed `ScenarioDef`.
3. Scenario-specific controllers (e.g. buck Type II/III) are DEFINED in your
   folder and registered by calling `registerController(def)` at the top of
   your `index.ts` (module load). This is safe at any point of module
   evaluation — the registry is import-cycle-proof (lazy `var` map; see the
   comment in `controllers/registry.ts`). Their `response()` must describe
   the exact discrete law you simulate.
4. Use real units everywhere, SI internally; pick display units EEs expect
   (the y.fmt / noise.mul / timeDisplay / freqDisplay fields exist for this).
5. Theory ↔ sim linkage is non-negotiable: your `PlantTheory` component must
   show (a) the exact ODE `deriv` integrates (KaTeX via `ui/Math` Tex), with
   parameter values, and (b) the transfer function linearized at the current
   operating point with LIVE numeric gains/time-constants (compute via
   `analysis/linearize` + `analysis/freq dcGain`, memoized on the store
   values that move the operating point).
6. Scene: Canvas 2D, rAF loop, read `useStore.getState()` + `engine` each
   frame (see tank/scene.tsx for the resize/dpr pattern). Make disturbances
   clickable where natural via `engine.applyImpulse`.
7. Presets: 3–5, each demonstrating a named behavior, with `desc` strings
   that say what to watch for.
8. If your loop has real structure (cascade, transforms, nonlinear pipeline),
   provide `DiagramView` — the generic single-loop block diagram is a wrong
   picture for it. Draw the textbook structure with live signal values.
9. Authoring order: keep the STUB export in index.ts until every file it
   will import exists and compiles — a dangling import in index.ts takes the
   whole dev server down for everyone (the registry imports your folder).
   Build plant → scene → theory → diagram first, wire index.ts LAST.

**Verify your work (no `npm run build` — it races other teammates on dist/):**

- Type-check: `npx tsc -p tsconfig.app.json --noEmit`
- Visual: a dev server is already running; screenshot your scenario with
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless
  --disable-gpu --screenshot=/tmp/<id>.png --window-size=1440,800
  --hide-scrollbars --virtual-time-budget=8000
  "http://localhost:5174/?scenario=<id>"` and READ the png. Verify: scene
  draws, response converges sensibly, Bode tabs populate, theory panel
  equations render, no Vite error overlay.
- Sanity-check the physics NUMERICALLY in your final report: state the
  hand-derived pole/gain/crossover values and confirm the on-screen
  linearization and PM match. If they disagree, your model or your math is
  wrong — find out which before reporting done.

### Analysis rules

- Bode plots come from **numerical linearization** at the current operating
  point (perturb `deriv`), not symbolic math. The UI labels the operating
  point, since nonlinear plants have operating-point-dependent dynamics.
- Controller frequency response (`ControllerDef.response`) must use the
  *exact same* structure as the time-domain implementation (including
  filters), so the Bode plot honestly describes the controller being
  simulated. Nonlinear laws set `response: null` and the LTI tabs show an
  explainer.

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
- `npm run build` — type-check (`tsc -b`) + production build. Integration
  lead runs this; teammates use `npx tsc -p tsconfig.app.json --noEmit`.
  There is no test suite yet.

## Roadmap (don't build ahead, but don't paint into corners)

1. ✅ v1: water tank + PID + strip charts + Bode + disturbances + time accel
2. ▶ wave 1 (parallel): cruise control, thermal/dead-time boiler, DC motor
   position servo, buck converter (Type II/III compensators)
3. Tuning-method guided modes (Ziegler–Nichols, relay autotune, Cohen–Coon)
4. On/off + hysteresis controller (thermostat), fuzzy logic controller
5. Buck converter (voltage mode → Type III ≈ PID; current mode), LDO
6. Shareable URLs (state in query string) — explicitly deferred
