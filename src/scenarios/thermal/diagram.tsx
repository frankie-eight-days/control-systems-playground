import { useEffect, useRef } from 'react'
import { getController } from '../../controllers/registry'
import { engine } from '../../state/engine'
import { useStore } from '../../state/store'
import { THERMAL } from './plant'

/**
 * Thermal boiler DiagramView — the generic single-loop diagram hides the
 * dead time as a sub-label; here it gets its own visually-distinct block.
 *
 * Actuator path is expanded to show the structure honestly:
 *
 *   r →(Σ)→ [C(s) / relay] → [sat 0–100%] → u → [e^{−θs}  Padé] → [Boiler 1st-order] → T
 *                                                         ↑                      ↑
 *                                              live u vs P_del shown      k_eff, C_th live
 *
 * The dead-time block uses a "pipe/queue" visual — horizontal segments
 * representing the 3-second lag that is the lesson of this scenario.
 * Live delayed power is reconstructed from the Padé state p2 (exactly as
 * the ODE does it): P_del = (u_norm − 2·a·p2)·Pmax.
 *
 * Canvas idioms (box, wire, arrow, sig helpers) follow ui/BlockDiagram.tsx.
 */
export function ThermalDiagram() {
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
      const cdef = getController(s.controllerId)

      // ---- live signals ----
      const r = s.setpoint
      const T = engine.yMeas                          // measured temperature (°C)
      const e = r - T
      const u = engine.u                              // controller output (%)
      const uNorm = Math.min(1, Math.max(0, u / 100))

      // Reconstruct delayed power from Padé state p2 (x[2]).
      // p_out_norm = u_norm − 2·a·p2   (exact formula from plant.ts)
      const PADE_A = THERMAL.theta / 2               // 1.5
      const p2 = engine.x.length >= 3 ? engine.x[2] : 0
      const pOutNorm = Math.min(1, Math.max(0, uNorm - 2 * PADE_A * p2))
      const Pcmd = uNorm * THERMAL.Pmax              // W  commanded
      const Pdel = pOutNorm * THERMAL.Pmax           // W  delivered (delayed)

      // Disturbance values
      const lossMult = s.dist.lossMult ?? 1
      const tamb = s.dist.tamb ?? 22
      const kEff = THERMAL.kNom * lossMult           // W/K effective
      const fopdt_K = THERMAL.Pmax / 100 / kEff     // °C/%
      const fopdt_tau = THERMAL.Cth / kEff           // s

      // ---- layout ----
      // Forward path sits at midY.  Feedback runs at fbY below.
      // We lay out the blocks left-to-right, computing widths proportionally
      // so the diagram works at any panel width ≥ ~520 px.
      const midY = H * 0.40
      const fbY = Math.min(H - 34, midY + H * 0.30)
      const pad = 14
      const blockH = 46

      const sumX = Math.max(60, W * 0.10)
      const ctlW = Math.max(90, W * 0.14)
      const ctlX = sumX + 36
      const satW = 30
      const satX = ctlX + ctlW + 28
      // Dead-time block: visually larger and distinctly coloured
      const delayX = satX + satW + 36
      const delayW = Math.max(100, W * 0.17)
      // Boiler block
      const boilerX = delayX + delayW + 36
      const boilerW = Math.max(96, W * 0.16)
      const branchX = Math.min(W - 44, boilerX + boilerW + 52)
      const outX = W - pad
      const sensW = Math.max(110, W * 0.18)
      const sensX = (sumX + branchX) / 2 - sensW / 2

      // dash animation keyed to wall-clock so it's independent of time scale
      const dashOff = -((engine.t * 28) % 12)

      // ---- drawing helpers ----
      const mono = '11px ui-monospace, monospace'
      const monoSm = '10px ui-monospace, monospace'
      const WIRE = '#64748b'

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

      const arrowR = (x: number, y: number) => {
        ctx.fillStyle = WIRE
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x - 8, y - 4)
        ctx.lineTo(x - 8, y + 4)
        ctx.closePath()
        ctx.fill()
      }
      const arrowU = (x: number, y: number) => {
        ctx.fillStyle = WIRE
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x - 4, y + 8)
        ctx.lineTo(x + 4, y + 8)
        ctx.closePath()
        ctx.fill()
      }

      const box = (
        x: number, w: number, title: string, sub: string,
        opts: { stroke?: string; fill?: string; titleColor?: string } = {},
      ) => {
        ctx.fillStyle = opts.fill ?? '#1e293b'
        ctx.strokeStyle = opts.stroke ?? '#94a3b8'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.roundRect(x, midY - blockH / 2, w, blockH, 4)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = opts.titleColor ?? '#e2e8f0'
        ctx.font = 'bold 11px ui-sans-serif, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(title, x + w / 2, midY - 6)
        ctx.fillStyle = opts.stroke ?? '#94a3b8'
        ctx.font = monoSm
        ctx.fillText(sub, x + w / 2, midY + 9)
        ctx.textBaseline = 'alphabetic'
      }

      const sig = (x: number, y: number, text: string, color: string, above = true) => {
        ctx.fillStyle = color
        ctx.font = mono
        ctx.textAlign = 'center'
        ctx.fillText(text, x, above ? y - 9 : y + 17)
      }

      // ---- forward path wires ----
      line([[pad, midY], [sumX - 13, midY]])
      arrowR(sumX - 13, midY)
      line([[sumX + 13, midY], [ctlX, midY]])
      arrowR(ctlX, midY)
      line([[ctlX + ctlW, midY], [satX, midY]])
      arrowR(satX, midY)
      line([[satX + satW, midY], [delayX, midY]])
      arrowR(delayX, midY)
      line([[delayX + delayW, midY], [boilerX, midY]])
      arrowR(boilerX, midY)
      line([[boilerX + boilerW, midY], [outX, midY]])
      arrowR(outX, midY)

      // ---- branch dot + feedback path ----
      ctx.fillStyle = WIRE
      ctx.beginPath()
      ctx.arc(branchX, midY, 3, 0, Math.PI * 2)
      ctx.fill()
      line([[branchX, midY], [branchX, fbY], [sensX + sensW, fbY]])
      arrowR(sensX + sensW, fbY)
      line([[sensX, fbY], [sumX, fbY], [sumX, midY + 13]])
      arrowU(sumX, midY + 13)

      // ---- summing junction ----
      ctx.strokeStyle = '#94a3b8'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(sumX, midY, 13, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = '#cbd5e1'
      ctx.font = 'bold 13px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('Σ', sumX, midY + 1)
      ctx.textBaseline = 'alphabetic'
      ctx.font = monoSm
      ctx.fillText('+', sumX - 20, midY - 4)
      ctx.fillText('−', sumX - 5, midY + 27)

      // ---- controller block ----
      if (s.controllerId === 'onoff') {
        const band = s.ctl.band ?? 4
        box(ctlX, ctlW, 'Relay', `Δ = ${band.toFixed(1)} °C`, { stroke: '#f59e0b', titleColor: '#fde68a' })
      } else {
        box(ctlX, ctlW, 'PID  C(s)', cdef.summary(s.ctl), { stroke: '#38bdf8' })
      }

      // ---- saturation block (0–100%) ----
      ctx.fillStyle = '#1e293b'
      ctx.strokeStyle = '#94a3b8'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.roundRect(satX, midY - 17, satW, 34, 4)
      ctx.fill()
      ctx.stroke()
      // saturation glyph
      ctx.strokeStyle = '#fbbf24'
      ctx.lineWidth = 1.75
      ctx.beginPath()
      ctx.moveTo(satX + 5, midY + 9)
      ctx.lineTo(satX + 11, midY + 9)
      ctx.lineTo(satX + satW - 11, midY - 9)
      ctx.lineTo(satX + satW - 5, midY - 9)
      ctx.stroke()
      ctx.fillStyle = '#64748b'
      ctx.font = '9px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillText('0–100%', satX + satW / 2, midY + 28)

      // ---- DEAD-TIME BLOCK — the key visual element ----
      //
      // Drawn with an amber/orange accent to make it pop; contains:
      //  - title: e^{−θs}  (the transfer function)
      //  - "pipe" glyph: three horizontal segments suggesting a conveyor
      //  - live u vs P_del annotation below
      const delayAccent = '#f59e0b'        // amber
      const delayFill = '#1c1a10'          // very dark amber tint
      ctx.fillStyle = delayFill
      ctx.strokeStyle = delayAccent
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.roundRect(delayX, midY - blockH / 2 - 4, delayW, blockH + 8, 6)
      ctx.fill()
      ctx.stroke()

      // Title line
      ctx.fillStyle = '#fde68a'
      ctx.font = 'bold 12px ui-sans-serif, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('DEAD TIME  e^(−θs)', delayX + delayW / 2, midY - 10)

      // Sub: θ = 3 s
      ctx.fillStyle = delayAccent
      ctx.font = monoSm
      ctx.fillText(`θ = ${THERMAL.theta} s  (Padé 2nd order)`, delayX + delayW / 2, midY + 4)

      // Pipe glyph — three short horizontal bars representing the queue
      const pipeY = midY + 16
      const pipeX0 = delayX + 8
      const pipeX1 = delayX + delayW - 8
      const pipeLen = pipeX1 - pipeX0
      const segCount = 3
      const segW = pipeLen / segCount - 3
      for (let i = 0; i < segCount; i++) {
        const sx = pipeX0 + i * (pipeLen / segCount)
        // Each segment brightness encodes how full the delay is (idle → dim)
        const brightness = 0.3 + 0.7 * uNorm
        ctx.fillStyle = `rgba(245, 158, 11, ${brightness})`
        ctx.fillRect(sx, pipeY - 3, segW, 6)
      }
      ctx.textBaseline = 'alphabetic'

      // Live P_cmd vs P_del annotation BELOW the block
      const lagPct = uNorm > 0.01 ? ((1 - pOutNorm / Math.max(uNorm, 1e-6)) * 100).toFixed(0) : '—'
      ctx.fillStyle = '#fbbf24'
      ctx.font = monoSm
      ctx.textAlign = 'center'
      ctx.fillText(
        `P_cmd=${Pcmd.toFixed(0)}W  →  P_del=${Pdel.toFixed(0)}W`,
        delayX + delayW / 2,
        midY + blockH / 2 + 18,
      )
      ctx.fillStyle = '#94a3b8'
      ctx.fillText(`lag ≈ ${lagPct}%`, delayX + delayW / 2, midY + blockH / 2 + 30)

      // ---- boiler plant block ----
      box(
        boilerX, boilerW,
        'Boiler  G₀(s)',
        `K=${fopdt_K.toFixed(2)} °C/%  τ=${fopdt_tau.toFixed(0)}s`,
        { stroke: '#38bdf8' },
      )

      // ---- sensor block on feedback row ----
      ctx.fillStyle = '#1e293b'
      ctx.strokeStyle = '#94a3b8'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.roundRect(sensX, fbY - 16, sensW, 32, 4)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#e2e8f0'
      ctx.font = 'bold 11px ui-sans-serif, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(
        s.noiseSigma > 0
          ? `Sensor + noise (σ=${(s.noiseSigma).toFixed(2)} °C)`
          : 'Sensor  T',
        sensX + sensW / 2,
        fbY + 4,
      )

      // ---- disturbance arrows into the boiler ----
      // T_amb: arrow from below, into boiler mid
      const dX = boilerX + boilerW * 0.35
      line([[dX, midY - blockH / 2 - 38], [dX, midY - blockH / 2]])
      arrowU(dX, midY - blockH / 2)
      ctx.fillStyle = '#f87171'
      ctx.font = monoSm
      ctx.textAlign = 'center'
      ctx.fillText(`T_amb = ${tamb.toFixed(0)}°C`, dX, midY - blockH / 2 - 44)

      // lossMult: arrow from above, slightly right
      const dX2 = boilerX + boilerW * 0.65
      line([[dX2, midY - blockH / 2 - 38], [dX2, midY - blockH / 2]])
      arrowU(dX2, midY - blockH / 2)
      const lossColor = lossMult > 1.05 ? '#f87171' : '#94a3b8'
      ctx.fillStyle = lossColor
      ctx.fillText(`k×${lossMult.toFixed(2)}`, dX2, midY - blockH / 2 - 44)
      ctx.fillText(`k_eff=${kEff.toFixed(1)}W/K`, dX2, midY - blockH / 2 - 32)

      // ---- live signal values on wires ----
      sig((pad + sumX) / 2, midY, `r = ${r.toFixed(1)}°C`, '#4ade80')
      // e label — left-aligned just after the junction to avoid overlap with box
      ctx.fillStyle = '#e2e8f0'
      ctx.font = mono
      ctx.textAlign = 'left'
      ctx.fillText(`e = ${e >= 0 ? '+' : ''}${e.toFixed(2)}°C`, sumX + 18, midY + 34)
      sig((satX + satW + delayX) / 2, midY, `u = ${u.toFixed(0)}%`, '#fbbf24')
      sig((boilerX + boilerW + outX) / 2 + 10, midY, `T = ${T.toFixed(1)}°C`, '#38bdf8')
      sig((sensX + sumX) / 2, fbY, `T = ${T.toFixed(1)}°C`, '#38bdf8', false)

      // ---- caption ----
      //
      // The caption ties the dead-time block to the ZN lesson and phase-margin
      // story — mirroring the theory panel but in one line.
      ctx.fillStyle = '#475569'
      ctx.font = '9.5px ui-sans-serif, sans-serif'
      ctx.textAlign = 'left'
      const captionLines = [
        `Dead time theta=${THERMAL.theta}s adds -w*theta rad of unbounded phase lag, killing PM at every gain — that is why ZN tuning starts here.`,
        `Pade 2nd-order: e^(-theta*s) approx N(s)/D(s), 2 extra ODE states (p1, p2). P_del from p2: P_del = (u_norm - 2a*p2)*Pmax.`,
      ]
      captionLines.forEach((l, i) =>
        ctx.fillText(l, pad, H - 4 - (captionLines.length - 1 - i) * 13),
      )
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
