import { useMemo } from 'react'
import { dcGain, poles2 } from '../../analysis/freq'
import { linearize } from '../../analysis/linearize'
import { engine } from '../../state/engine'
import { useStore } from '../../state/store'
import { Tex } from '../../ui/Math'
import { TheorySection } from '../../ui/TheorySection'
import { BUCK, buckPlant, esrZeroHz, type BuckDisturbances } from './plant'

/**
 * Buck plant theory: the averaged ODEs RK4 integrates, and G_vd(s) with LIVE
 * f₀ / Q / ESR-zero numbers pulled from numerical linearization at the
 * current operating point — move the ESR slider and watch Q and f_z move
 * (then check the G tab agrees).
 */
export function BuckTheory() {
  const setpoint = useStore((s) => s.setpoint)
  const io = useStore((s) => s.dist.io ?? 2)
  const vin = useStore((s) => s.dist.vin ?? 12)
  const esr = useStore((s) => s.dist.esr ?? 0.05)
  const controllerId = useStore((s) => s.controllerId)
  const band = useStore((s) => s.ctl.band ?? 0.25)

  const lin = useMemo(() => {
    const d: BuckDisturbances = { io, vin, esr }
    const eq = buckPlant.equilibrium(setpoint, d)
    const ss = linearize(buckPlant, eq.x, eq.u, d)
    const K = dcGain(ss) // V per % duty — should be Vin/100
    const poles = poles2(ss.A)
    const wn = Math.hypot(poles[0].re, poles[0].im)
    const f0 = wn / (2 * Math.PI)
    const q = poles[0].im !== 0 ? wn / (2 * Math.abs(poles[0].re)) : NaN
    return { u0: eq.u, K, f0, q, fz: esrZeroHz(esr) }
  }, [setpoint, io, vin, esr])

  return (
    <>
      {/* no "µs" in the title — the uppercase style turns µ into Μ (reads "ms") */}
      <TheorySection title="Plant — averaged model (what RK4 integrates)">
        <Tex
          block
          tex={`L\\,\\dot i_L = \\tfrac{u}{100}V_{in} - v_o - R_{DCR}\\,i_L \\qquad C\\,\\dot v_C = i_L - i_o`}
        />
        <Tex block tex={`v_o = v_C + R_{ESR}\\,(i_L - i_o)`} />
        <p className="text-xs text-slate-400">
          L={BUCK.L * 1e6} µH, C={BUCK.C * 1e6} µF, DCR={BUCK.DCR * 1e3} mΩ, ESR=
          {(esr * 1e3).toFixed(0)} mΩ, V<sub>in</sub>={vin.toFixed(1)} V, i<sub>o</sub>=
          {io.toFixed(1)} A, dt = 0.5 µs. Switching-cycle average: duty is a continuous actuator,
          ripple doesn't exist here. Synchronous FETs ⇒ i<sub>L</sub> may go negative (no DCM).
        </p>
      </TheorySection>

      <TheorySection
        title={`Control → output, linearized at vo = ${setpoint.toFixed(2)} V (u₀ = ${lin.u0.toFixed(1)}%)`}
      >
        <Tex
          block
          tex={`G_{vd}(s) = \\frac{\\Delta v_o}{\\Delta u} = K\\,\\frac{1 + s/\\omega_{esr}}{s^2/\\omega_0^2 + s/(Q\\,\\omega_0) + 1}`}
        />
        <Tex
          block
          tex={`K = ${lin.K.toFixed(3)}\\,\\tfrac{\\text{V}}{\\%},\\; f_0 = ${(lin.f0 / 1e3).toFixed(3)}\\,\\text{k},\\; Q = ${Number.isFinite(lin.q) ? lin.q.toFixed(2) : '\\text{—}'},\\; f_{esr} = ${(lin.fz / 1e3).toFixed(1)}\\,\\text{k}`}
        />
        <p className="text-xs text-slate-400">
          K, f₀, Q come from numerically linearizing the ODE above (K = V<sub>in</sub>/100 — u is
          % duty, so the modulator gain an analog designer hides in 1/V<sub>ramp</sub> lives
          here). f₀ = 1/2π√(LC) and Q = √(L/C)/(DCR+ESR) ={' '}
          {(Math.sqrt(BUCK.L / BUCK.C) * 1e3).toFixed(0)} mΩ/{((BUCK.DCR + esr) * 1e3).toFixed(0)}{' '}
          mΩ: the current-source load adds <em>no</em> damping, so only series resistance tames
          the resonant peak you see on the G tab.
        </p>
      </TheorySection>

      <TheorySection title="The ESR zero — why the cap choice IS loop design">
        <Tex
          block
          tex={`f_{esr} = \\frac{1}{2\\pi\\,R_{ESR}\\,C} = ${(lin.fz / 1e3).toFixed(1)}\\ \\text{kHz}\\qquad(50\\,\\text{m}\\Omega \\to 6.8\\,\\text{kHz},\\;\\; 5\\,\\text{m}\\Omega \\to 67.7\\,\\text{kHz})`}
        />
        <p className="text-xs text-slate-400">
          Above f<sub>esr</sub> the cap looks resistive and v<sub>o</sub> follows i<sub>L</sub>:
          the zero hands the loop +90° right where the LC took 180° away. A Type II compensator
          (one zero, ≤ +90° of boost) is solvent only because of that donation — swap the
          electrolytic for a ceramic and f<sub>esr</sub> jumps a decade up, the donation leaves
          the loop band, and PM collapses (preset 2). Type III brings two zeros of its own and
          doesn't care (preset 3).
        </p>
      </TheorySection>

      {controllerId === 'onoff' && (
        <HystereticSection vin={vin} vo={setpoint} esr={esr} band={band} />
      )}
    </>
  )
}

/**
 * Count u→switching edges in engine.history.u to estimate measured fsw.
 * A rising or falling transition between 0 and 100 is a switching event;
 * two events = one full cycle. Returns null if fewer than 4 edges found
 * (not enough data — the window may be too short for the current fsw).
 */
function measuredFsw(): number | null {
  const u = engine.history.u
  const t = engine.history.t
  if (u.length < 4) return null
  let edges = 0
  let tFirst = -1
  let tLast = -1
  for (let i = 1; i < u.length; i++) {
    const prev = u[i - 1]
    const curr = u[i]
    // Detect a switching transition: one side is 0%, other is 100%
    if ((prev < 10 && curr > 90) || (prev > 90 && curr < 10)) {
      edges++
      if (tFirst < 0) tFirst = t[i]
      tLast = t[i]
    }
  }
  if (edges < 4 || tLast <= tFirst) return null
  // edges - 1 half-cycles span from tFirst to tLast; 2 half-cycles per period
  const cycles = (edges - 1) / 2
  const windowSec = tLast - tFirst
  return cycles / windowSec
}

/**
 * Hysteretic (bang-bang) switching section: the law, the ESR-slope derivation
 * of predicted fsw, and a MEASURED fsw from the history edge count.
 *
 * Physics of hysteretic buck voltage-mode control:
 *   - When vo < Vref − ΔV/2: u → 100% (high FET on), inductor charges.
 *     dv_o/dt ≈ ESR·(di_L/dt) + (i_L−io)/C
 *     di_L/dt_on  = (Vin − vo) / L  ← dominant term with electrolytic
 *   - When vo > Vref + ΔV/2: u → 0%  (low FET on), inductor freewheels.
 *     di_L/dt_off = −vo / L
 *
 * ESR-dominated regime (electrolytic, ESR ≫ 1/(ωC)):
 *   slope_rise ≈ ESR · (Vin−vo)/L  [V/s]
 *   slope_fall ≈ ESR · vo/L        [V/s]
 *   T = ΔV/slope_rise + ΔV/slope_fall  →  fsw = 1/T
 *
 * Capacitive regime (ceramic, ESR → 0):
 *   slope_rise ≈ (i_L − io) / C  →  dominated by the integral of small net current
 *   In practice: both ESR and C terms contribute; formula uses the combined slope.
 */
function HystereticSection({
  vin,
  vo,
  esr,
  band,
}: {
  vin: number
  vo: number
  esr: number
  band: number
}) {
  // --- predicted fsw ---
  // Full ripple slope: ESR term + capacitive term
  // At the ripple mid-level i_L ≈ io (average), so the capacitive term
  // (i_L − io)/C ≈ 0 on average. The slope is dominated by ESR.
  const L = BUCK.L
  const C = BUCK.C
  const slopeRise = esr * (vin - vo) / L  // V/s, ESR-dominated
  const slopeFall = esr * vo / L           // V/s, ESR-dominated
  // Capacitive contribution to slope: at duty d = vo/vin, net current during
  // charge = (i_L − io) alternates; for the average model the cap slope is:
  //   cap_rise = (vin - vo) * vo / (vin * L * C)  (half-period average)
  //   cap_fall = vo * (vin - vo) / (vin * L * C)
  // Both equal  vo(Vin−vo)/(Vin·L·C) — the same value, ESR-independent.
  const capSlope = (vo * (vin - vo)) / (vin * L * C)  // V/s
  const effectiveRise = Math.max(slopeRise + capSlope, 1)   // V/s, combined
  const effectiveFall = Math.max(slopeFall + capSlope, 1)
  const Tpred = band / effectiveRise + band / effectiveFall
  const fswPred = 1 / Tpred

  // Dominant-regime label
  const esrDominated = esr * (vin - vo) / L > capSlope * 2

  // --- measured fsw ---
  const fswMeas = measuredFsw()

  const kHz = (f: number) => (f / 1e3).toFixed(1)
  const mVus = (s: number) => ((s * 1e3) / 1e6).toFixed(2) // V/s → mV/µs

  return (
    <TheorySection title="Hysteretic operation — predicted vs measured fsw">
      <Tex
        block
        tex={`u = \\begin{cases} 100\\% & v_o < V_{ref} - \\Delta V/2 \\\\ 0\\% & v_o > V_{ref} + \\Delta V/2 \\\\ \\text{hold} & \\text{otherwise} \\end{cases}`}
      />
      <p className="text-xs text-slate-400 mt-1">
        No carrier, no compensator — the relay IS the switcher. Switching frequency emerges from
        the band width and the rate at which v<sub>o</sub> sweeps across it.
      </p>

      <Tex
        block
        tex={`\\dot v_{o,\\uparrow} \\approx \\underbrace{R_{ESR}\\tfrac{V_{in}-v_o}{L}}_{${mVus(slopeRise)}\\ \\text{mV/µs}} + \\underbrace{\\tfrac{v_o(V_{in}-v_o)}{V_{in}LC}}_{${mVus(capSlope)}\\ \\text{mV/µs}}`}
      />
      <Tex
        block
        tex={`\\dot v_{o,\\downarrow} \\approx R_{ESR}\\tfrac{v_o}{L} + \\tfrac{v_o(V_{in}-v_o)}{V_{in}LC} = ${mVus(effectiveFall)}\\ \\text{mV/µs (falling)}`}
      />
      <Tex
        block
        tex={`T = \\frac{\\Delta V}{\\dot v_{\\uparrow}} + \\frac{\\Delta V}{\\dot v_{\\downarrow}} \\Rightarrow f_{sw,pred} = ${kHz(fswPred)}\\ \\text{kHz}`}
      />

      <div className="mt-1 flex gap-4 font-mono text-xs">
        <span className="text-sky-300">
          predicted: {kHz(fswPred)} kHz
        </span>
        <span className={fswMeas != null ? 'text-green-300' : 'text-slate-500'}>
          measured: {fswMeas != null ? `${kHz(fswMeas)} kHz` : 'counting edges…'}
        </span>
      </div>

      <p className="text-xs text-slate-400 mt-1">
        {esrDominated
          ? `ESR-dominated regime (ESR = ${(esr * 1e3).toFixed(0)} mΩ): the ripple slope is mostly resistive (${mVus(slopeRise)} mV/µs rising). Predicted ≈ ${kHz(fswPred)} kHz matches the strip chart.`
          : `Capacitive regime (ESR = ${(esr * 1e3).toFixed(0)} mΩ): ESR term is small, ripple slope is mostly capacitive (${mVus(capSlope)} mV/µs). fsw drops dramatically — try the electrolytic to see the difference.`}
        {' '}Narrowing the band (ΔV) raises f<sub>sw</sub> linearly and reduces ripple, at the cost
        of more switching transitions (and losses).
      </p>

      {fswMeas != null && Math.abs(fswMeas - fswPred) / fswPred > 0.3 && (
        <p className="text-xs text-amber-400 mt-1">
          Predicted and measured differ by {(Math.abs(fswMeas - fswPred) / fswPred * 100).toFixed(0)}%.
          The averaged plant model doesn't simulate real switching ripple — the relay drives the
          averaged v<sub>o</sub> across the band at the rates above, but the discrete nature of
          the 0.5 µs step quantizes the switching instants. Halving the band or dt closes the gap.
        </p>
      )}
    </TheorySection>
  )
}
