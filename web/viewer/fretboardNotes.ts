import type { model } from '@coderline/alphatab'

/**
 * One lit position on the fretboard.
 * `row` 0 is the top row of the board = the highest-pitched string (= `tuning[0]`).
 */
export interface FretNote {
  row: number
  fret: number
  dead?: boolean
}

/*
 * String numbering, verified against alphaTab 1.8.4 (node_modules/@coderline/alphatab/dist):
 * - `Note.string` is 1-based and `1` is the LOWEST string (the bottom tab line). d.ts: "1 is the lowest string
 *   on the guitar and the bottom line on the tablature".
 * - `Staff.tuning` (= `stringTuning.tunings`, MIDI numbers) lists the strings TOP line first, so `tuning[0]` is the
 *   highest string. d.ts: "The first item is the most top tablature line".
 * - alphaTab's own lookup (`Note.getStringTuning`) confirms it: `tuning[tuning.length - (string - 1) - 1]`.
 * Therefore `row = tuning.length - note.string`, i.e. row 0 = highest string, row n-1 = lowest string.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

function firstStaffTuning(track: model.Track): number[] {
  const tuning = track.staves?.[0]?.tuning
  return Array.isArray(tuning) ? tuning : []
}

/**
 * Notes to light up for the shown track: from the active beats, only beats whose
 * voice → bar → staff → track has index `trackIndex`; rests and non-string notes are skipped;
 * tie destinations are included; dead notes are flagged; same row + fret is deduplicated.
 */
export function notesFromBeats(beats: readonly model.Beat[], trackIndex: number): FretNote[] {
  const out: FretNote[] = []
  const seen = new Map<string, FretNote>()
  for (const beat of beats) {
    if (!beat || beat.isRest) continue
    const track = beat.voice?.bar?.staff?.track
    if (!track || track.index !== trackIndex) continue
    const count = firstStaffTuning(track).length
    if (count === 0) continue
    for (const note of beat.notes ?? []) {
      if (!note || note.isStringed === false) continue
      const string = note.string
      if (!Number.isInteger(string) || string < 1 || string > count) continue
      if (!Number.isInteger(note.fret) || note.fret < 0) continue
      const row = count - string
      const key = `${row}:${note.fret}`
      const existing = seen.get(key)
      if (existing) {
        if (note.isDead) existing.dead = true
        continue
      }
      const entry: FretNote = { row, fret: note.fret }
      if (note.isDead) entry.dead = true
      seen.set(key, entry)
      out.push(entry)
    }
  }
  return out
}

/** Open-string names, top row first (highest pitch first), with sharps. Empty when the track has no string tuning. */
export function tuningLabels(track: model.Track): string[] {
  return firstStaffTuning(track).map((midi) => NOTE_NAMES[((midi % 12) + 12) % 12])
}

/** True when the track's first staff is a stringed (tab) staff with a tuning and is not percussion. */
export function hasFretboard(track: model.Track): boolean {
  const staff = track.staves?.[0]
  if (!staff || staff.isPercussion || track.isPercussion) return false
  return staff.isStringed === true && firstStaffTuning(track).length > 0
}
