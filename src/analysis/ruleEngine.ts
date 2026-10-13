import { romanLabel, type RomanId } from '@/music/keys'
import { midiToName, pitchClass } from '@/music/pitch'
import { chordAt, slotBassInterval, slotPitchClasses, slotRoot, slotSymbol, tonicAt, type ChordSlot, type Score, type ScoreNote } from '@/music/score'
import { degreeFromSemitone, degreeLabel } from '@/music/scales'
import { spell, spelledName } from '@/music/spelling'

/**
 * Rule engine v1: deterministic, local checks on a score. It never judges
 * whether music is "good" — it points at things that are measurable and
 * explains them. Messages use the "可能 / 可以试试" register, never verdicts.
 */

export type Severity = 'warn' | 'info' | 'good'

export interface Finding {
  id: string
  severity: Severity
  message: string
  /** 0-based bar, when the finding is local. */
  bar?: number
  /** Melody note indices involved. */
  notes?: number[]
}

export type NonChordTone = 'passing' | 'neighbor' | 'appoggiatura' | 'escape' | 'unresolved'

export const NCT_LABEL: Record<NonChordTone, string> = {
  passing: '经过音',
  neighbor: '辅助音',
  appoggiatura: '倚音',
  escape: '逃音',
  unresolved: '未解决的非和弦音',
}

export interface NoteAnalysis {
  index: number
  degree: string
  /** Chord under the note (none when the chord track is empty there). */
  chord?: RomanId
  /** The chord slot under the note. */
  slot?: ChordSlot
  chordTone: boolean | null
  nct?: NonChordTone
  strongBeat: boolean
}

export interface KeyEstimate {
  tonicPc: number
  mode: 'major' | 'minor'
  /** Correlation (−1…1). */
  score: number
  label: string
}

export interface Analysis {
  notes: NoteAnalysis[]
  findings: Finding[]
  key: KeyEstimate | null
  cadence: string | null
}

// Krumhansl–Kessler key profiles.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

function correlate(a: readonly number[], b: readonly number[]): number {
  const ma = a.reduce((s, x) => s + x, 0) / a.length
  const mb = b.reduce((s, x) => s + x, 0) / b.length
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < a.length; i++) {
    num += (a[i]! - ma) * (b[i]! - mb)
    da += (a[i]! - ma) ** 2
    db += (b[i]! - mb) ** 2
  }
  return da && db ? num / Math.sqrt(da * db) : 0
}

/** Duration-weighted key estimate (Krumhansl–Schmuckler). */
export function estimateKey(notes: readonly ScoreNote[]): KeyEstimate | null {
  if (notes.length < 4) return null
  const hist = new Array<number>(12).fill(0)
  for (const n of notes) hist[pitchClass(n.midi)]! += n.beats
  let best: KeyEstimate | null = null
  for (let t = 0; t < 12; t++) {
    const rotated = hist.map((_, i) => hist[(i + t) % 12]!)
    for (const mode of ['major', 'minor'] as const) {
      const score = correlate(rotated, mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE)
      if (!best || score > best.score) {
        const name = spelledName(spell(60 + t, { keyTonic: mode === 'minor' ? 60 + ((t + 3) % 12) : 60 + t }))
        best = { tonicPc: t, mode, score, label: `${name} ${mode === 'major' ? '大调' : '小调'}` }
      }
    }
  }
  return best
}

const step = (a: number, b: number) => Math.abs(b - a) <= 2 && b !== a
const isLeap = (a: number, b: number) => Math.abs(b - a) >= 3

function classifyNct(prev: ScoreNote | undefined, cur: ScoreNote, next: ScoreNote | undefined): NonChordTone {
  if (!prev || !next) return 'unresolved'
  const inStep = step(prev.midi, cur.midi)
  const outStep = step(cur.midi, next.midi)
  const dirIn = Math.sign(cur.midi - prev.midi)
  const dirOut = Math.sign(next.midi - cur.midi)
  if (inStep && outStep && dirIn === dirOut) return 'passing'
  if (inStep && outStep && dirIn !== dirOut) return 'neighbor'
  if (isLeap(prev.midi, cur.midi) && outStep && dirIn !== dirOut) return 'appoggiatura'
  if (inStep && isLeap(cur.midi, next.midi) && dirIn !== dirOut) return 'escape'
  // Approached by repetition and resolved by step (suspension-like) is fine too.
  if (prev.midi === cur.midi && outStep) return 'appoggiatura'
  return 'unresolved'
}

export function analyzeScore(s: Score): Analysis {
  const melody = [...s.melody].sort((a, b) => a.start - b.start)
  const findings: Finding[] = []
  const barOf = (beat: number) => Math.floor(beat / s.beatsPerBar + 1e-6)

  // --- Per-note analysis -----------------------------------------------------
  const notes: NoteAnalysis[] = melody.map((n, i) => {
    const chord = chordAt(s, n.start)
    const strongBeat = Math.abs(n.start % 2) < 1e-6
    const degree = degreeLabel(degreeFromSemitone(n.midi - tonicAt(s, n.start)))
    if (!chord) return { index: s.melody.indexOf(n), degree, chordTone: null, strongBeat }
    const tones = slotPitchClasses(s, chord)
    const chordTone = tones.includes(pitchClass(n.midi))
    const base: NoteAnalysis = { index: s.melody.indexOf(n), degree, chord: chord.roman, slot: chord, chordTone, strongBeat }
    if (chordTone) return base
    return { ...base, nct: classifyNct(melody[i - 1], n, melody[i + 1]) }
  })

  // --- Chord-tone findings ---------------------------------------------------
  for (const a of notes) {
    const n = s.melody[a.index]!
    if (a.nct === 'unresolved') {
      findings.push({
        id: `nct-${a.index}`,
        severity: 'warn',
        bar: barOf(n.start),
        notes: [a.index],
        message: `第 ${barOf(n.start) + 1} 小节的 ${midiToName(n.midi)} 不在 ${slotSymbol(s, a.slot!)} 和弦里，前后也没有级进进入或解决。可以把它换成和弦音，或让它级进走到和弦音。`,
      })
    } else if (a.nct && a.strongBeat && n.beats >= 1 && a.nct !== 'appoggiatura') {
      findings.push({
        id: `strong-nct-${a.index}`,
        severity: 'info',
        bar: barOf(n.start),
        notes: [a.index],
        message: `第 ${barOf(n.start) + 1} 小节强拍上的 ${midiToName(n.midi)} 是${NCT_LABEL[a.nct]}，又持续了一拍以上，会和 ${slotSymbol(s, a.slot!)} 和弦产生明显摩擦。如果不是刻意制造张力，可以缩短它或放到弱拍。`,
      })
    }
  }

  // --- Melody shape ----------------------------------------------------------
  if (melody.length >= 2) {
    const midis = melody.map((n) => n.midi)
    const lo = Math.min(...midis)
    const hi = Math.max(...midis)
    if (hi - lo > 16) {
      findings.push({ id: 'range', severity: 'warn', message: `旋律音域跨了 ${hi - lo} 个半音（${midiToName(lo, { octave: true })}–${midiToName(hi, { octave: true })}），超过一个八度加大三度，大多数人唱起来会吃力。` })
    }
    for (let i = 1; i < melody.length; i++) {
      const jump = melody[i]!.midi - melody[i - 1]!.midi
      if (Math.abs(jump) > 12) {
        findings.push({ id: `bigleap-${i}`, severity: 'warn', bar: barOf(melody[i]!.start), notes: [s.melody.indexOf(melody[i - 1]!), s.melody.indexOf(melody[i]!)], message: `第 ${barOf(melody[i]!.start) + 1} 小节有超过八度的大跳，很难唱准。` })
      } else if (Math.abs(jump) >= 8 && melody[i + 1]) {
        const back = melody[i + 1]!.midi - melody[i]!.midi
        if (!(Math.sign(back) === -Math.sign(jump) && Math.abs(back) <= 2)) {
          findings.push({ id: `recover-${i}`, severity: 'info', bar: barOf(melody[i]!.start), notes: [s.melody.indexOf(melody[i]!)], message: `第 ${barOf(melody[i]!.start) + 1} 小节的六度以上大跳之后，可以试试反方向级进一步，旋律会更平衡。` })
        }
      }
    }
    // Climax: the highest note should be special.
    const highs = melody.filter((n) => n.midi === hi)
    if (highs.length >= 3 && melody.length >= 8) {
      findings.push({ id: 'climax', severity: 'info', notes: highs.map((n) => s.melody.indexOf(n)), message: `最高音 ${midiToName(hi, { octave: true })} 出现了 ${highs.length} 次。只出现一次的最高点更像“高潮”。` })
    } else if (highs.length === 1 && melody.length >= 8) {
      findings.push({ id: 'climax-good', severity: 'good', message: `旋律有一个清楚的最高点（${midiToName(hi, { octave: true })}）。` })
    }
    // Monotony: 4+ repeated notes.
    let run = 1
    for (let i = 1; i <= melody.length; i++) {
      if (i < melody.length && melody[i]!.midi === melody[i - 1]!.midi) run++
      else {
        if (run >= 4) findings.push({ id: `repeat-${i}`, severity: 'info', bar: barOf(melody[i - 1]!.start), message: `同一个音连续重复了 ${run} 次。说唱式的旋律可以这样写，否则可以加一点起伏。` })
        run = 1
      }
    }
    // Ending.
    const last = melody[melody.length - 1]!
    const endTonicPc = pitchClass(tonicAt(s, last.start))
    if (pitchClass(last.midi) === endTonicPc) {
      findings.push({ id: 'end-tonic', severity: 'good', message: '旋律结束在主音上，听起来“到家了”。' })
    } else {
      findings.push({ id: 'end-tonic', severity: 'warn', bar: barOf(last.start), notes: [s.melody.indexOf(last)], message: `旋律结束在第 ${degreeLabel(degreeFromSemitone(last.midi - tonicAt(s, last.start)))} 级，没有回到主音，会有“没说完”的感觉。如果这是乐句中段可以保留。` })
    }
  }

  // --- Harmony ---------------------------------------------------------------
  let cadence: string | null = null
  if (s.chords.length > 0) {
    for (let b = 0; b < s.bars; b++) {
      if (!s.chords.some((c) => barOf(c.start) === b || (c.start < b * s.beatsPerBar && c.start + c.beats > b * s.beatsPerBar))) {
        findings.push({ id: `nochord-${b}`, severity: 'info', bar: b, message: `第 ${b + 1} 小节还没有和弦。` })
      }
    }
    const sorted = [...s.chords].sort((a, b) => a.start - b.start)
    const lastChord = sorted[sorted.length - 1]!
    const prevChord = sorted[sorted.length - 2]
    const tonicRoman = s.mode === 'major' ? 'I' : 'i'
    const isDominant = (r: RomanId) => r === 'V' || r === 'v' || r === 'vii°'
    if (lastChord.roman === tonicRoman && prevChord && isDominant(prevChord.roman)) cadence = '正格终止（V → I）'
    else if (lastChord.roman === tonicRoman && prevChord && (prevChord.roman === 'IV' || prevChord.roman === 'iv')) cadence = '变格终止（IV → I）'
    else if (isDominant(lastChord.roman)) cadence = '半终止（停在 V）'
    else if (lastChord.roman === 'vi' && prevChord?.roman === 'V') cadence = '阻碍终止（V → vi）'
    if (cadence) findings.push({ id: 'cadence', severity: lastChord.roman === tonicRoman ? 'good' : 'info', message: `结尾是${cadence}。${lastChord.roman === tonicRoman ? '' : '如果这是整首歌的结尾，可以最后回到 ' + romanLabel(tonicRoman as RomanId) + '。'}` })
    else if (lastChord.roman !== tonicRoman) findings.push({ id: 'cadence', severity: 'info', message: `最后一个和弦是 ${romanLabel(lastChord.roman)}，不是主和弦。` })

    // Parallel perfect intervals between melody and the chord-root bass.
    for (let i = 1; i < melody.length; i++) {
      const a = melody[i - 1]!
      const b = melody[i]!
      const ca = chordAt(s, a.start)
      const cb = chordAt(s, b.start)
      if (!ca || !cb || ca === cb) continue
      const bassA = slotRoot(s, ca) - 24 + slotBassInterval(s, ca)
      const bassB = slotRoot(s, cb) - 24 + slotBassInterval(s, cb)
      const ivA = (((a.midi - bassA) % 12) + 12) % 12
      const ivB = (((b.midi - bassB) % 12) + 12) % 12
      const sameDir = Math.sign(b.midi - a.midi) === Math.sign(bassB - bassA) && b.midi !== a.midi
      if (sameDir && ivA === ivB && (ivA === 7 || ivA === 0)) {
        findings.push({
          id: `parallel-${i}`,
          severity: 'info',
          bar: barOf(b.start),
          notes: [s.melody.indexOf(a), s.melody.indexOf(b)],
          message: `第 ${barOf(b.start) + 1} 小节旋律和低音同向平行${ivA === 7 ? '五度' : '八度'}。古典和声会避免它；流行摇滚里（比如强力和弦）很常见，听起来更“空”，按需要取舍。`,
        })
      }
    }
  }

  const key = estimateKey(melody)
  const tonicPc = pitchClass(s.keyTonic)
  if (key && key.score > 0.6 && !s.sections?.some((x) => x.transpose) && (key.tonicPc !== tonicPc || key.mode !== s.mode)) {
    const relative = key.mode !== s.mode && pitchClass(key.tonicPc + (key.mode === 'minor' ? 3 : -3)) === tonicPc
    if (!relative) findings.push({ id: 'key', severity: 'info', message: `旋律的音听起来更像 ${key.label}，而作品设定的是 ${spelledName(spell(s.keyTonic, { keyTonic: s.mode === 'minor' ? s.keyTonic + 3 : s.keyTonic }))} ${s.mode === 'major' ? '大调' : '小调'}。` })
  }

  const order: Record<Severity, number> = { warn: 0, info: 1, good: 2 }
  findings.sort((x, y) => order[x.severity] - order[y.severity] || (x.bar ?? -1) - (y.bar ?? -1))
  return { notes, findings, key, cadence }
}

/** Per melody-note marks for the notation views. */
export function analysisMarks(a: Analysis): Record<number, 'warn'> {
  const out: Record<number, 'warn'> = {}
  for (const f of a.findings) if (f.severity === 'warn') for (const n of f.notes ?? []) out[n] = 'warn'
  return out
}
