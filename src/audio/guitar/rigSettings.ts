/**
 * Guitar monitor settings: a fixed chain of ten stages. Pure data plus
 * normalisation, so saved presets can be validated and tested.
 *
 *   gate → compressor → overdrive → distortion → amp → cabinet
 *        → chorus → delay → reverb → master (limited)
 */

export type AmpType = 'clean' | 'crunch' | 'high'

export interface RigSettings {
  gate: { on: boolean; threshold: number; release: number }
  comp: { on: boolean; amount: number; level: number }
  overdrive: { on: boolean; gain: number; tone: number; level: number }
  distortion: { on: boolean; gain: number; tone: number; level: number }
  amp: { type: AmpType; gain: number; bass: number; mid: number; treble: number; master: number }
  cab: { on: boolean }
  chorus: { on: boolean; rate: number; depth: number; mix: number }
  delay: { on: boolean; time: number; sync: boolean; feedback: number; mix: number }
  reverb: { on: boolean; size: number; mix: number }
  volume: number
}

export type StageId = 'gate' | 'comp' | 'overdrive' | 'distortion' | 'amp' | 'cab' | 'chorus' | 'delay' | 'reverb'

export const STAGE_LABEL: Record<StageId, string> = {
  gate: '噪声门',
  comp: '压缩',
  overdrive: '过载',
  distortion: '失真',
  amp: '音箱',
  cab: '箱体模拟',
  chorus: '合唱',
  delay: '延迟',
  reverb: '混响',
}

export const AMP_LABEL: Record<AmpType, string> = { clean: '干净', crunch: '轻失真', high: '高增益' }

/** Parameter ranges: every knob is 0–1 except where noted. */
export const PARAM_RANGE = {
  'gate.threshold': [-80, -20], // dBFS
  'gate.release': [0.02, 0.5], // seconds
  'delay.time': [0.06, 1.2], // seconds
} as const

export const DEFAULT_RIG: RigSettings = {
  gate: { on: true, threshold: -58, release: 0.12 },
  comp: { on: false, amount: 0.4, level: 0.6 },
  overdrive: { on: false, gain: 0.4, tone: 0.55, level: 0.6 },
  distortion: { on: false, gain: 0.6, tone: 0.5, level: 0.5 },
  amp: { type: 'clean', gain: 0.35, bass: 0.5, mid: 0.5, treble: 0.55, master: 0.6 },
  cab: { on: true },
  chorus: { on: false, rate: 0.35, depth: 0.4, mix: 0.35 },
  delay: { on: false, time: 0.36, sync: false, feedback: 0.3, mix: 0.25 },
  reverb: { on: true, size: 0.35, mix: 0.15 },
  volume: 0.5,
}

export type BuiltinPresetId = 'clean-pop' | 'rock-rhythm' | 'punk' | 'rnb' | 'lead'

export interface RigPreset {
  id: string
  name: string
  description: string
  settings: RigSettings
  builtin?: boolean
}

const preset = (patch: { [K in keyof RigSettings]?: Partial<RigSettings[K]> | RigSettings[K] }): RigSettings => {
  const out = structuredClone(DEFAULT_RIG) as RigSettings
  for (const key of Object.keys(patch) as Array<keyof RigSettings>) {
    const v = patch[key]
    if (typeof v === 'object' && v !== null) Object.assign(out[key] as object, v)
    else if (v !== undefined) (out as unknown as Record<string, unknown>)[key] = v
  }
  return out
}

export const BUILTIN_PRESETS: readonly RigPreset[] = [
  {
    id: 'clean-pop',
    name: '干净流行',
    description: '压缩让扫弦更整齐，合唱和一点混响让分解和弦发亮。',
    builtin: true,
    settings: preset({ comp: { on: true, amount: 0.45 }, amp: { type: 'clean', gain: 0.3, treble: 0.6 }, chorus: { on: true }, reverb: { on: true, mix: 0.18 } }),
  },
  {
    id: 'rock-rhythm',
    name: '摇滚节奏',
    description: '轻失真音箱，强力和弦厚实又清楚。',
    builtin: true,
    settings: preset({ gate: { on: true, threshold: -52 }, amp: { type: 'crunch', gain: 0.55, bass: 0.55, mid: 0.6, treble: 0.55 }, reverb: { on: true, mix: 0.08 } }),
  },
  {
    id: 'punk',
    name: '朋克',
    description: '失真加高增益，八分强力和弦一路冲。',
    builtin: true,
    settings: preset({
      gate: { on: true, threshold: -48, release: 0.06 },
      distortion: { on: true, gain: 0.65, tone: 0.55 },
      amp: { type: 'high', gain: 0.5, bass: 0.6, mid: 0.45, treble: 0.6 },
      reverb: { on: false },
    }),
  },
  {
    id: 'rnb',
    name: '轻 R&B',
    description: '干净、圆润，压缩加合唱，适合切音和七和弦。',
    builtin: true,
    settings: preset({ comp: { on: true, amount: 0.5 }, amp: { type: 'clean', gain: 0.25, bass: 0.55, treble: 0.45 }, chorus: { on: true, rate: 0.25, depth: 0.5, mix: 0.4 }, reverb: { on: true, mix: 0.12 } }),
  },
  {
    id: 'lead',
    name: '主音独奏',
    description: '过载推高增益音箱，延迟和混响让长音唱起来。',
    builtin: true,
    settings: preset({
      gate: { on: true, threshold: -50 },
      overdrive: { on: true, gain: 0.45, tone: 0.6, level: 0.7 },
      amp: { type: 'high', gain: 0.55, mid: 0.65 },
      delay: { on: true, time: 0.38, feedback: 0.32, mix: 0.25 },
      reverb: { on: true, size: 0.5, mix: 0.2 },
    }),
  },
]

const clamp01 = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : d)
const clampTo = (x: unknown, [lo, hi]: readonly [number, number], d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d)
const bool = (x: unknown, d: boolean) => (typeof x === 'boolean' ? x : d)
const obj = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {})

/** Validate and clamp settings from storage or a backup. Unknown fields are dropped. */
export function normalizeRig(raw: unknown): RigSettings {
  const r = obj(raw)
  const d = DEFAULT_RIG
  const g = obj(r.gate)
  const c = obj(r.comp)
  const o = obj(r.overdrive)
  const x = obj(r.distortion)
  const a = obj(r.amp)
  const ch = obj(r.chorus)
  const de = obj(r.delay)
  const rv = obj(r.reverb)
  return {
    gate: { on: bool(g.on, d.gate.on), threshold: clampTo(g.threshold, PARAM_RANGE['gate.threshold'], d.gate.threshold), release: clampTo(g.release, PARAM_RANGE['gate.release'], d.gate.release) },
    comp: { on: bool(c.on, d.comp.on), amount: clamp01(c.amount, d.comp.amount), level: clamp01(c.level, d.comp.level) },
    overdrive: { on: bool(o.on, d.overdrive.on), gain: clamp01(o.gain, d.overdrive.gain), tone: clamp01(o.tone, d.overdrive.tone), level: clamp01(o.level, d.overdrive.level) },
    distortion: { on: bool(x.on, d.distortion.on), gain: clamp01(x.gain, d.distortion.gain), tone: clamp01(x.tone, d.distortion.tone), level: clamp01(x.level, d.distortion.level) },
    amp: {
      type: a.type === 'crunch' || a.type === 'high' || a.type === 'clean' ? a.type : d.amp.type,
      gain: clamp01(a.gain, d.amp.gain),
      bass: clamp01(a.bass, d.amp.bass),
      mid: clamp01(a.mid, d.amp.mid),
      treble: clamp01(a.treble, d.amp.treble),
      master: clamp01(a.master, d.amp.master),
    },
    cab: { on: bool(obj(r.cab).on, d.cab.on) },
    chorus: { on: bool(ch.on, d.chorus.on), rate: clamp01(ch.rate, d.chorus.rate), depth: clamp01(ch.depth, d.chorus.depth), mix: clamp01(ch.mix, d.chorus.mix) },
    delay: { on: bool(de.on, d.delay.on), time: clampTo(de.time, PARAM_RANGE['delay.time'], d.delay.time), sync: bool(de.sync, d.delay.sync), feedback: Math.min(0.85, clamp01(de.feedback, d.delay.feedback)), mix: clamp01(de.mix, d.delay.mix) },
    reverb: { on: bool(rv.on, d.reverb.on), size: clamp01(rv.size, d.reverb.size), mix: clamp01(rv.mix, d.reverb.mix) },
    volume: clamp01(r.volume, d.volume),
  }
}

/** Delay time locked to the tempo: a dotted eighth, the classic rock lead delay. */
export function syncedDelayTime(bpm: number): number {
  const t = (60 / Math.max(40, Math.min(240, bpm))) * 0.75
  return Math.max(PARAM_RANGE['delay.time'][0], Math.min(PARAM_RANGE['delay.time'][1], t))
}

export function normalizePresets(raw: unknown): RigPreset[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((p) => obj(p))
    .filter((p) => typeof p.id === 'string' && typeof p.name === 'string')
    .slice(0, 20)
    .map((p) => ({ id: String(p.id), name: String(p.name).slice(0, 20), description: typeof p.description === 'string' ? p.description.slice(0, 80) : '', settings: normalizeRig(p.settings) }))
}
