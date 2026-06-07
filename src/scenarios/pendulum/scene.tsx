import { useEffect, useRef } from 'react'
import { engine } from '../../state/engine'
import { useStore } from '../../state/store'
import { CART, forceFromU } from './plant'

/** Poke the pole tip: φ̇ += 0.3 rad/s (click / button), shared with descriptor. */
export const pokePole = (x: number[]) => {
  const n = x.slice()
  n[3] += 0.3
  return n
}
/** Shove the cart: ẋ += 0.5 m/s. */
export const pokeCart = (x: number[]) => {
  const n = x.slice()
  n[1] += 0.5
  return n
}

/**
 * Side-view cart on a rail with end bumpers, a pole hinged on the cart with a
 * bob, a faint "upright" ghost line, the actuator force as a horizontal arrow,
 * and a cart-position drift bar under the rail (the SISO drift meter). When the
 * pole falls (|φ|>30°) or the cart hits a rail end (|x|≥track), the sim freezes
 * (the plant zeroes its derivative) and a flag blinks until Reset.
 *
 * The drawn cart x and pole angle are eased toward the sim state at a wall-clock
 * rate so the motion reads smoothly under time acceleration (cruise/jet pattern).
 * Click anywhere = poke the pole.
 */
export function PendulumScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const wrap = wrapRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let xShown = 0
    let phiShown = 0
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
      ctx.clearRect(0, 0, W, H)

      const p = useStore.getState()
      if (engine.x.length < 4) return
      const xCart = engine.x[0]
      const phi = engine.x[2]
      const F = forceFromU(engine.u) + (p.dist.nudge ?? 0)
      const phiDeg = phi * CART.rad2deg
      const fallen = Math.abs(phiDeg) > CART.fallen
      const atWall = Math.abs(xCart) >= CART.track - 1e-3

      const now = performance.now()
      const dtReal = Math.min(0.1, (now - lastNow) / 1000)
      lastNow = now
      const ease = 1 - Math.exp(-dtReal / 0.05)
      xShown += (xCart - xShown) * ease
      phiShown += (phi - phiShown) * ease

      // ----- rail geometry -----
      const railY = H * 0.62
      const railMargin = 56
      const railHalf = (W - 2 * railMargin) / 2
      const railCx = W / 2
      const pxPerM = railHalf / CART.track // x = ±track maps to the bumpers
      const cartXpx = railCx + xShown * pxPerM

      // rail
      ctx.strokeStyle = '#475569'
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.moveTo(railCx - railHalf, railY)
      ctx.lineTo(railCx + railHalf, railY)
      ctx.stroke()
      // end bumpers
      for (const s of [-1, 1]) {
        const bx = railCx + s * railHalf
        ctx.fillStyle = atWall && Math.sign(xShown) === s ? '#ef4444' : '#64748b'
        ctx.fillRect(bx - (s < 0 ? 6 : 0), railY - 26, 6, 52)
      }
      // tick at center (cart home)
      ctx.strokeStyle = '#334155'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(railCx, railY - 8)
      ctx.lineTo(railCx, railY + 8)
      ctx.stroke()

      // ----- upright ghost line (where the pole should be) -----
      const poleLenPx = Math.min(H * 0.34, railHalf * 0.9)
      ctx.strokeStyle = 'rgba(74,222,128,0.35)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([5, 5])
      ctx.beginPath()
      ctx.moveTo(cartXpx, railY - 14)
      ctx.lineTo(cartXpx, railY - 14 - poleLenPx)
      ctx.stroke()
      ctx.setLineDash([])

      // ----- cart -----
      const cartW = 70
      const cartH = 28
      ctx.fillStyle = '#1e40af'
      ctx.strokeStyle = '#3b82f6'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.roundRect(cartXpx - cartW / 2, railY - cartH / 2, cartW, cartH, 4)
      ctx.fill()
      ctx.stroke()
      // wheels
      ctx.fillStyle = '#0f172a'
      for (const wx of [-cartW * 0.3, cartW * 0.3]) {
        ctx.beginPath()
        ctx.arc(cartXpx + wx, railY + cartH / 2, 6, 0, Math.PI * 2)
        ctx.fill()
      }

      // ----- pole (φ from upright; +φ leans toward +x = right) -----
      const pivotX = cartXpx
      const pivotY = railY - 14
      // screen: up is −y. A +φ (lean right) rotates the pole clockwise toward +x.
      const tipX = pivotX + Math.sin(phiShown) * poleLenPx
      const tipY = pivotY - Math.cos(phiShown) * poleLenPx
      ctx.strokeStyle = fallen ? '#f87171' : '#e2e8f0'
      ctx.lineWidth = 5
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(pivotX, pivotY)
      ctx.lineTo(tipX, tipY)
      ctx.stroke()
      ctx.lineCap = 'butt'
      // bob
      ctx.fillStyle = fallen ? '#ef4444' : '#fbbf24'
      ctx.beginPath()
      ctx.arc(tipX, tipY, 10, 0, Math.PI * 2)
      ctx.fill()
      // pivot
      ctx.fillStyle = '#94a3b8'
      ctx.beginPath()
      ctx.arc(pivotX, pivotY, 4, 0, Math.PI * 2)
      ctx.fill()

      // ----- force arrow (under the cart) -----
      if (Math.abs(F) > 0.05) {
        const fLen = Math.min(60, Math.abs(F) * 5)
        const dir = Math.sign(F)
        const ay = railY + cartH / 2 + 18
        const ax0 = cartXpx
        const ax1 = cartXpx + dir * fLen
        ctx.strokeStyle = '#f59e0b'
        ctx.fillStyle = '#f59e0b'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(ax0, ay)
        ctx.lineTo(ax1, ay)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(ax1, ay)
        ctx.lineTo(ax1 - dir * 8, ay - 4)
        ctx.lineTo(ax1 - dir * 8, ay + 4)
        ctx.closePath()
        ctx.fill()
        ctx.font = '10px ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.fillText(`F = ${F.toFixed(1)} N`, cartXpx, ay + 16)
      }

      // ----- cart-position drift bar (THE SISO meter) -----
      const barY = H - 26
      const barW = railHalf * 2
      const barX = railCx - railHalf
      ctx.fillStyle = '#1e293b'
      ctx.fillRect(barX, barY, barW, 8)
      // danger zones near the ends
      ctx.fillStyle = 'rgba(239,68,68,0.25)'
      ctx.fillRect(barX, barY, barW * 0.12, 8)
      ctx.fillRect(barX + barW * 0.88, barY, barW * 0.12, 8)
      // marker
      const frac = (xShown / CART.track + 1) / 2
      const mx = barX + Math.min(1, Math.max(0, frac)) * barW
      ctx.fillStyle = Math.abs(xShown) > CART.track * 0.8 ? '#ef4444' : '#38bdf8'
      ctx.beginPath()
      ctx.arc(mx, barY + 4, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#64748b'
      ctx.font = '10px ui-monospace, monospace'
      ctx.textAlign = 'left'
      ctx.fillText('cart x (drift)', barX, barY - 4)
      ctx.textAlign = 'right'
      ctx.fillText(`±${CART.track} m`, barX + barW, barY - 4)

      // ----- failure flags -----
      if (fallen || atWall) {
        const blink = (Math.sin(now / 90) + 1) / 2
        ctx.fillStyle = `rgba(248,113,113,${0.55 + 0.45 * blink})`
        ctx.font = 'bold 22px ui-sans-serif, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(fallen ? 'FALLEN' : 'HIT TRACK END', W / 2, H * 0.2)
        ctx.strokeStyle = `rgba(248,113,113,${0.4 + 0.4 * blink})`
        ctx.lineWidth = 3
        ctx.strokeRect(3, 3, W - 6, H - 6)
        ctx.fillStyle = '#fca5a5'
        ctx.font = '11px ui-monospace, monospace'
        ctx.fillText('press Reset to recover', W / 2, H * 0.2 + 20)
      }

      // ----- readouts -----
      ctx.textAlign = 'left'
      ctx.font = 'bold 13px ui-monospace, monospace'
      const rows: [string, string][] = [
        [`φ = ${phiDeg.toFixed(2)}°`, fallen ? '#f87171' : '#34d399'],
        [`x = ${xCart.toFixed(3)} m`, Math.abs(xCart) > CART.track * 0.8 ? '#f87171' : '#38bdf8'],
        [`φ̇ = ${(engine.x[3] * CART.rad2deg).toFixed(0)}°/s`, '#a78bfa'],
      ]
      let ry = 22
      for (const [t, c] of rows) {
        ctx.fillStyle = c
        ctx.fillText(t, 12, ry)
        ry += 18
      }
      ctx.fillStyle = '#94a3b8'
      ctx.font = '11px ui-monospace, monospace'
      ctx.textAlign = 'right'
      ctx.fillText(`u = ${engine.u.toFixed(0)}%`, W - 12, 18)
      ctx.fillText(`r = ${p.setpoint.toFixed(1)}°`, W - 12, 33)
      ctx.textAlign = 'left'
      ctx.fillText(`t = ${engine.t.toFixed(1)} s (sim)`, 12, H - 38)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="cursor-pointer"
        title="Click to poke the pole (+0.3 rad/s)"
        onClick={() => engine.applyImpulse(pokePole)}
      />
      <div className="absolute right-2 top-2 flex gap-1.5">
        <button
          className="rounded bg-amber-900/70 px-2 py-1 text-xs text-amber-200 hover:bg-amber-800"
          onClick={() => engine.applyImpulse(pokePole)}
        >
          Poke pole
        </button>
        <button
          className="rounded bg-sky-900/70 px-2 py-1 text-xs text-sky-200 hover:bg-sky-800"
          onClick={() => engine.applyImpulse(pokeCart)}
        >
          Poke cart
        </button>
      </div>
    </div>
  )
}
