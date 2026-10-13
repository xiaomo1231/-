/**
 * 后期工作台的纯函数（无 DOM / Web Audio 依赖，可直接单元测试）。
 */
import { clampMix, cloneMix } from '@/songs/mixPresets'
import type { EqBand, MixSettings } from '@/songs/singTypes'

export const FREQ_MIN = 20
export const FREQ_MAX = 20000
/** EQ 曲线纵轴范围（±dB）。 */
export const DB_RANGE = 18

/** 频率 → 横坐标（对数轴）。 */
export function freqToX(freq: number, width: number, lo = FREQ_MIN, hi = FREQ_MAX): number {
  const f = Math.min(hi, Math.max(lo, freq))
  return ((Math.log(f) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * width
}

/** 横坐标 → 频率（对数轴），结果限制在 [lo, hi]。 */
export function xToFreq(x: number, width: number, lo = FREQ_MIN, hi = FREQ_MAX): number {
  const t = width > 0 ? Math.min(1, Math.max(0, x / width)) : 0
  return Math.exp(Math.log(lo) + t * (Math.log(hi) - Math.log(lo)))
}

/** 增益（dB）→ 纵坐标：+range 在顶部，-range 在底部。 */
export function dbToY(db: number, height: number, range = DB_RANGE): number {
  const d = Math.min(range, Math.max(-range, db))
  return ((range - d) / (2 * range)) * height
}

/** 纵坐标 → 增益（dB），结果限制在 ±range。 */
export function yToDb(y: number, height: number, range = DB_RANGE): number {
  const t = height > 0 ? Math.min(1, Math.max(0, y / height)) : 0.5
  return range - t * 2 * range
}

/** 均方根电平（dBFS）。静音返回 -120。 */
export function rmsDb(samples: ArrayLike<number>): number {
  const n = samples.length
  if (n === 0) return -120
  let sum = 0
  for (let i = 0; i < n; i++) {
    const s = samples[i] ?? 0
    sum += s * s
  }
  const rms = Math.sqrt(sum / n)
  return rms > 1e-6 ? Math.max(-120, 20 * Math.log10(rms)) : -120
}

/** 峰值电平（dBFS）。 */
export function peakDb(samples: ArrayLike<number>): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i] ?? 0))
  return peak > 1e-6 ? Math.max(-120, 20 * Math.log10(peak)) : -120
}

/** 频率文字：120 Hz、1.2k、10k。 */
export function formatHz(freq: number): string {
  if (freq < 1000) return `${Math.round(freq)} Hz`
  const k = Math.round((freq / 1000) * 10) / 10
  return `${k}k`
}

/** 增益文字：+2.5 dB、-3 dB、0 dB。 */
export function formatDb(db: number): string {
  const r = Math.round(db * 10) / 10
  if (r === 0) return '0 dB'
  return `${r > 0 ? '+' : ''}${r} dB`
}

/** 声像文字：居中 / 左 30% / 右 30%。 */
export function formatPan(pan: number): string {
  const p = Math.round(pan * 100)
  if (p === 0) return '居中'
  return p < 0 ? `左 ${-p}%` : `右 ${p}%`
}

/** 时间文字：m:ss。 */
export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** EQ 默认频段（与流行预设一致），用于补齐缺失的频段。 */
const FALLBACK_BANDS: EqBand[] = [
  { type: 'lowshelf', freq: 120, gainDb: 0, q: 0.7 },
  { type: 'peaking', freq: 300, gainDb: 0, q: 1 },
  { type: 'peaking', freq: 3000, gainDb: 0, q: 1 },
  { type: 'highshelf', freq: 10000, gainDb: 0, q: 0.7 },
]

/**
 * 人声 EQ 固定为 4 段（链路只读取前 4 段）。少于 4 段时用平直频段补齐，多余的丢弃。
 */
export function fitBands(bands: EqBand[]): EqBand[] {
  return FALLBACK_BANDS.map((fallback, i) => ({ ...(bands[i] ?? fallback) }))
}

/** 限制数值范围并把 EQ 频段规整为 4 段。返回新对象。 */
export function fitMix(m: MixSettings): MixSettings {
  const c = clampMix(m)
  return { ...c, vocal: { ...c.vocal, eq: { ...c.vocal.eq, bands: fitBands(c.vocal.eq.bands) } } }
}

/** 两个混音设置是否相同（用于高亮当前预设）。 */
export function mixEqual(a: MixSettings, b: MixSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export type ModuleId = 'lowcut' | 'eq' | 'comp' | 'deess' | 'reverb' | 'delay' | 'balance'

/**
 * 旁通某个模块（用于「听听看」的对比）：有开关的模块关闭开关；
 * 平衡没有开关，则把人声增益与声像、伴奏增益恢复到 0。
 */
export function bypassModule(m: MixSettings, id: ModuleId): MixSettings {
  const out = cloneMix(m)
  const v = out.vocal
  switch (id) {
    case 'lowcut':
      v.lowCut.on = false
      break
    case 'eq':
      v.eq.on = false
      break
    case 'comp':
      v.comp.on = false
      break
    case 'deess':
      v.deEss.on = false
      break
    case 'reverb':
      v.reverb.on = false
      break
    case 'delay':
      v.delay.on = false
      break
    case 'balance':
      v.gainDb = 0
      v.pan = 0
      out.backing.gainDb = 0
      break
  }
  return out
}

/** 模块是否有旁通开关，以及当前是否开启。平衡没有开关，返回 null。 */
export function moduleOn(m: MixSettings, id: ModuleId): boolean | null {
  const v = m.vocal
  switch (id) {
    case 'lowcut':
      return v.lowCut.on
    case 'eq':
      return v.eq.on
    case 'comp':
      return v.comp.on
    case 'deess':
      return v.deEss.on
    case 'reverb':
      return v.reverb.on
    case 'delay':
      return v.delay.on
    case 'balance':
      return null
  }
}

/**
 * 预览区域：循环区间（若有）或整首，并限制最长时长（从区间起点开始截取）。
 */
export function previewRegion(
  total: number,
  loop: { start: number; end: number } | null,
  maxSec: number,
): { start: number; end: number } {
  const start = loop ? Math.max(0, Math.min(loop.start, total)) : 0
  const end = loop ? Math.max(start, Math.min(loop.end, total)) : total
  const safeEnd = end > start ? end : Math.min(total, start + maxSec)
  return { start, end: Math.min(safeEnd, start + maxSec) }
}
