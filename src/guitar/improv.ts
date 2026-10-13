/**
 * Improvisation and target-note analysis on a pitch track (pure).
 */
import type { PitchPoint } from './technique'
import { emptyScore, type ChordSlot, type Score, type ScoreNote } from '@/music/score'
import type { RomanId } from '@/music/keys'

export interface NoteEvent {
  start: number
  end: number
  midi: number
}

/** Split a pitch track into notes: a new note when the rounded pitch changes and holds, or after silence. */
export function segmentNotes(points: readonly PitchPoint[], minSeconds = 0.08): NoteEvent[] {
  const out: NoteEvent[] = []
  let cur: { start: number; last: number; votes: number[] } | null = null
  let pending: { midi: number; count: number; t: number } | null = null
  const close = () => {
    if (!cur) return
    const counts = new Map<number, number>()
    for (const v of cur.votes) counts.set(v, (counts.get(v) ?? 0) + 1)
    const midi = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
    if (cur.last - cur.start >= minSeconds) out.push({ start: cur.start, end: cur.last, midi })
    cur = null
  }
  for (const p of points) {
    if (p.midi === null) {
      close()
      pending = null
      continue
    }
    const m = Math.round(p.midi)
    if (!cur) {
      cur = { start: p.t, last: p.t, votes: [m] }
      continue
    }
    const majority: number = cur.votes[cur.votes.length - 1]!
    if (m === majority) {
      cur.votes.push(m)
      cur.last = p.t
      pending = null
    } else if (pending && pending.midi === m) {
      pending.count++
      if (pending.count >= 2) {
        cur.last = pending.t
        close()
        cur = { start: pending.t, last: p.t, votes: [m, m] }
        pending = null
      }
    } else {
      pending = { midi: m, count: 1, t: p.t }
    }
  }
  close()
  return out
}

export interface ImprovContext {
  startAt: number
  beat: number
  bars: number
  /** Chord pitch classes per bar. */
  chordPcs: number[][]
  scalePcs: number[]
}

export interface ImprovStats {
  notes: number
  /** Share of notes in the scale. */
  inScale: number
  /** Share of notes starting on beats 1 and 3 that are chord tones. */
  strongChordTones: number
  /** Share of the take with no note sounding. */
  rest: number
  phrases: number
  rangeSemitones: number
  notesPerBar: number
}

const pc = (m: number) => ((m % 12) + 12) % 12

export function analyzeImprov(notes: readonly NoteEvent[], ctx: ImprovContext): ImprovStats {
  const end = ctx.startAt + ctx.bars * 4 * ctx.beat
  const inside = notes.filter((n) => n.start >= ctx.startAt - 0.1 && n.start < end)
  if (!inside.length) return { notes: 0, inScale: 0, strongChordTones: 0, rest: 1, phrases: 0, rangeSemitones: 0, notesPerBar: 0 }
  const inScale = inside.filter((n) => ctx.scalePcs.includes(pc(n.midi))).length / inside.length
  const strong = inside.filter((n) => {
    const beatPos = (n.start - ctx.startAt) / ctx.beat
    const inBar = beatPos - Math.floor(beatPos / 4) * 4
    return Math.abs(inBar - 0) < 0.3 || Math.abs(inBar - 2) < 0.3 || Math.abs(inBar - 4) < 0.3
  })
  const strongChord = strong.filter((n) => {
    const bar = Math.min(ctx.bars - 1, Math.max(0, Math.floor((n.start - ctx.startAt + 0.3 * ctx.beat) / (4 * ctx.beat))))
    return (ctx.chordPcs[bar] ?? []).includes(pc(n.midi))
  })
  const sounding = inside.reduce((s, n) => s + Math.max(0, Math.min(n.end, end) - n.start), 0)
  let phrases = 1
  for (let i = 1; i < inside.length; i++) if (inside[i]!.start - inside[i - 1]!.end >= ctx.beat) phrases++
  const midis = inside.map((n) => n.midi)
  return {
    notes: inside.length,
    inScale,
    strongChordTones: strong.length ? strongChord.length / strong.length : 0,
    rest: Math.max(0, Math.min(1, 1 - sounding / (end - ctx.startAt))),
    phrases,
    rangeSemitones: Math.max(...midis) - Math.min(...midis),
    notesPerBar: inside.length / ctx.bars,
  }
}

/** Local suggestions (always shown; the AI review is optional). */
export function improvSuggestions(s: ImprovStats): string[] {
  if (s.notes === 0) return ['没有检测到音。确认输入有信号，跟着伴奏弹几句。']
  const out: string[] = []
  if (s.inScale < 0.8) out.push('有不少音在音阶外。先只用 A 小调五声，熟练后再加入其他音。')
  if (s.strongChordTones < 0.4) out.push('强拍（第 1、3 拍）上落在和弦音的比例不高。试着在和弦变化时落在它的根音或三音上。')
  if (s.rest < 0.2) out.push('几乎没有留白。句子之间停一两拍，听起来更像在说话。')
  if (s.phrases < 3) out.push('乐句太少，像一口气弹完。试着分成“问—答—问—答”四句。')
  if (s.rangeSemitones < 7) out.push('音域比较窄。可以用一个推弦或换到第二把位，把高潮推上去。')
  if (s.notesPerBar > 8) out.push('音太密了。少即是多，挑几个音唱出来。')
  if (!out.length) out.push('音阶、和弦音、留白和音域都用得不错。下次试着重复一个动机再变化它。')
  return out
}

/** Score of passing the target-note drill: did each bar's first note land on a chord tone? */
export function downbeatTargets(points: readonly PitchPoint[], ctx: Pick<ImprovContext, 'startAt' | 'beat' | 'bars' | 'chordPcs'>): Array<{ bar: number; midi: number | null; chordTone: boolean }> {
  return Array.from({ length: ctx.bars }, (_, bar) => {
    const t0 = ctx.startAt + bar * 4 * ctx.beat
    const win = points.filter((p) => p.midi !== null && p.t >= t0 + 0.05 * ctx.beat && p.t <= t0 + 0.75 * ctx.beat).map((p) => p.midi!)
    if (win.length < 2) return { bar, midi: null, chordTone: false }
    const sorted = [...win].sort((a, b) => a - b)
    const midi = Math.round(sorted[Math.floor(sorted.length / 2)]!)
    return { bar, midi, chordTone: (ctx.chordPcs[bar] ?? []).includes(pc(midi)) }
  })
}

/**
 * Turn detected notes into a score (eighth-note grid, one voice, no bar
 * crossing) so an improvisation can go into the portfolio and the studio.
 */
export function improvToScore(notes: readonly NoteEvent[], opts: { startAt: number; beat: number; bars: number; keyTonic: number; mode: 'major' | 'minor'; bpm: number; romans: RomanId[] }): Score {
  const melody: ScoreNote[] = []
  const grid = 0.5
  const total = opts.bars * 4
  let lastEnd = 0
  for (const n of notes) {
    let start = Math.round((n.start - opts.startAt) / opts.beat / grid) * grid
    if (start < lastEnd) start = lastEnd
    if (start < 0 || start >= total) continue
    const barEnd = (Math.floor(start / 4) + 1) * 4
    let beats = Math.round((n.end - n.start) / opts.beat / grid) * grid
    beats = Math.max(grid, Math.min(beats, barEnd - start))
    melody.push({ start, beats, midi: n.midi })
    lastEnd = start + beats
  }
  const chords: ChordSlot[] = Array.from({ length: opts.bars }, (_, i) => ({ start: i * 4, beats: 4, roman: opts.romans[i % opts.romans.length]! }))
  return emptyScore({ keyTonic: opts.keyTonic, mode: opts.mode, bpm: opts.bpm, bars: opts.bars, melody, chords, accompaniment: { comp: 'off', bass: 'roots', drums: 'pop' } })
}
