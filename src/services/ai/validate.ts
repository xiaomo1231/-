import type { AIReview, AIReviewPoint, ExerciseSpec, ReviewDimension } from '@/entities/types'
import type { ModuleId } from '@/drills/types'
import { AIValidationError } from './aiClient'

/**
 * Local validation of AI output: parse → validate / normalise → use. Invalid
 * items are dropped; if nothing usable is left the whole result is rejected
 * and nothing is stored.
 */

const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null)

/** Trimmed string, cut at `max` characters; null when empty or not a string. */
export function cleanText(x: unknown, max: number): string | null {
  if (typeof x !== 'string') return null
  const t = x.replace(/\s+/g, ' ').trim()
  if (!t) return null
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

const texts = (x: unknown, max: number, limit: number): string[] =>
  (Array.isArray(x) ? x : []).map((t) => cleanText(t, max)).filter((t): t is string => t !== null).slice(0, limit)

/**
 * Does this text spell out a melody or progression (six or more note names,
 * jianpu digits or roman numerals in a row)? The reviewer must not write the
 * student's music, so such suggestions are dropped.
 */
export function looksLikeGhostwriting(text: string): boolean {
  const sep = String.raw`[\s,，、\-–—→>|/]+`
  const noteNames = new RegExp(String.raw`(?:\b[A-G][#b♯♭]?\d?(?:m|maj7|m7|7|sus[24]|add9|dim)?${sep}){5,}[A-G]`)
  const jianpu = new RegExp(String.raw`(?:(?<![\d.])[1-7][.'’]?${sep}){5,}[1-7](?![\d%])`)
  const romans = new RegExp(String.raw`(?:\b[b♭]?(?:I|II|III|IV|V|VI|VII|i|ii|iii|iv|v|vi|vii)°?7?${sep}){5,}[b♭]?(?:I|V|i|v)`)
  return noteNames.test(text) || jianpu.test(text) || romans.test(text)
}

// ---------------------------------------------------------------------------
// drill-generator
// ---------------------------------------------------------------------------

export interface ExerciseContext {
  progression: { chords: number; allowed: { major: readonly string[]; minor: readonly string[] } }
  melody: { notes: number; maxLeapSemitones: number; chromatic: boolean }
  knownSkills: ReadonlySet<string>
}

export interface ValidatedExercise {
  module: 'E6' | 'E8'
  spec: ExerciseSpec
  targets: string[]
  reason: string
}

const MAJOR_STEPS = new Set([-1, 0, 2, 4, 5, 7, 9, 11, 12, 14])

export function validateExercises(raw: unknown, ctx: ExerciseContext): { valid: ValidatedExercise[]; rejected: number } {
  const list = obj(raw)?.exercises
  if (!Array.isArray(list)) throw new AIValidationError('AI 没有按要求返回练习列表，没有保存任何题目。可以再试一次。')
  const valid: ValidatedExercise[] = []
  const seen = new Set<string>()
  let rejected = 0
  for (const item of list.slice(0, 20)) {
    const e = obj(item)
    const reason = cleanText(e?.reason, 60) ?? '针对你最近的练习记录'
    const targets = (Array.isArray(e?.targets) ? e!.targets : []).filter((t): t is string => typeof t === 'string' && ctx.knownSkills.has(t)).slice(0, 4)
    let ok: ValidatedExercise | null = null
    if (e?.module === 'E6') {
      const mode = e.mode === 'minor' ? 'minor' : e.mode === 'major' ? 'major' : null
      const romans = Array.isArray(e.romans) ? e.romans : []
      const allowed = mode ? ctx.progression.allowed[mode] : []
      if (mode && romans.length === ctx.progression.chords && romans.every((r) => typeof r === 'string' && allowed.includes(r))) {
        ok = { module: 'E6', spec: { kind: 'progression', mode, romans: romans as string[] }, targets, reason }
      }
    } else if (e?.module === 'E8') {
      const notes = Array.isArray(e.notes) ? e.notes : []
      const ints = notes.every((n) => Number.isInteger(n)) ? (notes as number[]) : null
      if (ints && ints.length === ctx.melody.notes && ints[0] === 0 && (ints[ints.length - 1] === 0 || ints[ints.length - 1] === 12)) {
        const inRange = ints.every((n) => n >= -1 && n <= 14)
        const chromatic = ints.filter((n) => !MAJOR_STEPS.has(n))
        const chromaticOk = ctx.melody.chromatic
          ? chromatic.length <= 1 && ints.every((n, i) => MAJOR_STEPS.has(n) || (i < ints.length - 1 && ints[i + 1] === n + 1))
          : chromatic.length === 0
        // Like the local generator, the last note may resolve to the tonic by up to a fourth.
        const leapsOk = ints.every((n, i) => i === 0 || Math.abs(n - ints[i - 1]!) <= (i === ints.length - 1 ? Math.max(5, ctx.melody.maxLeapSemitones) : ctx.melody.maxLeapSemitones))
        if (inRange && chromaticOk && leapsOk) ok = { module: 'E8', spec: { kind: 'melody', notes: ints.map((semitones) => ({ semitones, beats: 1 })) }, targets, reason }
      }
    }
    const key = ok ? JSON.stringify(ok.spec) : ''
    if (ok && !seen.has(key)) {
      seen.add(key)
      valid.push(ok)
    } else rejected++
  }
  if (!valid.length) throw new AIValidationError('AI 出的题都没通过本地检查（和弦不在你当前的级别里，或旋律不符合要求），没有保存。可以再试一次。')
  return { valid, rejected }
}

// ---------------------------------------------------------------------------
// confusion-explainer
// ---------------------------------------------------------------------------

export interface ConfusionExplanation {
  why: string
  tips: string[]
  practice: string
}

export function validateConfusion(raw: unknown): ConfusionExplanation {
  const o = obj(raw)
  const why = cleanText(o?.why, 200)
  const tips = texts(o?.tips, 80, 4)
  const practice = cleanText(o?.practice, 100) ?? ''
  if (!why || tips.length === 0) throw new AIValidationError('AI 的解释不完整，没有显示。可以再试一次。')
  return { why, tips, practice }
}

// ---------------------------------------------------------------------------
// composition-reviewer
// ---------------------------------------------------------------------------

const DIMENSIONS: readonly ReviewDimension[] = ['structure', 'harmony', 'melody', 'arrangement']

export function validateReview(raw: unknown, bars: number): { review: AIReview; dropped: number } {
  const o = obj(raw)
  const summary = cleanText(o?.summary, 220)
  const nextStep = cleanText(o?.nextStep, 180)
  if (!summary || !nextStep || !Array.isArray(o?.dimensions)) throw new AIValidationError('AI 的点评格式不完整，没有保存。可以再试一次。')
  let dropped = 0
  const dims: AIReview['dimensions'] = []
  for (const d of o!.dimensions as unknown[]) {
    const x = obj(d)
    const dimension = DIMENSIONS.find((k) => k === x?.dimension)
    if (!dimension || dims.some((y) => y.dimension === dimension)) continue
    const strengths = texts(x!.strengths, 140, 3).filter((t) => {
      const bad = looksLikeGhostwriting(t)
      if (bad) dropped++
      return !bad
    })
    const suggestions: AIReviewPoint[] = []
    for (const s of Array.isArray(x!.suggestions) ? (x!.suggestions as unknown[]).slice(0, 4) : []) {
      const so = obj(s)
      const text = cleanText(typeof s === 'string' ? s : so?.text, 180)
      if (!text) continue
      if (looksLikeGhostwriting(text)) {
        dropped++
        continue
      }
      const bar = Number(so?.bar)
      suggestions.push({ text, ...(Number.isInteger(bar) && bar >= 1 && bar <= bars ? { bar } : {}) })
    }
    if (strengths.length || suggestions.length) dims.push({ dimension, strengths, suggestions: suggestions.slice(0, 3) })
  }
  if (!dims.length) throw new AIValidationError('AI 的点评没有可用的内容，没有保存。可以再试一次。')
  dims.sort((a, b) => DIMENSIONS.indexOf(a.dimension) - DIMENSIONS.indexOf(b.dimension))
  const safeSummary = looksLikeGhostwriting(summary) ? '点评已生成，下面按结构、和声、旋律、编曲分别列出。' : summary
  const safeNext = looksLikeGhostwriting(nextStep) ? '从上面的第一条建议开始改。' : nextStep
  return { review: { summary: safeSummary, dimensions: dims, nextStep: safeNext }, dropped }
}

// ---------------------------------------------------------------------------
// plan-advisor
// ---------------------------------------------------------------------------

export function validateAdvice(raw: unknown, modules: ReadonlySet<ModuleId>): { focus: Array<{ module: ModuleId; minutes: number; reason: string }>; tip: string } {
  const o = obj(raw)
  const focus: Array<{ module: ModuleId; minutes: number; reason: string }> = []
  for (const f of Array.isArray(o?.focus) ? (o!.focus as unknown[]) : []) {
    const x = obj(f)
    const module = x?.module as ModuleId
    if (!modules.has(module) || focus.some((y) => y.module === module)) continue
    const minutes = Math.round(Number(x!.minutes))
    focus.push({ module, minutes: Number.isFinite(minutes) ? Math.max(3, Math.min(20, minutes)) : 5, reason: cleanText(x!.reason, 60) ?? '' })
  }
  const tip = cleanText(o?.tip, 100) ?? ''
  if (focus.length < 1) throw new AIValidationError('AI 的建议里没有可用的训练模块，没有保存。可以再试一次。')
  return { focus: focus.slice(0, 4), tip }
}

// ---------------------------------------------------------------------------
// improv-reviewer
// ---------------------------------------------------------------------------

export interface ImprovReview {
  summary: string
  strengths: string[]
  suggestions: Array<{ bar?: number; text: string }>
  nextStep: string
}

export function validateImprovReview(raw: unknown, bars: number): { review: ImprovReview; dropped: number } {
  const o = obj(raw)
  const summary = cleanText(o?.summary, 200)
  const nextStep = cleanText(o?.nextStep, 160)
  if (!summary || !nextStep) throw new AIValidationError('AI 的点评格式不完整，没有显示。可以再试一次。')
  let dropped = 0
  const keep = (t: string) => {
    if (looksLikeGhostwriting(t)) {
      dropped++
      return false
    }
    return true
  }
  const strengths = texts(o?.strengths, 120, 3).filter(keep)
  const suggestions: ImprovReview['suggestions'] = []
  for (const sg of Array.isArray(o?.suggestions) ? (o!.suggestions as unknown[]).slice(0, 4) : []) {
    const so = obj(sg)
    const text = cleanText(typeof sg === 'string' ? sg : so?.text, 160)
    if (!text || !keep(text)) continue
    const bar = Number(so?.bar)
    suggestions.push({ text, ...(Number.isInteger(bar) && bar >= 1 && bar <= bars ? { bar } : {}) })
  }
  if (!strengths.length && !suggestions.length) throw new AIValidationError('AI 的点评没有可用的内容，没有显示。可以再试一次。')
  return { review: { summary: looksLikeGhostwriting(summary) ? '点评已生成，见下方建议。' : summary, strengths, suggestions: suggestions.slice(0, 3), nextStep: looksLikeGhostwriting(nextStep) ? '从第一条建议开始试。' : nextStep }, dropped }
}

// ---------------------------------------------------------------------------
// guitar-coach
// ---------------------------------------------------------------------------

export interface GuitarCoachContext {
  patterns: ReadonlySet<string>
  romansMajor: readonly string[]
  romansMinor: readonly string[]
  /** Open-string MIDI notes, low to high. */
  strings: readonly number[]
}

export type CoachExercise =
  | { type: 'strum'; pattern: string; mode: 'major' | 'minor'; romans: string[]; bpm: number; reason: string }
  | { type: 'lick'; notes: Array<{ string: number; fret: number; beats: number; tech?: 'vibrato' | 'hammer' | 'pull' }>; bpm: number; reason: string }
  | { type: 'bend'; string: number; fret: number; semitones: 1 | 2; reason: string }

const A_MINOR_PENTA = [9, 0, 2, 4, 7]
const BEATS = [0.5, 1, 1.5, 2]

export function validateCoachExercises(raw: unknown, ctx: GuitarCoachContext): { valid: CoachExercise[]; rejected: number } {
  const list = obj(raw)?.exercises
  if (!Array.isArray(list)) throw new AIValidationError('AI 没有按要求返回练习列表，没有保存任何内容。可以再试一次。')
  const valid: CoachExercise[] = []
  let rejected = 0
  const pcOf = (s: number, f: number) => (((ctx.strings[s]! + f) % 12) + 12) % 12
  for (const item of list.slice(0, 12)) {
    const e = obj(item)
    const reason = cleanText(e?.reason, 60) ?? '针对你最近的练习记录'
    let ok: CoachExercise | null = null
    if (e?.type === 'strum') {
      const mode = e.mode === 'minor' ? 'minor' : e.mode === 'major' ? 'major' : null
      const romans = Array.isArray(e.romans) ? (e.romans as unknown[]) : []
      const allowed = mode === 'minor' ? ctx.romansMinor : ctx.romansMajor
      const bpm = Math.round(Number(e.bpm))
      if (mode && typeof e.pattern === 'string' && ctx.patterns.has(e.pattern) && romans.length === 4 && romans.every((r) => typeof r === 'string' && allowed.includes(r)) && bpm >= 60 && bpm <= 140) {
        ok = { type: 'strum', pattern: e.pattern, mode, romans: romans as string[], bpm, reason }
      }
    } else if (e?.type === 'lick') {
      const notes = Array.isArray(e.notes) ? (e.notes as unknown[]).map(obj) : []
      const bpm = Math.round(Number(e.bpm))
      const parsed = notes.map((n) => ({
        string: Number(n?.string),
        fret: Number(n?.fret),
        beats: Number(n?.beats),
        tech: n?.tech === 'vibrato' || n?.tech === 'hammer' || n?.tech === 'pull' ? (n.tech as 'vibrato' | 'hammer' | 'pull') : undefined,
      }))
      const total = parsed.reduce((s, n) => s + n.beats, 0)
      const fine =
        parsed.length >= 4 &&
        parsed.length <= 10 &&
        parsed.every((n) => Number.isInteger(n.string) && n.string >= 0 && n.string < ctx.strings.length && Number.isInteger(n.fret) && n.fret >= 5 && n.fret <= 8 && BEATS.includes(n.beats) && A_MINOR_PENTA.includes(pcOf(n.string, n.fret))) &&
        Number.isInteger(total) &&
        total <= 8 &&
        bpm >= 50 &&
        bpm <= 120
      if (fine) ok = { type: 'lick', notes: parsed.map((n) => ({ string: n.string, fret: n.fret, beats: n.beats, ...(n.tech ? { tech: n.tech } : {}) })), bpm, reason }
    } else if (e?.type === 'bend') {
      const string = Number(e.string)
      const fret = Number(e.fret)
      const semitones = Number(e.semitones)
      if (Number.isInteger(string) && string >= 1 && string < ctx.strings.length && Number.isInteger(fret) && fret >= 5 && fret <= 8 && (semitones === 1 || semitones === 2) && A_MINOR_PENTA.includes(pcOf(string, fret)) && A_MINOR_PENTA.includes(pcOf(string, fret + semitones))) {
        ok = { type: 'bend', string, fret, semitones, reason }
      }
    }
    if (ok) valid.push(ok)
    else rejected++
  }
  if (!valid.length) throw new AIValidationError('AI 出的练习都没通过本地检查（节奏型、和弦或音不在要求范围内），没有保存。可以再试一次。')
  return { valid, rejected }
}
