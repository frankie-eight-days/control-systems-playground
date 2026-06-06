import { useEffect, useRef } from 'react'
import { engine } from '../../state/engine'
import { useStore } from '../../state/store'
import { synthNetwork, type CompensatorNetwork } from './compensatorNetwork'
import { buckPlant, esrZeroHz, type BuckDisturbances } from './plant'

const WIRE = '#475569'
const NODE = '#94a3b8'
const SKY = '#38bdf8'
const AMBER = '#fbbf24'
const GREEN = '#4ade80'
const VIOLET = '#a78bfa' // compensator / feedback network accent
const MONO = '11px ui-monospace, monospace'

/** Scenes may write disturbances (load steps, cap swaps) via the store. */
function setDist(patch: Record<string, number>) {
  const s = useStore.getState()
  s.set({ dist: { ...s.dist, ...patch } })
}
const loadStep = (dA: number) =>
  setDist({ io: Math.min(8, Math.max(0.2, (useStore.getState().dist.io ?? 2) + dA)) })
/** Toggle between the two cap personalities (threshold = geometric mean). */
const capSwap = () =>
  setDist({ esr: (useStore.getState().dist.esr ?? 0.05) > 0.0158 ? 0.005 : 0.05 })

/** Draw helpers passed in from the rAF closure (they capture ctx). */
interface DrawHelpers {
  wire: (pts: [number, number][]) => void
  dot: (x: number, y: number, r?: number, c?: string) => void
  label: (
    text: string,
    x: number,
    y: number,
    color?: string,
    align?: CanvasTextAlign,
    font?: string,
  ) => void
}

interface FeedbackArgs extends DrawHelpers {
  W: number
  H: number
  yFb: number
  xVo: number
  yTop: number
  xHS: number
  net: CompensatorNetwork
  ref: number
}

/**
 * The feedback half of the schematic: vo sense → error amplifier with the live
 * compensator network → PWM → gate drive. For Type II/III the actual op-amp RC
 * network is drawn with synthesized component values; for PID a generic C(s)
 * box; for the hysteretic controller a comparator with its ±ΔV/2 band.
 */
function drawFeedback(ctx: CanvasRenderingContext2D, a: FeedbackArgs) {
  const { W, yFb, xVo, yTop, xHS, net, ref, wire, dot, label } = a
  const small = '10px ui-monospace, monospace'
  const part = (name: string) => net.parts.find((p) => p.name === name)?.value ?? '—'

  // Section header + a thin separator rule above the feedback band.
  ctx.strokeStyle = '#1e293b'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(12, yFb - 56)
  ctx.lineTo(W * 0.62, yFb - 56)
  ctx.stroke()
  label('FEEDBACK / COMPENSATOR', 12, yFb - 60, VIOLET, 'left', 'bold 11px ui-monospace, monospace')

  // Horizontal flow:  vo → divider → R1 → (−)op-amp(+)←Vref → Vc → PWM → gates.
  const xDiv = W * 0.1 // sense divider
  const xAmp = W * 0.34 // op-amp apex input plane
  const ampOut = xAmp + 28
  const xPwm = W * 0.52
  const yRail = yFb // inverting-input rail
  const yFbBranch = yFb - 30 // feedback (Zf) rail, above the op-amp

  // small horizontal resistor symbol centered at (cx,cy) of width w
  const resH = (cx0: number, cy0: number, w: number, color = VIOLET) => {
    ctx.strokeStyle = color
    ctx.lineWidth = 1.6
    ctx.strokeRect(cx0 - w / 2, cy0 - 5, w, 10)
  }
  // capacitor (two plates) centered at (cx,cy), gap horizontal
  const capH = (cx0: number, cy0: number, color = VIOLET) => {
    ctx.strokeStyle = color
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.moveTo(cx0 - 2, cy0 - 6)
    ctx.lineTo(cx0 - 2, cy0 + 6)
    ctx.moveTo(cx0 + 2, cy0 - 6)
    ctx.lineTo(cx0 + 2, cy0 + 6)
    ctx.stroke()
  }

  // --- vo sense tap: from the vo node down and left to the divider top ---
  wire([
    [xVo, yTop],
    [xVo, yFb - 46],
    [xDiv, yFb - 46],
    [xDiv, yFb - 24],
  ])
  dot(xVo, yTop, 3, VIOLET)
  label('vo sense', xDiv - 4, yFb - 50, '#94a3b8', 'left', small)

  // --- divider Rfb1/Rfb2 → fb node on the rail (fixed 2:1-ish for ~vo·Rfb2/(Rfb1+Rfb2)) ---
  resH(xDiv, yFb - 16, 16)
  ctx.strokeStyle = VIOLET
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(xDiv, yFb - 11)
  ctx.lineTo(xDiv, yRail)
  ctx.stroke()
  dot(xDiv, yRail, 3, VIOLET)
  resH(xDiv, yRail + 14, 16)
  ctx.beginPath()
  ctx.moveTo(xDiv, yRail + 19)
  ctx.lineTo(xDiv, yRail + 30)
  ctx.stroke()
  ctx.strokeStyle = WIRE
  ctx.beginPath()
  ctx.moveTo(xDiv - 6, yRail + 30)
  ctx.lineTo(xDiv + 6, yRail + 30)
  ctx.stroke()

  if (net.kind === 'typeii' || net.kind === 'typeiii') {
    // input rail: fb node → R1 → (−) input. Plenty of room now.
    const xR1 = (xDiv + xAmp) / 2
    wire([[xDiv, yRail], [xR1 - 12, yRail]])
    resH(xR1, yRail, 24)
    label('R1', xR1, yRail - 9, VIOLET, 'center', small)
    const xIn = xAmp - 14
    wire([[xR1 + 12, yRail], [xIn, yRail], [xIn, yFb - 6], [xAmp, yFb - 6]])
    dot(xIn, yRail, 2.5, VIOLET)

    // Type III: R3–C3 series to ground, tapped between R1 and the op-amp so it
    // sits clear of the op-amp's + / Vref labels (2nd zero/pole pair).
    if (net.kind === 'typeiii') {
      const xB = xR1 + 22
      dot(xB, yRail, 2.5, VIOLET)
      ctx.strokeStyle = VIOLET
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(xB, yRail)
      ctx.lineTo(xB, yRail + 6)
      ctx.stroke()
      ctx.strokeRect(xB - 5, yRail + 6, 10, 14) // R3 (vertical)
      capH(xB, yRail + 28)
      label('R3', xB - 9, yRail + 16, VIOLET, 'right', small)
      label('C3', xB - 9, yRail + 31, VIOLET, 'right', small)
      ctx.strokeStyle = VIOLET
      ctx.beginPath()
      ctx.moveTo(xB, yRail + 20)
      ctx.lineTo(xB, yRail + 22)
      ctx.stroke()
      ctx.strokeStyle = WIRE
      ctx.beginPath()
      ctx.moveTo(xB - 6, yRail + 36)
      ctx.lineTo(xB + 6, yRail + 36)
      ctx.stroke()
    }

    drawOpAmp(ctx, xAmp, yFb, wire, label)

    // --- Zf feedback branch: (−) input → R2 — C1 series, C2 across, → output ---
    const xR2 = xAmp - 2
    const xC1 = ampOut - 6
    wire([[xAmp, yFb - 6], [xAmp - 8, yFb - 6], [xAmp - 8, yFbBranch], [xC1 + 8, yFbBranch], [ampOut, yFbBranch], [ampOut, yFb]])
    resH(xR2, yFbBranch, 22)
    label('R2', xR2, yFbBranch - 9, VIOLET, 'center', small)
    capH(xC1, yFbBranch)
    label('C1', xC1, yFbBranch + 13, VIOLET, 'center', small)
    // C2 across, on a higher rail
    const yC2 = yFbBranch - 16
    wire([[xAmp - 8, yFbBranch], [xAmp - 8, yC2], [xC1 + 8, yC2], [xC1 + 8, yFbBranch]])
    capH((xAmp - 8 + xC1 + 8) / 2, yC2)
    label('C2', (xAmp - 8 + xC1 + 8) / 2, yC2 - 8, VIOLET, 'center', small)
    dot(ampOut, yFbBranch, 2.5, VIOLET)

    label(`Vref ${ref.toFixed(2)} V`, xAmp + 14, yFb + 24, '#64748b', 'center', small)
    label(
      net.kind === 'typeiii' ? 'Type III error amp' : 'Type II error amp',
      xAmp + 14,
      yFb + 38,
      VIOLET,
      'center',
      small,
    )
  } else {
    drawOpAmp(ctx, xAmp, yFb, wire, label)
    wire([[xDiv, yRail], [xAmp - 14, yRail], [xAmp - 14, yFb - 6], [xAmp, yFb - 6]])
    const bx = (xDiv + xAmp) / 2
    ctx.strokeStyle = VIOLET
    ctx.lineWidth = 1.6
    ctx.strokeRect(bx - 34, yFb - 35, 68, 24)
    if (net.kind === 'pid') {
      label('C(s) = PID', bx, yFb - 19, VIOLET, 'center', small)
      label('digital — no passive RC; see C tab', xDiv - 4, yFb + 34, '#64748b', 'left', small)
    } else {
      label('comparator', bx, yFb - 23, VIOLET, 'center', small)
      label(`±${(parseFloat(part('ΔV')) / 2).toFixed(0)} mV hyst`, bx, yFb - 13, '#cbd5e1', 'center', small)
      label('hysteretic (bang-bang) control', xDiv - 4, yFb + 34, '#64748b', 'left', small)
    }
  }

  // --- Vc → PWM block → gate drive back up to the FETs ---
  wire([[ampOut, yFb], [xPwm - 22, yFb]])
  label('Vc', ampOut + 4, yFb - 5, VIOLET, 'left', small)
  ctx.strokeStyle = SKY
  ctx.lineWidth = 1.6
  ctx.strokeRect(xPwm - 22, yFb - 14, 44, 28)
  label('PWM', xPwm, yFb - 1, SKY, 'center', small)
  label('Vc/Vᵣₐₘₚ', xPwm, yFb + 11, '#64748b', 'center', small)
  // sawtooth glyph above the PWM box
  ctx.strokeStyle = '#475569'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i < 3; i++) {
    const x0 = xPwm - 18 + i * 12
    ctx.moveTo(x0, yFb - 17)
    ctx.lineTo(x0 + 10, yFb - 25)
    ctx.lineTo(x0 + 10, yFb - 17)
  }
  ctx.stroke()
  // gate-drive (dashed) closes the loop: PWM → up → across to QH gate.
  const yGate = yTop - 30
  ctx.strokeStyle = SKY
  ctx.lineWidth = 1.4
  ctx.setLineDash([4, 3])
  ctx.beginPath()
  ctx.moveTo(xPwm + 22, yFb)
  ctx.lineTo(xPwm + 22, yGate)
  ctx.lineTo(xHS, yGate)
  ctx.lineTo(xHS, yTop - 11)
  ctx.stroke()
  ctx.setLineDash([])
  // Label sits on the vertical gate-drive riser, well right of the vo readout.
  label('gate drive', xPwm + 26, yFb - 18, SKY, 'left', small)
  label('(QL inverted)', xPwm + 26, yFb - 6, '#64748b', 'left', small)

  // --- component VALUE legend row (keeps the schematic itself uncluttered) ---
  const vals = net.parts.map((p) => `${p.name} ${p.value}`).join('   ')
  if (vals) label(vals, 12, yFb + 50, '#7dd3fc', 'left', small)
}

/** The op-amp triangle with its − (Zin) and + (Vref) inputs. */
function drawOpAmp(
  ctx: CanvasRenderingContext2D,
  xAmp: number,
  yFb: number,
  wire: DrawHelpers['wire'],
  label: DrawHelpers['label'],
) {
  const ampH = 32
  const small = '10px ui-monospace, monospace'
  ctx.strokeStyle = NODE
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.moveTo(xAmp, yFb - ampH / 2)
  ctx.lineTo(xAmp, yFb + ampH / 2)
  ctx.lineTo(xAmp + 28, yFb)
  ctx.closePath()
  ctx.stroke()
  label('−', xAmp + 4, yFb - 5, '#e2e8f0', 'left', small)
  label('+', xAmp + 4, yFb + 11, '#e2e8f0', 'left', small)
  // + input tied to the reference; the value is captioned below the op-amp
  // (drawn by the caller) so nothing crowds the input nodes.
  wire([[xAmp - 9, yFb + 10], [xAmp, yFb + 10]])
}

/**
 * Datasheet-figure schematic: Vin source, synchronous FET pair with live
 * duty, inductor with an iL current arrow, output cap drawn WITH its ESR
 * (the star of the scenario, in amber), current-source load, vo readout,
 * plus the feedback path with the live op-amp compensator network.
 */
export function BuckScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const esrNow = useStore((s) => s.dist.esr ?? 0.05)
  const electro = esrNow > 0.0158

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

      const p = useStore.getState()
      if (engine.x.length < 2) return
      const d: BuckDisturbances = {
        io: p.dist.io ?? 2,
        vin: p.dist.vin ?? 12,
        esr: p.dist.esr ?? 0.05,
      }
      const iL = engine.x[0]
      const vo = buckPlant.vout(engine.x, d)
      const duty = engine.u
      const t = engine.t
      const net = synthNetwork(p.controllerId, p.ctl)

      // ----- layout -----
      // Power stage in the upper band; feedback/compensator network below it.
      const yTop = H * 0.24
      const yBot = H * 0.52
      const yMid = (yTop + yBot) / 2
      const yFb = H * 0.80 // feedback-path rail (op-amp + RC network sit here)
      const xVin = Math.max(40, W * 0.07)
      const xHS = W * 0.195 // high-side FET center
      const xSW = W * 0.3
      const xLa = xSW + 16
      const xLb = W * 0.52
      const xVo = W * 0.555
      const xCap = W * 0.655
      const xLoad = Math.min(W - 46, W * 0.87)

      const wire = (pts: [number, number][]) => {
        ctx.strokeStyle = WIRE
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1])
        for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y)
        ctx.stroke()
      }
      const dot = (x: number, y: number, r = 3, c = NODE) => {
        ctx.fillStyle = c
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
      const label = (
        text: string,
        x: number,
        y: number,
        color = '#cbd5e1',
        align: CanvasTextAlign = 'center',
        font = MONO,
      ) => {
        ctx.fillStyle = color
        ctx.font = font
        ctx.textAlign = align
        ctx.fillText(text, x, y)
      }

      // ----- rails -----
      wire([
        [xVin, yTop],
        [xHS - 22, yTop],
      ])
      wire([
        [xHS + 22, yTop],
        [xLa, yTop],
      ])
      wire([
        [xLb, yTop],
        [xLoad, yTop],
      ])
      wire([
        [xVin, yBot],
        [xLoad, yBot],
      ])
      // ground symbol mid-rail
      const xG = (xVin + xLoad) / 2
      ctx.strokeStyle = WIRE
      ctx.lineWidth = 2
      for (let i = 0; i < 3; i++) {
        ctx.beginPath()
        ctx.moveTo(xG - 9 + i * 3, yBot + 4 + i * 3.5)
        ctx.lineTo(xG + 9 - i * 3, yBot + 4 + i * 3.5)
        ctx.stroke()
      }

      // ----- Vin source -----
      wire([
        [xVin, yTop],
        [xVin, yMid - 15],
      ])
      wire([
        [xVin, yMid + 15],
        [xVin, yBot],
      ])
      ctx.strokeStyle = NODE
      ctx.lineWidth = 1.8
      ctx.beginPath()
      ctx.arc(xVin, yMid, 15, 0, Math.PI * 2)
      ctx.stroke()
      label('+', xVin, yMid - 3.5, '#e2e8f0')
      label('−', xVin, yMid + 9, '#e2e8f0')
      label(`Vin ${d.vin.toFixed(1)} V`, xVin, yMid + 32, '#cbd5e1')

      // ----- FET helper -----
      const fet = (
        cx0: number,
        cy0: number,
        horiz: boolean,
        on01: number,
        name: string,
        dlabel: string,
      ) => {
        const w = horiz ? 44 : 24
        const h = horiz ? 22 : 44
        ctx.fillStyle = `rgba(56, 189, 248, ${0.06 + 0.5 * on01})`
        ctx.strokeStyle = NODE
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.roundRect(cx0 - w / 2, cy0 - h / 2, w, h, 3)
        ctx.fill()
        ctx.stroke()
        // gate stub
        ctx.beginPath()
        if (horiz) {
          ctx.moveTo(cx0, cy0 - h / 2)
          ctx.lineTo(cx0, cy0 - h / 2 - 7)
          ctx.moveTo(cx0 - 7, cy0 - h / 2 - 7)
          ctx.lineTo(cx0 + 7, cy0 - h / 2 - 7)
        } else {
          ctx.moveTo(cx0 + w / 2, cy0)
          ctx.lineTo(cx0 + w / 2 + 7, cy0)
          ctx.moveTo(cx0 + w / 2 + 7, cy0 - 7)
          ctx.lineTo(cx0 + w / 2 + 7, cy0 + 7)
        }
        ctx.stroke()
        label(name, cx0, cy0 + 4, '#e2e8f0', 'center', 'bold 11px ui-monospace, monospace')
        if (horiz) label(dlabel, cx0, cy0 - h / 2 - 13, SKY)
        else label(dlabel, cx0 + w / 2 + 13, cy0 + 4, SKY, 'left')
      }
      fet(xHS, yTop, true, duty / 100, 'QH', `D = ${duty.toFixed(1)}%`)
      // low-side FET, SW node down to ground
      wire([
        [xSW, yTop],
        [xSW, yMid - 22],
      ])
      wire([
        [xSW, yMid + 22],
        [xSW, yBot],
      ])
      fet(xSW, yMid, false, 1 - duty / 100, 'QL', `${(100 - duty).toFixed(1)}%`)
      dot(xSW, yTop)
      label('SW', xSW - 10, yTop - 8, '#64748b', 'right')

      // ----- inductor -----
      const nBump = 4
      const bw = (xLb - xLa) / nBump
      ctx.strokeStyle = '#cbd5e1'
      ctx.lineWidth = 2
      ctx.beginPath()
      for (let i = 0; i < nBump; i++) {
        ctx.arc(xLa + bw * (i + 0.5), yTop, bw / 2, Math.PI, 0, false)
      }
      ctx.stroke()
      label('L 22 µH · DCR 20 mΩ', xLa - 4, yTop - 16, '#94a3b8', 'left')

      // iL arrow under the inductor: thickness ∝ |iL|, direction = sign
      const aY = yTop + 15
      const mag = Math.min(Math.abs(iL) / 8, 1)
      const aw = 1 + 6 * mag
      ctx.strokeStyle = SKY
      ctx.fillStyle = SKY
      ctx.lineWidth = aw
      ctx.setLineDash([7, 5])
      ctx.lineDashOffset = -((t * 1.2e4 * Math.sign(iL) * (0.2 + mag)) % 12)
      ctx.beginPath()
      ctx.moveTo(xLa + 6, aY)
      ctx.lineTo(xLb - 10, aY)
      ctx.stroke()
      ctx.setLineDash([])
      const hx = iL >= 0 ? xLb - 10 : xLa + 6
      const hs = iL >= 0 ? 1 : -1
      ctx.beginPath()
      ctx.moveTo(hx + hs * (4 + aw), aY)
      ctx.lineTo(hx, aY - 3.5 - aw)
      ctx.lineTo(hx, aY + 3.5 + aw)
      ctx.closePath()
      ctx.fill()
      label(`iL = ${iL.toFixed(2)} A`, (xLa + xLb) / 2, aY + 17, SKY)

      // ----- vo node + readout -----
      dot(xVo, yTop, 4, GREEN)
      const err = Math.abs(vo - p.setpoint)
      label(
        `vo = ${vo.toFixed(3)} V`,
        xVo + 10,
        yTop - 36,
        err < 0.05 ? GREEN : err < 0.25 ? AMBER : '#f87171',
        'left',
        'bold 14px ui-monospace, monospace',
      )
      label(`ref ${p.setpoint.toFixed(2)} V`, xVo + 10, yTop - 22, '#64748b', 'left')

      // ----- output cap with ESR (the star) -----
      const yE0 = yTop + 14 // ESR zigzag top
      const yE1 = yE0 + 30
      const yC0 = yE1 + 10 // cap plates
      wire([
        [xCap, yTop],
        [xCap, yE0],
      ])
      dot(xCap, yTop)
      ctx.save()
      ctx.strokeStyle = AMBER
      ctx.lineWidth = 2.2
      ctx.shadowColor = AMBER
      ctx.shadowBlur = 7
      ctx.beginPath()
      ctx.moveTo(xCap, yE0)
      const nz = 6
      for (let i = 0; i < nz; i++) {
        const yy = yE0 + ((i + 0.5) * (yE1 - yE0)) / nz
        ctx.lineTo(xCap + (i % 2 === 0 ? 7 : -7), yy)
      }
      ctx.lineTo(xCap, yE1)
      ctx.stroke()
      ctx.restore()
      label(`ESR ${(d.esr * 1e3).toFixed(0)} mΩ`, xCap + 14, yE0 + 13, AMBER, 'left', 'bold 11px ui-monospace, monospace')
      label(`fz = ${(esrZeroHz(d.esr) / 1e3).toFixed(1)} kHz`, xCap + 14, yE0 + 27, '#d6a428', 'left')
      // plates
      wire([
        [xCap, yE1],
        [xCap, yC0],
      ])
      ctx.strokeStyle = SKY
      ctx.lineWidth = 2.5
      for (const yy of [yC0, yC0 + 7]) {
        ctx.beginPath()
        ctx.moveTo(xCap - 11, yy)
        ctx.lineTo(xCap + 11, yy)
        ctx.stroke()
      }
      wire([
        [xCap, yC0 + 7],
        [xCap, yBot],
      ])
      label('C 470 µF', xCap + 14, yC0 + 4, '#94a3b8', 'left')
      label(d.esr > 0.0158 ? 'electrolytic' : 'ceramic', xCap + 14, yC0 + 17, '#64748b', 'left')

      // ----- load (current source) -----
      wire([
        [xLoad, yTop],
        [xLoad, yMid - 13],
      ])
      wire([
        [xLoad, yMid + 13],
        [xLoad, yBot],
      ])
      dot(xLoad, yTop)
      ctx.strokeStyle = NODE
      ctx.lineWidth = 1.8
      ctx.beginPath()
      ctx.arc(xLoad, yMid, 13, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(xLoad, yMid - 7)
      ctx.lineTo(xLoad, yMid + 5)
      ctx.stroke()
      ctx.fillStyle = NODE
      ctx.beginPath()
      ctx.moveTo(xLoad, yMid + 8)
      ctx.lineTo(xLoad - 4, yMid + 1)
      ctx.lineTo(xLoad + 4, yMid + 1)
      ctx.closePath()
      ctx.fill()
      label(`io = ${d.io.toFixed(1)} A`, xLoad, yMid + 32, '#f87171')
      label('load', xLoad, yMid + 45, '#64748b')

      // ----- feedback path + compensator network (the datasheet payoff) -----
      // vo tap → resistor divider → error amp (op-amp) with the live Type II/III
      // RC network → PWM → back up to the gate drive. Component values are
      // synthesized from the active controller's sliders (compensatorNetwork.ts).
      drawFeedback(ctx, { W, H, yFb, xVo, yTop, xHS, net, ref: p.setpoint, wire, dot, label })

      // ----- annotations -----
      label(`D·Vin = ${((duty / 100) * d.vin).toFixed(2)} V`, 12, 20, '#94a3b8', 'left')
      label('(= vo + DCR·io in steady state)', 12, 34, '#64748b', 'left', '10px ui-monospace, monospace')
      label(
        'cycle-averaged model — ripple not drawn',
        12,
        48,
        '#475569',
        'left',
        '10px ui-monospace, monospace',
      )
      label(`t = ${(t * 1e3).toFixed(2)} ms (sim)`, W - 10, H - 8, '#64748b', 'right')
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas ref={canvasRef} />
      <div className="absolute right-2 top-2 flex flex-wrap justify-end gap-1.5">
        <button
          className="rounded bg-sky-900/70 px-2 py-1 text-xs text-sky-200 hover:bg-sky-800"
          title="Step the load current up 2 A — the classic transient test"
          onClick={() => loadStep(2)}
        >
          load +2 A
        </button>
        <button
          className="rounded bg-sky-900/70 px-2 py-1 text-xs text-sky-200 hover:bg-sky-800"
          title="Release 2 A of load"
          onClick={() => loadStep(-2)}
        >
          −2 A
        </button>
        <button
          className="rounded bg-amber-900/70 px-2 py-1 text-xs text-amber-200 hover:bg-amber-800"
          title="Swap the output capacitor — same C, very different ESR (and ESR zero!)"
          onClick={capSwap}
        >
          {electro ? 'cap → ceramic 5 mΩ' : 'cap → electrolytic 50 mΩ'}
        </button>
      </div>
    </div>
  )
}
