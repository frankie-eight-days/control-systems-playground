import { useEffect, useRef } from 'react'
import { engine } from '../../state/engine'
import { useStore } from '../../state/store'
import { Kt, PMSM, radsToRpm, rpmToRads } from './model'
import { iqStarFromU } from './speedPlant'
import { vqFromU } from './torquePlant'

/**
 * FOC block diagram — the structurally-correct picture the generic single-loop
 * diagram can't draw. Mode-aware (torque = one current loop on a dyno; speed =
 * cascade with the inner current loop drawn as a nested, shaded region labeled
 * as the torque demo's loop). Live signal values on every wire; wires animate
 * at WALL-CLOCK rate (so flow speed is independent of the sim time scale).
 *
 * Canvas idioms (boxes, arrows, animated dashes, live sig labels) follow
 * ui/BlockDiagram.tsx — this is the same vocabulary, just the FOC topology.
 */
export function PmsmDiagram() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const wrap = wrapRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    const start = performance.now()

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
      const mode = s.scenarioId
      // wall-clock dash offset (flow rate independent of sim time scale)
      const dashOff = -(((performance.now() - start) / 1000) * 26) % 12

      const dctx: DCtx = { ctx, W, H, dashOff }
      if (mode === 'pmsm-speed') drawSpeed(dctx, s)
      else drawTorque(dctx, s)
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

/* ----------------------------- draw helpers ---------------------------- */

interface DCtx {
  ctx: CanvasRenderingContext2D
  W: number
  H: number
  dashOff: number
}

const WIRE = '#64748b'
const MONO = '11px ui-monospace, monospace'
const MONO_SM = '10px ui-monospace, monospace'

function wire(d: DCtx, pts: [number, number][], animated = true) {
  const { ctx } = d
  ctx.strokeStyle = WIRE
  ctx.lineWidth = 1.5
  ctx.setLineDash(animated ? [7, 5] : [])
  ctx.lineDashOffset = animated ? d.dashOff : 0
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (const [px, py] of pts.slice(1)) ctx.lineTo(px, py)
  ctx.stroke()
  ctx.setLineDash([])
}

/** Arrowhead pointing right (r), left (l), up (u), or down (dn). */
function arrow(d: DCtx, x: number, y: number, dir: 'r' | 'l' | 'u' | 'dn') {
  const { ctx } = d
  ctx.fillStyle = WIRE
  ctx.beginPath()
  if (dir === 'r') {
    ctx.moveTo(x, y)
    ctx.lineTo(x - 8, y - 4)
    ctx.lineTo(x - 8, y + 4)
  } else if (dir === 'l') {
    ctx.moveTo(x, y)
    ctx.lineTo(x + 8, y - 4)
    ctx.lineTo(x + 8, y + 4)
  } else if (dir === 'u') {
    ctx.moveTo(x, y)
    ctx.lineTo(x - 4, y + 8)
    ctx.lineTo(x + 4, y + 8)
  } else {
    ctx.moveTo(x, y)
    ctx.lineTo(x - 4, y - 8)
    ctx.lineTo(x + 4, y - 8)
  }
  ctx.closePath()
  ctx.fill()
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}
/** Rounded block with bold title + mono subtitle; returns its rect. */
function block(
  d: DCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  sub: string,
  opts: { fill?: string; stroke?: string; titleColor?: string } = {},
): Box {
  const { ctx } = d
  ctx.fillStyle = opts.fill ?? '#1e293b'
  ctx.strokeStyle = opts.stroke ?? '#94a3b8'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 4)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = opts.titleColor ?? '#e2e8f0'
  ctx.font = 'bold 11px ui-sans-serif, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (sub) {
    ctx.fillText(title, x + w / 2, y + h / 2 - 7)
    ctx.fillStyle = '#94a3b8'
    ctx.font = MONO_SM
    ctx.fillText(sub, x + w / 2, y + h / 2 + 8)
  } else {
    ctx.fillText(title, x + w / 2, y + h / 2)
  }
  ctx.textBaseline = 'alphabetic'
  return { x, y, w, h }
}

/** Summing junction circle with two labeled signs. */
function summer(d: DCtx, cx: number, cy: number, signTop = '+', signBot = '−') {
  const { ctx } = d
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(cx, cy, 12, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = '#cbd5e1'
  ctx.font = 'bold 13px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('Σ', cx, cy + 1)
  ctx.font = MONO_SM
  ctx.fillText(signTop, cx - 18, cy - 6)
  ctx.fillText(signBot, cx - 4, cy + 18)
  ctx.textBaseline = 'alphabetic'
}

/** Signal label centered at (x,y), above or below the wire. */
function sig(d: DCtx, x: number, y: number, text: string, color: string, above = true) {
  d.ctx.fillStyle = color
  d.ctx.font = MONO
  d.ctx.textAlign = 'center'
  d.ctx.fillText(text, x, above ? y - 8 : y + 16)
}

/** Small section caption (bottom-left). */
function caption(d: DCtx, lines: string[]) {
  const { ctx, H } = d
  ctx.font = MONO_SM
  ctx.textAlign = 'left'
  ctx.fillStyle = '#64748b'
  lines.forEach((l, i) => ctx.fillText(l, 12, H - 10 - (lines.length - 1 - i) * 13))
}

/* ------------------------------- TORQUE -------------------------------- */
function drawTorque(d: DCtx, s: ReturnType<typeof useStore.getState>) {
  const { ctx, W } = d
  const rpm = s.dist.dynoRpm ?? 0
  const decouple = s.dist.decouple ?? 1
  const vdc = s.dist.vdc ?? PMSM.Vdc
  const Tstar = s.setpoint
  const iqStar = Tstar / Kt // textbook current reference (= T*/Kt)
  const iq = engine.x.length > 1 ? engine.x[1] : 0
  const id = engine.x.length > 0 ? engine.x[0] : 0
  const uPct = engine.u
  const vq = vqFromU(uPct, vdc)
  const we = PMSM.p * rpmToRads(rpm)
  const vdFF = -decouple * we * PMSM.Lq * iq // live decoupling feedforward (V)

  const midY = d.H * 0.42
  const fbY = midY + Math.min(d.H * 0.32, 150)
  const bh = 42

  // x positions across the forward path. Right end reserves ~56 px for the
  // current-sensor tap + dyno so they never clip the panel edge.
  const x0 = 14
  const sumX = 58
  const piX = sumX + 24
  const piW = 60
  const ffJoinX = piX + piW + 24 // decoupling FF join (a small +)
  const invX = ffJoinX + 22
  const invW = Math.max(70, W * 0.12)
  const invpwmX = invX + invW + 20
  const pwmW = Math.max(80, W * 0.13)
  const motorX = invpwmX + pwmW + 20
  const motorW = Math.max(64, W * 0.095)
  const tapX = Math.min(W - 56, motorX + motorW + 28)

  // ---------- forward path ----------
  wire(d, [[x0, midY], [sumX - 12, midY]])
  arrow(d, sumX - 12, midY, 'r')
  sig(d, (x0 + sumX) / 2, midY, `i_q*=${iqStar.toFixed(2)}A`, '#34d399')
  ctx.fillStyle = '#94a3b8'
  ctx.font = MONO_SM
  ctx.textAlign = 'center'
  ctx.fillText(`T*=${Tstar.toFixed(2)} N·m ÷Kt`, (x0 + sumX) / 2, midY - 22)

  summer(d, sumX, midY)
  wire(d, [[sumX + 12, midY], [piX, midY]])
  arrow(d, piX, midY, 'r')
  block(d, piX, midY - bh / 2, piW, bh, 'PI', 'i_q→v_q')

  // decoupling feedforward join
  wire(d, [[piX + piW, midY], [ffJoinX - 6, midY]])
  arrow(d, ffJoinX - 6, midY, 'r')
  // small summing plus for the FF
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(ffJoinX, midY, 7, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = '#cbd5e1'
  ctx.font = MONO_SM
  ctx.textAlign = 'center'
  ctx.fillText('+', ffJoinX, midY + 3)
  // FF arrow coming up from below
  const ffY = midY + 46
  wire(d, [[ffJoinX, ffY], [ffJoinX, midY + 8]])
  arrow(d, ffJoinX, midY + 8, 'u')
  ctx.fillStyle = decouple > 0.01 ? '#a78bfa' : '#475569'
  ctx.font = MONO_SM
  ctx.textAlign = 'center'
  ctx.fillText(`v_d FF = ${vdFF.toFixed(1)} V`, ffJoinX, ffY + 12)
  ctx.fillText(`−d·ω_e·Lq·i_q`, ffJoinX, ffY + 24)
  ctx.fillStyle = '#64748b'
  ctx.fillText(`d=${decouple.toFixed(2)}`, ffJoinX, ffY + 36)

  // v_q wire into the inverse transform. Label is lifted above the block top
  // (the wire segment is short, so a normal in-line label would overlap it).
  wire(d, [[ffJoinX + 7, midY], [invX, midY]])
  arrow(d, invX, midY, 'r')
  ctx.fillStyle = '#fbbf24'
  ctx.font = MONO
  ctx.textAlign = 'center'
  ctx.fillText(`v_q=${vq.toFixed(1)}V`, invX + invW / 2, midY - bh / 2 - 8)

  block(d, invX, midY - bh / 2, invW, bh, 'dq → abc', 'inv Park/Clarke')
  wire(d, [[invX + invW, midY], [invpwmX, midY]])
  arrow(d, invpwmX, midY, 'r')
  sig(d, (invX + invW + invpwmX) / 2, midY, 'v_a v_b v_c', '#fbbf24')

  block(d, invpwmX, midY - bh / 2, pwmW, bh, 'SVPWM +', `inverter · Vdc=${vdc.toFixed(0)}V`)
  wire(d, [[invpwmX + pwmW, midY], [motorX, midY]])
  arrow(d, motorX, midY, 'r')

  block(d, motorX, midY - bh / 2, motorW, bh, 'PMSM', '3-φ', { stroke: '#38bdf8' })

  // shaft to the dyno + branch tap for current sensors
  wire(d, [[motorX + motorW, midY], [tapX, midY]])
  // branch dot
  ctx.fillStyle = WIRE
  ctx.beginPath()
  ctx.arc(tapX, midY, 3, 0, Math.PI * 2)
  ctx.fill()
  // shaft continues to dyno
  const dynoX = Math.min(W - 16, tapX + 16)
  wire(d, [[tapX, midY], [dynoX, midY]], false)
  drawDyno(d, dynoX, midY, rpm)

  // ---------- feedback path: tap → down → abc/dq → back to summer ----------
  const sensX = tapX
  wire(d, [[sensX, midY], [sensX, fbY]])
  // current-sensor tap label
  ctx.fillStyle = '#38bdf8'
  ctx.font = MONO_SM
  ctx.textAlign = 'center'
  ctx.fillText('i_a, i_b taps', sensX + 2, midY + 16)

  const dqX = (sumX + sensX) / 2 - Math.max(78, W * 0.13) / 2
  const dqW = Math.max(78, W * 0.13)
  wire(d, [[sensX, fbY], [dqX + dqW, fbY]])
  arrow(d, dqX + dqW, fbY, 'l')
  block(d, dqX, fbY - 20, dqW, 40, 'abc → αβ → dq', 'Clarke/Park')
  // θ_e (encoder) input into the transform from below
  const encY = fbY + 40
  wire(d, [[dqX + dqW / 2, encY], [dqX + dqW / 2, fbY + 20]])
  arrow(d, dqX + dqW / 2, fbY + 20, 'u')
  ctx.fillStyle = '#a78bfa'
  ctx.font = MONO_SM
  ctx.fillText('θ_e (encoder)', dqX + dqW / 2, encY + 12)

  // i_q feedback up to the summer (−)
  wire(d, [[dqX, fbY], [sumX, fbY], [sumX, midY + 12]])
  arrow(d, sumX, midY + 12, 'u')
  sig(d, (dqX + sumX) / 2, fbY, `i_q=${iq.toFixed(2)}A`, '#34d399', false)
  // i_d readout (decoupling quality) hanging off the transform
  ctx.fillStyle = '#a78bfa'
  ctx.font = MONO_SM
  ctx.textAlign = 'left'
  ctx.fillText(`i_d=${id.toFixed(2)}A`, dqX, fbY - 26)

  caption(d, [
    'FOC current loop on a dynamometer. The PI acts on torque error T*−T = Kt·(i_q*−i_q): same loop, drawn in the textbook i_q form.',
    'Decoupling FF (d=1) cancels the ω_e·Lq·i_q cross-term so i_d≈0. The dq↔abc transforms are the heart of FOC; the encoder angle θ_e drives both.',
  ])
}

/* -------------------------------- SPEED -------------------------------- */
function drawSpeed(d: DCtx, s: ReturnType<typeof useStore.getState>) {
  const { ctx, W } = d
  const wStar = s.setpoint // rpm
  const iqStar = iqStarFromU(engine.u) // inner current command from outer PI
  const iq = engine.x.length > 0 ? engine.x[0] : 0
  const wm = engine.x.length > 1 ? engine.x[1] : 0
  const rpm = radsToRpm(wm)
  const jmult = s.dist.jmult ?? 1
  const tload = s.dist.tload ?? 0

  const midY = d.H * 0.40
  const fbY = midY + Math.min(d.H * 0.36, 160)
  const bh = 42

  const x0 = 14
  const sumX = 50
  const piX = sumX + 22
  const piW = 58
  const encW = Math.max(54, W * 0.085)
  // Lay out right-to-left so the encoder tap always fits the panel: reserve
  // its half-width at the right edge, then place the shaft and nested region.
  const encX = W - 14 - encW / 2
  const shaftW = Math.max(56, W * 0.085)
  const shaftX = encX - encW / 2 - 20 - shaftW
  const nestX = piX + piW + 22
  const nestW = shaftX - 20 - nestX
  const nestY = midY - 58
  const nestH = 116

  // ---------- outer forward path ----------
  wire(d, [[x0, midY], [sumX - 12, midY]])
  arrow(d, sumX - 12, midY, 'r')
  sig(d, (x0 + sumX) / 2, midY, `ω*=${wStar.toFixed(0)}rpm`, '#4ade80')
  summer(d, sumX, midY)
  wire(d, [[sumX + 12, midY], [piX, midY]])
  arrow(d, piX, midY, 'r')
  block(d, piX, midY - bh / 2, piW, bh, 'speed PI', 'ω → i_q*')

  wire(d, [[piX + piW, midY], [nestX, midY]])
  arrow(d, nestX, midY, 'r')
  sig(d, (piX + piW + nestX) / 2, midY, `i_q*=${iqStar.toFixed(2)}A`, '#34d399')

  // ---------- nested inner current loop (shaded region) ----------
  ctx.fillStyle = 'rgba(56,189,248,0.07)'
  ctx.strokeStyle = 'rgba(56,189,248,0.5)'
  ctx.lineWidth = 1.25
  ctx.setLineDash([4, 3])
  ctx.beginPath()
  ctx.roundRect(nestX, nestY, nestW, nestH, 6)
  ctx.fill()
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = '#7dd3fc'
  ctx.font = 'bold 10px ui-sans-serif, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('inner current loop — the torque demo’s loop, τᵢ ≈ 0.3 ms', nestX + 8, nestY + 14)

  // compact inner loop: Σ → [PI] → [dq→abc+inv] → [PMSM] → i_q fb. The three
  // block widths are carved from the nest interior (after fixed summer + gaps)
  // so the chain ALWAYS fits regardless of panel width.
  const inY = midY + 8
  const ibh = 36
  const isumX = nestX + 18
  const ipiX = isumX + 16
  const gap = 10
  const interior = nestX + nestW - 10 - ipiX // space for 3 blocks + 2 gaps
  const blocksW = interior - 2 * gap
  const ipiW = blocksW * 0.26
  const ivW = blocksW * 0.46
  const imW = blocksW * 0.28
  const ivX = ipiX + ipiW + gap
  const imX = ivX + ivW + gap

  wire(d, [[nestX, inY], [isumX - 11, inY]])
  arrow(d, isumX - 11, inY, 'r')
  summer(d, isumX, inY)
  wire(d, [[isumX + 12, inY], [ipiX, inY]])
  arrow(d, ipiX, inY, 'r')
  block(d, ipiX, inY - ibh / 2, ipiW, ibh, 'PI', '')
  wire(d, [[ipiX + ipiW, inY], [ivX, inY]])
  arrow(d, ivX, inY, 'r')
  block(d, ivX, inY - ibh / 2, ivW, ibh, 'dq→abc', 'SVPWM+inv')
  wire(d, [[ivX + ivW, inY], [imX, inY]])
  arrow(d, imX, inY, 'r')
  block(d, imX, inY - ibh / 2, imW, ibh, 'PMSM', 'τ', { stroke: '#38bdf8' })
  // inner feedback (i_q) along the bottom of the nest
  const ifbY = nestY + nestH - 12
  ctx.fillStyle = WIRE
  ctx.beginPath()
  ctx.arc(imX + imW, inY, 3, 0, Math.PI * 2)
  ctx.fill()
  wire(d, [[imX + imW, inY], [imX + imW, ifbY], [isumX, ifbY], [isumX, inY + 12]])
  arrow(d, isumX, inY + 12, 'u')
  sig(d, (isumX + imX) / 2, ifbY, `i_q=${iq.toFixed(2)}A`, '#34d399', false)

  // ---------- nest output: torque to the shaft ----------
  wire(d, [[nestX + nestW, midY], [shaftX, midY]])
  arrow(d, shaftX, midY, 'r')
  sig(d, (nestX + nestW + shaftX) / 2, midY, `T=${(Kt * iq).toFixed(2)}`, '#e2e8f0')

  block(d, shaftX, midY - bh / 2, shaftW, bh, 'shaft', 'J·dω/dt', { stroke: '#94a3b8' })
  drawFlywheelBadge(d, shaftX + shaftW / 2, midY - bh / 2 - 8, jmult)
  // load torque into the shaft
  if (Math.abs(tload) > 0.005) {
    const tY = midY + bh / 2 + 30
    wire(d, [[shaftX + shaftW / 2, tY], [shaftX + shaftW / 2, midY + bh / 2]])
    arrow(d, shaftX + shaftW / 2, midY + bh / 2, 'u')
    ctx.fillStyle = tload > 0 ? '#f87171' : '#4ade80'
    ctx.font = MONO_SM
    ctx.textAlign = 'center'
    ctx.fillText(`T_load=${tload >= 0 ? '+' : ''}${tload.toFixed(2)}`, shaftX + shaftW / 2, tY + 12)
  }

  // shaft → encoder → ω feedback
  wire(d, [[shaftX + shaftW, midY], [encX, midY]])
  ctx.fillStyle = WIRE
  ctx.beginPath()
  ctx.arc(encX, midY, 3, 0, Math.PI * 2)
  ctx.fill()
  // encoder block hanging below the tap
  const encBoxY = fbY - 20
  wire(d, [[encX, midY], [encX, encBoxY]])
  block(d, encX - encW / 2, encBoxY, encW, 40, 'encoder', 'θ, ω')
  // ω feedback back to the outer summer
  wire(d, [[encX - encW / 2, encBoxY + 20], [sumX, encBoxY + 20], [sumX, midY + 12]])
  arrow(d, sumX, midY + 12, 'u')
  sig(d, (sumX + encX) / 2, encBoxY + 20, `ω=${rpm.toFixed(0)} rpm`, '#38bdf8', false)

  caption(d, [
    'Cascade: the outer speed PI commands i_q*, and the SHADED inner loop is the torque demo’s current loop modeled as a τᵢ≈0.3 ms lag.',
    'A loop within a loop — design the inner fast, then close the outer a decade slower (the separation rule on the speed theory panel).',
  ])
}

/* ------------------------------ vignettes ------------------------------ */

/** Dyno brake on the shaft (torque mode). */
function drawDyno(d: DCtx, x: number, y: number, rpm: number) {
  const { ctx } = d
  ctx.fillStyle = '#52525b'
  ctx.beginPath()
  ctx.roundRect(x - 8, y - 16, 20, 32, 3)
  ctx.fill()
  ctx.fillStyle = rpm > 5 ? '#f59e0b' : '#71717a'
  ctx.beginPath()
  ctx.roundRect(x - 4, y - 12, 12, 24, 2)
  ctx.fill()
  ctx.fillStyle = '#cbd5e1'
  ctx.font = MONO_SM
  ctx.textAlign = 'center'
  ctx.fillText('DYNO', x + 2, y - 20)
  ctx.fillStyle = '#f59e0b'
  ctx.fillText(`${rpm.toFixed(0)} rpm`, x + 2, y + 28)
}

/** Flywheel mass badge scaling with jmult (speed mode). */
function drawFlywheelBadge(d: DCtx, x: number, y: number, jmult: number) {
  const { ctx } = d
  const r = 6 + 3 * Math.sqrt(jmult)
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = 2 + Math.sqrt(jmult)
  ctx.globalAlpha = 0.6
  ctx.beginPath()
  ctx.arc(x, y - r, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.fillStyle = '#94a3b8'
  ctx.font = MONO_SM
  ctx.textAlign = 'center'
  ctx.fillText(`J×${jmult.toFixed(1)}`, x, y - 2 * r - 4)
}
