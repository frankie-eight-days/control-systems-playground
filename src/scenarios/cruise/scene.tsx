import { useEffect, useRef } from 'react'
import { engine } from '../../state/engine'
import { useStore } from '../../state/store'

/**
 * Canvas scene: side-view car on a road that tilts with grade.
 * Wheel spin rate ∝ speed. Wind arrow shown when wind ≠ 0.
 * Grade % posted on a signpost. Speed and setpoint readouts.
 * Click = brake-tap impulse (−10 km/h).
 */
export function CruiseScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const wrap = wrapRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0

    // Visual odometer & wheel phase, advanced at WALL-CLOCK rate so the car
    // reads as "driving at v" regardless of sim time acceleration. Never use
    // t·v as a phase: t grows large, so tiny v changes teleport the phase.
    let odo = 0 // metres (visual)
    let wheelPhase = 0 // rad
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
      const v = engine.x.length > 0 ? Math.max(0, engine.x[0]) : 0
      const vKmh = v * 3.6
      const sp = p.setpoint // km/h
      const grade = p.dist.grade ?? 0
      const wind = p.dist.wind ?? 0

      // advance visual motion by real elapsed time (clamped across tab naps)
      const now = performance.now()
      const dtReal = Math.min(0.1, (now - lastNow) / 1000)
      lastNow = now
      odo += v * dtReal
      // wheel spin: v/r through a visual gear-down, capped below strobe rates
      wheelPhase += Math.min((v / 0.3) * 0.25, 16) * dtReal

      // Road tilt angle — capped for readability (true angle would be tiny)
      const maxGrade = 8
      const tiltDeg = (grade / maxGrade) * 12

      // ─── Road ───────────────────────────────────────────────────────────────
      const roadY = H * 0.72
      const roadH = H * 0.06
      ctx.save()
      // Tilt the road around its left edge
      ctx.translate(0, roadY)
      ctx.rotate((tiltDeg * Math.PI) / 180)

      // Road surface
      ctx.fillStyle = '#374151'
      ctx.fillRect(0, 0, W * 1.1, roadH)

      // Dashed centre line, scrolling with speed
      const dashLen = 36
      const dashGap = 24
      // 8 px per metre of (visual) travel — conveys speed without strobing
      const dashOffset = (odo * 8) % (dashLen + dashGap)
      ctx.strokeStyle = '#fbbf24'
      ctx.lineWidth = 2
      ctx.setLineDash([dashLen, dashGap])
      ctx.lineDashOffset = -dashOffset
      ctx.beginPath()
      ctx.moveTo(0, roadH * 0.5)
      ctx.lineTo(W * 1.1, roadH * 0.5)
      ctx.stroke()
      ctx.setLineDash([])

      // Motion lines on road (speed stripes)
      if (vKmh > 5) {
        ctx.strokeStyle = `rgba(148,163,184,${Math.min(0.5, vKmh / 120)})`
        ctx.lineWidth = 1
        const stripeCount = 4
        const stripeSpacing = W / (stripeCount + 1)
        const stripeLen = Math.min(60, vKmh * 0.6)
        const scrollOffset = (odo * 10) % stripeSpacing
        for (let i = 0; i <= stripeCount + 1; i++) {
          const sx = i * stripeSpacing - scrollOffset
          ctx.beginPath()
          ctx.moveTo(sx, -2)
          ctx.lineTo(sx - stripeLen, -2)
          ctx.stroke()
        }
      }
      ctx.restore()

      // ─── Car body ────────────────────────────────────────────────────────────
      const carW = Math.min(W * 0.28, 140)
      const carH = carW * 0.42
      const carX = W * 0.38 - carW / 2
      // Adjust car Y to sit on the tilted road
      const roadTopAtCar =
        roadY + (W * 0.38) * Math.tan((tiltDeg * Math.PI) / 180)
      const carY = roadTopAtCar - carH - 4

      ctx.save()
      ctx.translate(W * 0.38, roadTopAtCar)
      ctx.rotate((tiltDeg * Math.PI) / 180)
      ctx.translate(-W * 0.38, -roadTopAtCar)

      // Body
      ctx.fillStyle = '#1e40af'
      ctx.beginPath()
      ctx.roundRect(carX, carY, carW, carH * 0.65, 4)
      ctx.fill()

      // Cabin
      ctx.fillStyle = '#1d4ed8'
      const cabInset = carW * 0.15
      const cabW = carW * 0.55
      const cabH = carH * 0.45
      ctx.beginPath()
      ctx.roundRect(carX + cabInset, carY - cabH + 2, cabW, cabH, [6, 6, 0, 0])
      ctx.fill()

      // Windshield / windows
      ctx.fillStyle = 'rgba(186,230,253,0.45)'
      ctx.beginPath()
      ctx.roundRect(carX + cabInset + 4, carY - cabH + 6, cabW - 8, cabH - 4, 3)
      ctx.fill()

      // Headlight
      ctx.fillStyle = '#fef08a'
      ctx.beginPath()
      ctx.ellipse(carX + carW - 8, carY + carH * 0.3, 5, 4, 0, 0, Math.PI * 2)
      ctx.fill()

      // Wheels (two circles)
      const wheelR = carH * 0.28
      const wheelY = carY + carH * 0.65 - 2
      const wheelXs = [carX + carW * 0.2, carX + carW * 0.8]
      const wheelAngle = wheelPhase // integrated, wall-clock spin (see above)

      for (const wx of wheelXs) {
        // Tyre
        ctx.fillStyle = '#1f2937'
        ctx.beginPath()
        ctx.arc(wx, wheelY, wheelR, 0, Math.PI * 2)
        ctx.fill()
        // Rim
        ctx.strokeStyle = '#94a3b8'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(wx, wheelY, wheelR * 0.62, 0, Math.PI * 2)
        ctx.stroke()
        // Spokes
        ctx.lineWidth = 1.5
        for (let i = 0; i < 4; i++) {
          const angle = wheelAngle + (i * Math.PI) / 2
          ctx.beginPath()
          ctx.moveTo(wx, wheelY)
          ctx.lineTo(wx + Math.cos(angle) * wheelR * 0.58, wheelY + Math.sin(angle) * wheelR * 0.58)
          ctx.stroke()
        }
      }

      ctx.restore()

      // ─── Wind arrow ─────────────────────────────────────────────────────────
      if (Math.abs(wind) > 0.2) {
        const arrowY = H * 0.3
        const arrowLen = Math.min(80, Math.abs(wind) * 5)
        const headDir = wind > 0 ? 1 : -1 // headwind+ = arrow pointing right→car
        const arrowX = wind > 0 ? carX - arrowLen - 8 : carX + carW + 8

        ctx.save()
        ctx.strokeStyle = '#67e8f9'
        ctx.fillStyle = '#67e8f9'
        ctx.lineWidth = 2.5
        ctx.beginPath()
        if (wind > 0) {
          ctx.moveTo(arrowX, arrowY)
          ctx.lineTo(arrowX + arrowLen, arrowY)
        } else {
          ctx.moveTo(arrowX + arrowLen, arrowY)
          ctx.lineTo(arrowX, arrowY)
        }
        ctx.stroke()
        // Arrowhead
        const tipX = wind > 0 ? arrowX + arrowLen : arrowX
        ctx.beginPath()
        ctx.moveTo(tipX, arrowY)
        ctx.lineTo(tipX - headDir * 10, arrowY - 5)
        ctx.lineTo(tipX - headDir * 10, arrowY + 5)
        ctx.closePath()
        ctx.fill()
        // Label
        ctx.font = '11px ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.fillText(`wind ${wind > 0 ? '+' : ''}${wind.toFixed(0)} m/s`, arrowX + arrowLen / 2, arrowY - 10)
        ctx.restore()
      }

      // ─── Grade signpost ──────────────────────────────────────────────────────
      if (Math.abs(grade) > 0.05) {
        const signX = W * 0.82
        const signY = roadY - 60

        ctx.strokeStyle = '#64748b'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(signX, signY)
        ctx.lineTo(signX, roadY)
        ctx.stroke()

        ctx.fillStyle = grade > 0 ? '#f87171' : '#4ade80'
        const signW = 62
        const signH = 26
        ctx.beginPath()
        ctx.roundRect(signX - signW / 2, signY - signH / 2, signW, signH, 4)
        ctx.fill()

        ctx.fillStyle = '#0f172a'
        ctx.font = 'bold 12px ui-sans-serif, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(`${grade > 0 ? '+' : ''}${grade.toFixed(0)}%`, signX, signY + 5)
      }

      // ─── Speed and setpoint readouts ─────────────────────────────────────────
      ctx.font = 'bold 20px ui-monospace, monospace'
      ctx.textAlign = 'left'
      ctx.fillStyle = '#38bdf8'
      ctx.fillText(`v = ${vKmh.toFixed(1)} km/h`, 16, 32)

      ctx.fillStyle = '#4ade80'
      ctx.font = '14px ui-monospace, monospace'
      ctx.fillText(`r = ${sp.toFixed(0)} km/h`, 16, 54)

      const err = vKmh - sp
      ctx.fillStyle = Math.abs(err) < 0.5 ? '#4ade80' : '#f59e0b'
      ctx.fillText(`e = ${err > 0 ? '+' : ''}${err.toFixed(1)} km/h`, 16, 72)

      // Throttle readout
      ctx.fillStyle = '#94a3b8'
      ctx.font = '12px ui-monospace, monospace'
      ctx.textAlign = 'right'
      ctx.fillText(`u = ${engine.u.toFixed(1)}%`, W - 12, H - 18)
      ctx.fillText(`t = ${engine.t.toFixed(0)} s (sim)`, W - 12, H - 34)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Brake-tap impulse: −10 km/h = −10/3.6 m/s
  const brakeTap = () =>
    engine.applyImpulse((x) => {
      const next = x.slice()
      next[0] = Math.max(0, next[0] - 10 / 3.6)
      return next
    })

  const accelBump = () =>
    engine.applyImpulse((x) => {
      const next = x.slice()
      next[0] = next[0] + 5 / 3.6
      return next
    })

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="cursor-pointer"
        title="Click to apply brake tap (−10 km/h)"
        onClick={brakeTap}
      />
      <div className="absolute right-2 top-2 flex gap-1.5">
        <button
          className="rounded bg-red-900/70 px-2 py-1 text-xs text-red-200 hover:bg-red-800"
          onClick={brakeTap}
        >
          Brake tap
        </button>
        <button
          className="rounded bg-sky-900/70 px-2 py-1 text-xs text-sky-200 hover:bg-sky-800"
          onClick={accelBump}
        >
          +5 km/h
        </button>
      </div>
    </div>
  )
}
