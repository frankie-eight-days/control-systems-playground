import { TheorySection } from '../../ui/TheorySection'
import { useLiveFuzzy } from './fuzzyTabs'

/**
 * Slimmed sidebar theory for the fuzzy controller. The big live visuals
 * (membership fans, rule grid, control surface) now live in the Bode-panel
 * tabs (Fuzzify · Rules + Surface) — see fuzzyTabs.tsx. Here we keep the prose
 * and a compact live readout that points at those tabs, so nothing is
 * duplicated. The crisp values come from the same shared live hook the tabs
 * use, so the numbers always agree.
 */
export function FuzzyTheory() {
  const live = useLiveFuzzy()

  return (
    <>
      <TheorySection title="Fuzzy controller — Mamdani 5×5 (live in the Bode panel)">
        <p className="text-[11px] text-slate-400">
          This controller is a fuzzy inference pipeline, not a transfer function: the pitch error e
          and its filtered rate ė are fuzzified into five triangular sets each, a skew-symmetric 5×5
          rule base fires, and the result defuzzifies (centroid) into one elevator command. Because
          there is no C(jω), the Bode panel's L / T,S / C tabs are replaced by live views of the law
          itself —{' '}
          <span className="font-mono text-sky-300">Fuzzify</span> (the membership functions) and{' '}
          <span className="font-mono text-sky-300">Rules + Surface</span> (the rule activations and
          control surface). Watch them react as the jet rejects a gust.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-1.5 rounded-md border border-slate-800 bg-slate-900/60 p-2 font-mono text-[11px]">
          <span className="text-slate-400">
            e = <span className="text-sky-300">{live.e.toFixed(1)}°</span> → E ={' '}
            <span className="text-amber-300">{live.E.toFixed(2)}</span>
          </span>
          <span className="text-slate-400">
            ė = <span className="text-sky-300">{live.edot.toFixed(1)}°/s</span> → Ė ={' '}
            <span className="text-amber-300">{live.Edot.toFixed(2)}</span>
          </span>
          <span className="col-span-2 text-slate-400">
            centroid U = <span className="text-amber-300">{live.U.toFixed(2)}</span> → ×k
            <sub>u</sub>({live.ku.toFixed(2)}) → u ={' '}
            <span className="text-amber-300">{live.uPct.toFixed(1)}%</span> → δ<sub>cmd</sub> ={' '}
            <span className="text-amber-300">{live.deltaCmd.toFixed(1)}°</span>
          </span>
        </div>
      </TheorySection>

      <TheorySection title="What fuzzy buys — and what it costs">
        <p className="text-[11px] text-slate-400">
          The control surface (Rules + Surface tab) <em>is</em> a nonlinear gain schedule written in
          words: near the centre it slopes smoothly (≈ a fixed PD law — compare the PID controller,
          whose Kp/Kd match the surface's centre slope), but toward the corners it saturates, easing
          off authority on huge upsets instead of demanding impossible deflection. Encoding control
          as rules lets a designer shape that schedule by intent ("big positive error and still
          climbing → full nose down") without ever writing a transfer function. The ė column of the
          rule base is exactly the derivative (damping) action that lets the FLC stabilize the
          open-loop-unstable airframe — the linguistic twin of PID's K<sub>d</sub>.
        </p>
        <p className="mt-1 text-[11px] text-amber-300/90">
          The cost: there is no C(jω), so the L / C / T,S Bode tabs don't exist for this controller
          (they're replaced by the Fuzzify / Rules + Surface views). You cannot read a phase margin
          off a fuzzy loop — its stability is empirical, shown by the jet actually holding trim and
          recovering gusts in the scene and strip charts, not proven by a margin. That is the honest
          trade: linguistic flexibility for the loss of the linear toolbox. (The plant itself is
          still LTI — the <span className="font-mono text-slate-300">G</span> tab works.)
        </p>
      </TheorySection>
    </>
  )
}
