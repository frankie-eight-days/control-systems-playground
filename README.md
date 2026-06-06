# Control Systems Playground

Interactive, physics-based control-systems sandbox for electrical engineers —
**runs entirely in your browser**, no server, no MATLAB.

Tune a real PID (derivative filtering, back-calculation anti-windup, actuator
saturation) against a nonlinear gravity-drained water tank, inject
disturbances, and watch the time-domain response and the open-loop Bode plot
(with live gain/phase margins) react together.

## Why

Textbooks show you the math. Simulators show you the response. Almost nothing
shows you both at once and keeps them honestly connected. Here, every behavior
on screen is traceable to an equation on screen:

- The plant's nonlinear ODE — exactly what the RK4 integrator steps — is
  displayed, alongside its transfer function **linearized live at the current
  operating point** (move the setpoint: watch K and τ change, because √h).
- The Bode plot is `L(jω) = C(jω)·G(jω)` of the *same* controller structure
  being simulated, margins annotated.
- The P, I, and D term contributions are plotted live, so you see *which*
  term causes what.

## Try

- Crank **Kp** until the phase margin collapses and the level rings — watch
  both happen simultaneously.
- Add sensor noise with some **Kd** to see why derivative filtering exists.
- Saturate the pump and watch anti-windup do its job.
- Click the tank to dump 50 L in. Close the drain valve and watch the plant
  turn integrating.
- Time acceleration up to 100× — tank dynamics are slow, like real tanks.

## Run

```sh
npm install
npm run dev
```

## Stack

Vite + React + TypeScript, uPlot, Zustand, Tailwind, KaTeX. Physics is a
hand-rolled fixed-timestep RK4 over plant ODEs — no game engine — which is
what makes determinism, time acceleration, and numerical linearization (→
Bode for any future plant) all fall out for free.

## Roadmap

Cruise control · ball & beam · Ziegler–Nichols and relay autotune guided
modes · on/off + hysteresis · fuzzy logic · and the payoff: buck converter
and LDO compensation, where the tank you tuned turns out to be the Type III
compensator in your datasheet.
