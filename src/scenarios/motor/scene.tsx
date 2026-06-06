import { useEffect, useRef } from 'react'
import { engine } from '../../state/engine'
import { useStore } from '../../state/store'
import { MOTOR } from './plant'

/** Velocity impulse helpers, shared with the descriptor. */
export const whackOmega = (deltaOmega: number) => (x: number[]) => {
  const next = x.slice()
  next[1] = next[1] + deltaOmega // ω += Δω rad/s
  return next
}

/**
 * Canvas scene: a rotary dial showing shaft angle, ghost needle at setpoint,
 * torque arc arrow, load-torque arrow, and slight motion blur proportional
 * to ω. Click the disc to apply a +5 rad/s velocity impulse (whack).
 */
export function MotorScene() {
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
      if (engine.x.length < 2) return

      const theta = engine.x[0]   // rad
      const omega = engine.x[1]   // rad/s
      const thetaDeg = theta * MOTOR.rad2deg
      const setpointDeg = p.setpoint  // degrees
      const setpointRad = setpointDeg * MOTOR.deg2rad

      const load = p.dist.load ?? 0
      const tauM = ((engine.u - 50) / 50) * 0.5  // N·m from current u
      const tauNet = tauM - load

      // ----- layout -----
      const cx_ = W / 2
      const cy_ = H * 0.45
      const R = Math.min(W, H) * 0.28

      // ----- motion-blur shadow (proportional to |ω|) -----
      const blurFrames = Math.min(8, Math.floor(Math.abs(omega) * 0.5))
      const blurAlpha = Math.min(0.12, Math.abs(omega) * 0.015)
      for (let i = 1; i <= blurFrames; i++) {
        const blurTheta = theta - omega * 0.015 * i
        ctx.save()
        ctx.globalAlpha = blurAlpha * (1 - i / (blurFrames + 1))
        ctx.translate(cx_, cy_)
        ctx.rotate(blurTheta - Math.PI / 2)
        ctx.beginPath()
        ctx.arc(0, 0, R * 0.08, 0, Math.PI * 2)
        ctx.fillStyle = '#38bdf8'
        ctx.fill()
        ctx.restore()
      }

      // ----- disc body -----
      ctx.save()
      ctx.translate(cx_, cy_)
      // Outer ring
      ctx.beginPath()
      ctx.arc(0, 0, R, 0, Math.PI * 2)
      const grad = ctx.createRadialGradient(-R * 0.25, -R * 0.25, 0, 0, 0, R)
      grad.addColorStop(0, '#334155')
      grad.addColorStop(1, '#1e293b')
      ctx.fillStyle = grad
      ctx.fill()
      ctx.strokeStyle = '#475569'
      ctx.lineWidth = 3
      ctx.stroke()

      // Tick marks (every 30°)
      for (let a = 0; a < 360; a += 30) {
        const rad = (a * Math.PI) / 180
        const inner = a % 90 === 0 ? R * 0.78 : R * 0.85
        ctx.beginPath()
        ctx.moveTo(Math.cos(rad) * inner, Math.sin(rad) * inner)
        ctx.lineTo(Math.cos(rad) * R * 0.95, Math.sin(rad) * R * 0.95)
        ctx.strokeStyle = a % 90 === 0 ? '#94a3b8' : '#475569'
        ctx.lineWidth = a % 90 === 0 ? 2 : 1
        ctx.stroke()
      }
      ctx.restore()

      // ----- ghost needle at setpoint (green, dashed) -----
      ctx.save()
      ctx.translate(cx_, cy_)
      ctx.rotate(setpointRad - Math.PI / 2)
      ctx.setLineDash([6, 4])
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.55)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(R * 0.85, 0)
      ctx.stroke()
      ctx.setLineDash([])
      // dot at setpoint tip
      ctx.beginPath()
      ctx.arc(R * 0.85, 0, 5, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(74, 222, 128, 0.6)'
      ctx.fill()
      ctx.restore()

      // ----- shaft needle (current angle, bright) -----
      ctx.save()
      ctx.translate(cx_, cy_)
      ctx.rotate(theta - Math.PI / 2)
      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(-R * 0.12, 0)
      ctx.lineTo(R * 0.82, 0)
      ctx.stroke()
      // needle hub
      ctx.beginPath()
      ctx.arc(0, 0, R * 0.09, 0, Math.PI * 2)
      ctx.fillStyle = '#1e293b'
      ctx.fill()
      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = 2
      ctx.stroke()
      // tip dot
      ctx.beginPath()
      ctx.arc(R * 0.82, 0, 5, 0, Math.PI * 2)
      ctx.fillStyle = '#38bdf8'
      ctx.fill()
      ctx.restore()

      // ----- torque arc arrow (motor torque, magnitude + direction) -----
      if (Math.abs(tauM) > 0.005) {
        const arcR = R * 0.55
        const tauFrac = tauM / MOTOR.tauMax   // −1..+1
        const sweepAngle = Math.min(Math.PI * 0.6, Math.abs(tauFrac) * Math.PI * 0.6)
        const startAngle = theta - Math.PI / 2
        const endAngle = tauM > 0 ? startAngle + sweepAngle : startAngle - sweepAngle
        const tauColor = tauM > 0 ? '#fbbf24' : '#f87171'

        ctx.save()
        ctx.translate(cx_, cy_)
        ctx.beginPath()
        ctx.arc(0, 0, arcR, startAngle, endAngle, tauM < 0)
        ctx.strokeStyle = tauColor
        ctx.lineWidth = 3.5
        ctx.stroke()
        // Arrowhead
        const arrowEnd = tauM > 0 ? endAngle : endAngle
        const arrowDir = tauM > 0 ? 1 : -1
        const ax = Math.cos(arrowEnd) * arcR
        const ay = Math.sin(arrowEnd) * arcR
        const tangentAngle = arrowEnd + arrowDir * Math.PI / 2
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(ax + Math.cos(tangentAngle - 0.4) * 8, ay + Math.sin(tangentAngle - 0.4) * 8)
        ctx.lineTo(ax + Math.cos(tangentAngle + 0.4) * 8, ay + Math.sin(tangentAngle + 0.4) * 8)
        ctx.closePath()
        ctx.fillStyle = tauColor
        ctx.fill()
        ctx.restore()

        // Torque label
        ctx.fillStyle = tauColor
        ctx.font = '11px ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.fillText(`τ_m = ${tauM.toFixed(3)} N·m`, cx_, cy_ + R + 22)
      }

      // ----- load torque arrow (when load ≠ 0) -----
      if (Math.abs(load) > 0.001) {
        const lx = cx_ + R * 1.25
        const ly = cy_
        const loadColor = '#c084fc'
        const arrowLen = 20 + Math.abs(load / MOTOR.tauMax) * 30
        const dir = load > 0 ? 1 : -1
        ctx.save()
        ctx.translate(lx, ly)
        ctx.beginPath()
        ctx.moveTo(0, -arrowLen * dir)
        ctx.lineTo(0, arrowLen * dir)
        ctx.strokeStyle = loadColor
        ctx.lineWidth = 3
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(0, arrowLen * dir)
        ctx.lineTo(-5, arrowLen * dir - dir * 10)
        ctx.lineTo(5, arrowLen * dir - dir * 10)
        ctx.closePath()
        ctx.fillStyle = loadColor
        ctx.fill()
        ctx.restore()
        ctx.fillStyle = loadColor
        ctx.font = '11px ui-monospace, monospace'
        ctx.textAlign = 'left'
        ctx.fillText(`τ_load = ${load.toFixed(3)} N·m`, lx + 10, ly + 4)
      }

      // ----- angle readouts -----
      ctx.fillStyle = '#94a3b8'
      ctx.font = '12px ui-monospace, monospace'
      ctx.textAlign = 'left'
      ctx.fillText(`θ = ${thetaDeg.toFixed(1)}°`, 12, H - 54)
      ctx.fillText(`r = ${setpointDeg.toFixed(1)}°`, 12, H - 36)
      ctx.fillText(`ω = ${(omega * MOTOR.rad2deg).toFixed(1)} °/s`, 12, H - 18)
      ctx.textAlign = 'right'
      ctx.fillText(`u = ${engine.u.toFixed(1)}%`, W - 12, H - 36)
      ctx.fillText(`t = ${engine.t.toFixed(1)} s (sim)`, W - 12, H - 18)

      // ----- net-torque indicator -----
      const netColor = Math.abs(tauNet) < 0.01 ? '#4ade80' : '#f59e0b'
      ctx.fillStyle = netColor
      ctx.textAlign = 'center'
      ctx.fillText(`τ_net = ${tauNet.toFixed(3)} N·m`, cx_, cy_ + R + 40)

      // ---- ω speed ring (thin arc outside disc) -----
      const omegaFrac = Math.max(-1, Math.min(1, omega / 30))  // saturate at ±30 rad/s
      if (Math.abs(omegaFrac) > 0.01) {
        ctx.save()
        ctx.translate(cx_, cy_)
        ctx.beginPath()
        ctx.arc(0, 0, R + 8, -Math.PI / 2, -Math.PI / 2 + omegaFrac * Math.PI * 2, omega < 0)
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)'
        ctx.lineWidth = 4
        ctx.stroke()
        ctx.restore()
      }
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="cursor-pointer"
        title="Click to apply +5 rad/s velocity impulse (whack)"
        onClick={() => engine.applyImpulse(whackOmega(5))}
      />
      <div className="absolute right-2 top-2 flex gap-1.5">
        <button
          className="rounded bg-sky-900/70 px-2 py-1 text-xs text-sky-200 hover:bg-sky-800"
          title="Apply +5 rad/s velocity impulse"
          onClick={() => engine.applyImpulse(whackOmega(5))}
        >
          Whack +5 rad/s
        </button>
        <button
          className="rounded bg-sky-900/70 px-2 py-1 text-xs text-sky-200 hover:bg-sky-800"
          title="Apply −5 rad/s velocity impulse"
          onClick={() => engine.applyImpulse(whackOmega(-5))}
        >
          Whack −5 rad/s
        </button>
      </div>
    </div>
  )
}
