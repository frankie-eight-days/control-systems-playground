import { useEffect, useRef } from 'react'
import { engine } from '../state/engine'
import { useStore } from '../state/store'

/**
 * The classic feedback block diagram — but live: signal values update on the
 * wires and the active path animates. This is the map between the textbook
 * picture and everything else on screen.
 *
 *   r ──→(+)── e ──→ [Controller] ──→ [sat] ── u ──→ [Plant] ──┬──→ y
 *         ↑−                                    d ──↗           │
 *         └──────────── [Sensor + noise] ←─────────────────────┘
 */
export function BlockDiagram() {
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
      const r = s.setpoint
      const y = engine.yMeas
      const e = r - y
      const u = engine.u
      const pid = s.controller === 'pid'

      // ---- layout ----
      const midY = H * 0.42
      const fbY = Math.min(H - 30, midY + H * 0.32)
      const x0 = 14
      const sumX = Math.max(70, W * 0.13)
      const ctlX = sumX + 40
      const ctlW = Math.max(96, W * 0.17)
      const satX = ctlX + ctlW + 34
      const satW = 30
      const plantX = satX + satW + 44
      const plantW = Math.max(86, W * 0.15)
      const branchX = Math.min(W - 60, plantX + plantW + 64)
      const outX = W - 14
      const blockH = 46
      const sensW = Math.max(120, W * 0.2)
      const sensX = (sumX + branchX) / 2 - sensW / 2

      const mono = '11px ui-monospace, monospace'
      const wire = '#64748b'
      const dashOff = -((engine.t * 24) % 12)

      const line = (pts: [number, number][], animated = true) => {
        ctx.strokeStyle = wire
        ctx.lineWidth = 1.5
        ctx.setLineDash(animated ? [7, 5] : [])
        ctx.lineDashOffset = animated ? dashOff : 0
        ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1])
        for (const [px, py] of pts.slice(1)) ctx.lineTo(px, py)
        ctx.stroke()
        ctx.setLineDash([])
      }
      const arrow = (x: number, yy: number, dir: 'r' | 'u') => {
        ctx.fillStyle = wire
        ctx.beginPath()
        if (dir === 'r') {
          ctx.moveTo(x, yy)
          ctx.lineTo(x - 8, yy - 4)
          ctx.lineTo(x - 8, yy + 4)
        } else {
          ctx.moveTo(x, yy)
          ctx.lineTo(x - 4, yy + 8)
          ctx.lineTo(x + 4, yy + 8)
        }
        ctx.closePath()
        ctx.fill()
      }
      const block = (x: number, w: number, title: string, sub: string) => {
        ctx.fillStyle = '#1e293b'
        ctx.strokeStyle = '#94a3b8'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.roundRect(x, midY - blockH / 2, w, blockH, 4)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = '#e2e8f0'
        ctx.font = 'bold 12px ui-sans-serif, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(title, x + w / 2, midY - 2)
        ctx.fillStyle = '#94a3b8'
        ctx.font = mono
        ctx.fillText(sub, x + w / 2, midY + 14)
      }
      const sig = (x: number, yy: number, text: string, color: string, above = true) => {
        ctx.fillStyle = color
        ctx.font = mono
        ctx.textAlign = 'center'
        ctx.fillText(text, x, above ? yy - 9 : yy + 17)
      }

      // ---- forward path wires ----
      line([
        [x0, midY],
        [sumX - 13, midY],
      ])
      arrow(sumX - 13, midY, 'r')
      line([
        [sumX + 13, midY],
        [ctlX, midY],
      ])
      arrow(ctlX, midY, 'r')
      line([
        [ctlX + ctlW, midY],
        [satX, midY],
      ])
      arrow(satX, midY, 'r')
      line([
        [satX + satW, midY],
        [plantX, midY],
      ])
      arrow(plantX, midY, 'r')
      line([
        [plantX + plantW, midY],
        [outX, midY],
      ])
      arrow(outX, midY, 'r')

      // branch dot + feedback path (right → down → sensor → left → up → sum)
      ctx.fillStyle = wire
      ctx.beginPath()
      ctx.arc(branchX, midY, 3, 0, Math.PI * 2)
      ctx.fill()
      line([
        [branchX, midY],
        [branchX, fbY],
        [sensX + sensW, fbY],
      ])
      arrow(sensX + sensW, fbY, 'r')
      line([
        [sensX, fbY],
        [sumX, fbY],
        [sumX, midY + 13],
      ])
      arrow(sumX, midY + 13 + 8 - 8, 'u')

      // ---- summing junction ----
      ctx.strokeStyle = '#94a3b8'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(sumX, midY, 13, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = '#cbd5e1'
      ctx.font = 'bold 13px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillText('Σ', sumX, midY + 4)
      ctx.font = mono
      ctx.fillText('+', sumX - 22, midY - 4)
      ctx.fillText('−', sumX - 6, midY + 28)

      // ---- blocks ----
      block(
        ctlX,
        ctlW,
        pid ? 'PID  C(s)' : 'Relay',
        pid
          ? `${s.kp.toFixed(0)} + ${s.ki.toFixed(1)}/s + ${s.kd.toFixed(0)}s`
          : `Δ = ${s.band.toFixed(2)} m`,
      )
      block(plantX, plantW, 'Tank  G(s)', 'ẋ = f(x,u,d)')
      // saturation block with its glyph
      ctx.fillStyle = '#1e293b'
      ctx.strokeStyle = '#94a3b8'
      ctx.beginPath()
      ctx.roundRect(satX, midY - 17, satW, 34, 4)
      ctx.fill()
      ctx.stroke()
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
      ctx.fillText('0–100%', satX + satW / 2, midY + 28)

      // sensor block on feedback row
      ctx.fillStyle = '#1e293b'
      ctx.strokeStyle = '#94a3b8'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.roundRect(sensX, fbY - 16, sensW, 32, 4)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#e2e8f0'
      ctx.font = 'bold 11px ui-sans-serif, sans-serif'
      ctx.fillText(
        s.noiseSigma > 0 ? `Sensor + noise (σ=${(s.noiseSigma * 1000).toFixed(1)} mm)` : 'Sensor',
        sensX + sensW / 2,
        fbY + 4,
      )

      // ---- disturbance into the plant ----
      const dX = plantX + plantW / 2
      line([
        [dX, midY - blockH / 2 - 34],
        [dX, midY - blockH / 2],
      ])
      arrow(dX, midY - blockH / 2, 'u')
      ctx.fillStyle = '#f87171'
      ctx.font = mono
      ctx.textAlign = 'center'
      ctx.fillText(`d: valve ${(s.valve * 100).toFixed(0)}%, dumps`, dX, midY - blockH / 2 - 40)

      // ---- live signal values ----
      sig((x0 + sumX) / 2, midY, `r = ${r.toFixed(2)} m`, '#4ade80')
      sig(
        (sumX + ctlX + 13) / 2 + 8,
        midY,
        `e = ${e >= 0 ? '+' : ''}${e.toFixed(3)} m`,
        '#e2e8f0',
        false, // below the wire — keeps clear of the r label
      )
      sig((satX + satW + plantX) / 2, midY, `u = ${u.toFixed(0)}%`, '#fbbf24')
      sig((plantX + plantW + outX) / 2 + 14, midY, `y = ${y.toFixed(3)} m`, '#38bdf8')
      sig((sensX + sumX) / 2, fbY, `${y.toFixed(3)} m`, '#38bdf8', false)
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
