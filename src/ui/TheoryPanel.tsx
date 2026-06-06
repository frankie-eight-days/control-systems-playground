import { getController } from '../controllers/registry'
import { getScenario } from '../scenarios/registry'
import { useStore } from '../state/store'
import { Tex } from './Math'
import { TheorySection } from './TheorySection'

/**
 * Theory ↔ simulation bridge, composed from the parts that own the math:
 * the scenario's plant theory, the controller's law, and the generic loop
 * algebra that ties them to the Bode tabs.
 */
export function TheoryPanel() {
  const scenarioId = useStore((s) => s.scenarioId)
  const controllerId = useStore((s) => s.controllerId)
  const scn = getScenario(scenarioId)
  const cdef = getController(controllerId)

  return (
    <div className="space-y-3 text-sm">
      <scn.PlantTheory key={scn.id} />
      {cdef.Theory && <cdef.Theory key={cdef.id} />}
      {cdef.response !== null ? <LoopAlgebra /> : <NonlinearLoopNote />}
    </div>
  )
}

function LoopAlgebra() {
  return (
    <TheorySection title="Loop algebra (the Bode panel tabs)">
      <Tex block tex={`L = C\\,G \\qquad T = \\frac{L}{1+L} \\qquad S = \\frac{1}{1+L}`} />
      <p className="text-xs text-slate-400">
        In dB the compensator and plant <em>add</em>: |L| = |C| + |G|. Where |L| ≫ 1, T ≈ 1
        (output tracks setpoint) and S ≈ 1/L (disturbances crushed — an integrator makes S → 0 at
        DC). Where |L| ≪ 1, the loop does nothing: T ≈ L, S ≈ 1. All the action is at the 0 dB
        crossover: the phase margin there <span className="text-green-400">(green line)</span>{' '}
        sets the closed-loop peaking in |T| and the ringing you see in the response. Rule of
        thumb: ζ ≈ PM/100, and T + S = 1 always.
      </p>
    </TheorySection>
  )
}

function NonlinearLoopNote() {
  return (
    <TheorySection title="Loop">
      <p className="text-xs text-slate-400">
        This controller is nonlinear, so there's no L(jω) — stability and the limit cycle come
        from the switching law and the plant's rates (predicted above). The plant itself is still
        linearizable: see the <span className="font-mono">G</span> tab.
      </p>
    </TheorySection>
  )
}
