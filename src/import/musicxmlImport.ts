/**
 * MusicXML (partwise) → a score (pure, uses DOMParser). Takes one part,
 * voice 1: notes with ties merged, rests, lyrics, chord symbols
 * (<harmony>), key, tempo. Chord tones of a written chord (<chord/>) keep
 * only the top note. Notes crossing a bar line are cut at the bar.
 */
import { emptyScore, type ChordSlot, type Score, type ScoreNote } from '@/music/score'
import type { ChordTypeId } from '@/music/chords'
import type { Mode } from '@/music/keys'
import { ImportError } from './midiImport'
import { chordToRoman } from './chordSymbols'

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const MAJOR_FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]

const KIND: Record<string, ChordTypeId> = {
  major: 'maj',
  minor: 'min',
  augmented: 'aug',
  diminished: 'dim',
  dominant: 'dom7',
  'major-seventh': 'maj7',
  'minor-seventh': 'min7',
  'diminished-seventh': 'dim7',
  'half-diminished': 'm7b5',
  'suspended-second': 'sus2',
  'suspended-fourth': 'sus4',
  power: 'power',
  'dominant-ninth': 'dom7',
  'major-ninth': 'maj7',
  'minor-ninth': 'min7',
  'major-sixth': 'maj',
  'minor-sixth': 'min',
}

export interface MusicXmlPart {
  id: string
  name: string
}

export interface MusicXmlImport {
  score: Score
  title: string
  warnings: string[]
}

const text = (el: Element | null | undefined, sel: string) => el?.querySelector(sel)?.textContent?.trim() ?? ''
const num = (el: Element | null | undefined, sel: string, d = 0) => {
  const t = text(el, sel)
  const v = Number(t)
  return t && Number.isFinite(v) ? v : d
}

function parseDoc(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new ImportError('文件不是有效的 MusicXML。')
  if (!doc.querySelector('score-partwise')) {
    throw new ImportError(doc.querySelector('score-timewise') ? '这是 timewise 格式的 MusicXML，请导出为常见的 partwise 格式。' : '文件不是 MusicXML 乐谱。')
  }
  return doc
}

export function musicXmlParts(xml: string): MusicXmlPart[] {
  const doc = parseDoc(xml)
  return [...doc.querySelectorAll('part-list > score-part')].map((p) => ({ id: p.getAttribute('id') ?? '', name: text(p, 'part-name') || p.getAttribute('id') || '声部' }))
}

export function musicXmlToScore(xml: string, partId?: string, opts: { maxBars?: number } = {}): MusicXmlImport {
  const doc = parseDoc(xml)
  const warnings: string[] = []
  const part = (partId ? doc.querySelector(`part[id="${partId}"]`) : null) ?? doc.querySelector('part')
  if (!part) throw new ImportError('乐谱里没有声部。')
  const title = text(doc.documentElement, 'work > work-title') || text(doc.documentElement, 'movement-title') || '导入的乐谱'
  let divisions = 1
  let key: { tonicPc: number; mode: Mode } | null = null
  let bpm = 0
  let barBeats = 4
  let timeWarned = false
  const melody: ScoreNote[] = []
  const harmony: Array<{ beat: number; rootPc: number; quality: ChordTypeId; bassPc?: number }> = []
  let measureStart = 0
  let cut = 0
  let lastNote: ScoreNote | null = null
  const measures = [...part.querySelectorAll(':scope > measure')]
  const maxBars = opts.maxBars ?? 80
  for (const m of measures) {
    let cursor = 0
    let measureLen = 0
    for (const el of [...m.children]) {
      const tag = el.tagName
      if (tag === 'attributes') {
        divisions = num(el, 'divisions', divisions)
        const fifths = el.querySelector('key > fifths')
        if (fifths && !key) {
          const f = Number(fifths.textContent)
          const minor = text(el, 'key > mode') === 'minor'
          const majorPc = MAJOR_FIFTHS[((f % 12) + 12) % 12]!
          key = { tonicPc: minor ? (majorPc + 9) % 12 : majorPc, mode: minor ? 'minor' : 'major' }
        }
        const beats = num(el, 'time > beats', 0)
        const type = num(el, 'time > beat-type', 0)
        if (beats && type) {
          barBeats = (beats * 4) / type
          if (!(beats === 4 && type === 4) && !timeWarned) {
            warnings.push(`原谱是 ${beats}/${type} 拍，这里按 4/4 拍重新分小节，小节线位置可能和原谱不同。`)
            timeWarned = true
          }
        }
      } else if (tag === 'direction' || tag === 'sound') {
        const tempo = Number((tag === 'sound' ? el : el.querySelector('sound'))?.getAttribute('tempo')) || num(el, 'metronome > per-minute', 0)
        if (tempo && !bpm) bpm = tempo
      } else if (tag === 'harmony') {
        const step = text(el, 'root > root-step')
        if (step) {
          const rootPc = (STEP[step]! + num(el, 'root > root-alter', 0) + 12) % 12
          const quality = KIND[text(el, 'kind')] ?? 'maj'
          const bstep = text(el, 'bass > bass-step')
          const offset = num(el, 'offset', 0) / divisions
          harmony.push({ beat: measureStart + cursor / divisions + offset, rootPc, quality, ...(bstep ? { bassPc: (STEP[bstep]! + num(el, 'bass > bass-alter', 0) + 12) % 12 } : {}) })
        }
      } else if (tag === 'backup') {
        cursor -= num(el, 'duration', 0)
      } else if (tag === 'forward') {
        cursor += num(el, 'duration', 0)
      } else if (tag === 'note') {
        if (el.querySelector('grace')) continue
        const dur = num(el, 'duration', 0)
        const voice = text(el, 'voice') || '1'
        const isChordTone = Boolean(el.querySelector('chord'))
        const start = measureStart + (isChordTone ? (cursor - dur) / divisions : cursor / divisions)
        if (!isChordTone) cursor += dur
        measureLen = Math.max(measureLen, cursor)
        if (voice !== '1') continue
        const pitch = el.querySelector('pitch')
        if (!pitch) continue // rest
        const midi = (num(pitch, 'octave', 4) + 1) * 12 + STEP[text(pitch, 'step')]! + num(pitch, 'alter', 0)
        const beats = dur / divisions
        const tieStop = [...el.querySelectorAll('tie')].some((t) => t.getAttribute('type') === 'stop')
        if (isChordTone) {
          if (lastNote && Math.abs(lastNote.start - start) < 1e-6 && midi > lastNote.midi) lastNote.midi = midi
          continue
        }
        if (tieStop && lastNote && lastNote.midi === midi && Math.abs(lastNote.start + lastNote.beats - start) < 1e-6) {
          lastNote.beats += beats
          continue
        }
        const lyric = text(el, 'lyric > text')
        lastNote = { start, beats, midi, ...(lyric ? { lyric: lyric.slice(0, 4) } : {}) }
        melody.push(lastNote)
      }
    }
    measureStart += Math.max(measureLen, 0) / divisions || barBeats
  }
  const totalBeats = Math.max(4, measureStart)
  let bars = Math.ceil(totalBeats / 4 - 1e-6)
  if (bars > maxBars) {
    warnings.push(`原谱有 ${bars} 小节，只导入了前 ${maxBars} 小节。`)
    bars = maxBars
  }
  // Re-bar into 4/4 and cut notes at bar lines.
  const fitted: ScoreNote[] = []
  for (const n of melody) {
    if (n.start >= bars * 4) continue
    const start = Math.round(n.start * 4) / 4
    const barEnd = (Math.floor(start / 4 + 1e-6) + 1) * 4
    let beats = Math.round(n.beats * 4) / 4
    if (start + beats > barEnd + 1e-6) {
      cut++
      beats = barEnd - start
    }
    const prev = fitted[fitted.length - 1]
    if (prev && prev.start + prev.beats > start + 1e-6) prev.beats = Math.max(0.25, start - prev.start)
    if (beats >= 0.25) fitted.push({ ...n, start, beats })
  }
  if (cut) warnings.push(`有 ${cut} 个音跨过小节线，被截到了小节末尾（这里不画连音线）。`)
  key ??= { tonicPc: 0, mode: 'major' }
  const chords: ChordSlot[] = []
  const unsupported = new Set<string>()
  harmony.sort((a, b) => a.beat - b.beat)
  harmony.forEach((h, i) => {
    const start = Math.round(h.beat * 2) / 2
    if (start >= bars * 4) return
    const barEnd = (Math.floor(start / 4) + 1) * 4
    const next = harmony[i + 1] ? Math.round(harmony[i + 1]!.beat * 2) / 2 : Infinity
    const beats = Math.min(barEnd, next) - start
    if (beats <= 0) return
    const spec = chordToRoman({ symbol: '', rootPc: h.rootPc, quality: h.quality, ...(h.bassPc !== undefined ? { bassPc: h.bassPc } : {}) }, key!.tonicPc, key!.mode)
    if (!spec) {
      unsupported.add(String(h.rootPc))
      return
    }
    chords.push({ start, beats, roman: spec.roman, ...(spec.quality ? { quality: spec.quality } : {}), ...(spec.bass ? { bass: spec.bass } : {}) })
  })
  if (unsupported.size) warnings.push(`有 ${unsupported.size} 种和弦的根音不在这个调的常用级数里，没有导入（和弦轨上会空着）。`)
  if (!fitted.length) warnings.push('这个声部没有音符（可能是鼓或伴奏声部），可以换一个声部试试。')
  const tonic = 53 + ((key.tonicPc - 5 + 12) % 12)
  const score = emptyScore({ keyTonic: tonic, mode: key.mode, bpm: Math.round(Math.max(40, Math.min(240, bpm || 90))), bars, melody: fitted, chords, accompaniment: { comp: 'block', bass: 'roots', drums: 'pop' } })
  return { score, title, warnings }
}
