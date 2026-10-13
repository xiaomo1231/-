/**
 * Compact jianpu (numbered notation) for the built-in song library (pure).
 *
 *   "5 3/ 5/ 1' - | 6 1'/ 6/ 5 -"
 *
 * - 1–7 are scale steps of the major scale on `doMidi`; 0 is a rest
 * - ' raises an octave, , lowers one; # and b before the digit alter it
 * - each note is a quarter; / halves it (// for a sixteenth); . makes it dotted
 * - - extends the previous note (or rest) by one beat
 * - | separates bars, which must add up to four beats
 */
import type { ScoreNote } from '@/music/score'

const STEPS = [0, 2, 4, 5, 7, 9, 11]

export class JianpuError extends Error {}

export function parseJianpu(src: string, doMidi: number, lyrics = ''): ScoreNote[] {
  const notes: ScoreNote[] = []
  const syllables = [...lyrics.replace(/\s+/g, '')]
  let si = 0
  let beat = 0
  let last: ScoreNote | { rest: true; beats: number } | null = null
  src.split('|').forEach((bar, bi) => {
    const barStart = bi * 4
    beat = barStart
    for (const tok of bar.trim().split(/\s+/).filter(Boolean)) {
      if (tok === '-') {
        if (!last) throw new JianpuError(`第 ${bi + 1} 小节以“-”开头`)
        last.beats += 1
        beat += 1
        continue
      }
      const m = /^([#b]?)([0-7])([',]*)(\/*)(\.?)$/.exec(tok)
      if (!m) throw new JianpuError(`看不懂的记号“${tok}”（第 ${bi + 1} 小节）`)
      let beats = 1 / Math.pow(2, m[4]!.length)
      if (m[5]) beats *= 1.5
      if (m[2] === '0') {
        last = { rest: true, beats }
        beat += beats
        continue
      }
      const octave = [...m[3]!].reduce((o, c) => o + (c === "'" ? 1 : -1), 0)
      const midi = doMidi + STEPS[Number(m[2]) - 1]! + 12 * octave + (m[1] === '#' ? 1 : m[1] === 'b' ? -1 : 0)
      const syl = syllables[si++]
      const note: ScoreNote = { start: beat, beats, midi, ...(syl && syl !== '_' ? { lyric: syl } : {}) }
      notes.push(note)
      last = note
      beat += beats
    }
    if (Math.abs(beat - barStart - 4) > 1e-6) throw new JianpuError(`第 ${bi + 1} 小节是 ${beat - barStart} 拍，应该是 4 拍`)
  })
  return notes
}
