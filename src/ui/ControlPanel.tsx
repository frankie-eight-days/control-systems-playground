import { engine } from '../state/engine'
import { useStore } from '../state/store'

const SPEEDS = [1, 2, 5, 10, 25, 50, 100]

export function ControlPanel() {
  const s = useStore()

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
          <div className="mb-1 text-xs text-slate-400">Time acceleration</div>
          <div className="flex flex-wrap gap-1">
            {SPEEDS.map((v) => (
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
          label="Setpoint r"
          value={s.setpoint}
          min={0.1}
          max={1.9}
          step={0.01}
          unit="m"
          fmt={(v) => v.toFixed(2)}
          onChange={(v) => s.set({ setpoint: v })}
        />
      </Section>

      <Section title="PID gains">
        <Slider
          label="Kp  (proportional)"
          value={s.kp}
          min={0}
          max={300}
          step={1}
          unit="%/m"
          fmt={(v) => v.toFixed(0)}
          onChange={(v) => s.set({ kp: v })}
        />
        <Slider
          label="Ki  (integral)"
          value={s.ki}
          min={0}
          max={20}
          step={0.1}
          unit="%/(m·s)"
          fmt={(v) => v.toFixed(1)}
          onChange={(v) => s.set({ ki: v })}
        />
        <Slider
          label="Kd  (derivative)"
          value={s.kd}
          min={0}
          max={300}
          step={1}
          unit="%·s/m"
          fmt={(v) => v.toFixed(0)}
          onChange={(v) => s.set({ kd: v })}
        />
        <Slider
          label="ωf  (D filter cutoff)"
          value={s.wf}
          min={0.5}
          max={50}
          step={0.5}
          unit="rad/s"
          fmt={(v) => v.toFixed(1)}
          onChange={(v) => s.set({ wf: v })}
        />
      </Section>

      <Section title="Disturbances">
        <Slider
          label="Drain valve opening"
          value={s.valve}
          min={0}
          max={1}
          step={0.01}
          unit="%"
          fmt={(v) => (v * 100).toFixed(0)}
          onChange={(v) => s.set({ valve: v })}
        />
        <Slider
          label="Sensor noise σ"
          value={s.noiseSigma}
          min={0}
          max={0.02}
          step={0.0005}
          unit="mm"
          fmt={(v) => (v * 1000).toFixed(1)}
          onChange={(v) => s.set({ noiseSigma: v })}
        />
        <p className="text-xs text-slate-500">
          Click the tank (or the +50 L / −50 L buttons) to dump water in or scoop it out. Crank up
          the noise with some Kd to see why the derivative term needs filtering.
        </p>
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
  label,
  value,
  min,
  max,
  step,
  unit,
  fmt,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  fmt: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <label className="block">
      <div className="mb-0.5 flex items-baseline justify-between text-xs">
        <span className="text-slate-300">{label}</span>
        <span className="font-mono text-sky-300">
          {fmt(value)} <span className="text-slate-500">{unit}</span>
        </span>
      </div>
      <input
        type="range"
        className="w-full accent-sky-500"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}
