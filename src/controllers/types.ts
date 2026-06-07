import type { ComponentType } from 'react'
import type { Cx } from '../analysis/complex'

/** Live controller instance — pure logic, no DOM. */
export interface ControllerImpl {
  reset(): void
  /**
   * One control update. `p` is the current parameter record (slider values,
   * keys defined by the scenario's controller config). Must return the
   * SATURATED actuator command in 0..100.
   */
  update(setpoint: number, y: number, dt: number, p: Record<string, number>): number
  /** Values matching the def's `termInfo` order (e.g. P/I/D contributions). */
  termValues?(): number[]
}

/** One asymptote/component curve on the "C anatomy" Bode tab. */
export interface ResponsePart {
  label: string
  color: string
  /** |part(jω)| as absolute magnitude, or null to omit at this ω (gain off). */
  mag(w: number, p: Record<string, number>): number | null
}

/** A custom analysis view shown as a Bode-panel tab for nonlinear
 *  controllers (which have no L/T/C) — e.g. fuzzy membership functions,
 *  rule activations, control surface. */
export interface AnalysisTab {
  id: string
  label: string
  hint: string
  View: ComponentType
}

/**
 * A controller TYPE: time-domain implementation plus its frequency-domain
 * twin and UI metadata. The `response` MUST describe the exact structure
 * `create()` simulates — that honesty is a core principle of this app.
 */
export interface ControllerDef {
  id: string
  label: string
  create(): ControllerImpl
  /**
   * C(jω) for the current params — or null if the law is nonlinear (relay),
   * in which case the LTI Bode views show an explainer instead.
   */
  response: ((p: Record<string, number>, w: number) => Cx) | null
  /** Decomposition curves for the "C anatomy" tab (requires `response`). */
  parts?: ResponsePart[]
  /**
   * For nonlinear controllers (response: null): replacement tabs shown where
   * L / T,S / C anatomy would be. Without these, a "No C(s)?" explainer tab
   * is shown instead. The G (plant) tab always remains.
   */
  analysisTabs?: AnalysisTab[]
  /** Labels/colors for the term-decomposition strip chart (optional). */
  termInfo?: { label: string; color: string }[]
  /** One-line block-diagram summary, e.g. "60 + 1.5/s + 0·s". */
  summary(p: Record<string, number>): string
  /** Theory-panel section (KaTeX) explaining the law with live params. */
  Theory?: ComponentType
}
