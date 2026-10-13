/**
 * 后期课堂 task checking: conditions on the student's settings (pure) and
 * conditions measured on the rendered result.
 */
import type { MixSettings } from '@/songs/singTypes'
import { CONTROLS, getPath } from './controls'
import type { MeasureCheck, SettingCheck } from './types'
import { filter } from './material'
import { integratedLufs, truePeakDb } from '@/audio/fx/loudness'
import { phraseLevels } from '@/audio/fx/autoLevel'

export interface CheckResult {
  ok: boolean
  /** What is wrong (Chinese), when not ok. */
  message: string
}

const fmt = (x: number) => (Math.abs(x) >= 100 ? Math.round(x).toString() : (Math.round(x * 10) / 10).toString())

/** One setting condition. */
export function checkSetting(m: MixSettings, c: SettingCheck): CheckResult {
  const spec = CONTROLS[c.path]
  const label = spec?.label ?? c.path
  const v = getPath(m, c.path)
  if (c.equals !== undefined) {
    const ok = v === c.equals
    const want = typeof c.equals === 'boolean' ? (c.equals ? '打开' : '关闭') : spec?.kind === 'select' ? (spec.options.find((o) => o.value === c.equals)?.label ?? String(c.equals)) : String(c.equals)
    return { ok, message: ok ? '' : `「${label}」需要${typeof c.equals === 'boolean' ? want : `选「${want}」`}。` }
  }
  if (typeof v !== 'number') return { ok: false, message: `「${label}」没有设置。` }
  const unit = spec?.kind === 'number' ? (spec.percent ? '%' : spec.unit) : ''
  const show = (x: number) => (spec?.kind === 'number' && spec.percent ? fmt(x * 100) : fmt(x))
  if (c.min !== undefined && v < c.min) return { ok: false, message: `「${label}」现在是 ${show(v)} ${unit}，要至少 ${show(c.min)} ${unit}。` }
  if (c.max !== undefined && v > c.max) return { ok: false, message: `「${label}」现在是 ${show(v)} ${unit}，要不超过 ${show(c.max)} ${unit}。` }
  return { ok: true, message: '' }
}

/** Band energy of a mono signal between two frequencies (dB). */
function bandDb(x: Float32Array, rate: number, lo: number, hi: number): number {
  let y = x
  if (lo > 20) y = filter(filter(y, rate, 'highpass', lo), rate, 'highpass', lo)
  if (hi < rate / 2) y = filter(filter(y, rate, 'lowpass', hi), rate, 'lowpass', hi)
  let s = 0
  for (const v of y) s += v * v
  return 10 * Math.log10(s / Math.max(1, y.length) + 1e-15)
}

const mono = (ch: Float32Array[]) => {
  const out = new Float32Array(ch[0]?.length ?? 0)
  for (const c of ch) for (let i = 0; i < out.length; i++) out[i]! += c[i]! / ch.length
  return out
}

export interface Rendered {
  /** The student's result. */
  after: Float32Array[]
  /** The same material with the lesson's starting settings. */
  before: Float32Array[]
  rate: number
  /** Gain reduction seen during the render, dB (≥ 0), when measured. */
  gainReductionDb?: number
  phrases?: Array<{ startMs: number; endMs: number }>
}

/** One measured condition. */
export function checkMeasure(r: Rendered, c: MeasureCheck): CheckResult {
  switch (c.kind) {
    case 'lufs': {
      const l = integratedLufs(r.after, r.rate)
      const ok = Math.abs(l - c.target) <= c.tolerance
      return { ok, message: ok ? '' : `整体响度是 ${fmt(l)} LUFS，目标是 ${c.target} ± ${c.tolerance} LUFS。` }
    }
    case 'truePeak': {
      const p = truePeakDb(r.after, r.rate)
      const ok = p <= c.max + 0.05
      return { ok, message: ok ? '' : `真峰值是 ${fmt(p)} dBTP，要不超过 ${c.max} dBTP。` }
    }
    case 'gainReduction': {
      const g = r.gainReductionDb ?? 0
      const ok = g >= c.min && g <= c.max
      return { ok, message: ok ? '' : `压缩时最多压低了约 ${fmt(g)} dB，目标是 ${c.min}–${c.max} dB。` }
    }
    case 'lowEnergyCut': {
      const cut = bandDb(mono(r.before), r.rate, 20, 100) - bandDb(mono(r.after), r.rate, 20, 100)
      const ok = cut >= c.minDb
      return { ok, message: ok ? '' : `100 Hz 以下只减少了 ${fmt(cut)} dB，要至少 ${c.minDb} dB。` }
    }
    case 'sibilanceCut': {
      const cut = bandDb(mono(r.before), r.rate, 5000, 10000) - bandDb(mono(r.after), r.rate, 5000, 10000)
      const ok = cut >= c.minDb
      return { ok, message: ok ? '' : `5–10 kHz 的齿音只减少了 ${fmt(cut)} dB，要至少 ${c.minDb} dB。` }
    }
    case 'phraseSpread': {
      const levels = phraseLevels(mono(r.after), r.rate, r.phrases ?? []).filter((l) => Number.isFinite(l))
      const spread = levels.length ? Math.max(...levels) - Math.min(...levels) : 0
      const ok = spread <= c.maxDb
      return { ok, message: ok ? '' : `最响和最轻的句子相差 ${fmt(spread)} dB，要不超过 ${c.maxDb} dB。` }
    }
  }
}
