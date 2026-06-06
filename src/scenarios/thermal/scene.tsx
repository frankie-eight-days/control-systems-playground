import { useEffect, useRef } from 'react'
import { engine } from '../../state/engine'
import { useStore } from '../../state/store'
import { THERMAL, thermalPlant } from './plant'

/**
 * Canvas scene for the espresso-boiler scenario.
 *
 * Elements:
 *  - Boiler vessel with water level (always full, coloured by temperature)
 *  - Heating element glowing ∝ DELAYED power (p_out state)
 *  - Delay visualiser: a "pipe" with 3 slugs showing the command traveling
 *    through the dead-time lag before reaching the element
 *  - Thermometer column on the right
 *  - Steam wisps above 95 °C
 *  - Lid that opens visually when lossMult > 1
 *  - Setpoint line on thermometer
 *  - Click = add cold water impulse (−15 °C to boiler temperature)
 */
export function ThermalScene() {
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
      if (engine.x.length < 3) return

      const T = engine.x[0]            // boiler temperature (°C)
      const p2 = engine.x[2]           // Padé state — tracks derivative of delayed signal
      const lossMult = p.dist.lossMult ?? 1
      const tamb = p.dist.tamb ?? 22
      const t = engine.t

      // Padé output (delayed power fraction, matches deriv formula)
      const uNorm = Math.min(1, Math.max(0, engine.u / 100))
      const PADE_A = THERMAL.theta / 2   // 1.5
      const pOutNorm = Math.min(1, Math.max(0, uNorm - 2 * PADE_A * p2))

      // Temperature normalised for colour [tamb..200]
      const tNorm = Math.min(1, Math.max(0, (T - tamb) / (180 - tamb)))

      // ---- Layout ----
      const boilerW = Math.min(W * 0.36, 220)
      const boilerH = Math.min(H * 0.52, 260)
      const boilerX = W * 0.12
      const boilerY = H * 0.22
      const lidGap = lossMult > 1.05 ? 14 * Math.min(1, (lossMult - 1) / 2) : 0

      // ---- Boiler body ----
      // Water colour: cool = dark blue, warm = orange, hot = red-orange
      const waterR = Math.round(20 + tNorm * 235)
      const waterG = Math.round(60 + tNorm * (tNorm < 0.5 ? 80 : -60 * (tNorm - 0.5) * 2))
      const waterB = Math.round(200 - tNorm * 170)
      const waterColor = `rgb(${waterR},${waterG},${waterB})`
      const waterGrad = ctx.createLinearGradient(boilerX, boilerY + boilerH, boilerX, boilerY)
      waterGrad.addColorStop(0, waterColor)
      waterGrad.addColorStop(1, `rgba(${waterR},${waterG},${waterB},0.6)`)

      // Vessel walls
      ctx.strokeStyle = '#475569'
      ctx.lineWidth = 6

      // Lid
      const lidY = boilerY - lidGap
      ctx.fillStyle = '#334155'
      ctx.beginPath()
      ctx.roundRect(boilerX - 6, lidY - 10, boilerW + 12, 12, 4)
      ctx.fill()
      ctx.stroke()
      if (lidGap > 1) {
        ctx.fillStyle = 'rgba(255,200,100,0.3)'
        ctx.fillRect(boilerX, boilerY - lidGap + 2, boilerW, lidGap - 2)
      }

      // Main vessel
      ctx.beginPath()
      ctx.moveTo(boilerX, boilerY)
      ctx.lineTo(boilerX, boilerY + boilerH)
      ctx.lineTo(boilerX + boilerW, boilerY + boilerH)
      ctx.lineTo(boilerX + boilerW, boilerY)
      ctx.stroke()

      // Water fill
      ctx.fillStyle = waterGrad
      ctx.fillRect(boilerX + 3, boilerY + 3, boilerW - 6, boilerH - 6)

      // Gentle ripple on water surface
      ctx.save()
      ctx.beginPath()
      ctx.rect(boilerX + 3, boilerY + 3, boilerW - 6, boilerH - 6)
      ctx.clip()
      ctx.beginPath()
      ctx.moveTo(boilerX + 3, boilerY + 5)
      for (let rx = 0; rx <= boilerW - 6; rx += 5) {
        ctx.lineTo(boilerX + 3 + rx, boilerY + 5 + Math.sin(rx * 0.18 + t * 1.2) * 2)
      }
      ctx.lineTo(boilerX + boilerW - 3, boilerY + 3)
      ctx.lineTo(boilerX + 3, boilerY + 3)
      ctx.closePath()
      ctx.fillStyle = `rgba(${waterR + 20},${waterG + 20},${waterB + 20},0.3)`
      ctx.fill()
      ctx.restore()

      // ---- Heating element (bottom of boiler, glows with delayed power) ----
      const elemY = boilerY + boilerH - 22
      const elemX1 = boilerX + boilerW * 0.18
      const elemX2 = boilerX + boilerW * 0.82
      const elemGlow = pOutNorm
      if (elemGlow > 0.02) {
        // Glow halo
        const gGrad = ctx.createRadialGradient(
          (elemX1 + elemX2) / 2, elemY, 0,
          (elemX1 + elemX2) / 2, elemY, 40 * elemGlow,
        )
        gGrad.addColorStop(0, `rgba(255,150,30,${elemGlow * 0.55})`)
        gGrad.addColorStop(1, 'rgba(255,100,0,0)')
        ctx.fillStyle = gGrad
        ctx.fillRect(boilerX + 3, elemY - 30, boilerW - 6, 50)
      }
      // Element coil lines
      const elemR = Math.round(180 + elemGlow * 75)
      const elemG = Math.round(80 + elemGlow * 20)
      ctx.strokeStyle = `rgb(${elemR},${elemG},30)`
      ctx.lineWidth = 5
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(elemX1, elemY)
      ctx.lineTo(elemX2, elemY)
      ctx.stroke()
      ctx.lineWidth = 3
      ctx.strokeStyle = `rgba(${elemR},${elemG + 40},60,0.4)`
      ctx.beginPath()
      ctx.moveTo(elemX1, elemY - 5)
      ctx.lineTo(elemX2, elemY - 5)
      ctx.stroke()

      // ---- Dead-time delay visualiser (pipe from command knob to element) ----
      //
      // A short horizontal "conveyor pipe" left of the boiler.  Three slugs
      // (representing the commanded power) travel rightward at speed 1/θ
      // through the pipe.  This makes the 3 s delay tangible.
      const pipeY = boilerY + boilerH * 0.7
      const pipeX0 = 8
      const pipeX1 = boilerX - 4
      const pipeLen = pipeX1 - pipeX0
      ctx.strokeStyle = '#475569'
      ctx.lineWidth = 12
      ctx.lineCap = 'butt'
      ctx.beginPath()
      ctx.moveTo(pipeX0, pipeY)
      ctx.lineTo(pipeX1, pipeY)
      ctx.stroke()
      // Pipe label
      ctx.fillStyle = '#64748b'
      ctx.font = '10px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillText(`delay θ=${THERMAL.theta}s`, (pipeX0 + pipeX1) / 2, pipeY + 18)

      // Three slugs; fraction of pipe traversed = (t % θ)/θ
      const theta = THERMAL.theta
      for (let slug = 0; slug < 3; slug++) {
        const offset = (slug / 3) * theta
        const phase = ((t + offset) % theta) / theta
        const sx = pipeX0 + phase * pipeLen
        // Only draw slug if it's within the pipe
        if (sx > pipeX0 + 4 && sx < pipeX1 - 4) {
          const slugBright = uNorm
          ctx.fillStyle = `rgba(${Math.round(255 * slugBright)},${Math.round(100 * slugBright)},30,0.8)`
          ctx.beginPath()
          ctx.arc(sx, pipeY, 5, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      // Arrow from pipe to boiler side
      ctx.strokeStyle = '#475569'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(pipeX1, pipeY)
      ctx.lineTo(boilerX, elemY)
      ctx.stroke()

      // Command label at left of pipe
      ctx.fillStyle = '#94a3b8'
      ctx.font = '11px ui-monospace, monospace'
      ctx.textAlign = 'left'
      ctx.fillText(`u=${engine.u.toFixed(0)}%`, pipeX0, pipeY - 10)
      ctx.fillText(`P_cmd=${(uNorm * THERMAL.Pmax).toFixed(0)}W`, pipeX0, pipeY - 24)
      // Delayed output below pipe
      ctx.fillStyle = `rgba(${Math.round(180 + pOutNorm * 75)},100,30,0.9)`
      ctx.textAlign = 'left'
      ctx.fillText(`P_del=${(pOutNorm * THERMAL.Pmax).toFixed(0)}W`, pipeX0, pipeY + 30)

      // ---- Thermometer (right side) ----
      const thermX = boilerX + boilerW + 30
      const thermTop = boilerY
      const thermBot = boilerY + boilerH
      const thermH = thermBot - thermTop
      const thermW = 16

      // Background bar
      ctx.fillStyle = '#1e293b'
      ctx.fillRect(thermX, thermTop, thermW, thermH)
      ctx.strokeStyle = '#475569'
      ctx.lineWidth = 2
      ctx.strokeRect(thermX, thermTop, thermW, thermH)

      // Temperature range: display 15–160 °C (per spec)
      const tMin = 15
      const tMax = 160
      const tClamped = Math.min(tMax, Math.max(tMin, T))
      const tFrac = (tClamped - tMin) / (tMax - tMin)
      const fillH = tFrac * thermH

      // Mercury gradient
      const mercGrad = ctx.createLinearGradient(thermX, thermBot, thermX, thermTop)
      mercGrad.addColorStop(0, '#1d4ed8')
      mercGrad.addColorStop(0.4, '#f59e0b')
      mercGrad.addColorStop(1, '#ef4444')
      ctx.fillStyle = mercGrad
      ctx.fillRect(thermX + 2, thermBot - fillH, thermW - 4, fillH)

      // Setpoint line on thermometer
      const spFrac = (Math.min(tMax, Math.max(tMin, p.setpoint)) - tMin) / (tMax - tMin)
      const spY = thermBot - spFrac * thermH
      ctx.strokeStyle = '#4ade80'
      ctx.lineWidth = 2
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.moveTo(thermX - 10, spY)
      ctx.lineTo(thermX + thermW + 10, spY)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#4ade80'
      ctx.font = '11px ui-monospace, monospace'
      ctx.textAlign = 'left'
      ctx.fillText(`r=${p.setpoint.toFixed(0)}°C`, thermX + thermW + 14, spY + 4)

      // Temperature readout
      ctx.fillStyle = '#38bdf8'
      ctx.textAlign = 'left'
      ctx.fillText(`T=${T.toFixed(1)}°C`, thermX + thermW + 14, thermTop + 14)

      // Tick marks every 20 °C
      ctx.strokeStyle = '#475569'
      ctx.lineWidth = 1
      ctx.fillStyle = '#94a3b8'
      ctx.font = '9px ui-monospace, monospace'
      for (let tick = 20; tick <= 160; tick += 20) {
        if (tick < tMin || tick > tMax) continue
        const ty = thermBot - ((tick - tMin) / (tMax - tMin)) * thermH
        ctx.beginPath()
        ctx.moveTo(thermX - 4, ty)
        ctx.lineTo(thermX, ty)
        ctx.stroke()
        ctx.textAlign = 'right'
        ctx.fillText(`${tick}`, thermX - 6, ty + 3)
      }

      // ---- Steam wisps (T > 95 °C) ----
      if (T > 95) {
        const steamAlpha = Math.min(1, (T - 95) / 55)
        ctx.save()
        for (let w = 0; w < 4; w++) {
          const wx = boilerX + boilerW * (0.2 + w * 0.2)
          const phase2 = (t * 0.6 + w * 1.1) % 3
          const wy = boilerY - phase2 * 30
          const alpha = steamAlpha * (1 - phase2 / 3) * 0.5
          ctx.fillStyle = `rgba(200,210,230,${alpha})`
          ctx.beginPath()
          ctx.arc(wx + Math.sin(phase2 * 2) * 5, wy, 6 + phase2 * 3, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.restore()
      }

      // ---- On/off hysteresis band on thermometer ----
      if (p.controllerId === 'onoff') {
        const band = p.ctl.band ?? 4
        const hiT = Math.min(tMax, p.setpoint + band / 2)
        const loT = Math.max(tMin, p.setpoint - band / 2)
        const hiFrac = (hiT - tMin) / (tMax - tMin)
        const loFrac = (loT - tMin) / (tMax - tMin)
        const yHi = thermBot - hiFrac * thermH
        const yLo = thermBot - loFrac * thermH
        ctx.fillStyle = 'rgba(74, 222, 128, 0.08)'
        ctx.fillRect(thermX, yHi, thermW, yLo - yHi)
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.4)'
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        for (const ty of [yHi, yLo]) {
          ctx.beginPath()
          ctx.moveTo(thermX - 6, ty)
          ctx.lineTo(thermX + thermW + 6, ty)
          ctx.stroke()
        }
        ctx.setLineDash([])
      }

      // ---- Bottom readouts ----
      const fopdt = thermalPlant.fopdt(lossMult)
      ctx.fillStyle = '#94a3b8'
      ctx.font = '12px ui-monospace, monospace'
      ctx.textAlign = 'left'
      ctx.fillText(`K=${fopdt.K.toFixed(2)} °C/%  τ=${fopdt.tau.toFixed(0)}s  θ=${fopdt.theta}s`, 8, H - 32)
      ctx.fillText(`T_amb=${tamb.toFixed(0)}°C  lossMult=${lossMult.toFixed(1)}`, 8, H - 16)
      ctx.textAlign = 'right'
      ctx.fillText(`t = ${engine.t.toFixed(1)} s (sim)`, W - 8, H - 16)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="cursor-pointer"
        title="Click to add cold water (−15 °C)"
        onClick={() =>
          engine.applyImpulse((x) => {
            const next = x.slice()
            next[0] = Math.max(0, next[0] - 15)
            return next
          })
        }
      />
      <div className="absolute right-2 top-2 flex gap-1.5">
        <button
          className="rounded bg-sky-900/70 px-2 py-1 text-xs text-sky-200 hover:bg-sky-800"
          onClick={() =>
            engine.applyImpulse((x) => {
              const next = x.slice()
              next[0] = Math.max(0, next[0] - 15)
              return next
            })
          }
        >
          Cold water −15°C
        </button>
        <button
          className="rounded bg-orange-900/70 px-2 py-1 text-xs text-orange-200 hover:bg-orange-800"
          onClick={() =>
            engine.applyImpulse((x) => {
              const next = x.slice()
              next[0] = Math.max(0, next[0] - 5)
              return next
            })
          }
        >
          Steam draw −5°C
        </button>
      </div>
    </div>
  )
}
