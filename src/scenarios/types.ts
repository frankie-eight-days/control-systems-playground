import type { ComponentType } from 'react'
import type { Plant } from '../sim/plant'

export interface SliderSpec {
  key: string
  label: string
  unit: string
  min: number
  max: number
  step: number
  fmt?: (v: number) => string
}

/** Click-to-disturb impulse: instantaneously transforms the plant state. */
export interface ImpulseSpec {
  label: string
  title?: string
  apply: (x: number[]) => number[]
}

export interface PresetSpec {
  name: string
  desc: string
  set: {
    controllerId?: string
    ctl?: Record<string, number>
    timeScale?: number
    setpoint?: number
    dist?: Record<string, number>
  }
}

/** Per-scenario configuration of one controller type. */
export interface ScenarioControllerCfg {
  /** Must match a ControllerDef id in controllers/registry.ts. */
  id: string
  /** Slider specs for this plant (ranges + units are plant-specific!). */
  params: SliderSpec[]
  defaults: Record<string, number>
}

/**
 * Everything the engine + generic UI need to run one scenario. Adding a
 * scenario = one folder exporting one of these + a registry line. The
 * generic UI (charts, Bode, control panel, block diagram) consumes ONLY
 * this contract — scenario folders own their plant, scene, and theory.
 */
export interface ScenarioDef {
  id: string
  title: string
  /** Header strapline, e.g. "PID level control of a gravity-drained tank". */
  blurb: string

  plant: Plant
  initialX: number[]

  /** Physics timestep in SIMULATED seconds (tank 5 ms; buck ~1 µs). */
  dt: number
  /** History sampling period, sim seconds. */
  sampleDt: number
  /** Strip-chart window, sim seconds. */
  windowS: number
  /** Sim-seconds advanced per real second. <1 = slow motion (buck!). */
  timeScales: number[]
  defaultTimeScale: number
  /** Chart time axis: display = sim-s × mul, labeled with unit. */
  timeDisplay: { unit: string; mul: number }

  /** Bode x-axis display unit (internally everything is rad/s). */
  freqDisplay: 'rad/s' | 'Hz'
  /** Bode sweep bounds in rad/s. */
  wSweep: [number, number]

  /** Sensor/output signal: chart range, labels, formatting.
   *  autoZoom: oscilloscope-style y-axis — auto-range around the live data
   *  with at least minSpan of span, instead of the fixed [min,max]. Use when
   *  interesting deviations are tiny vs. the absolute scale (buck: mV on
   *  volts). min/max still bound the zoom. */
  y: {
    label: string
    unit: string
    min: number
    max: number
    fmt: (v: number) => string
    autoZoom?: { minSpan: number }
  }
  setpoint: SliderSpec
  /** Actuator strip-chart title (command is always 0–100%). */
  uLabel: string

  controllers: ScenarioControllerCfg[]
  defaultControllerId: string

  distSliders: SliderSpec[]
  distDefaults: Record<string, number>
  impulses: ImpulseSpec[]
  /** Sensor noise σ slider: display = σ × mul, labeled unit. */
  noise: { max: number; step: number; unit: string; mul: number }

  /** Optional third strip chart when the controller has no term split. */
  aux?: {
    label: string
    unit: string
    get: (x: number[], u: number, d: Record<string, number>) => number
  }

  presets: PresetSpec[]

  /** Block-diagram labels. */
  diagram: {
    plantLabel: string
    plantSub?: string
    dSummary: (d: Record<string, number>) => string
  }

  /** Canvas visualization — owns its own clicks/buttons via engine impulses. */
  Scene: ComponentType
  /** Plant theory sections (nonlinear ODE, linearization) with live values. */
  PlantTheory: ComponentType
  /**
   * Optional override for the Diagram tab. The generic block diagram draws a
   * single SISO loop — honest for simple plants, but structurally wrong as a
   * PICTURE for e.g. FOC (transforms, inverter, cascade) or fuzzy control
   * (fuzzify → rules → defuzzify). Scenarios whose loop has real structure
   * should draw it themselves (live signal values expected, same canvas
   * idioms as ui/BlockDiagram.tsx).
   */
  DiagramView?: ComponentType
}
