import { useEffect, useRef } from 'react'
import { engine } from '../../state/engine'
import { useStore } from '../../state/store'
import { MAGLEV } from './plant'

const mm = 1000

/** Tap impulses (click / buttons): change ball velocity. +down, −up. */
export const tapDown = (x: number[]) => {
  const next = x.slice()
  next[1] += 0.3
  return next
}
export const tapUp = (x: number[]) => {
  const next = x.slice()
  next[1] -= 0.3
  return next
}

/**
 * Side-view maglev: an electromagnet at the top (coil winding glyph, field glow
 * ∝ current), a steel ball hanging below it with the air gap dimensioned and a
 * mm ruler, the setpoint ghost tick, and live z/i readouts. When the ball hits
 * the magnet (STUCK) or falls past the floor (DROPPED) the sim freezes and the
 * scene flags it until Reset. Click anywhere = tap the ball down.
 */
export function MaglevScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const wrap = wrapRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let lastNow = performance.now()
    let glowPhase = 0

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
      if (engine.x.length < 3) return
      const z = engine.x[0] * mm // gap mm
      const i = engine.x[2] // A
      const mass = p.dist.mass ?? 1
      const sp = p.setpoint // mm

      const now = performance.now()
      const dtReal = Math.min(0.1, (now - lastNow) / 1000)
      lastNow = now
      glowPhase += dtReal * 6

      // Terminal-state detection → freeze the sim (Reset re-runs it).
      const stuck = z <= MAGLEV.zStuck * mm + 0.02
      const dropped = z >= MAGLEV.zDrop * mm - 0.02
      if ((stuck || dropped) && p.running) p.set({ running: false })

      // ─── geometry: magnet face near the top, floor near the bottom ───
      const magY = H * 0.16 // y of the magnet face
      const zMaxMm = MAGLEV.zDrop * mm // 40 mm spans to the floor
      const floorY = H * 0.9
      const pxPerMm = (floorY - magY) / zMaxMm
      const ballY = magY + z * pxPerMm
      const cx = W * 0.42
      const ballR = Math.min(W * 0.06, 26)

      // ─── electromagnet (coil core + winding glyph) ───
      const coreW = Math.min(W * 0.22, 130)
      const coreH = H * 0.12
      const coreX = cx - coreW / 2
      ctx.fillStyle = '#475569'
      ctx.fillRect(coreX, magY - coreH, coreW, coreH)
      // pole face
      ctx.fillStyle = '#64748b'
      ctx.fillRect(coreX - 6, magY - 6, coreW + 12, 6)
      // winding turns
      ctx.strokeStyle = '#b45309'
      ctx.lineWidth = 3
      const turns = 6
      for (let t = 0; t < turns; t++) {
        const ty = magY - coreH + 6 + (t * (coreH - 10)) / turns
        ctx.beginPath()
        ctx.ellipse(cx, ty, coreW / 2 + 4, 4, 0, 0, Math.PI * 2)
        ctx.stroke()
      }
      // field glow under the magnet, intensity ∝ i/iMax
      const glowI = Math.min(1, i / MAGLEV.iMax)
      if (glowI > 0.01) {
        const gr = ctx.createRadialGradient(cx, magY, 2, cx, magY, coreW * (0.8 + 0.3 * glowI))
        const a = 0.12 + 0.4 * glowI + 0.05 * Math.sin(glowPhase)
        gr.addColorStop(0, `rgba(56,189,248,${a})`)
        gr.addColorStop(1, 'rgba(56,189,248,0)')
        ctx.fillStyle = gr
        ctx.beginPath()
        ctx.arc(cx, magY, coreW * (0.8 + 0.3 * glowI), 0, Math.PI * 2)
        ctx.fill()
      }
      // field lines toward the ball, density ∝ i
      const nLines = Math.round(2 + glowI * 5)
      ctx.strokeStyle = `rgba(56,189,248,${0.25 + 0.5 * glowI})`
      ctx.lineWidth = 1
      for (let l = 0; l < nLines; l++) {
        const fx = cx + (l - (nLines - 1) / 2) * (coreW / nLines)
        ctx.beginPath()
        ctx.moveTo(fx, magY)
        ctx.lineTo(cx + (fx - cx) * 0.4, ballY - ballR)
        ctx.stroke()
      }

      // ─── mm ruler down the left of the gap ───
      const rulerX = coreX - 26
      ctx.strokeStyle = '#334155'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(rulerX, magY)
      ctx.lineTo(rulerX, floorY)
      ctx.stroke()
      ctx.fillStyle = '#64748b'
      ctx.font = '9px ui-monospace, monospace'
      ctx.textAlign = 'right'
      for (let mmk = 0; mmk <= zMaxMm; mmk += 5) {
        const ry = magY + mmk * pxPerMm
        ctx.beginPath()
        ctx.moveTo(rulerX - (mmk % 10 === 0 ? 6 : 3), ry)
        ctx.lineTo(rulerX, ry)
        ctx.stroke()
        if (mmk % 10 === 0) ctx.fillText(`${mmk}`, rulerX - 8, ry + 3)
      }

      // ─── setpoint ghost tick ───
      const spY = magY + sp * pxPerMm
      ctx.strokeStyle = '#4ade80'
      ctx.lineWidth = 1.5
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.moveTo(coreX - 10, spY)
      ctx.lineTo(cx + coreW, spY)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#4ade80'
      ctx.textAlign = 'left'
      ctx.fillText(`z* = ${sp.toFixed(1)} mm`, cx + coreW + 4, spY + 3)

      // ─── air-gap dimension line (magnet face → ball top) ───
      ctx.strokeStyle = '#94a3b8'
      ctx.lineWidth = 1
      const dimX = cx + coreW / 2 + 14
      ctx.beginPath()
      ctx.moveTo(dimX, magY)
      ctx.lineTo(dimX, ballY - ballR)
      ctx.moveTo(dimX - 4, magY)
      ctx.lineTo(dimX + 4, magY)
      ctx.moveTo(dimX - 4, ballY - ballR)
      ctx.lineTo(dimX + 4, ballY - ballR)
      ctx.stroke()
      ctx.fillStyle = '#cbd5e1'
      ctx.fillText(`z = ${z.toFixed(1)} mm`, dimX + 6, (magY + ballY - ballR) / 2 + 3)

      // ─── the steel ball (radius hints at mass) ───
      const rEff = ballR * (0.85 + 0.25 * Math.cbrt(mass))
      const bg = ctx.createRadialGradient(cx - rEff * 0.3, ballY - rEff * 0.3, 2, cx, ballY, rEff)
      bg.addColorStop(0, '#e2e8f0')
      bg.addColorStop(1, '#64748b')
      ctx.fillStyle = bg
      ctx.beginPath()
      ctx.arc(cx, ballY, rEff, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#334155'
      ctx.lineWidth = 1
      ctx.stroke()
      if (Math.abs(mass - 1) > 0.01) {
        ctx.fillStyle = '#fbbf24'
        ctx.font = '10px ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.fillText(`${(mass * MAGLEV.m * 1000).toFixed(0)} g`, cx, ballY + 3)
      }

      // ─── floor ───
      ctx.strokeStyle = '#475569'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(coreX - 30, floorY)
      ctx.lineTo(cx + coreW + 30, floorY)
      ctx.stroke()

      // ─── failure flags ───
      if (stuck || dropped) {
        const blink = (Math.sin(now / 100) + 1) / 2
        ctx.fillStyle = `rgba(248,113,113,${0.6 + 0.4 * blink})`
        ctx.font = 'bold 22px ui-sans-serif, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(stuck ? 'STUCK TO MAGNET' : 'DROPPED', cx, H * 0.5)
        ctx.strokeStyle = `rgba(248,113,113,${0.4 + 0.4 * blink})`
        ctx.lineWidth = 3
        ctx.strokeRect(3, 3, W - 6, H - 6)
      }

      // ─── readouts ───
      ctx.font = 'bold 13px ui-monospace, monospace'
      ctx.textAlign = 'left'
      const rows: [string, string][] = [
        [`z = ${z.toFixed(2)} mm`, '#38bdf8'],
        [`i = ${i.toFixed(3)} A`, '#fbbf24'],
        [`e = ${(sp - z).toFixed(2)} mm`, Math.abs(sp - z) < 0.5 ? '#4ade80' : '#f59e0b'],
      ]
      let ry = 22
      for (const [txt, col] of rows) {
        ctx.fillStyle = col
        ctx.fillText(txt, 12, ry)
        ry += 18
      }
      ctx.fillStyle = '#94a3b8'
      ctx.font = '11px ui-monospace, monospace'
      ctx.textAlign = 'right'
      ctx.fillText(`u = ${engine.u.toFixed(0)}%`, W - 12, H - 28)
      ctx.fillText(`t = ${(engine.t * 1000).toFixed(0)} ms (sim)`, W - 12, H - 14)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const resetSim = () => {
    engine.reset()
    useStore.getState().set({ running: true })
  }

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="cursor-pointer"
        title="Click to tap the ball down (+0.3 m/s)"
        onClick={() => engine.applyImpulse(tapDown)}
      />
      <div className="absolute right-2 top-2 flex gap-1.5">
        <button
          className="rounded bg-sky-900/70 px-2 py-1 text-xs text-sky-200 hover:bg-sky-800"
          onClick={() => engine.applyImpulse(tapDown)}
        >
          Tap down
        </button>
        <button
          className="rounded bg-sky-900/70 px-2 py-1 text-xs text-sky-200 hover:bg-sky-800"
          onClick={() => engine.applyImpulse(tapUp)}
        >
          Tap up
        </button>
        <button
          className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-600"
          onClick={resetSim}
        >
          Reset
        </button>
      </div>
    </div>
  )
}
