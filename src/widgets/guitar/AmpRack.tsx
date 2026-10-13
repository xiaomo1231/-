import { useState } from 'react'
import { Save, Trash2 } from 'lucide-react'
import { useGuitarAudio } from '@/features/guitar/guitarAudioStore'
import { AMP_LABEL, BUILTIN_PRESETS, PARAM_RANGE, STAGE_LABEL, type AmpType, type RigSettings } from '@/audio/guitar/rigSettings'
import { guitarMonitor } from '@/audio/guitar/monitor'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { cn } from '@/shared/lib/utils'

type PedalId = 'gate' | 'comp' | 'overdrive' | 'distortion' | 'chorus' | 'delay' | 'reverb'

interface KnobSpec {
  key: string
  label: string
  min?: number
  max?: number
  step?: number
  format?: (v: number) => string
}

const pct = (v: number) => `${Math.round(v * 100)}`

const PEDALS: Array<{ id: PedalId; tint: string; knobs: KnobSpec[]; hint: string }> = [
  { id: 'gate', tint: 'from-slate-500/30', hint: '不弹时压掉电流声', knobs: [{ key: 'threshold', label: '阈值', min: PARAM_RANGE['gate.threshold'][0], max: PARAM_RANGE['gate.threshold'][1], step: 1, format: (v) => `${v} dB` }, { key: 'release', label: '释放', min: PARAM_RANGE['gate.release'][0], max: PARAM_RANGE['gate.release'][1], step: 0.01, format: (v) => `${Math.round(v * 1000)} ms` }] },
  { id: 'comp', tint: 'from-sky-500/30', hint: '让音量更平均', knobs: [{ key: 'amount', label: '强度' }, { key: 'level', label: '电平' }] },
  { id: 'overdrive', tint: 'from-emerald-500/30', hint: '温暖的饱和', knobs: [{ key: 'gain', label: '增益' }, { key: 'tone', label: '音色' }, { key: 'level', label: '电平' }] },
  { id: 'distortion', tint: 'from-orange-500/30', hint: '硬朗的削波', knobs: [{ key: 'gain', label: '增益' }, { key: 'tone', label: '音色' }, { key: 'level', label: '电平' }] },
  { id: 'chorus', tint: 'from-violet-500/30', hint: '加宽、发亮', knobs: [{ key: 'rate', label: '速度' }, { key: 'depth', label: '深度' }, { key: 'mix', label: '混合' }] },
  { id: 'delay', tint: 'from-cyan-500/30', hint: '回声，独奏常用', knobs: [{ key: 'time', label: '时间', min: PARAM_RANGE['delay.time'][0], max: PARAM_RANGE['delay.time'][1], step: 0.01, format: (v) => `${Math.round(v * 1000)} ms` }, { key: 'feedback', label: '反馈', max: 0.85 }, { key: 'mix', label: '混合' }] },
  { id: 'reverb', tint: 'from-indigo-500/30', hint: '空间感', knobs: [{ key: 'size', label: '空间' }, { key: 'mix', label: '混合' }] },
]

function Knob({ spec, value, onChange, disabled, id }: { spec: KnobSpec; value: number; onChange: (v: number) => void; disabled?: boolean; id: string }) {
  const min = spec.min ?? 0
  const max = spec.max ?? 1
  const angle = -135 + ((value - min) / (max - min)) * 270
  return (
    <label htmlFor={id} className={cn('flex flex-col items-center gap-1 text-[11px]', disabled && 'opacity-50')}>
      <span className="relative flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background shadow-inner" aria-hidden>
        <span className="absolute h-4 w-0.5 origin-bottom rounded bg-amber" style={{ transform: `translateY(-8px) rotate(${angle}deg)`, transformOrigin: '50% 100%', bottom: '50%' }} />
      </span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={spec.step ?? 0.01}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-14 accent-[hsl(var(--amber))]"
      />
      <span className="text-muted-foreground">{spec.label}</span>
      <span className="num">{(spec.format ?? pct)(value)}</span>
    </label>
  )
}

/** Pedalboard + amp. Changes are heard immediately when monitoring is on and saved to the profile. */
export function AmpRack() {
  const { rig, setRig, presetId, presets, applyPreset, savePreset, deletePreset } = useGuitarAudio()
  const [name, setName] = useState('')
  const set = <K extends keyof RigSettings>(key: K, patch: Partial<RigSettings[K]>) => setRig({ ...rig, [key]: { ...(rig[key] as object), ...patch } } as RigSettings)

  return (
    <div className="space-y-6">
      <section aria-label="预设" className="flex flex-wrap items-center gap-2">
        {[...BUILTIN_PRESETS, ...presets].map((p) => (
          <span key={p.id} className="inline-flex items-center">
            <button
              type="button"
              onClick={() => applyPreset(p.id)}
              aria-pressed={presetId === p.id}
              title={p.description}
              className={cn('focus-ring rounded-full border px-3 py-1.5 text-sm transition-colors', presetId === p.id ? 'border-amber/70 bg-amber-soft/40' : 'border-border hover:border-cyan/40')}
            >
              {p.name}
            </button>
            {!p.builtin && (
              <button type="button" onClick={() => void deletePreset(p.id)} className="focus-ring ml-0.5 rounded-full p-1 text-muted-foreground hover:text-destructive" aria-label={`删除预设「${p.name}」`}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
        ))}
        <form
          className="ml-auto flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void savePreset(name)
            setName('')
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value.slice(0, 20))} placeholder="给当前音色起个名字" className="h-9 w-44" aria-label="预设名称" />
          <Button size="sm" variant="outline" type="submit">
            <Save /> 存为预设
          </Button>
        </form>
      </section>

      <section aria-label="效果器" className="grid grid-cols-7 gap-3">
        {PEDALS.slice(0, 4).map((p) => (
          <Pedal key={p.id} spec={p} rig={rig} set={set} />
        ))}
        <div className="col-span-3 grid grid-cols-3 gap-3">
          {PEDALS.slice(4).map((p) => (
            <Pedal key={p.id} spec={p} rig={rig} set={set} />
          ))}
        </div>
      </section>
      {!guitarMonitor.gateAvailable && <p className="text-xs text-muted-foreground">这个浏览器加载不了噪声门模块，噪声门暂时不起作用，其他效果正常。</p>}

      <section aria-label="音箱" className="studio-noise rounded-3xl border border-border/80 bg-gradient-to-b from-card to-background p-6 shadow-lift">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Amplifier</div>
            <div className="text-xl font-semibold">{STAGE_LABEL.amp}</div>
          </div>
          <div className="flex gap-2" role="radiogroup" aria-label="音箱类型">
            {(Object.keys(AMP_LABEL) as AmpType[]).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={rig.amp.type === t}
                onClick={() => set('amp', { type: t })}
                className={cn('focus-ring rounded-xl border px-4 py-2 text-sm', rig.amp.type === t ? 'border-amber/70 bg-amber-soft/40' : 'border-border hover:border-cyan/40')}
              >
                {AMP_LABEL[t]}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={rig.cab.on} onChange={(e) => set('cab', { on: e.target.checked })} className="h-4 w-4 accent-[hsl(var(--amber))]" />
            {STAGE_LABEL.cab}
          </label>
        </div>
        <div className="mt-5 flex flex-wrap justify-around gap-4">
          {(['gain', 'bass', 'mid', 'treble', 'master'] as const).map((k) => (
            <Knob
              key={k}
              id={`amp-${k}`}
              spec={{ key: k, label: { gain: '增益', bass: '低音', mid: '中音', treble: '高音', master: '主音量' }[k] }}
              value={rig.amp[k]}
              onChange={(v) => set('amp', { [k]: v })}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

function Pedal({
  spec,
  rig,
  set,
}: {
  spec: (typeof PEDALS)[number]
  rig: RigSettings
  set: <K extends keyof RigSettings>(key: K, patch: Partial<RigSettings[K]>) => void
}) {
  const state = rig[spec.id] as Record<string, number | boolean>
  const on = Boolean(state.on)
  return (
    <div className={cn('flex flex-col items-center rounded-2xl border bg-gradient-to-b to-card p-3 transition-colors', spec.tint, on ? 'border-amber/50' : 'border-border/70')}>
      <div className="text-sm font-semibold">{STAGE_LABEL[spec.id]}</div>
      <div className="text-[10px] text-muted-foreground">{spec.hint}</div>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {spec.knobs.map((k) => (
          <Knob key={k.key} id={`${spec.id}-${k.key}`} spec={k} value={Number(state[k.key])} onChange={(v) => set(spec.id, { [k.key]: v } as never)} disabled={!on} />
        ))}
      </div>
      {spec.id === 'delay' && (
        <label className="mt-1 flex items-center gap-1 text-[11px]">
          <input type="checkbox" checked={rig.delay.sync} onChange={(e) => set('delay', { sync: e.target.checked })} className="accent-[hsl(var(--amber))]" />
          跟随曲速
        </label>
      )}
      <button
        type="button"
        onClick={() => set(spec.id, { on: !on } as never)}
        aria-pressed={on}
        aria-label={`${STAGE_LABEL[spec.id]}${on ? '：开' : '：关'}`}
        className="focus-ring mt-3 flex flex-col items-center gap-1"
      >
        <span className={cn('h-2 w-2 rounded-full', on ? 'bg-destructive shadow-[0_0_8px_hsl(var(--destructive))]' : 'bg-muted')} aria-hidden />
        <span className="h-7 w-10 rounded-lg border border-border bg-muted/60 shadow-inner" aria-hidden />
      </button>
    </div>
  )
}
