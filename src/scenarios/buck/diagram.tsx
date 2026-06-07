import { useEffect, useRef } from 'react'
import { getController } from '../../controllers/registry'
import { engine } from '../../state/engine'
import { useStore } from '../../state/store'
import { buckPlant, esrZeroHz, type BuckDisturbances } from './plant'

/* ---- shared canvas helpers (same idioms as ui/BlockDiagram.tsx) ---- */
const WIRE = '#64748b'
const MONO = '11px ui-monospace, monospace'
const VIOLET = '#a78bfa'
const SKY = '#38bdf8'
const AMBER = '#fbbf24'
const GREEN = '#4ade80'

interface Draw {
  line: (pts: [number, number][], color?: string, animated?: boolean) => void
  arrow: (x: number, y: number, dir: 'r' | 'l' | 'u' | 'd', color?: string) => void
  label: (x: number, y: number, text: string, color: string, align?: CanvasTextAlign) => void
}

/**
 * Measured switching frequency from the recorded duty trace: count 0↔100 %
 * edges in history.u over its time span. For the hysteretic relay this is the
 * real limit-cycle fsw; for the PWM controllers the averaged duty barely moves
 * so it (correctly) reads ~0 and we don't show it.
 */
function measuredFswHz(): number {
  const h = engine.history
  const u = h.u
  const t = h.t
  const n = u.length
  if (n < 4) return 0
  let edges = 0
  let prevHigh = u[0] > 50
  for (let i = 1; i < n; i++) {
    const high = u[i] > 50
    if (high !== prevHigh) {
      edges++
      prevHigh = high
    }
  }
  const span = t[n - 1] - t[0]
  if (span <= 0 || edges < 2) return 0
  // a full switching period is two edges (rise + fall)
  return edges / 2 / span
}

/**
 * Buck DiagramView — replaces the generic single SISO loop, which is the wrong
 * PICTURE for a switching converter. It draws the real voltage-mode chain:
 *
 *   Vref → Σ → [COMPENSATOR] → Vc → [PWM ×100] → d% → [POWER STAGE QH/QL+LC]
 *                                                        → vo → [DIVIDER] ↺
 *
 * mode-aware on the active controller: Type III/II show their corner-frequency
 * summary, PID its gains, and the hysteretic relay collapses the
 * compensator+modulator into a single comparator that bangs the gates DIRECTLY
 * — no carrier — with the live measured switching frequency on the gate wire.
 */
export function BuckDiagram() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const wrap = wrapRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const dpr = window.devicePixelRatio || 1
      const W = wrap.clientWidth
      const H = wrap.clientHeight
      if (W === 0 || H === 0) return
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = W * dpr
        canvas.height = H * dpr
        canvas.style.width = `${W}px`
        canvas.style.height = `${H}px`
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

      const s = useStore.getState()
      const dashOff = -((engine.t * 24) % 12)

      const line = (pts: [number, number][], color = WIRE, animated = true) => {
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        ctx.setLineDash(animated ? [7, 5] : [])
        ctx.lineDashOffset = animated ? dashOff : 0
        ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1])
        for (const [px, py] of pts.slice(1)) ctx.lineTo(px, py)
        ctx.stroke()
        ctx.setLineDash([])
      }
      const arrow = (x: number, y: number, dir: 'r' | 'l' | 'u' | 'd', color = WIRE) => {
        ctx.fillStyle = color
        ctx.beginPath()
        const tip: [number, number][] =
          dir === 'r'
            ? [[x - 8, y - 4], [x - 8, y + 4]]
            : dir === 'l'
              ? [[x + 8, y - 4], [x + 8, y + 4]]
              : dir === 'u'
                ? [[x - 4, y + 8], [x + 4, y + 8]]
                : [[x - 4, y - 8], [x + 4, y - 8]]
        ctx.moveTo(x, y)
        ctx.lineTo(tip[0][0], tip[0][1])
        ctx.lineTo(tip[1][0], tip[1][1])
        ctx.closePath()
        ctx.fill()
      }
      const label = (
        x: number,
        y: number,
        text: string,
        color: string,
        align: CanvasTextAlign = 'center',
      ) => {
        ctx.fillStyle = color
        ctx.font = MONO
        ctx.textAlign = align
        ctx.fillText(text, x, y)
      }

      drawChain(ctx, W, H, s, { line, arrow, label })
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div ref={wrapRef} className="h-full w-full">
      <canvas ref={canvasRef} />
    </div>
  )
}

/** A titled rounded stage box; draws title (bold) + optional sub line. */
function stageBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  sub: string,
  accent = '#94a3b8',
) {
  ctx.fillStyle = '#1e293b'
  ctx.strokeStyle = accent
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 5)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#e2e8f0'
  ctx.font = 'bold 11px ui-sans-serif, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(title, x + w / 2, y + 15)
  if (sub) {
    ctx.fillStyle = '#94a3b8'
    ctx.font = MONO
    ctx.fillText(sub, x + w / 2, y + h - 8)
  }
}

function drawChain(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  s: ReturnType<typeof useStore.getState>,
  d: Draw,
) {
  const cdef = getController(s.controllerId)
  const dist: BuckDisturbances = {
    io: s.dist.io ?? 2,
    vin: s.dist.vin ?? 12,
    esr: s.dist.esr ?? 0.05,
  }
  const iL = engine.x.length >= 2 ? engine.x[0] : 0
  const vo = engine.x.length >= 2 ? buckPlant.vout(engine.x, dist) : 0
  const duty = engine.u
  const vref = s.setpoint
  const err = vref - engine.yMeas
  const hysteretic = s.controllerId === 'onoff'

  const pad = 14
  // Center the two-row diagram (forward chain + feedback return) in the panel,
  // capping the row spacing so a tall panel doesn't stretch the loop absurdly.
  const rowGap = Math.min(H * 0.32, 150)
  const midY = H / 2 - rowGap / 2 + 6
  const fbY = midY + rowGap
  const blockH = 48

  // ── summing junction ──
  const sumX = Math.max(64, W * 0.11)
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(sumX, midY, 12, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = '#cbd5e1'
  ctx.font = 'bold 13px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.fillText('Σ', sumX, midY + 4)
  ctx.font = MONO
  ctx.fillText('+', sumX - 19, midY - 6)
  ctx.fillText('−', sumX + 6, midY + 22)
  // Vref into the sum (label centered on the wire segment, above it)
  d.line([[pad, midY], [sumX - 12, midY]])
  d.arrow(sumX - 12, midY, 'r')
  d.label((pad + sumX - 12) / 2, midY - 9, `Vref ${vref.toFixed(2)} V`, GREEN)

  // Column geometry: COMP → (PWM) → POWER STAGE, laid left→right.
  // Leave a clear gap after Σ for the error-signal label, and reserve room on
  // the right for the vo output wire + readout after the power stage.
  const x0 = sumX + 58
  const voGap = Math.max(64, W * 0.08) // space after the power stage for vo
  const totalW = W - x0 - pad - voGap
  const wPow = Math.max(116, totalW * 0.3)
  const powX = W - pad - voGap - wPow
  const compW = hysteretic ? Math.max(120, totalW * 0.32) : Math.max(104, totalW * 0.26)
  const compX = x0
  const compR = compX + compW

  // ── COMPENSATOR (mode-aware) ──
  if (hysteretic) {
    // a comparator with hysteresis — drives the gates DIRECTLY (no PWM).
    stageBox(ctx, compX, midY - blockH / 2, compW, blockH, 'COMPARATOR', `±Δ/2 = ±${(((s.ctl.band ?? 0) / 2) * 1e3).toFixed(0)} mV`, VIOLET)
    // tiny hysteresis glyph inside
    ctx.strokeStyle = '#cbd5e1'
    ctx.lineWidth = 1.25
    ctx.beginPath()
    ctx.moveTo(compX + 10, midY + 9)
    ctx.lineTo(compX + 22, midY + 9)
    ctx.lineTo(compX + 22, midY + 2)
    ctx.lineTo(compX + 34, midY + 2)
    ctx.stroke()
  } else {
    const title =
      s.controllerId === 'buck-typeiii'
        ? 'TYPE III  C(s)'
        : s.controllerId === 'buck-typeii'
          ? 'TYPE II  C(s)'
          : 'PID  C(s)'
    stageBox(ctx, compX, midY - blockH / 2, compW, blockH, title, cdef.summary(s.ctl), VIOLET)
  }
  // error signal in the gap between Σ and the compensator box
  d.line([[sumX + 12, midY], [compX, midY]])
  d.arrow(compX, midY, 'r')
  d.label((sumX + 12 + compX) / 2, midY - 9, `e=${err >= 0 ? '+' : ''}${(err * 1e3).toFixed(0)} mV`, '#e2e8f0')

  // ── PWM modulator (skipped in hysteretic mode — that's the lesson) ──
  let stageInX: number // where the wire enters the power stage
  if (!hysteretic) {
    const pwmW = Math.max(74, totalW * 0.16)
    const pwmX = (compR + powX) / 2 - pwmW / 2
    // Vc wire comp → PWM
    d.line([[compR, midY], [pwmX, midY]])
    d.arrow(pwmX, midY, 'r')
    d.label((compR + pwmX) / 2, midY - 9, `Vc`, VIOLET)
    stageBox(ctx, pwmX, midY - blockH / 2, pwmW, blockH, 'PWM', 'Vc/Vᵣₐₘₚ', SKY)
    // the explicit ×100 %→duty factor, called out under the box
    d.label(pwmX + pwmW / 2, midY + blockH / 2 + 14, '× 100  (%/duty)', '#7dd3fc')
    // sawtooth glyph above the PWM box
    ctx.strokeStyle = '#475569'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 0; i < 3; i++) {
      const sx = pwmX + 8 + i * 14
      ctx.moveTo(sx, midY - blockH / 2 - 4)
      ctx.lineTo(sx + 12, midY - blockH / 2 - 12)
      ctx.lineTo(sx + 12, midY - blockH / 2 - 4)
    }
    ctx.stroke()
    // duty wire PWM → power stage
    d.line([[pwmX + pwmW, midY], [powX, midY]])
    d.arrow(powX, midY, 'r')
    d.label((pwmX + pwmW + powX) / 2, midY - 9, `d=${duty.toFixed(0)}%`, AMBER)
    stageInX = pwmX + pwmW
  } else {
    // gate-drive wire straight from the comparator to the power stage — the
    // comparator IS the modulator. Measured switching frequency on the wire.
    const fsw = measuredFswHz()
    d.line([[compR, midY], [powX, midY]], AMBER)
    d.arrow(powX, midY, 'r', AMBER)
    d.label((compR + powX) / 2, midY - 16, `gates 0/100% direct`, AMBER)
    d.label(
      (compR + powX) / 2,
      midY - 4,
      fsw > 0 ? `fsw ≈ ${fsw >= 1000 ? (fsw / 1000).toFixed(1) + ' kHz' : fsw.toFixed(0) + ' Hz'}` : 'no carrier',
      '#fde68a',
    )
    stageInX = compR
  }
  void stageInX

  // ── POWER STAGE (QH/QL + LC + ESR), live Vin — a TALLER box so the glyph
  // and the Vin/fz labels don't crowd the title or the io arrow. ──
  const powH = blockH + 26
  stageBox(ctx, powX, midY - powH / 2, wPow, powH, 'POWER STAGE', '', '#cbd5e1')
  drawPowerGlyph(ctx, powX, midY, wPow, powH, duty, dist)

  // ── vo output branch (single readout, right of the box) ──
  const outX = W - pad
  d.line([[powX + wPow, midY], [outX, midY]], SKY)
  d.arrow(outX, midY, 'r', SKY)
  const err2 = Math.abs(vo - vref)
  d.label(
    (powX + wPow + outX) / 2 + 2,
    midY - 9,
    `vo ${vo.toFixed(2)} V`,
    err2 < 0.05 ? GREEN : err2 < 0.25 ? AMBER : '#f87171',
  )
  // branch dot near the output, down to the divider
  const branchX = outX - 4
  ctx.fillStyle = SKY
  ctx.beginPath()
  ctx.arc(branchX, midY, 3, 0, Math.PI * 2)
  ctx.fill()

  // ── io disturbance arrow into the power stage — enters at the upper-right
  // corner so it clears the centered POWER STAGE title. ──
  const dX = powX + wPow * 0.8
  d.line([[dX, midY - powH / 2 - 26], [dX, midY - powH / 2]], '#f87171')
  d.arrow(dX, midY - powH / 2, 'u', '#f87171')
  d.label(dX, midY - powH / 2 - 31, `io = ${dist.io.toFixed(1)} A`, '#f87171')

  // ── feedback divider / sense on the return row ──
  const divW = Math.max(120, totalW * 0.26)
  const divX = (sumX + branchX) / 2 - divW / 2
  d.line([[branchX, midY], [branchX, fbY], [divX + divW, fbY]], SKY)
  d.arrow(divX + divW, fbY, 'l', SKY)
  stageBox(
    ctx,
    divX,
    fbY - 16,
    divW,
    32,
    'FEEDBACK DIVIDER',
    s.noiseSigma > 0 ? `+ noise σ=${(s.noiseSigma * 1e3).toFixed(1)} mV` : 'Rfb1 / Rfb2 → Vfb',
    '#94a3b8',
  )
  // (vo is read out once, at the power-stage output — not duplicated here)
  // divider → Σ minus input
  d.line([[divX, fbY], [sumX, fbY], [sumX, midY + 12]])
  d.arrow(sumX, midY + 12, 'u')

  // ── live aux readout (iL) below the power-stage box ──
  d.label(powX + wPow / 2, midY + powH / 2 + 14, `iL = ${iL.toFixed(2)} A`, SKY)

  ctx.fillStyle = '#64748b'
  ctx.font = '9px ui-sans-serif, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(
    hysteretic
      ? 'Hysteretic (bang-bang): the comparator switches the FETs directly — no modulator, no carrier. fsw is set by the band Δ and the LC, not a clock.'
      : 'Voltage-mode: C(s) shapes the error into Vc; the PWM compares Vc to a ramp to make duty (the ×100 %→duty factor lives in C(s)); the power stage averages it to vo.',
    pad,
    H - 4,
  )
}

/** Mini synchronous-buck glyph inside the POWER STAGE box: QH, L, C+ESR, with
 *  the live Vin / fz labels on their own row below the glyph (no crowding). */
function drawPowerGlyph(
  ctx: CanvasRenderingContext2D,
  x: number,
  midY: number,
  w: number,
  h: number,
  duty: number,
  dist: BuckDisturbances,
) {
  const gy = midY - 2 // glyph row, just below the box title
  const x0 = x + 10
  // QH switch (fill by duty)
  ctx.fillStyle = `rgba(56,189,248,${0.12 + 0.5 * (duty / 100)})`
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(x0, gy - 6, 14, 12, 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#cbd5e1'
  ctx.font = '8px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.fillText('QH', x0 + 7, gy + 3)
  // inductor (little coil)
  const lx0 = x0 + 22
  ctx.strokeStyle = '#cbd5e1'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let i = 0; i < 3; i++) ctx.arc(lx0 + 4.3 * (i * 2 + 1), gy, 4.3, Math.PI, 0, false)
  ctx.stroke()
  ctx.fillStyle = '#64748b'
  ctx.fillText('L', lx0 + 13, gy - 8)
  // ESR + cap (amber — the star) to ground after L
  const cx0 = lx0 + 36
  ctx.strokeStyle = AMBER
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(cx0, gy - 6)
  for (let i = 0; i < 3; i++) ctx.lineTo(cx0 + (i % 2 === 0 ? 4 : -4), gy - 6 + (i + 1) * 3)
  ctx.stroke()
  // cap plates
  ctx.strokeStyle = SKY
  ctx.beginPath()
  ctx.moveTo(cx0 - 6, gy + 6)
  ctx.lineTo(cx0 + 6, gy + 6)
  ctx.moveTo(cx0 - 6, gy + 9)
  ctx.lineTo(cx0 + 6, gy + 9)
  ctx.stroke()
  // ── one centered label row along the bottom of the box (Vin · ESR · fz on
  // a single line, centered, so nothing competes for the same space) ──
  const ly = midY + h / 2 - 7
  ctx.font = '8.5px ui-monospace, monospace'
  ctx.textAlign = 'center'
  const cxBox = x + w / 2
  ctx.fillStyle = '#cbd5e1'
  ctx.fillText(
    `Vin ${dist.vin.toFixed(1)}V · ESR ${(dist.esr * 1e3).toFixed(0)}m · fz ${(esrZeroHz(dist.esr) / 1e3).toFixed(1)}k`,
    cxBox,
    ly,
  )
}
