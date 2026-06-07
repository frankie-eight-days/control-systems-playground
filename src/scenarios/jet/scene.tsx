import { useEffect, useRef } from 'react'
import { engine } from '../../state/engine'
import { useStore } from '../../state/store'
import { deltaCmdFromU, JET } from './plant'

const rad2deg = 180 / Math.PI
const deg2rad = Math.PI / 180

/** +5° α gust impulse (click / button), shared with the descriptor. */
export const gustHit = (x: number[]) => {
  const next = x.slice()
  next[0] += 5 * deg2rad
  return next
}
/** Nose whack: +0.5 rad/s pitch-rate kick. */
export const noseWhack = (x: number[]) => {
  const next = x.slice()
  next[1] += 0.5
  return next
}

/**
 * Side-view fighter silhouette: the airframe rotates with pitch attitude θ
 * (wall-clock-smoothed so it reads as a real attitude, not a sim-time number),
 * the elevator deflects with δ, a horizon with sky/ground shading tilts the
 * opposite way, an AoA gauge shows α against a red stall arc, and a CG marker
 * slides along the fuselage with the cg slider. Click = +5° gust hit.
 */
export function JetScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const wrap = wrapRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    // Wall-clock smoothed attitude for display (the sim θ can jump when time
    // is accelerated; ease the drawn angle toward it at a real-time rate).
    let thetaShown = 0
    let deltaShown = 0
    let lastNow = performance.now()

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

      const p = useStore.getState()
      if (engine.x.length < 4) {
        ctx.clearRect(0, 0, W, H)
        return
      }
      const alpha = engine.x[0]
      const q = engine.x[1]
      const theta = engine.x[2]
      const delta = engine.x[3]
      const cg = p.dist.cg ?? 0.75
      const gust = p.dist.gust ?? 0
      const alphaAero = alpha + gust * deg2rad
      const alphaDeg = alphaAero * rad2deg
      const departed = Math.abs(alphaDeg) > JET.alphaStall * rad2deg

      const now = performance.now()
      const dtReal = Math.min(0.1, (now - lastNow) / 1000)
      lastNow = now
      const ease = 1 - Math.exp(-dtReal / 0.08) // ~80 ms visual time constant
      thetaShown += (theta - thetaShown) * ease
      deltaShown += (delta - deltaShown) * ease

      // ─── Sky / ground horizon (tilts opposite the aircraft pitch) ─────────
      const cx = W * 0.42
      const cy = H * 0.5
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, W, H)
      ctx.clip()
      ctx.translate(cx, cy)
      ctx.rotate(-thetaShown) // world rotates opposite to attitude
      const big = Math.hypot(W, H)
      // horizon offset by α so climbing into wind pushes the horizon down a touch
      const horizonY = alphaAero * rad2deg * 4
      const sky = ctx.createLinearGradient(0, -big, 0, horizonY)
      sky.addColorStop(0, '#0b2545')
      sky.addColorStop(1, '#3b6ea5')
      ctx.fillStyle = sky
      ctx.fillRect(-big, -big, 2 * big, big + horizonY)
      const ground = ctx.createLinearGradient(0, horizonY, 0, big)
      ground.addColorStop(0, '#5b4327')
      ground.addColorStop(1, '#2c2113')
      ctx.fillStyle = ground
      ctx.fillRect(-big, horizonY, 2 * big, big - horizonY)
      // horizon line + a few pitch-ladder ticks
      ctx.strokeStyle = '#e2e8f0'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(-big, horizonY)
      ctx.lineTo(big, horizonY)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(226,232,240,0.4)'
      ctx.lineWidth = 1
      ctx.font = '9px ui-monospace, monospace'
      ctx.fillStyle = 'rgba(226,232,240,0.6)'
      ctx.textAlign = 'left'
      for (let d = -30; d <= 30; d += 10) {
        if (d === 0) continue
        const ly = horizonY - d * 4
        ctx.beginPath()
        ctx.moveTo(-44, ly)
        ctx.lineTo(44, ly)
        ctx.stroke()
        ctx.fillText(`${d > 0 ? '+' : ''}${d}`, 48, ly + 3)
      }
      ctx.restore()

      // ─── Aircraft (fixed at centre, rotated by attitude) ──────────────────
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(-thetaShown) // nose-up θ>0 ⇒ rotate body CCW (nose up on screen)
      const L = Math.min(W * 0.34, 230) // fuselage length
      const fuselageH = L * 0.1

      // fuselage
      ctx.fillStyle = '#cbd5e1'
      ctx.strokeStyle = '#64748b'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(L * 0.55, 0) // nose
      ctx.lineTo(L * 0.18, -fuselageH)
      ctx.lineTo(-L * 0.4, -fuselageH * 0.85)
      ctx.lineTo(-L * 0.5, -fuselageH * 1.9) // tail fin top
      ctx.lineTo(-L * 0.42, -fuselageH * 0.6)
      ctx.lineTo(-L * 0.5, 0)
      ctx.lineTo(-L * 0.4, fuselageH * 0.85)
      ctx.lineTo(L * 0.18, fuselageH)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()

      // canopy
      ctx.fillStyle = 'rgba(125,211,252,0.6)'
      ctx.beginPath()
      ctx.moveTo(L * 0.24, -fuselageH * 0.7)
      ctx.lineTo(L * 0.36, -fuselageH * 1.0)
      ctx.lineTo(L * 0.12, -fuselageH * 1.0)
      ctx.lineTo(L * 0.02, -fuselageH * 0.7)
      ctx.closePath()
      ctx.fill()

      // main wing (seen edge-on, a thin lifting line through the CG region)
      ctx.strokeStyle = '#94a3b8'
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.moveTo(L * 0.12, fuselageH * 0.2)
      ctx.lineTo(-L * 0.12, fuselageH * 0.2)
      ctx.stroke()

      // elevator (tailplane) — deflects with δ. Positive δ = trailing edge
      // down. Hinged at the tail.
      const hingeX = -L * 0.42
      const hingeY = 0
      ctx.save()
      ctx.translate(hingeX, hingeY)
      ctx.rotate(deltaShown) // δ>0 → surface trailing edge down (screen)
      ctx.strokeStyle = '#fbbf24'
      ctx.lineWidth = 3.5
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(-L * 0.16, 0)
      ctx.stroke()
      ctx.restore()

      // velocity vector / relative wind (shows α as angle between body axis and V)
      // The relative wind comes from −α below the nose axis.
      ctx.strokeStyle = departed ? '#f87171' : 'rgba(56,189,248,0.7)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 3])
      ctx.save()
      ctx.rotate(alphaAero) // wind below the nose by α
      ctx.beginPath()
      ctx.moveTo(-L * 0.1, 0)
      ctx.lineTo(L * 0.62, 0)
      ctx.stroke()
      ctx.restore()
      ctx.setLineDash([])

      // CG marker — slides fore/aft along the fuselage with the cg slider.
      // cg 0 (fwd) → near nose; cg 1 (aft) → near tail.
      const cgX = L * 0.3 - cg * (L * 0.62)
      ctx.fillStyle = '#0f172a'
      ctx.beginPath()
      ctx.arc(cgX, 0, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#fde68a'
      for (let i = 0; i < 4; i++) {
        ctx.beginPath()
        ctx.moveTo(cgX, 0)
        ctx.arc(cgX, 0, 5, (i * Math.PI) / 2, (i * Math.PI) / 2 + Math.PI / 2)
        ctx.closePath()
        if (i % 2 === 0) ctx.fill()
      }
      ctx.strokeStyle = '#fbbf24'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(cgX, 0, 5, 0, Math.PI * 2)
      ctx.stroke()

      ctx.restore() // aircraft frame

      // ─── Gust arrows (when steady gust ≠ 0) ───────────────────────────────
      if (Math.abs(gust) > 0.2) {
        const n = Math.min(4, Math.ceil(Math.abs(gust) / 2))
        ctx.strokeStyle = '#67e8f9'
        ctx.fillStyle = '#67e8f9'
        ctx.lineWidth = 2
        const dir = gust > 0 ? -1 : 1 // +gust = updraft → arrows point up
        for (let i = 0; i < n; i++) {
          const ax = cx - 70 + i * 30
          const ay0 = cy + 80
          const ay1 = cy + 80 + dir * 26
          ctx.beginPath()
          ctx.moveTo(ax, ay0)
          ctx.lineTo(ax, ay1)
          ctx.stroke()
          ctx.beginPath()
          ctx.moveTo(ax, ay1)
          ctx.lineTo(ax - 4, ay1 - dir * 6)
          ctx.lineTo(ax + 4, ay1 - dir * 6)
          ctx.closePath()
          ctx.fill()
        }
        ctx.font = '10px ui-monospace, monospace'
        ctx.textAlign = 'left'
        ctx.fillText(`gust ${gust > 0 ? '+' : ''}${gust.toFixed(0)}°`, cx - 70, cy + 80 + dir * 38)
      }

      // ─── DEPARTURE flash ──────────────────────────────────────────────────
      if (departed) {
        const blink = (Math.sin(now / 90) + 1) / 2
        ctx.fillStyle = `rgba(248,113,113,${0.5 + 0.5 * blink})`
        ctx.font = 'bold 22px ui-sans-serif, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('DEPARTURE', cx, H * 0.16)
        ctx.strokeStyle = `rgba(248,113,113,${0.4 + 0.4 * blink})`
        ctx.lineWidth = 3
        ctx.strokeRect(3, 3, W - 6, H - 6)
      }

      // ─── AoA gauge (top-right): needle vs red stall arc ───────────────────
      const gx = W - 70
      const gy = 64
      const gr = 42
      ctx.save()
      ctx.translate(gx, gy)
      // dial background
      ctx.fillStyle = 'rgba(15,23,42,0.8)'
      ctx.beginPath()
      ctx.arc(0, 0, gr + 6, 0, Math.PI * 2)
      ctx.fill()
      // gauge maps α ∈ [−20,20]° onto ±120°
      const aMax = 20
      const ang = (a: number) => (Math.max(-aMax, Math.min(aMax, a)) / aMax) * (120 * deg2rad)
      // green (attached) arc
      ctx.strokeStyle = '#22c55e'
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.arc(0, 0, gr, -Math.PI / 2 + ang(-15), -Math.PI / 2 + ang(15))
      ctx.stroke()
      // red stall arcs (|α|>15°)
      ctx.strokeStyle = '#ef4444'
      ctx.beginPath()
      ctx.arc(0, 0, gr, -Math.PI / 2 + ang(15), -Math.PI / 2 + ang(aMax))
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(0, 0, gr, -Math.PI / 2 + ang(-aMax), -Math.PI / 2 + ang(-15))
      ctx.stroke()
      // needle
      const na = -Math.PI / 2 + ang(alphaDeg)
      ctx.strokeStyle = departed ? '#fca5a5' : '#fbbf24'
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(Math.cos(na) * (gr - 4), Math.sin(na) * (gr - 4))
      ctx.stroke()
      ctx.fillStyle = '#fbbf24'
      ctx.beginPath()
      ctx.arc(0, 0, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#94a3b8'
      ctx.font = '9px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillText('AoA α', 0, gr + 18)
      ctx.restore()

      // ─── Readouts (top-left) ──────────────────────────────────────────────
      ctx.font = 'bold 13px ui-monospace, monospace'
      ctx.textAlign = 'left'
      ctx.fillStyle = '#e2e8f0'
      const rows = [
        [`θ = ${(theta * rad2deg).toFixed(1)}°`, '#38bdf8'],
        [`α = ${alphaDeg.toFixed(1)}°`, departed ? '#f87171' : '#34d399'],
        [`q = ${(q * rad2deg).toFixed(0)}°/s`, '#a78bfa'],
        [`δ = ${(delta * rad2deg).toFixed(1)}°`, '#fbbf24'],
      ] as const
      let ry = 22
      for (const [txt, col] of rows) {
        ctx.fillStyle = col as string
        ctx.fillText(txt as string, 12, ry)
        ry += 18
      }
      // command + sim clock
      ctx.fillStyle = '#94a3b8'
      ctx.font = '11px ui-monospace, monospace'
      ctx.textAlign = 'right'
      ctx.fillText(`u = ${engine.u.toFixed(0)}%  (δcmd ${(deltaCmdFromU(engine.u) * rad2deg).toFixed(1)}°)`, W - 12, H - 30)
      ctx.fillText(`setpoint θ = ${p.setpoint.toFixed(1)}°`, W - 12, H - 16)
      ctx.textAlign = 'left'
      ctx.fillText(`t = ${engine.t.toFixed(1)} s (sim)`, 12, H - 12)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="cursor-pointer"
        title="Click to hit the jet with a +5° α gust"
        onClick={() => engine.applyImpulse(gustHit)}
      />
      <div className="absolute right-2 top-2 flex gap-1.5">
        <button
          className="rounded bg-sky-900/70 px-2 py-1 text-xs text-sky-200 hover:bg-sky-800"
          onClick={() => engine.applyImpulse(gustHit)}
        >
          Gust hit (+5° α)
        </button>
        <button
          className="rounded bg-amber-900/70 px-2 py-1 text-xs text-amber-200 hover:bg-amber-800"
          onClick={() => engine.applyImpulse(noseWhack)}
        >
          Nose whack (q +0.5)
        </button>
      </div>
    </div>
  )
}
