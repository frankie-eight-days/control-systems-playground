import { useEffect, useRef } from 'react'
import { engine } from '../../state/engine'
import { useStore } from '../../state/store'
import { Kt, PMSM, phaseCurrents, radsToRpm, rpmToRads } from './model'

/* Phase colours (A/B/C) — distinct, EE-conventional R/Y/B-ish. */
const PH = ['#f87171', '#fbbf24', '#38bdf8'] // A red, B amber, C blue
const ROTOR_N = '#ef4444'
const ROTOR_S = '#3b82f6'

/**
 * Visual spin mapping. The true mechanical speed is 1.7–50 rev/s (100–3000
 * rpm) — far past the ~5 rev/s where discrete pole markers strobe at 60 Hz.
 * So the rotor is drawn SLOWED to a legible 0.25–1.5 rev/s: a floor keeps any
 * nonzero rpm visibly turning, a cap keeps 3000 rpm from blurring. The true
 * rpm is always a readout, and the live slow-down ratio is captioned
 * ("rotation shown at N:1") — same honesty note as the dq-axes stylization.
 */
const VIS_MAX_REVPS = 1.5 // drawn rev/s at 3000 rpm
const VIS_MIN_REVPS = 0.25 // floor so low rpm still visibly turns
const RPM_TOP = 3000
/** rpm → drawn mechanical rev/s (signed). 0 rpm ⇒ parked. */
function visualRevps(rpm: number): number {
  if (Math.abs(rpm) < 1) return 0
  const mag = Math.min(VIS_MAX_REVPS, Math.max(VIS_MIN_REVPS, (Math.abs(rpm) / RPM_TOP) * VIS_MAX_REVPS))
  return mag * Math.sign(rpm)
}

/**
 * THE SHOWPIECE — a field-oriented PMSM cross-section, shared by both demos.
 *
 * - Stator ring with 3 winding groups (A/B/C), each glowing ∝ |i_phase|,
 *   the phase currents reconstructed by inverse Park+Clarke from (i_d,i_q,θ_e).
 * - Rotor with N/S magnets drawn at the mechanical angle θ_m.
 * - dq axes pinned to the rotor; the stator-current SPACE VECTOR as a rotating
 *   arrow (length ∝ |i|).
 * - θ is integrated IN-SCENE at a wall-clock-scaled, strobe-capped rate from ω
 *   (the cruise odometer pattern — never t·ω as a phase).
 * - Inset strip: scrolling i_a/i_b/i_c sinusoids from an in-scene ring buffer.
 *
 * Mode (by scenario id):
 *   pmsm-torque — state [i_d,i_q]; speed imposed by the dyno (brake caliper).
 *   pmsm-speed  — state [i_q,ω_m]; load-torque arrow + flywheel scaling jmult.
 */
export function PmsmScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const wrap = wrapRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0

    // In-scene integrated angles, advanced at WALL-CLOCK rate (cruise odometer).
    // thetaM drives the rotor + dq axes; thetaE = p·thetaM is the electrical
    // angle that reconstructs the phase currents. Both spin at a STROBE-CAPPED
    // visual rate while the true rpm is read out separately.
    let thetaM = 0 // mechanical, rad (visual)
    let lastNow = performance.now()

    // Ring buffer for the scrolling i_a/i_b/i_c inset (wall-clock advanced).
    const N = 220
    const buf: [number, number, number][] = Array.from({ length: N }, () => [0, 0, 0])
    let head = 0
    let sampleAcc = 0

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
      const mode = p.scenarioId // 'pmsm-torque' | 'pmsm-speed'
      if (engine.x.length < 2) return

      // ---- read state per mode ----
      let id: number, iq: number, wm: number, jmult = 1
      if (mode === 'pmsm-speed') {
        iq = engine.x[0]
        wm = engine.x[1]
        id = 0 // the inner loop holds i_d = 0; not a state here
        jmult = p.dist.jmult ?? 1
      } else {
        id = engine.x[0]
        iq = engine.x[1]
        wm = rpmToRads(p.dist.dynoRpm ?? 0) // dyno imposes speed
      }
      const rpm = radsToRpm(wm)
      const torque = Kt * iq
      const vdc = mode === 'pmsm-speed' ? PMSM.Vdc : p.dist.vdc ?? PMSM.Vdc
      const imag = Math.hypot(id, iq)

      // ---- advance visual angle at wall-clock rate (cruise odometer) ----
      const now = performance.now()
      const dtReal = Math.min(0.1, (now - lastNow) / 1000)
      lastNow = now
      // Drawn mechanical rev/s (slowed for legibility); rotor angle integrates
      // at this rate. θ_e = p·θ_m so the windings glow at the electrical rate.
      const revps = visualRevps(rpm)
      thetaM += revps * 2 * Math.PI * dtReal
      const thetaE = PMSM.p * thetaM
      // live slow-down ratio for the honesty caption (true rev/s ÷ drawn rev/s)
      const trueRevps = Math.abs(rpm) / 60
      const spinScale = revps !== 0 ? trueRevps / Math.abs(revps) : 0

      // reconstruct physical phase currents from the dq state + electrical angle
      const [ia, ib, ic] = phaseCurrents(id, iq, thetaE)

      // ---- push to scrolling inset buffer (~120 Hz wall clock) ----
      sampleAcc += dtReal
      if (sampleAcc >= 1 / 120) {
        sampleAcc = 0
        head = (head + 1) % N
        buf[head] = [ia, ib, ic]
      }

      // ================= MOTOR CROSS-SECTION =================
      const cx = W * 0.40
      const cy = H * 0.50
      const Rstator = Math.min(W * 0.30, H * 0.40)
      const Rbore = Rstator * 0.62 // stator inner bore
      const Rrotor = Rbore * 0.86

      // stator iron ring
      ctx.lineWidth = Rstator - Rbore
      ctx.strokeStyle = '#27313f'
      ctx.beginPath()
      ctx.arc(cx, cy, (Rstator + Rbore) / 2, 0, Math.PI * 2)
      ctx.stroke()
      ctx.lineWidth = 2
      ctx.strokeStyle = '#475569'
      for (const r of [Rstator, Rbore]) {
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.stroke()
      }

      // 3 winding groups: 3 slots each, 60° apart per phase belt. Glow ∝ |i_ph|.
      const iAbc = [ia, ib, ic]
      const Rmid = (Rstator + Rbore) / 2
      for (let ph = 0; ph < 3; ph++) {
        const belt = (ph * 2 * Math.PI) / 3 // A at 0, B at 120°, C at 240°
        const glow = Math.min(1, Math.abs(iAbc[ph]) / PMSM.Imax)
        for (const side of [0, Math.PI]) {
          // two diametric belts per phase (go & return conductors)
          for (let k = -1; k <= 1; k++) {
            const a = belt + side + k * 0.22
            const sx = cx + Math.cos(a) * Rmid
            const sy = cy + Math.sin(a) * Rmid
            ctx.beginPath()
            ctx.arc(sx, sy, (Rstator - Rbore) * 0.26, 0, Math.PI * 2)
            ctx.fillStyle = PH[ph]
            ctx.globalAlpha = 0.16 + 0.8 * glow
            ctx.fill()
          }
        }
      }
      ctx.globalAlpha = 1

      // phase legend
      ctx.font = '11px ui-monospace, monospace'
      ctx.textAlign = 'left'
      for (let ph = 0; ph < 3; ph++) {
        ctx.fillStyle = PH[ph]
        const yy = 16 + ph * 15
        ctx.fillText(
          `i_${'abc'[ph]} = ${iAbc[ph] >= 0 ? '+' : ''}${iAbc[ph].toFixed(2)} A`,
          12,
          yy,
        )
      }

      // ================= ROTOR (N/S magnets at θ_m) =================
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(thetaM)
      // shaft
      ctx.fillStyle = '#1e293b'
      ctx.beginPath()
      ctx.arc(0, 0, Rrotor, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#64748b'
      ctx.lineWidth = 1.5
      ctx.stroke()
      // p pole-pairs of magnets around the rotor (N/S alternating)
      const poles = PMSM.p * 2
      for (let k = 0; k < poles; k++) {
        const a0 = (k * 2 * Math.PI) / poles
        const a1 = ((k + 1) * 2 * Math.PI) / poles
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.arc(0, 0, Rrotor * 0.96, a0, a1)
        ctx.closePath()
        ctx.fillStyle = k % 2 === 0 ? ROTOR_N : ROTOR_S
        ctx.globalAlpha = 0.85
        ctx.fill()
      }
      ctx.globalAlpha = 1
      // N/S labels on the first pole pair
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 12px ui-sans-serif, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('N', Rrotor * 0.6, 0)
      ctx.fillText('S', -Rrotor * 0.6, 0)
      ctx.textBaseline = 'alphabetic'
      ctx.restore()

      // ================= dq AXES (pinned to rotor) =================
      // d-axis aligned with rotor N (angle θ_m here, since one PM pole points
      // along +d); q-axis 90° (electrical) ahead. We draw them in the
      // mechanical frame for legibility (d along the rotor, q a quarter turn).
      const drawAxis = (ang: number, len: number, color: string, label: string) => {
        const ex = cx + Math.cos(ang) * len
        const ey = cy + Math.sin(ang) * len
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.setLineDash([5, 4])
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(ex, ey)
        ctx.stroke()
        ctx.setLineDash([])
        // arrowhead
        ctx.beginPath()
        ctx.moveTo(ex, ey)
        ctx.lineTo(ex - Math.cos(ang - 0.4) * 9, ey - Math.sin(ang - 0.4) * 9)
        ctx.lineTo(ex - Math.cos(ang + 0.4) * 9, ey - Math.sin(ang + 0.4) * 9)
        ctx.closePath()
        ctx.fillStyle = color
        ctx.fill()
        ctx.fillStyle = color
        ctx.font = 'bold 12px ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.fillText(label, ex + Math.cos(ang) * 12, ey + Math.sin(ang) * 12 + 4)
      }
      const dAng = thetaM // d-axis along rotor N
      const qAng = thetaM - Math.PI / 2 // q leads d by 90° (CCW positive)
      drawAxis(dAng, Rbore * 0.92, '#a78bfa', 'd')
      drawAxis(qAng, Rbore * 0.92, '#34d399', 'q')

      // ================= STATOR CURRENT SPACE VECTOR =================
      // i_s = i_d·d̂ + i_q·q̂, drawn in the same frame as the axes. Length ∝ |i|.
      if (imag > 0.02) {
        const scale = (Rbore * 0.92) / PMSM.Imax
        const vx = cx + (Math.cos(dAng) * id + Math.cos(qAng) * iq) * scale
        const vy = cy + (Math.sin(dAng) * id + Math.sin(qAng) * iq) * scale
        const ang = Math.atan2(vy - cy, vx - cx)
        ctx.strokeStyle = '#f8fafc'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(vx, vy)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(vx, vy)
        ctx.lineTo(vx - Math.cos(ang - 0.4) * 11, vy - Math.sin(ang - 0.4) * 11)
        ctx.lineTo(vx - Math.cos(ang + 0.4) * 11, vy - Math.sin(ang + 0.4) * 11)
        ctx.closePath()
        ctx.fillStyle = '#f8fafc'
        ctx.fill()
        ctx.fillStyle = '#cbd5e1'
        ctx.font = '11px ui-monospace, monospace'
        ctx.textAlign = 'left'
        ctx.fillText(`|i| = ${imag.toFixed(2)} A`, vx + 6, vy - 6)
      }

      // ================= MODE-SPECIFIC LOAD VISUAL =================
      if (mode === 'pmsm-torque') {
        drawDynoCaliper(ctx, cx, cy, Rstator, p.dist.dynoRpm ?? 0)
      } else {
        drawFlywheel(ctx, cx, cy, Rstator, jmult, p.dist.tload ?? 0)
      }

      // ================= SCROLLING i_abc INSET =================
      drawInset(ctx, W, H, buf, head, N)

      // ================= READOUTS =================
      ctx.textAlign = 'right'
      ctx.font = 'bold 15px ui-monospace, monospace'
      ctx.fillStyle = '#38bdf8'
      ctx.fillText(`${rpm.toFixed(0)} rpm`, W - 12, 20)
      // spin honesty caption: true speed is slowed for legibility
      ctx.font = '10px ui-monospace, monospace'
      ctx.fillStyle = '#64748b'
      if (Math.abs(rpm) < 1) {
        ctx.fillStyle = '#f59e0b'
        ctx.fillText('PARKED (locked rotor)', W - 12, 33)
      } else {
        ctx.fillText(`rotation shown at ${spinScale.toFixed(0)}:1`, W - 12, 33)
      }
      ctx.font = '12px ui-monospace, monospace'
      ctx.fillStyle = '#e2e8f0'
      ctx.fillText(`T = ${torque.toFixed(3)} N·m`, W - 12, 52)
      ctx.fillStyle = '#a78bfa'
      ctx.fillText(`i_d = ${id.toFixed(2)} A`, W - 12, 68)
      ctx.fillStyle = '#34d399'
      ctx.fillText(`i_q = ${iq.toFixed(2)} A`, W - 12, 84)
      // v_q as % command (torque mode) — the actuator readout
      ctx.fillStyle = '#fbbf24'
      ctx.fillText(`u = ${engine.u.toFixed(1)} %`, W - 12, 100)
      if (mode === 'pmsm-torque') {
        const vq = ((engine.u - 50) / 50) * (vdc / Math.sqrt(3))
        ctx.fillStyle = '#94a3b8'
        ctx.fillText(`v_q = ${vq.toFixed(1)} V (${((Math.abs(vq) / (vdc / Math.sqrt(3))) * 100).toFixed(0)}% Vmax)`, W - 12, 116)
      }
      ctx.fillStyle = '#64748b'
      ctx.font = '11px ui-monospace, monospace'
      ctx.fillText(`θ_e = ${((thetaE % (2 * Math.PI)) * 180 / Math.PI).toFixed(0)}° (rotor angle, slowed for view)`, W - 12, H - 10)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  // click-to-disturb: a current spike on i_q (torque mode) / speed whack (speed)
  const onClick = () => {
    const mode = useStore.getState().scenarioId
    if (mode === 'pmsm-speed') {
      engine.applyImpulse((x) => {
        const n = x.slice()
        n[1] = n[1] - 20 // ω_m −20 rad/s "load whack"
        return n
      })
    } else {
      engine.applyImpulse((x) => {
        const n = x.slice()
        n[1] = n[1] + 3 // i_q +3 A current spike
        return n
      })
    }
  }

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="cursor-pointer"
        title="Click to disturb (current spike / load whack)"
        onClick={onClick}
      />
      <div className="absolute right-2 bottom-2 flex gap-1.5">
        <button
          className="rounded bg-emerald-900/70 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-800"
          onClick={onClick}
        >
          Disturb
        </button>
      </div>
    </div>
  )
}

/* ----------------------------- sub-drawers ----------------------------- */

/** Dyno brake caliper biting the rotor + imposed-rpm readout (torque mode). */
function drawDynoCaliper(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  Rstator: number,
  dynoRpm: number,
) {
  const r = Rstator + 14
  // caliper at the top
  ctx.fillStyle = '#52525b'
  ctx.beginPath()
  ctx.roundRect(cx - 22, cy - r - 14, 44, 22, 4)
  ctx.fill()
  ctx.fillStyle = dynoRpm > 5 ? '#f59e0b' : '#71717a'
  ctx.beginPath()
  ctx.roundRect(cx - 18, cy - r + 2, 36, 8, 2)
  ctx.fill()
  ctx.fillStyle = '#cbd5e1'
  ctx.font = '11px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.fillText('DYNO', cx, cy - r - 18)
  ctx.fillStyle = '#f59e0b'
  ctx.font = 'bold 12px ui-monospace, monospace'
  ctx.fillText(`imposes ${dynoRpm.toFixed(0)} rpm`, cx, cy + Rstator + 34)
}

/** Flywheel ring scaling with jmult + load-torque arrow (speed mode). */
function drawFlywheel(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  Rstator: number,
  jmult: number,
  tload: number,
) {
  // flywheel rim outside the stator; radius grows with √jmult (mass∝R² feel)
  const Rfw = Rstator + 10 + 16 * Math.sqrt(jmult)
  ctx.strokeStyle = '#475569'
  ctx.lineWidth = 6 + 3 * Math.sqrt(jmult)
  ctx.globalAlpha = 0.5
  ctx.beginPath()
  ctx.arc(cx, cy, Rfw, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.fillStyle = '#64748b'
  ctx.font = '11px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.fillText(`flywheel J×${jmult.toFixed(1)}`, cx, cy + Rfw + 16)

  // load-torque arrow (curved, opposing motion when tload>0)
  if (Math.abs(tload) > 0.02) {
    const dir = tload > 0 ? -1 : 1 // braking torque drawn against +ω (CCW)
    ctx.strokeStyle = tload > 0 ? '#f87171' : '#4ade80'
    ctx.fillStyle = ctx.strokeStyle
    ctx.lineWidth = 3
    const ra = Rfw - 6
    const a0 = -Math.PI / 2
    const a1 = a0 + dir * 1.1
    ctx.beginPath()
    ctx.arc(cx, cy, ra, a0, a1, dir < 0)
    ctx.stroke()
    const ax = cx + Math.cos(a1) * ra
    const ay = cy + Math.sin(a1) * ra
    const tang = a1 + (dir > 0 ? Math.PI / 2 : -Math.PI / 2)
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(ax - Math.cos(tang - 0.4) * 10, ay - Math.sin(tang - 0.4) * 10)
    ctx.lineTo(ax - Math.cos(tang + 0.4) * 10, ay - Math.sin(tang + 0.4) * 10)
    ctx.closePath()
    ctx.fill()
    ctx.font = '11px ui-monospace, monospace'
    ctx.fillText(`T_load ${tload >= 0 ? '+' : ''}${tload.toFixed(2)} N·m`, cx, cy - Rfw - 8)
  }
}

/** Scrolling i_a/i_b/i_c sinusoid strip (bottom-left inset). */
function drawInset(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  buf: [number, number, number][],
  head: number,
  N: number,
) {
  const iw = Math.min(W * 0.34, 240)
  const ih = 64
  const ix = 12
  const iy = H - ih - 26
  ctx.fillStyle = 'rgba(15,23,42,0.75)'
  ctx.strokeStyle = '#334155'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(ix, iy, iw, ih, 4)
  ctx.fill()
  ctx.stroke()
  // zero line
  const mid = iy + ih / 2
  ctx.strokeStyle = '#1e293b'
  ctx.beginPath()
  ctx.moveTo(ix, mid)
  ctx.lineTo(ix + iw, mid)
  ctx.stroke()
  const yscale = (ih / 2 - 4) / PMSM.Imax
  for (let ph = 0; ph < 3; ph++) {
    ctx.strokeStyle = PH[ph]
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let k = 0; k < N; k++) {
      const idx = (head + 1 + k) % N // oldest → newest, left → right
      const v = buf[idx][ph]
      const px = ix + (k / (N - 1)) * iw
      const py = mid - v * yscale
      if (k === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
  }
  ctx.fillStyle = '#64748b'
  ctx.font = '10px ui-monospace, monospace'
  ctx.textAlign = 'left'
  ctx.fillText('i_abc (A) — FOC makes these AC; the dq frame makes them DC', ix, iy - 4)
}
