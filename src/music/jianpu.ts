import { pitchClass } from './pitch'
import type { Event } from './score'

/**
 * Jianpu (numbered notation) layout, movable-do: "1" is the major-key tonic
 * (for minor keys the relative major, so the minor tonic reads as 6, the
 * common Chinese convention). Pure function; the view only draws tokens.
 */
export interface JianpuToken {
  kind: 'note' | 'rest' | 'dash'
  /** Centre x in px. */
  x: number
  digit: string
  /** '#', 'b' or ''. */
  accidental: '' | '#' | 'b'
  /** Octave dots: +1 = one dot above, −1 = one below. */
  octave: number
  /** Underlines (eighth = 1, sixteenth = 2). */
  lines: number
  /** Augmentation dot to the right. */
  dotted: boolean
  lyric?: string
  /** Event index (for highlighting). */
  event: number
  bar: number
}

export interface JianpuLine {
  bars: number[]
  tokens: JianpuToken[]
  /** Underline segments: from x1 to x2 at depth level (1 or 2). */
  beams: Array<{ x1: number; x2: number; level: number }>
  /** Bar line x positions (including the end). */
  barLines: number[]
  /** Chord labels: x and text. */
  chords: Array<{ x: number; text: string }>
}

export interface JianpuOptions {
  beatsPerBar: number
  beatWidth: number
  barsPerLine: number
  /** Left padding of each line. */
  padding: number
}

const DEFAULTS: JianpuOptions = { beatsPerBar: 4, beatWidth: 46, barsPerLine: 4, padding: 16 }

const DEGREE: Record<number, [string, '' | '#' | 'b']> = {
  0: ['1', ''],
  1: ['1', '#'],
  2: ['2', ''],
  3: ['3', 'b'],
  4: ['3', ''],
  5: ['4', ''],
  6: ['4', '#'],
  7: ['5', ''],
  8: ['6', 'b'],
  9: ['6', ''],
  10: ['7', 'b'],
  11: ['7', ''],
}

/** The "1" of the middle register: the tonic at or just below the melody's median. */
export function referenceTonic(midis: readonly number[], signatureTonic: number): number {
  const sorted = [...midis].sort((a, b) => a - b)
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 66
  const pc = pitchClass(signatureTonic)
  return median - ((median - pc) % 12 + 12) % 12
}

export function jianpuDegree(midi: number, ref: number): { digit: string; accidental: '' | '#' | 'b'; octave: number } {
  const rel = midi - ref
  const [digit, accidental] = DEGREE[((rel % 12) + 12) % 12]!
  return { digit, accidental, octave: Math.floor(rel / 12) }
}

export function layoutJianpu(
  events: readonly Event[],
  signatureTonic: number,
  totalBars: number,
  chords: ReadonlyArray<{ start: number; text: string }> = [],
  options: Partial<JianpuOptions> = {},
): JianpuLine[] {
  const o = { ...DEFAULTS, ...options }
  const ref = referenceTonic(
    events.filter((e) => e.midi !== null).map((e) => e.midi!),
    signatureTonic,
  )
  const barW = o.beatsPerBar * o.beatWidth
  const lines: JianpuLine[] = []
  for (let first = 0; first < totalBars; first += o.barsPerLine) {
    const bars = Array.from({ length: Math.min(o.barsPerLine, totalBars - first) }, (_, i) => first + i)
    const line: JianpuLine = { bars, tokens: [], beams: [], barLines: [], chords: [] }
    const xOf = (beat: number) => {
      const bar = Math.floor(beat / o.beatsPerBar + 1e-6)
      return o.padding + (bar - first) * barW + (beat - bar * o.beatsPerBar) * o.beatWidth + o.beatWidth * 0.3
    }
    bars.forEach((_b, i) => line.barLines.push(o.padding + (i + 1) * barW))
    events.forEach((e, idx) => {
      const bar = Math.floor(e.start / o.beatsPerBar + 1e-6)
      if (bar < first || bar >= first + bars.length) return
      const lines = e.beats <= 0.25 + 1e-6 ? 2 : e.beats < 1 - 1e-6 ? 1 : 0
      const dotted = Math.abs(e.beats - 1.5) < 1e-6 || Math.abs(e.beats - 0.75) < 1e-6
      const base = { x: xOf(e.start), lines, dotted, event: idx, bar }
      if (e.midi === null) {
        line.tokens.push({ ...base, kind: 'rest', digit: '0', accidental: '', octave: 0 })
        // Rests longer than a beat are written as one 0 per beat.
        for (let k = 1; k < Math.floor(e.beats + 1e-6); k++) {
          line.tokens.push({ ...base, kind: 'rest', x: xOf(e.start + k), digit: '0', accidental: '', octave: 0, lines: 0, dotted: false })
        }
      } else {
        const d = jianpuDegree(e.midi, ref)
        line.tokens.push({ ...base, kind: 'note', ...d, ...(e.lyric ? { lyric: e.lyric } : {}) })
        // Each extra whole beat of a long note is a dash.
        const whole = Math.floor(e.beats + 1e-6)
        for (let k = 1; k < whole; k++) {
          line.tokens.push({ ...base, kind: 'dash', x: xOf(e.start + k), digit: '–', accidental: '', octave: 0, lines: 0, dotted: false })
        }
      }
    })
    // Beams join consecutive short notes inside the same beat.
    const short = line.tokens.filter((t) => t.lines > 0 && t.kind !== 'dash').sort((a, b) => a.x - b.x)
    for (let level = 1; level <= 2; level++) {
      let run: JianpuToken[] = []
      const flush = () => {
        if (run.length) line.beams.push({ x1: run[0]!.x - 7, x2: run[run.length - 1]!.x + 7, level })
        run = []
      }
      short.forEach((t) => {
        const ev = events[t.event]!
        const beat = Math.floor(ev.start + 1e-6)
        if (t.lines < level) {
          flush()
          return
        }
        const prev = run[run.length - 1]
        if (prev && Math.floor(events[prev.event]!.start + 1e-6) !== beat) flush()
        run.push(t)
      })
      flush()
    }
    for (const c of chords) {
      const bar = Math.floor(c.start / o.beatsPerBar + 1e-6)
      if (bar >= first && bar < first + bars.length) line.chords.push({ x: xOf(c.start) - 6, text: c.text })
    }
    lines.push(line)
  }
  return lines
}

/** "1=C" style key label. */
export function jianpuKeyLabel(signatureName: string, beatsPerBar = 4): string {
  return `1=${signatureName}  ${beatsPerBar}/4`
}
