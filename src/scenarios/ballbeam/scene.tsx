import { useEffect, useRef } from 'react'
import { engine } from '../../state/engine'
import { useStore } from '../../state/store'
import { BB, ballOff, thetaCmdFromU } from './plant'

/** Velocity-impulse helpers, shared with the descriptor. */
export const pokeBall = (dv: number) => (x: number[]) => {
  const next = x.slice()
  if (!ballOff(next[0])) next[1] = next[1] + dv
  return next
}

/**
 * Side-view scene: a beam pivoting at its centre on a stand, a ball rolling
 * on the beam, edge markers that flash red when the ball falls off. The ball
 * rotates visually with travel distance (like a clock face rolling).
 * Setpoint is shown as a green tick on the beam. Click = +0.3 m/s poke.
 */
export function BallBeamScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const wrap = wrapRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    // Accumulated rotation angle for the rolling-ball visual
    let ballRot = 0
    let lastP = 0

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

      const ballP = engine.x[0]      // m
      const ballV = engine.x[1]      // m/s
      const theta = engine.x[2]      // rad (beam angle)
      const tilt = p.dist.tilt ?? 0  // deg mounting bias
      const setpointCm = p.setpoint  // cm
      const off = ballOff(ballP)

      // Accumulate ball rotation: arc = distance travelled / radius
      const BALL_R_M = 0.025  // visual ball radius in beam-length units
      const dp = ballP - lastP
      ballRot += dp / BALL_R_M
      lastP = ballP

      // --- layout ---
      const cx = W * 0.5     // pivot x
      const cy = H * 0.55    // pivot y
      const beamPx = Math.min(W * 0.75, 400)   // half-beam length in pixels
      const scale = beamPx / BB.beamHalf        // pixels per metre

      // beam tilt includes the visual of the mounting bias too
      const thetaEff = theta + tilt * BB.deg2rad

      // --- support stand ---
      ctx.strokeStyle = '#475569'
      ctx.lineWidth = 5
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx - 18, cy + 50)
      ctx.lineTo(cx + 18, cy + 50)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(cx - 30, cy + 50)
      ctx.lineTo(cx + 30, cy + 50)
      ctx.stroke()

      // pivot dot
      ctx.fillStyle = '#94a3b8'
      ctx.beginPath()
      ctx.arc(cx, cy, 6, 0, Math.PI * 2)
      ctx.fill()

      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(-thetaEff)  // negative: positive theta tilts right end down => beam rotates CCW

      // --- beam ---
      const beamThick = 8
      ctx.fillStyle = '#334155'
      ctx.strokeStyle = '#64748b'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.roundRect(-beamPx, -beamThick / 2, beamPx * 2, beamThick, 3)
      ctx.fill()
      ctx.stroke()

      // --- beam groove / rail line ---
      ctx.strokeStyle = '#475569'
      ctx.lineWidth = 1
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.moveTo(-beamPx, 0)
      ctx.lineTo(beamPx, 0)
      ctx.stroke()
      ctx.setLineDash([])

      // --- edge markers (red triangles at ±beamHalf) ---
      const edgeCol = off ? '#ef4444' : '#94a3b8'
      for (const side of [-1, 1]) {
        const ex = side * beamPx
        ctx.fillStyle = edgeCol
        ctx.beginPath()
        ctx.moveTo(ex, -beamThick / 2 - 4)
        ctx.lineTo(ex - side * 7, -beamThick / 2 - 14)
        ctx.lineTo(ex + side * 7, -beamThick / 2 - 14)
        ctx.closePath()
        ctx.fill()
      }

      // --- setpoint ghost tick (green) ---
      const spPx = (setpointCm / 100) * scale
      ctx.strokeStyle = 'rgba(74,222,128,0.65)'
      ctx.lineWidth = 2
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(spPx, -beamThick / 2 - 18)
      ctx.lineTo(spPx, beamThick / 2 + 4)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(74,222,128,0.65)'
      ctx.font = '10px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillText(`r=${setpointCm.toFixed(0)}`, spPx, -beamThick / 2 - 22)

      // --- ball (clamped to beam visually even when off) ---
      const ballPxPos = Math.max(-beamPx, Math.min(beamPx, ballP * scale))
      const ballR = BALL_R_M * scale
      const ballX = ballPxPos
      const ballY = -beamThick / 2 - ballR

      // ball body
      const ballGrad = ctx.createRadialGradient(
        ballX - ballR * 0.3, ballY - ballR * 0.3, 0,
        ballX, ballY, ballR,
      )
      ballGrad.addColorStop(0, '#e2e8f0')
      ballGrad.addColorStop(1, '#64748b')
      ctx.fillStyle = off ? 'rgba(248,113,113,0.6)' : ballGrad
      ctx.beginPath()
      ctx.arc(ballX, ballY, ballR, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = off ? '#ef4444' : '#94a3b8'
      ctx.lineWidth = 1.5
      ctx.stroke()

      // wall-clock pattern: two perpendicular lines rotating with travel
      ctx.save()
      ctx.translate(ballX, ballY)
      ctx.rotate(ballRot)
      ctx.strokeStyle = 'rgba(30,41,59,0.7)'
      ctx.lineWidth = 1.5
      for (let i = 0; i < 2; i++) {
        ctx.rotate(Math.PI / 2)
        ctx.beginPath()
        ctx.moveTo(0, -ballR * 0.85)
        ctx.lineTo(0, ballR * 0.85)
        ctx.stroke()
      }
      ctx.restore()

      // --- tilt-bias indicator (small arc on pivot) ---
      if (Math.abs(tilt) > 0.1) {
        ctx.strokeStyle = '#c084fc'
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.arc(0, 0, 22, -Math.PI / 2, -Math.PI / 2 + tilt * BB.deg2rad * 3, tilt < 0)
        ctx.stroke()
        ctx.fillStyle = '#c084fc'
        ctx.font = '10px ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.fillText(`bias ${tilt > 0 ? '+' : ''}${tilt.toFixed(1)}deg`, 0, 38)
      }

      ctx.restore()  // beam frame

      // --- readouts ---
      ctx.fillStyle = '#94a3b8'
      ctx.font = '12px ui-monospace, monospace'
      ctx.textAlign = 'left'
      ctx.fillText(`p = ${(ballP * 100).toFixed(1)} cm`, 12, H - 54)
      ctx.fillText(`v = ${(ballV * 100).toFixed(1)} cm/s`, 12, H - 36)
      ctx.fillText(`theta = ${(theta * BB.rad2deg).toFixed(2)} deg`, 12, H - 18)
      ctx.textAlign = 'right'
      ctx.fillText(`u = ${engine.u.toFixed(1)}%`, W - 12, H - 36)
      ctx.fillText(`t = ${engine.t.toFixed(1)} s (sim)`, W - 12, H - 18)
      ctx.fillText(
        `theta_cmd = ${(thetaCmdFromU(engine.u) * BB.rad2deg).toFixed(2)} deg`,
        W - 12, H - 54,
      )

      // --- BALL OFF overlay ---
      if (off) {
        const blink = (Math.sin(performance.now() / 120) + 1) / 2
        ctx.fillStyle = `rgba(239,68,68,${0.45 + 0.45 * blink})`
        ctx.font = 'bold 26px ui-sans-serif, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('BALL OFF', W / 2, H * 0.2)
        ctx.fillStyle = `rgba(239,68,68,${0.3 + 0.3 * blink})`
        ctx.strokeStyle = `rgba(239,68,68,${0.4 + 0.4 * blink})`
        ctx.lineWidth = 3
        ctx.strokeRect(3, 3, W - 6, H - 6)
        ctx.fillStyle = '#94a3b8'
        ctx.font = '11px ui-monospace, monospace'
        ctx.fillText('Hit Reset to recover', W / 2, H * 0.2 + 22)
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
        title="Click to poke the ball (+0.3 m/s)"
        onClick={() => engine.applyImpulse(pokeBall(0.3))}
      />
      <div className="absolute right-2 top-2 flex gap-1.5">
        <button
          className="rounded bg-sky-900/70 px-2 py-1 text-xs text-sky-200 hover:bg-sky-800"
          onClick={() => engine.applyImpulse(pokeBall(0.3))}
        >
          Poke +0.3 m/s
        </button>
        <button
          className="rounded bg-sky-900/70 px-2 py-1 text-xs text-sky-200 hover:bg-sky-800"
          onClick={() => engine.applyImpulse(pokeBall(-0.3))}
        >
          Poke -0.3 m/s
        </button>
      </div>
    </div>
  )
}
