import { useEffect, useRef } from 'react'
import { engine } from '../state/engine'
import { useStore } from '../state/store'
import { TANK } from '../sim/plants/tank'

const WATER = '#1d6fa3'
const WATER_TOP = '#2e8fc9'

/**
 * Canvas scene: tank, lagged pump feeding from above, gravity drain through
 * a valve. Click the tank to dump in 50 L (the classic disturbance).
 */
export function TankScene() {
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

      const p = useStore.getState()
      const h = engine.x[0]
      const qIn = Math.max(0, engine.x[1])
      const qOut = engine.qOut
      const t = engine.t

      // ----- layout -----
      const tankW = Math.min(W * 0.42, 300)
      const tankH = Math.min(H * 0.62, 320)
      const tankX = (W - tankW) / 2
      const tankY = H * 0.16
      const yOfLevel = (lvl: number) => tankY + tankH * (1 - lvl / TANK.height)
      const wallC = '#475569'

      // ----- inflow pipe + pump (top left) -----
      const pipeY = tankY - 28
      const pipeInX = tankX + tankW * 0.18
      ctx.strokeStyle = wallC
      ctx.lineWidth = 10
      ctx.lineCap = 'butt'
      ctx.beginPath()
      ctx.moveTo(0, pipeY)
      ctx.lineTo(pipeInX, pipeY)
      ctx.lineTo(pipeInX, tankY - 6)
      ctx.stroke()
      // pump body
      const pumpX = Math.max(34, tankX * 0.35)
      ctx.fillStyle = '#334155'
      ctx.beginPath()
      ctx.arc(pumpX, pipeY, 16, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#94a3b8'
      ctx.lineWidth = 2
      ctx.stroke()
      // impeller, spinning with command
      ctx.save()
      ctx.translate(pumpX, pipeY)
      ctx.rotate(t * (0.5 + (engine.u / 100) * 9))
      ctx.strokeStyle = '#cbd5e1'
      for (let i = 0; i < 3; i++) {
        ctx.rotate((Math.PI * 2) / 3)
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(11, 0)
        ctx.stroke()
      }
      ctx.restore()
      ctx.fillStyle = '#cbd5e1'
      ctx.font = '11px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillText(`u = ${engine.u.toFixed(0)}%`, pumpX, pipeY + 34)

      // inflow stream falling to the water surface
      if (qIn > 1e-5) {
        const sw = 2 + (qIn / TANK.qMax) * 9
        ctx.fillStyle = 'rgba(56, 189, 248, 0.65)'
        ctx.fillRect(pipeInX - sw / 2, tankY - 6, sw, Math.max(0, yOfLevel(h) - (tankY - 6)))
      }

      // ----- tank walls -----
      ctx.strokeStyle = wallC
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.moveTo(tankX, tankY - 6)
      ctx.lineTo(tankX, tankY + tankH)
      ctx.lineTo(tankX + tankW, tankY + tankH)
      ctx.lineTo(tankX + tankW, tankY - 6)
      ctx.stroke()

      // ----- water -----
      const surfY = yOfLevel(h)
      if (h > 0.005) {
        const grad = ctx.createLinearGradient(0, surfY, 0, tankY + tankH)
        grad.addColorStop(0, WATER_TOP)
        grad.addColorStop(1, WATER)
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.moveTo(tankX + 2.5, tankY + tankH - 2.5)
        ctx.lineTo(tankX + 2.5, surfY)
        // gentle ripple, amplitude grows with net flow
        const ripple = Math.min(3, 1 + (qIn / TANK.qMax) * 4)
        for (let x = 0; x <= tankW - 5; x += 6) {
          ctx.lineTo(tankX + 2.5 + x, surfY + Math.sin(x * 0.12 + t * 3) * ripple)
        }
        ctx.lineTo(tankX + tankW - 2.5, tankY + tankH - 2.5)
        ctx.closePath()
        ctx.fill()
      }

      // overflow warning
      if (engine.overflow) {
        ctx.fillStyle = '#f87171'
        ctx.font = 'bold 13px ui-sans-serif, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('OVERFLOW', tankX + tankW / 2, tankY - 14)
      }

      // ----- setpoint line -----
      const spY = yOfLevel(p.setpoint)
      ctx.strokeStyle = '#4ade80'
      ctx.lineWidth = 1.5
      ctx.setLineDash([7, 5])
      ctx.beginPath()
      ctx.moveTo(tankX - 14, spY)
      ctx.lineTo(tankX + tankW + 14, spY)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#4ade80'
      ctx.font = '11px ui-monospace, monospace'
      ctx.textAlign = 'left'
      ctx.fillText(`r = ${p.setpoint.toFixed(2)} m`, tankX + tankW + 18, spY + 4)

      // measured level label
      ctx.fillStyle = '#38bdf8'
      ctx.textAlign = 'right'
      ctx.fillText(`h = ${h.toFixed(3)} m`, tankX - 18, surfY + 4)

      // ----- outflow pipe + valve (bottom right) -----
      const outY = tankY + tankH - 8
      const valveX = tankX + tankW + 36
      ctx.strokeStyle = wallC
      ctx.lineWidth = 10
      ctx.beginPath()
      ctx.moveTo(tankX + tankW + 2, outY)
      ctx.lineTo(valveX + 26, outY)
      ctx.stroke()
      // valve butterfly symbol (two triangles), rotation hints at opening
      ctx.fillStyle = '#0f172a'
      ctx.fillRect(valveX - 11, outY - 11, 22, 22)
      ctx.save()
      ctx.translate(valveX, outY)
      ctx.rotate((1 - p.valve) * (Math.PI / 2) * 0.85)
      ctx.strokeStyle = p.valve > 0.02 ? '#fbbf24' : '#f87171'
      ctx.lineWidth = 3.5
      ctx.beginPath()
      ctx.moveTo(-10, 0)
      ctx.lineTo(10, 0)
      ctx.stroke()
      ctx.restore()
      ctx.fillStyle = '#cbd5e1'
      ctx.font = '11px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillText(`valve ${(p.valve * 100).toFixed(0)}%`, valveX + 4, outY + 26)
      // outflow stream
      if (qOut > 1e-5 && h > 0.005) {
        const sw = 2 + (qOut / TANK.qMax) * 9
        ctx.fillStyle = 'rgba(56, 189, 248, 0.55)'
        ctx.fillRect(valveX + 26, outY - sw / 2 - 1, 4, sw + 2)
        ctx.fillRect(valveX + 26, outY, sw, H - outY)
      }

      // ----- flow readouts -----
      ctx.fillStyle = '#94a3b8'
      ctx.font = '12px ui-monospace, monospace'
      ctx.textAlign = 'left'
      ctx.fillText(`q_in  = ${(qIn * 1000).toFixed(1)} L/s`, 12, H - 36)
      ctx.fillText(`q_out = ${(qOut * 1000).toFixed(1)} L/s`, 12, H - 18)
      ctx.textAlign = 'right'
      ctx.fillText(`t = ${engine.t.toFixed(1)} s (sim)`, W - 12, H - 18)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="cursor-pointer"
        title="Click to dump 50 L into the tank"
        onClick={() => engine.dump(0.05)}
      />
      <div className="absolute right-2 top-2 flex gap-1.5">
        <button
          className="rounded bg-sky-900/70 px-2 py-1 text-xs text-sky-200 hover:bg-sky-800"
          onClick={() => engine.dump(0.05)}
        >
          +50 L
        </button>
        <button
          className="rounded bg-sky-900/70 px-2 py-1 text-xs text-sky-200 hover:bg-sky-800"
          onClick={() => engine.dump(-0.05)}
        >
          −50 L
        </button>
      </div>
    </div>
  )
}
