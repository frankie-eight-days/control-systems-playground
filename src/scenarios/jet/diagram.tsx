import { useEffect, useRef } from 'react'
import { getController } from '../../controllers/registry'
import { engine } from '../../state/engine'
import { useStore } from '../../state/store'
import { CENTERS, evalFuzzy, RULES, type FuzzyEval } from './fuzzy'
import { JET, MaOfCg } from './plant'

const rad2deg = 180 / Math.PI
const deg2rad = Math.PI / 180

/* ---- shared canvas helpers (same idioms as ui/BlockDiagram.tsx) ---- */
const WIRE = '#64748b'
const MONO = '11px ui-monospace, monospace'

/** Short-period eigenvalues from the 2×2 [α,q] block at this CG (for the badge). */
function shortPeriodReMaxT2(cg: number): { unstable: boolean; reMax: number; t2: number } {
  const Ma = MaOfCg(cg)
  const tr = JET.Zv + JET.Mq
  const det = JET.Zv * JET.Mq - Ma
  const disc = tr * tr - 4 * det
  const reMax = disc >= 0 ? (tr + Math.sqrt(disc)) / 2 : tr / 2
  const unstable = reMax > 1e-4
  return { unstable, reMax, t2: unstable ? Math.LN2 / reMax : Infinity }
}

/** Blue/red ramp for U ∈ [−1,1]: −1 (nose-up) sky · 0 slate · +1 (nose-down) red. */
function surfColor(u: number): string {
  const t = Math.max(-1, Math.min(1, u))
  if (t >= 0) return `rgb(${Math.round(30 + 218 * t)}, ${Math.round(41 + 72 * t)}, ${Math.round(59 - 6 * t)})`
  const k = -t
  return `rgb(${Math.round(30 + 26 * k)}, ${Math.round(41 + 148 * k)}, ${Math.round(59 + 189 * k)})`
}

/**
 * Live signal-flow value computed from the plant + gains every frame. ė is a
 * lightly-filtered −ẏ (render-time read; the controller owns the authoritative
 * filter state). Returns the full fuzzy evaluation plus the crisp e, ė.
 */
type FilterRef = { y: number; d: number; t: number }
function liveFuzzy(filt: FilterRef, ke: number, kde: number, wf: number): FuzzyEval & { e: number; edot: number } {
  const sp = useStore.getState().setpoint
  const y = engine.x.length >= 3 ? engine.x[2] * rad2deg : 0
  const now = engine.t
  if (Number.isFinite(filt.y) && now > filt.t) {
    const dt = Math.max(1e-3, now - filt.t)
    const raw = -(y - filt.y) / dt
    filt.d += (raw - filt.d) * Math.min(1, dt * (wf || 8))
  }
  filt.y = y
  filt.t = now
  const e = sp - y
  const edot = filt.d
  const E = Math.min(1, Math.max(-1, ke * e))
  const Edot = Math.min(1, Math.max(-1, kde * edot))
  return { ...evalFuzzy(E, Edot), e, edot }
}

/**
 * Jet DiagramView — replaces the generic single-loop block diagram, which is
 * the wrong PICTURE for fuzzy control. When the fuzzy controller is active it
 * draws the textbook fuzzy pipeline (error+filter → FUZZIFY → RULE BASE →
 * DEFUZZIFY → ×ku → actuator → airframe → sensor), live, with every wire
 * labelled and the rule grid lighting up as the jet responds. With the linear
 * jet-pid controller it falls back to a simple generic-style loop.
 */
export function JetDiagram() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const filt = useRef<FilterRef>({ y: NaN, d: 0, t: 0 })

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
      const dashOff = -((engine.t * 24) % 12)

      // shared wire/arrow drawing closures (capture ctx + dashOff)
      const line = (pts: [number, number][], color = WIRE, animated = true) => {
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        ctx.setLineDash(animated ? [7, 5] : [])
        ctx.lineDashOffset = animated ? dashOff : 0
        ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1])
        for (const [px, py] of pts.slice(1)) ctx.lineTo(px, py)
        ctx.stroke()
        ctx.setLineDash([])
      }
      const arrow = (x: number, y: number, dir: 'r' | 'l' | 'u' | 'd', color = WIRE) => {
        ctx.fillStyle = color
        ctx.beginPath()
        if (dir === 'r') {
          ctx.moveTo(x, y), ctx.lineTo(x - 8, y - 4), ctx.lineTo(x - 8, y + 4)
        } else if (dir === 'l') {
          ctx.moveTo(x, y), ctx.lineTo(x + 8, y - 4), ctx.lineTo(x + 8, y + 4)
        } else if (dir === 'u') {
          ctx.moveTo(x, y), ctx.lineTo(x - 4, y + 8), ctx.lineTo(x + 4, y + 8)
        } else {
          ctx.moveTo(x, y), ctx.lineTo(x - 4, y - 8), ctx.lineTo(x + 4, y - 8)
        }
        ctx.closePath()
        ctx.fill()
      }
      const label = (x: number, y: number, text: string, color: string, align: CanvasTextAlign = 'center') => {
        ctx.fillStyle = color
        ctx.font = MONO
        ctx.textAlign = align
        ctx.fillText(text, x, y)
      }

      if (s.controllerId === 'fuzzy-pitch') {
        drawFuzzyPipeline(ctx, W, H, s, filt.current, { line, arrow, label })
      } else {
        drawGenericLoop(ctx, W, H, s, { line, arrow, label })
      }
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

/* ----------------------------- fuzzy pipeline ----------------------------- */

interface Draw {
  line: (pts: [number, number][], color?: string, animated?: boolean) => void
  arrow: (x: number, y: number, dir: 'r' | 'l' | 'u' | 'd', color?: string) => void
  label: (x: number, y: number, text: string, color: string, align?: CanvasTextAlign) => void
}

/** A titled rounded stage box; returns its right-edge x for wiring. */
function stageBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  accent = '#94a3b8',
) {
  ctx.fillStyle = '#1e293b'
  ctx.strokeStyle = accent
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 5)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#cbd5e1'
  ctx.font = 'bold 9px ui-sans-serif, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(title, x + w / 2, y + 11)
}

/** Mini 5-triangle membership fan with the live crisp tick + shaded firing. */
function drawMFfan(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  value: number,
  mu: number[],
) {
  const x0 = x + 2
  const x1 = x + w - 2
  const yb = y + h - 2
  const yt = y + 2
  const X = (v: number) => x0 + ((v + 1) / 2) * (x1 - x0)
  const Y = (m: number) => yb - m * (yb - yt)
  const cols = ['#60a5fa', '#7dd3fc', '#94a3b8', '#fca5a5', '#f87171']
  ctx.lineWidth = 1
  for (let i = 0; i < 5; i++) {
    const c = CENTERS[i]
    const pL = i === 0 ? [X(-1), Y(1)] : [X(c - 0.5), Y(0)]
    const pR = i === 4 ? [X(1), Y(1)] : [X(c + 0.5), Y(0)]
    ctx.strokeStyle = cols[i]
    ctx.globalAlpha = 0.55
    ctx.beginPath()
    ctx.moveTo(pL[0], pL[1])
    ctx.lineTo(X(c), Y(1))
    ctx.lineTo(pR[0], pR[1])
    ctx.stroke()
    ctx.globalAlpha = 1
    if (mu[i] > 0.02) {
      ctx.fillStyle = cols[i]
      ctx.globalAlpha = 0.4
      ctx.beginPath()
      ctx.moveTo(X(c), Y(mu[i]))
      ctx.lineTo(X(Math.max(-1, c - 0.5 * mu[i])), Y(0))
      ctx.lineTo(X(Math.min(1, c + 0.5 * mu[i])), Y(0))
      ctx.closePath()
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }
  // live crisp value tick
  ctx.strokeStyle = '#fbbf24'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(X(value), yt)
  ctx.lineTo(X(value), yb)
  ctx.stroke()
}

/** Mini 5×5 rule grid; cells tinted by output set, lit by live firing μ. */
function drawRuleGrid(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cell: number,
  fire: number[][],
) {
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const w = fire[i]?.[j] ?? 0
      const out = RULES[i][j]
      const cx = x + j * cell
      const cy = y + i * cell
      ctx.fillStyle = surfColor(CENTERS[out])
      ctx.globalAlpha = 0.3 + 0.7 * w
      ctx.fillRect(cx + 0.5, cy + 0.5, cell - 1, cell - 1)
      ctx.globalAlpha = 1
      if (w > 0.05) {
        ctx.strokeStyle = '#fbbf24'
        ctx.lineWidth = 1.25
        ctx.strokeRect(cx + 0.5, cy + 0.5, cell - 1, cell - 1)
      }
    }
  }
}

function drawFuzzyPipeline(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  s: ReturnType<typeof useStore.getState>,
  filt: FilterRef,
  d: Draw,
) {
  const ke = s.ctl.ke ?? 0.06
  const kde = s.ctl.kde ?? 0.08
  const ku = s.ctl.ku ?? 0.6
  const wf = s.ctl.wf || 10
  const ev = liveFuzzy(filt, ke, kde, wf)
  const sp = s.setpoint
  const cg = s.dist.cg ?? 0.75
  const theta = engine.x.length >= 3 ? engine.x[2] * rad2deg : 0
  const alpha = engine.x.length >= 1 ? (engine.x[0] + (s.dist.gust ?? 0) * deg2rad) * rad2deg : 0
  const delta = engine.x.length >= 4 ? engine.x[3] * rad2deg : 0
  const uPct = Math.min(100, Math.max(0, 50 + Math.min(1, Math.max(-1, ku * ev.U)) * 50))
  const deltaCmd = ((uPct - 50) / 50) * JET.dmax * rad2deg
  const eig = shortPeriodReMaxT2(cg)

  // ─── ROW 1 (forward path): Σ → e/ė(+filter) → FUZZIFY → RULES → DEFUZZIFY → ×ku ───
  const r1 = H * 0.30
  const pad = 12
  // summing junction
  const sumX = pad + 12
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(sumX, r1, 11, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = '#cbd5e1'
  ctx.font = 'bold 12px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.fillText('Σ', sumX, r1 + 4)
  ctx.font = MONO
  ctx.fillText('+', sumX - 17, r1 - 5)
  ctx.fillText('−', sumX - 5, r1 + 22)
  // θ* setpoint into the sum from the left
  d.line([[pad - 4, r1], [sumX - 11, r1]])
  d.arrow(sumX - 11, r1, 'r')
  d.label(pad + 2, r1 - 9, `θ*=${sp.toFixed(1)}°`, '#4ade80', 'left')

  // available width split across 4 stages (error/filter, fuzzify, rules, defuzz) + ku
  const gap = 16
  const x0 = sumX + 14
  // stage widths tuned to fit ~520px; scale with W
  const totalW = W - x0 - pad
  const wErr = Math.max(58, totalW * 0.15)
  const wFuz = Math.max(78, totalW * 0.24)
  const wRule = Math.max(54, totalW * 0.17)
  const wDef = Math.max(60, totalW * 0.2)
  const wKu = Math.max(40, totalW * 0.1)
  const boxH = 52
  const boxY = r1 - boxH / 2

  // [e, ė + derivative filter]
  let bx = x0
  stageBox(ctx, bx, boxY, wErr, boxH, 'error + ωf', '#a3a3a3')
  d.label(bx + wErr / 2, boxY + 26, `e=${ev.e.toFixed(1)}°`, '#e2e8f0')
  d.label(bx + wErr / 2, boxY + 38, `ė=${ev.edot.toFixed(1)}°/s`, '#cbd5e1')
  d.label(bx + wErr / 2, boxY + 49, `ωf=${wf.toFixed(0)}`, '#64748b')
  const errR = bx + wErr

  // wire e/ė → FUZZIFY
  bx = errR + gap
  d.line([[errR, r1], [bx, r1]])
  d.arrow(bx, r1, 'r')

  // [FUZZIFICATION] two MF fans
  stageBox(ctx, bx, boxY, wFuz, boxH, 'FUZZIFY', '#38bdf8')
  const fanW = (wFuz - 10) / 2
  const fanH = 22
  const fanY = boxY + 15
  drawMFfan(ctx, bx + 4, fanY, fanW, fanH, ev.E, ev.muE)
  drawMFfan(ctx, bx + 6 + fanW, fanY, fanW, fanH, ev.Edot, ev.muEdot)
  ctx.fillStyle = '#64748b'
  ctx.font = '7.5px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.fillText('μ(E)', bx + 4 + fanW / 2, boxY + boxH - 3)
  ctx.fillText('μ(Ė)', bx + 6 + fanW + fanW / 2, boxY + boxH - 3)
  const fuzR = bx + wFuz

  // wire → RULES (carry the fuzzy sets label)
  bx = fuzR + gap
  d.line([[fuzR, r1], [bx, r1]])
  d.arrow(bx, r1, 'r')
  d.label((fuzR + bx) / 2, r1 - 8, 'μ', '#7dd3fc')

  // [RULE BASE] mini 5×5
  stageBox(ctx, bx, boxY, wRule, boxH, 'RULE 5×5', '#a78bfa')
  const cell = Math.min((wRule - 10) / 5, (boxH - 16) / 5)
  const gridW = cell * 5
  drawRuleGrid(ctx, bx + (wRule - gridW) / 2, boxY + 14, cell, ev.fire)
  const ruleR = bx + wRule

  // wire → DEFUZZIFY
  bx = ruleR + gap
  d.line([[ruleR, r1], [bx, r1]])
  d.arrow(bx, r1, 'r')

  // [DEFUZZIFICATION] centroid glyph + crisp U
  stageBox(ctx, bx, boxY, wDef, boxH, 'DEFUZZIFY', '#34d399')
  // draw the 5 output singletons as a little bar field with the centroid marker
  const dx0 = bx + 6
  const dx1 = bx + wDef - 6
  const dyb = boxY + 34
  const DX = (v: number) => dx0 + ((v + 1) / 2) * (dx1 - dx0)
  ctx.strokeStyle = '#475569'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(dx0, dyb)
  ctx.lineTo(dx1, dyb)
  ctx.stroke()
  for (let k = 0; k < 5; k++) {
    const wgt = ev.outW[k]
    ctx.strokeStyle = surfColor(CENTERS[k])
    ctx.globalAlpha = 0.4 + 0.6 * wgt
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(DX(CENTERS[k]), dyb)
    ctx.lineTo(DX(CENTERS[k]), dyb - 4 - wgt * 12)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  // centroid marker (the defuzzified U)
  ctx.fillStyle = '#fbbf24'
  ctx.beginPath()
  ctx.arc(DX(ev.U), dyb, 3, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fde68a'
  ctx.font = '8px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.fillText(`U=${ev.U.toFixed(2)}`, bx + wDef / 2, boxY + boxH - 3)
  const defR = bx + wDef

  // wire → ×ku
  bx = defR + gap
  d.line([[defR, r1], [bx, r1]])
  d.arrow(bx, r1, 'r')

  // [×ku] triangle gain block
  ctx.fillStyle = '#1e293b'
  ctx.strokeStyle = '#fbbf24'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(bx, r1 - 13)
  ctx.lineTo(bx + wKu, r1)
  ctx.lineTo(bx, r1 + 13)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#fde68a'
  ctx.font = '9px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.fillText(`×${ku.toFixed(2)}`, bx + wKu * 0.42, r1 + 3)
  const kuR = bx + wKu

  // ─── ROW 2 (right→left): ACTUATOR → AIRFRAME → θ branch → sensor → back to Σ ───
  const r2 = H * 0.72
  const aH = 46
  const aY = r2 - aH / 2
  const afH = 50
  const afY = r2 - afH / 2
  const gap2 = 38
  // Lay boxes out right→left from a margin so they never overlap or clip.
  const aW = Math.max(66, totalW * 0.15)
  const afW = Math.max(100, totalW * 0.25)
  const actX = W - pad - aW // actuator hugs the right margin
  const afX = actX - gap2 - afW

  // elbow: down from ×ku, then right to above the actuator, then down into it
  const elbowX = actX + aW / 2
  d.line([[kuR, r1], [elbowX, r1], [elbowX, aY]])
  d.arrow(elbowX, aY, 'd')
  d.label(elbowX + 4, (r1 + aY) / 2, `u=${uPct.toFixed(0)}%`, '#fbbf24', 'left')

  stageBox(ctx, actX, aY, aW, aH, 'ACTUATOR', '#fbbf24')
  d.label(actX + aW / 2, aY + 26, `τ=${(JET.tauAct * 1000).toFixed(0)} ms`, '#cbd5e1')
  d.label(actX + aW / 2, aY + 38, `δ=${delta.toFixed(1)}°`, '#fbbf24')

  // wire actuator → airframe (leftward). δcmd label sits just left of the
  // actuator, right-aligned so it never collides with the airframe box.
  d.line([[actX, r2], [afX + afW, r2]])
  d.arrow(afX + afW, r2, 'l')
  d.label(actX - 4, r2 - 6, `δcmd=${deltaCmd.toFixed(1)}°`, '#fde68a', 'right')

  // [AIRFRAME] with live OPEN-LOOP UNSTABLE badge
  const accent = eig.unstable ? '#f87171' : '#34d399'
  stageBox(ctx, afX, afY, afW, afH, 'AIRFRAME', accent)
  ctx.font = '8.5px ui-monospace, monospace'
  ctx.textAlign = 'center'
  if (eig.unstable) {
    // red blinking badge
    const blink = 0.6 + 0.4 * ((Math.sin(engine.t * 6) + 1) / 2)
    ctx.fillStyle = `rgba(248,113,113,${blink})`
    ctx.fillText('OPEN-LOOP UNSTABLE', afX + afW / 2, afY + 24)
    ctx.fillStyle = '#fca5a5'
    ctx.fillText(`RHP pole +${eig.reMax.toFixed(2)} · t₂=${eig.t2.toFixed(2)}s`, afX + afW / 2, afY + 36)
  } else {
    ctx.fillStyle = '#6ee7b7'
    ctx.fillText('stable (LHP)', afX + afW / 2, afY + 24)
    ctx.fillText(`cg=${cg.toFixed(2)}`, afX + afW / 2, afY + 36)
  }

  // θ/α output branch on the left, then down/around back to Σ
  const branchX = afX - 20
  d.line([[afX, r2], [branchX, r2]])
  ctx.fillStyle = WIRE
  ctx.beginPath()
  ctx.arc(branchX, r2, 3, 0, Math.PI * 2)
  ctx.fill()
  d.label(branchX - 4, r2 - 9, `θ=${theta.toFixed(1)}°`, '#38bdf8', 'right')
  d.label(branchX - 4, r2 + 16, `α=${alpha.toFixed(1)}°`, Math.abs(alpha) > 15 ? '#f87171' : '#34d399', 'right')

  // sensor block on the return wire (between branch and Σ, lower)
  const sensY = r2
  const sensW = Math.max(74, totalW * 0.16)
  const sensX = sumX + 6
  // route: branch → left to sensX+sensW, sensor box, → left to sumX, → up to Σ
  d.line([[branchX, r2], [branchX, H - 16], [sensX + sensW, H - 16]])
  d.arrow(sensX + sensW, H - 16, 'l')
  ctx.fillStyle = '#1e293b'
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(sensX, H - 16 - 14, sensW, 28, 4)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#e2e8f0'
  ctx.font = 'bold 9px ui-sans-serif, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(
    s.noiseSigma > 0 ? `Sensor σ=${(s.noiseSigma * 1).toFixed(1)}°` : 'Sensor θ',
    sensX + sensW / 2,
    H - 16 + 3,
  )
  // sensor → up to Σ's minus input
  d.line([[sensX, H - 16], [sumX, H - 16], [sumX, r1 + 11]])
  d.arrow(sumX, r1 + 11, 'u')
  void sensY

  // ─── caption ───
  ctx.fillStyle = '#64748b'
  ctx.font = '9px ui-sans-serif, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(
    'Mamdani FLC: fuzzify e, ė → fire the 5×5 rule base → defuzzify (centroid) → scale → elevator. No C(s) — a rule pipeline, not a transfer function.',
    pad,
    H - 3,
  )
}

/* --------------------------- jet-pid generic loop --------------------------- */

function drawGenericLoop(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  s: ReturnType<typeof useStore.getState>,
  d: Draw,
) {
  const cdef = getController(s.controllerId)
  const sp = s.setpoint
  const theta = engine.x.length >= 3 ? engine.x[2] * rad2deg : 0
  const e = sp - theta
  const u = engine.u
  const cg = s.dist.cg ?? 0.75
  const eig = shortPeriodReMaxT2(cg)

  const midY = H * 0.44
  const pad = 14
  const sumX = Math.max(64, W * 0.12)
  const ctlX = sumX + 34
  const ctlW = Math.max(110, W * 0.22)
  const actX = ctlX + ctlW + 30
  const actW = Math.max(70, W * 0.13)
  const afX = actX + actW + 34
  const afW = Math.max(110, W * 0.2)
  const branchX = Math.min(W - 46, afX + afW + 44)
  const outX = W - pad
  const fbY = Math.min(H - 24, midY + H * 0.34)
  const blockH = 46

  // forward wires
  d.line([[pad, midY], [sumX - 11, midY]])
  d.arrow(sumX - 11, midY, 'r')
  d.line([[sumX + 11, midY], [ctlX, midY]])
  d.arrow(ctlX, midY, 'r')
  d.line([[ctlX + ctlW, midY], [actX, midY]])
  d.arrow(actX, midY, 'r')
  d.line([[actX + actW, midY], [afX, midY]])
  d.arrow(afX, midY, 'r')
  d.line([[afX + afW, midY], [outX, midY]])
  d.arrow(outX, midY, 'r')

  // sum
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(sumX, midY, 11, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = '#cbd5e1'
  ctx.font = 'bold 12px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.fillText('Σ', sumX, midY + 4)
  ctx.font = MONO
  ctx.fillText('+', sumX - 18, midY - 5)
  ctx.fillText('−', sumX - 5, midY + 22)

  const box = (x: number, w: number, title: string, sub: string, accent = '#94a3b8') => {
    ctx.fillStyle = '#1e293b'
    ctx.strokeStyle = accent
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.roundRect(x, midY - blockH / 2, w, blockH, 4)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#e2e8f0'
    ctx.font = 'bold 12px ui-sans-serif, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(title, x + w / 2, midY - 1)
    ctx.fillStyle = '#94a3b8'
    ctx.font = MONO
    ctx.fillText(sub, x + w / 2, midY + 14)
  }

  box(ctlX, ctlW, 'PID  C(s)', cdef.summary(s.ctl), '#38bdf8')
  box(actX, actW, 'ACT', `τ=${(JET.tauAct * 1000).toFixed(0)}ms`, '#fbbf24')
  box(afX, afW, 'AIRFRAME', eig.unstable ? `t₂=${eig.t2.toFixed(2)}s` : `cg=${cg.toFixed(2)}`, eig.unstable ? '#f87171' : '#34d399')
  if (eig.unstable) {
    const blink = 0.6 + 0.4 * ((Math.sin(engine.t * 6) + 1) / 2)
    ctx.fillStyle = `rgba(248,113,113,${blink})`
    ctx.font = 'bold 8.5px ui-monospace, monospace'
    ctx.textAlign = 'center'
    ctx.fillText('OPEN-LOOP UNSTABLE', afX + afW / 2, midY - blockH / 2 - 6)
  }

  // feedback path
  ctx.fillStyle = WIRE
  ctx.beginPath()
  ctx.arc(branchX, midY, 3, 0, Math.PI * 2)
  ctx.fill()
  const sensW = Math.max(110, W * 0.2)
  const sensX = (sumX + branchX) / 2 - sensW / 2
  d.line([[branchX, midY], [branchX, fbY], [sensX + sensW, fbY]])
  d.arrow(sensX + sensW, fbY, 'r')
  ctx.fillStyle = '#1e293b'
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(sensX, fbY - 15, sensW, 30, 4)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#e2e8f0'
  ctx.font = 'bold 11px ui-sans-serif, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(s.noiseSigma > 0 ? `Sensor σ=${(s.noiseSigma).toFixed(1)}°` : 'Sensor θ', sensX + sensW / 2, fbY + 4)
  d.line([[sensX, fbY], [sumX, fbY], [sumX, midY + 11]])
  d.arrow(sumX, midY + 11, 'u')

  // disturbance (CG) into the airframe
  const dX = afX + afW / 2
  d.line([[dX, midY - blockH / 2 - 30], [dX, midY - blockH / 2]])
  d.arrow(dX, midY - blockH / 2, 'u')

  // live values
  d.label((pad + sumX) / 2, midY - 9, `θ*=${sp.toFixed(1)}°`, '#4ade80')
  d.label((sumX + ctlX + 11) / 2 + 6, midY + 17, `e=${e >= 0 ? '+' : ''}${e.toFixed(1)}°`, '#e2e8f0')
  d.label((actX + actW + afX) / 2, midY - 9, `u=${u.toFixed(0)}%`, '#fbbf24')
  d.label((afX + afW + outX) / 2 + 8, midY - 9, `θ=${theta.toFixed(1)}°`, '#38bdf8')

  ctx.fillStyle = '#64748b'
  ctx.font = '9px ui-sans-serif, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(
    'Linear PD/PID law: single SISO loop with a transfer function C(s). Switch to the fuzzy controller to see the rule-based pipeline.',
    pad,
    H - 4,
  )
}
