import { OnOffController } from '../sim/onoff'
import { useStore } from '../state/store'
import { Tex } from '../ui/Math'
import { TheorySection } from '../ui/TheorySection'
import type { ControllerDef } from './types'

function RelayTheory() {
  const band = useStore((s) => s.ctl.band ?? 0)
  return (
    <TheorySection title="Controller — relay with hysteresis (thermostat)">
      <Tex
        block
        tex={`u = \\begin{cases} 100\\% & e > ${(band / 2).toPrecision(2)} \\\\ 0\\% & e < -${(band / 2).toPrecision(2)} \\\\ \\text{hold} & \\text{otherwise} \\end{cases}`}
      />
      <p className="text-xs text-slate-400">
        Nonlinear — no C(s), no equilibrium. The loop limit-cycles across the band Δ. Narrower Δ →
        tighter control but faster actuator cycling. The plant theory section above predicts the
        cycle from the plant's rise/fall rates.
      </p>
    </TheorySection>
  )
}

export const onoffDef: ControllerDef = {
  id: 'onoff',
  label: 'On/Off + hysteresis',
  create() {
    const relay = new OnOffController()
    return {
      reset: () => relay.reset(),
      update: (sp, y, _dt, p) => relay.update(sp, y, p.band ?? 0),
    }
  },
  response: null, // relay is nonlinear — LTI Bode views show an explainer
  summary: (p) => `relay, Δ = ${(p.band ?? 0).toPrecision(2)}`,
  Theory: RelayTheory,
}
