/**
 * Standard MIDI files → a score (pure). The student picks a melody track;
 * it is reduced to one voice (highest note at each onset), quantised to
 * sixteenth notes and cut at bar lines. One chord per bar is estimated from
 * all pitched tracks and mapped to the key.
 */
import { emptyScore, type ChordSlot, type Score, type ScoreNote } from '@/music/score'
import { estimateKey } from '@/analysis/ruleEngine'
import { matchChord } from '@/audio/chroma'
import type { ChordTypeId } from '@/music/chords'
import type { Mode } from '@/music/keys'
import { chordToRoman } from './chordSymbols'

export class ImportError extends Error {}

export interface MidiNote {
  start: number // ticks
  end: number
  midi: number
  channel: number
}

export interface MidiTrack {
  index: number
  name: string
  notes: MidiNote[]
  /** Channel 10: drums. */
  drums: boolean
}

export interface MidiFile {
  ppq: number
  tracks: MidiTrack[]
  tempo: number // BPM
  timeSig: [number, number]
  key: { tonicPc: number; mode: Mode } | null
}

class Reader {
  pos = 0
  constructor(private b: Uint8Array) {}
  get done() {
    return this.pos >= this.b.length
  }
  u8() {
    if (this.pos >= this.b.length) throw new ImportError('MIDI 文件不完整。')
    return this.b[this.pos++]!
  }
  u16() {
    return (this.u8() << 8) | this.u8()
  }
  u32() {
    return ((this.u8() << 24) >>> 0) + (this.u8() << 16) + (this.u8() << 8) + this.u8()
  }
  str(n: number) {
    let s = ''
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8())
    return s
  }
  varint() {
    let v = 0
    for (let i = 0; i < 4; i++) {
      const c = this.u8()
      v = (v << 7) | (c & 0x7f)
      if (!(c & 0x80)) return v
    }
    return v
  }
  bytes(n: number) {
    const out = this.b.slice(this.pos, this.pos + n)
    this.pos += n
    return out
  }
}

const MAJOR_FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]

export function parseMidi(data: Uint8Array): MidiFile {
  const r = new Reader(data)
  if (r.str(4) !== 'MThd') throw new ImportError('这不是 MIDI 文件（文件头不是 MThd）。')
  const hlen = r.u32()
  r.u16() // format
  const ntrks = r.u16()
  const division = r.u16()
  if (division & 0x8000) throw new ImportError('这个 MIDI 使用 SMPTE 时间格式，暂不支持。请从软件里重新导出为普通 MIDI。')
  r.pos = 8 + hlen
  let tempo = 120
  let timeSig: [number, number] = [4, 4]
  let key: MidiFile['key'] = null
  const tracks: MidiTrack[] = []
  for (let t = 0; t < ntrks && !r.done; t++) {
    if (r.str(4) !== 'MTrk') throw new ImportError('MIDI 文件里的音轨格式不对。')
    const len = r.u32()
    const end = r.pos + len
    let tick = 0
    let status = 0
    let name = ''
    const open = new Map<string, number>()
    const notes: MidiNote[] = []
    let tempoSet = false
    while (r.pos < end) {
      tick += r.varint()
      let b = r.u8()
      if (b < 0x80) {
        // Running status.
        r.pos--
        b = status
      } else if (b < 0xf0) status = b
      if (b === 0xff) {
        const type = r.u8()
        const l = r.varint()
        const d = r.bytes(l)
        if (type === 0x03 && !name) name = new TextDecoder().decode(d)
        if (type === 0x51 && !tempoSet && l === 3) {
          tempo = Math.round(60000000 / ((d[0]! << 16) | (d[1]! << 8) | d[2]!))
          tempoSet = true
        }
        if (type === 0x58 && l >= 2) timeSig = [d[0]!, Math.pow(2, d[1]!)]
        if (type === 0x59 && l === 2 && !key) {
          const sf = (d[0]! << 24) >> 24
          const minor = d[1] === 1
          const majorPc = MAJOR_FIFTHS[(sf + 12) % 12]!
          key = { tonicPc: minor ? (majorPc + 9) % 12 : majorPc, mode: minor ? 'minor' : 'major' }
        }
      } else if (b === 0xf0 || b === 0xf7) {
        r.pos += r.varint()
      } else {
        const type = b & 0xf0
        const ch = b & 0x0f
        const d1 = r.u8()
        const d2 = type === 0xc0 || type === 0xd0 ? 0 : r.u8()
        const k = `${ch}:${d1}`
        if (type === 0x90 && d2 > 0) open.set(k, tick)
        else if (type === 0x80 || (type === 0x90 && d2 === 0)) {
          const s = open.get(k)
          if (s !== undefined) {
            notes.push({ start: s, end: tick, midi: d1, channel: ch })
            open.delete(k)
          }
        }
      }
    }
    r.pos = end
    if (notes.length) tracks.push({ index: t, name: name || `音轨 ${tracks.length + 1}`, notes: notes.sort((a, b) => a.start - b.start), drums: notes.every((n) => n.channel === 9) })
  }
  if (!tracks.length) throw new ImportError('这个 MIDI 文件里没有音符。')
  return { ppq: division, tracks, tempo, timeSig, key }
}

/** A sensible default melody track: pitched, not drums, highest average pitch among the busier tracks. */
export function guessMelodyTrack(f: MidiFile): number {
  const pitched = f.tracks.filter((t) => !t.drums)
  if (!pitched.length) return f.tracks[0]!.index
  const busiest = Math.max(...pitched.map((t) => t.notes.length))
  const candidates = pitched.filter((t) => t.notes.length >= busiest * 0.25)
  const avg = (t: MidiTrack) => t.notes.reduce((s, n) => s + n.midi, 0) / t.notes.length
  return candidates.sort((a, b) => avg(b) - avg(a))[0]!.index
}

const SUFFIX: Record<string, ChordTypeId> = { maj: 'maj', min: 'min', '5': 'power', '7': 'dom7', m7: 'min7' }

export interface MidiImportResult {
  score: Score
  warnings: string[]
}

export function midiToScore(f: MidiFile, melodyTrack: number, opts: { maxBars?: number } = {}): MidiImportResult {
  const warnings: string[] = []
  const [num, den] = f.timeSig
  if (!(num === 4 && den === 4)) warnings.push(`原曲是 ${num}/${den} 拍，这里按 4/4 拍重新分小节，小节线位置可能和原谱不同。`)
  const track = f.tracks.find((t) => t.index === melodyTrack) ?? f.tracks[0]!
  const q = (ticks: number) => Math.round((ticks / f.ppq) * 4) / 4
  // One voice: the highest note at each onset.
  const byStart = new Map<number, MidiNote>()
  for (const n of track.notes) {
    if (n.channel === 9) continue
    const s = q(n.start)
    const prev = byStart.get(s)
    if (!prev || n.midi > prev.midi) byStart.set(s, n)
  }
  const starts = [...byStart.keys()].sort((a, b) => a - b)
  const maxBars = opts.maxBars ?? 80
  const lastBeat = starts.length ? starts[starts.length - 1]! : 0
  let bars = Math.max(1, Math.ceil((lastBeat + 1) / 4))
  if (bars > maxBars) {
    warnings.push(`原曲有 ${bars} 小节，只导入了前 ${maxBars} 小节。`)
    bars = maxBars
  }
  const melody: ScoreNote[] = []
  let cut = 0
  starts.forEach((s, i) => {
    if (s >= bars * 4) return
    const n = byStart.get(s)!
    const next = starts[i + 1] ?? Infinity
    const barEnd = (Math.floor(s / 4) + 1) * 4
    let beats = Math.max(0.25, q(n.end) - s)
    if (s + beats > barEnd) cut++
    beats = Math.min(beats, next - s, barEnd - s)
    if (beats >= 0.25) melody.push({ start: s, beats, midi: n.midi })
  })
  if (cut) warnings.push(`有 ${cut} 个音跨过小节线，被截到了小节末尾（这里不画连音线）。`)
  // Key: from the file, or estimated from the melody.
  let key = f.key
  if (!key) {
    const est = estimateKey(melody)
    key = est ? { tonicPc: est.tonicPc, mode: est.mode } : { tonicPc: 0, mode: 'major' }
  }
  // One chord per bar from every pitched note sounding in it.
  const chords: ChordSlot[] = []
  const pitched = f.tracks.filter((t) => !t.drums).flatMap((t) => t.notes.filter((n) => n.channel !== 9))
  for (let b = 0; b < bars; b++) {
    const from = b * 4
    const to = from + 4
    const chroma = new Array<number>(12).fill(0)
    for (const n of pitched) {
      const s = n.start / f.ppq
      const e = n.end / f.ppq
      const overlap = Math.min(e, to) - Math.max(s, from)
      if (overlap > 0) chroma[n.midi % 12]! += overlap * (n.midi < 60 ? 1.5 : 1)
    }
    const hint = matchChord(chroma)
    if (!hint || hint.score < 0.7) continue
    const spec = chordToRoman({ symbol: hint.label, rootPc: hint.rootPc, quality: SUFFIX[hint.quality] ?? 'maj' }, key.tonicPc, key.mode)
    if (spec) chords.push({ start: from, beats: 4, roman: spec.roman, ...(spec.quality ? { quality: spec.quality } : {}) })
  }
  const tonic = 53 + ((key.tonicPc - 5 + 12) % 12)
  const score = emptyScore({ keyTonic: tonic, mode: key.mode, bpm: Math.max(40, Math.min(240, f.tempo)), bars, melody, chords, accompaniment: { comp: 'block', bass: 'roots', drums: 'pop' } })
  return { score, warnings }
}
