import { getController } from '../controllers/registry'
import { getScenario } from '../scenarios/registry'
import type { SliderSpec } from '../scenarios/types'
import { engine } from '../state/engine'
import { useStore } from '../state/store'

/** Fully descriptor-driven control panel — no scenario-specific code here. */
export function ControlPanel() {
  const s = useStore()
  const scn = getScenario(s.scenarioId)
  const ctlCfg = scn.controllers.find((c) => c.id === s.controllerId) ?? scn.controllers[0]

  return (
    <div className="space-y-3 text-sm">
      <Section title="Simulation">
        <div className="flex items-center gap-2">
          <button
            className={`rounded px-3 py-1 text-xs font-semibold ${
              s.running
                ? 'bg-amber-600/80 text-amber-50 hover:bg-amber-600'
                : 'bg-green-600/80 text-green-50 hover:bg-green-600'
            }`}
            onClick={() => s.set({ running: !s.running })}
          >
            {s.running ? 'Pause' : 'Run'}
          </button>
          <button
            className="rounded bg-slate-700 px-3 py-1 text-xs font-semibold text-slate-100 hover:bg-slate-600"
            onClick={() => engine.reset()}
          >
            Reset
          </button>
        </div>
        <div>
          <div className="mb-1 text-xs text-slate-400">
            Time scale {scn.timeScales.some((v) => v < 1) ? '(<1 = slow motion)' : ''}
          </div>
          <div className="flex flex-wrap gap-1">
            {scn.timeScales.map((v) => (
              <button
                key={v}
                className={`rounded px-2 py-0.5 font-mono text-xs ${
                  s.timeScale === v
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
                onClick={() => s.set({ timeScale: v })}
              >
                {v}×
              </button>
            ))}
          </div>
        </div>
        <Slider
          spec={scn.setpoint}
          value={s.setpoint}
          onChange={(v) => s.set({ setpoint: v })}
        />
      </Section>

      <Section title="Controller">
        <div className="flex flex-wrap gap-1">
          {scn.controllers.map((cfg) => (
            <button
              key={cfg.id}
              className={`rounded px-3 py-1 text-xs font-semibold ${
                s.controllerId === cfg.id
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
              onClick={() => s.setController(cfg.id)}
            >
              {getController(cfg.id).label}
            </button>
          ))}
        </div>
        {ctlCfg.params.map((spec) => (
          <Slider
            key={spec.key}
            spec={spec}
            value={s.ctl[spec.key] ?? 0}
            onChange={(v) => s.set({ ctl: { ...s.ctl, [spec.key]: v } })}
          />
        ))}
      </Section>

      {scn.presets.length > 0 && (
        <Section title="Tuning examples">
          <div className="grid grid-cols-2 gap-1">
            {scn.presets.map((p) => (
              <button
                key={p.name}
                title={p.desc}
                className="rounded bg-slate-800 px-2 py-1 text-left text-xs text-slate-200 hover:bg-slate-700"
                onClick={() => {
                  if (p.set.controllerId && p.set.controllerId !== s.controllerId) {
                    s.setController(p.set.controllerId)
                  }
                  const { controllerId: _cid, ctl, ...rest } = p.set
                  s.set({ ...rest, ...(ctl ? { ctl: { ...ctl } } : {}) })
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Hover a preset for what it demonstrates. Watch the Bode footer's PM react.
          </p>
        </Section>
      )}

      <Section title="Disturbances">
        {scn.distSliders.map((spec) => (
          <Slider
            key={spec.key}
            spec={spec}
            value={s.dist[spec.key] ?? 0}
            onChange={(v) => s.set({ dist: { ...s.dist, [spec.key]: v } })}
          />
        ))}
        <Slider
          spec={{
            key: 'noise',
            label: 'Sensor noise σ',
            unit: scn.noise.unit,
            min: 0,
            max: scn.noise.max,
            step: scn.noise.step,
            fmt: (v) => (v * scn.noise.mul).toFixed(1),
          }}
          value={s.noiseSigma}
          onChange={(v) => s.set({ noiseSigma: v })}
        />
        {scn.impulses.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {scn.impulses.map((imp) => (
              <button
                key={imp.label}
                title={imp.title}
                className="rounded bg-sky-900/70 px-2 py-1 text-xs text-sky-200 hover:bg-sky-800"
                onClick={() => engine.applyImpulse(imp.apply)}
              >
                {imp.label}
              </button>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Slider({
  spec,
  value,
  onChange,
}: {
  spec: SliderSpec
  value: number
  onChange: (v: number) => void
}) {
  // default format: as many decimals as the slider step implies
  const decimals = (String(spec.step).split('.')[1] ?? '').length
  const fmt = spec.fmt ?? ((v: number) => v.toFixed(decimals))
  return (
    <label className="block">
      <div className="mb-0.5 flex items-baseline justify-between text-xs">
        <span className="text-slate-300">{spec.label}</span>
        <span className="font-mono text-sky-300">
          {fmt(value)} <span className="text-slate-500">{spec.unit}</span>
        </span>
      </div>
      <input
        type="range"
        className="w-full accent-sky-500"
        value={value}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}
