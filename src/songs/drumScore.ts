/**
 * Bridges the drum part (step grid, src/songs/drumTypes.ts) and alphaTab's score model:
 * reads a song's rhythm for the generators, turns an existing percussion track into a
 * DrumPart, builds a new percussion track from a DrumPart, and exports Guitar Pro 7.
 *
 * Runs in Node and the browser. Runtime alphaTab classes come from the `at` namespace
 * the caller passes in; only types and numeric enum values are used here.
 *
 * alphaTab facts this relies on (verified against 1.8.4):
 * - Beat.playbackStart is relative to the bar, in MIDI ticks (960 per quarter note).
 * - A percussion note's `percussionArticulation` indexes `track.percussionArticulations`;
 *   when that list is shorter, the index is a GM-based articulation id (36 = kick, 38 = snare…),
 *   and its `outputMidiNumber` is the key played and exported.
 * - A staff is percussion when its notes have a percussion articulation; the track must play on
 *   MIDI channel 9 (0-based) for the GM drum kit.
 */
import type { model } from '@coderline/alphatab'
import {
  DRUM_PIECES,
  barSteps,
  type DrumBar,
  type DrumHit,
  type DrumPart,
  type DrumPiece,
  type DrumVelocity,
  type SongBarInfo,
} from './drumTypes'

import type * as AlphaTab from '@coderline/alphatab'

/** The alphaTab module namespace (pass the `import * as at from '@coderline/alphatab'` namespace). */
export type AT = typeof AlphaTab

const TICKS_PER_QUARTER = 960
const DRUM_CHANNEL = 9
const CHANNEL_COUNT = 16

// alphaTab enum values (alphaTab.d.ts). Kept numeric so this module stays light.
const DYN_P = 2
const DYN_MF = 4
const DYN_FF = 6
const DYN_FFF = 7
const ACCENT_NONE = 0
const ACCENT_HEAVY = 2
const DURATION_WHOLE = 1
const DURATION_SIXTEENTH = 16
/** Typical MIDI velocity of each dynamic (PPP … FFF), for the guide-rhythm velocities. */
const DYNAMIC_VELOCITY = [16, 32, 48, 64, 80, 96, 112, 127]

/** Default GM articulation ids whose output key differs from the id (alphaTab's built-in list). */
const DEFAULT_OUTPUT_KEY = new Map<number, number>([
  [91, 38], [92, 46], [93, 51], [94, 51], [95, 55], [96, 52], [97, 49], [98, 57],
  [99, 56], [100, 56], [101, 56], [102, 56], [103, 56], [111, 54], [112, 54], [113, 54],
  [114, 43], [115, 49], [116, 49],
])

/** The GM key this drum piece is played with, or null for an unknown piece. */
export function pieceMidi(piece: DrumPiece): number {
  const info = DRUM_PIECES.find((p) => p.id === piece)
  return info ? info.midi : 38
}

/**
 * Notation of each kit piece for a track's own articulation list (same order as DRUM_PIECES):
 * element name, staff line (Guitar Pro steps: 1 = top line) and note head family, taken from
 * alphaTab's built-in GM articulations.
 */
const ARTICULATION_LOOK: Record<DrumPiece, { name: string; staffLine: number; head: 'black' | 'x' | 'heavyX' | 'heavyXHat' | 'circleX' | 'diamond' | 'triangle' }> = {
  crash: { name: 'Crash High', staffLine: -2, head: 'heavyX' },
  china: { name: 'China', staffLine: -3, head: 'heavyXHat' },
  splash: { name: 'Splash', staffLine: -2, head: 'x' },
  ride: { name: 'Ride', staffLine: 0, head: 'x' },
  rideBell: { name: 'Ride Bell', staffLine: 0, head: 'diamond' },
  hihatOpen: { name: 'Charley (open)', staffLine: -1, head: 'circleX' },
  hihatClosed: { name: 'Charley', staffLine: -1, head: 'x' },
  hihatPedal: { name: 'Charley (pedal)', staffLine: 9, head: 'x' },
  tomHigh: { name: 'Tom High', staffLine: 2, head: 'black' },
  tomMid: { name: 'Tom Low', staffLine: 5, head: 'black' },
  snare: { name: 'Snare', staffLine: 3, head: 'black' },
  sideStick: { name: 'Snare (side stick)', staffLine: 3, head: 'x' },
  tomFloor: { name: 'Tom Very Low', staffLine: 6, head: 'black' },
  kick: { name: 'Kick Drum', staffLine: 7, head: 'black' },
  cowbell: { name: 'Cowbell Medium', staffLine: 0, head: 'triangle' },
  tambourine: { name: 'Tambourine', staffLine: 3, head: 'triangle' },
  clap: { name: 'Hand Clap', staffLine: 3, head: 'black' },
}

/** The track's articulation list: one entry per kit piece, notes refer to it by index. */
function buildArticulations(at: AT): model.InstrumentArticulation[] {
  const S = at.model.MusicFontSymbol
  const heads: Record<string, [model.MusicFontSymbol, model.MusicFontSymbol, model.MusicFontSymbol]> = {
    black: [S.NoteheadBlack, S.NoteheadHalf, S.NoteheadWhole],
    x: [S.NoteheadXBlack, S.NoteheadXHalf, S.NoteheadXWhole],
    heavyX: [S.NoteheadHeavyX, S.NoteheadHeavyX, S.NoteheadHeavyX],
    heavyXHat: [S.NoteheadHeavyXHat, S.NoteheadHeavyXHat, S.NoteheadHeavyXHat],
    circleX: [S.NoteheadCircleX, S.NoteheadCircleX, S.NoteheadCircleX],
    diamond: [S.NoteheadDiamondWhite, S.NoteheadDiamondWhite, S.NoteheadDiamondWhite],
    triangle: [S.NoteheadTriangleUpBlack, S.NoteheadTriangleUpHalf, S.NoteheadTriangleUpWhole],
  }
  return DRUM_PIECES.map((info, index) => {
    const look = ARTICULATION_LOOK[info.id]
    const [def, half, whole] = heads[look.head]!
    return new at.model.InstrumentArticulation(look.name, look.staffLine, info.midi, def, half, whole, undefined, undefined, index)
  })
}

/** Drum piece for a GM percussion key (the key itself or one of its alternates), or null. */
export function drumMidiToPiece(midi: number): DrumPiece | null {
  const exact = DRUM_PIECES.find((p) => p.midi === midi)
  if (exact) return exact.id
  const alt = DRUM_PIECES.find((p) => p.alsoMidi.includes(midi))
  return alt ? alt.id : null
}

function isRhythmName(name: string): boolean {
  return /rhythm|节奏/i.test(name)
}

function isGuitarLike(track: model.Track): boolean {
  const program = track.playbackInfo.program
  return (program >= 24 && program <= 31) || /guitar|吉他/i.test(track.name)
}

function trackNoteCount(track: model.Track): number {
  let count = 0
  for (const staff of track.staves) {
    for (const bar of staff.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) if (beat.notes.length > 0 && !beat.isRest) count++
      }
    }
  }
  return count
}

/** Guide track when none is chosen: a rhythm guitar, else any guitar, else the busiest pitched track. */
function autoGuideTrack(score: model.Score): number | null {
  const pitched = score.tracks.filter((t) => !t.isPercussion)
  if (pitched.length === 0) return null
  const rhythm = pitched.find((t) => isRhythmName(t.name) && isGuitarLike(t))
    ?? pitched.find((t) => isRhythmName(t.name))
  const guitar = rhythm ?? pitched.find(isGuitarLike)
  const chosen = guitar ?? pitched.reduce((best, t) => (trackNoteCount(t) > trackNoteCount(best) ? t : best))
  return score.tracks.indexOf(chosen)
}

function beatVelocity(beat: model.Beat): number {
  const dyn = Math.min(Math.max(Math.round(beat.dynamics), 0), DYNAMIC_VELOCITY.length - 1)
  let vel = DYNAMIC_VELOCITY[dyn]
  if (beat.notes.length > 0 && beat.notes.every((n) => n.isGhost)) vel = Math.min(vel, 40)
  if (beat.notes.some((n) => n.accentuated === ACCENT_HEAVY)) vel = Math.min(127, vel + 16)
  else if (beat.notes.some((n) => n.accentuated !== ACCENT_NONE)) vel = Math.min(127, vel + 8)
  return vel
}

/**
 * Per master bar facts for the drum generators: meter, tempo at the start of the bar,
 * section marker, guide-instrument onsets and whether the bar has triplet feel.
 *
 * @param guideTrack index of the rhythm track; null picks one automatically (see autoGuideTrack).
 */
export function songBars(score: model.Score, guideTrack: number | null): SongBarInfo[] {
  const guideIndex = guideTrack !== null && guideTrack >= 0 && guideTrack < score.tracks.length
    ? guideTrack
    : autoGuideTrack(score)
  const guide = guideIndex === null ? null : score.tracks[guideIndex]
  let bpm = score.tempo
  return score.masterBars.map((mb, i) => {
    const startBpm = mb.tempoAutomations.find((t) => t.ratioPosition <= 0)?.value ?? bpm
    if (mb.tempoAutomations.length > 0) bpm = mb.tempoAutomations[mb.tempoAutomations.length - 1].value
    else bpm = startBpm

    const onsets = new Map<number, number>()
    let triplet = false
    if (guide) {
      for (const staff of guide.staves) {
        const bar = staff.bars[i]
        if (!bar) continue
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            if (beat.tupletNumerator === 3 || beat.tupletNumerator === 6) triplet = true
            if (beat.isRest || beat.notes.length === 0) continue
            const at = Math.round((beat.playbackStart / TICKS_PER_QUARTER) * 1000) / 1000
            onsets.set(at, Math.max(onsets.get(at) ?? 0, beatVelocity(beat)))
          }
        }
      }
    }
    return {
      num: mb.timeSignatureNumerator,
      den: mb.timeSignatureDenominator,
      bpm: startBpm,
      section: mb.section?.text || mb.section?.marker || null,
      onsets: [...onsets.entries()].sort((a, b) => a[0] - b[0]).map(([at, vel]) => ({ at, vel })),
      triplet,
    }
  })
}

/** Index of the first percussion track, or null. */
export function findDrumTrack(score: model.Score): number | null {
  const index = score.tracks.findIndex((t) => t.isPercussion)
  return index >= 0 ? index : null
}

/** Piece of a percussion note: its articulation resolved against the track's list, else GM ids. */
function notePiece(track: model.Track, articulation: number): DrumPiece | null {
  const list = track.percussionArticulations
  const key = articulation < list.length
    ? list[articulation].outputMidiNumber
    : (DEFAULT_OUTPUT_KEY.get(articulation) ?? articulation)
  return drumMidiToPiece(key)
}

/** Velocity level of a note: ghost 1, accent 3, otherwise from the beat's dynamic. */
function noteVelocity(beat: model.Beat, note: model.Note): DrumVelocity {
  if (note.isGhost) return 1
  if (note.accentuated !== ACCENT_NONE) return 3
  // alphaTab gives every beat F unless the file says otherwise, so F stays normal here.
  if (beat.dynamics <= DYN_P) return 1
  if (beat.dynamics >= DYN_FF && beat.dynamics <= DYN_FFF) return 3
  return 2
}

/**
 * Grid resolution for a bar. Tuplets decide first: sixteenth triplets give 6, eighth triplets
 * (without plain sixteenths) give 3. Without that evidence, the first of 4, 3, 6 that every
 * onset lands on exactly is used (4 when several fit, since they all mean the same times).
 */
function gridForBar(staffBars: model.Bar[]): 3 | 4 | 6 {
  let tripletSixteenth = false
  let tripletAny = false
  let plainSixteenth = false
  const onsets: number[] = []
  for (const bar of staffBars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        const isTriplet = beat.tupletNumerator === 3
        if (isTriplet) tripletAny = true
        if (isTriplet && beat.duration === DURATION_SIXTEENTH) tripletSixteenth = true
        if (!isTriplet && beat.duration === DURATION_SIXTEENTH) plainSixteenth = true
        if (beat.notes.length > 0) onsets.push(beat.playbackStart)
      }
    }
  }
  if (tripletSixteenth) return 6
  if (tripletAny && !plainSixteenth) return 3
  for (const grid of [4, 3, 6] as const) {
    if (onsets.every((ticks) => (ticks * grid) % TICKS_PER_QUARTER === 0)) return grid
  }
  return 4
}

/**
 * Converts an existing percussion track into a DrumPart (one bar per master bar).
 * Note starts are quantized to the bar's grid; notes whose piece is unknown are skipped.
 */
export function partFromTrack(
  score: model.Score,
  trackIndex: number,
  meta: { path: string; title: string; artist: string; updatedBy: string },
): DrumPart {
  const track = score.tracks[trackIndex]
  if (!track) throw new Error(`partFromTrack: no track ${trackIndex}`)
  const order = new Map(DRUM_PIECES.map((p, i) => [p.id, i]))
  const bars: DrumBar[] = score.masterBars.map((mb, i) => {
    const staffBars = track.staves.map((s) => s.bars[i]).filter((b): b is model.Bar => !!b)
    const spq = gridForBar(staffBars)
    const steps = barSteps({ num: mb.timeSignatureNumerator, den: mb.timeSignatureDenominator, stepsPerQuarter: spq })
    const best = new Map<string, DrumHit>()
    for (const bar of staffBars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          for (const note of beat.notes) {
            if (note.percussionArticulation < 0) continue
            const piece = notePiece(track, note.percussionArticulation)
            if (!piece) continue
            const step = Math.round((beat.playbackStart / TICKS_PER_QUARTER) * spq)
            if (step < 0 || step >= steps) continue
            const vel = noteVelocity(beat, note)
            const key = `${step}|${piece}`
            const prev = best.get(key)
            if (!prev || vel > prev.vel) best.set(key, { step, piece, vel })
          }
        }
      }
    }
    const hits = [...best.values()].sort((a, b) => a.step - b.step || (order.get(a.piece) ?? 0) - (order.get(b.piece) ?? 0))
    return {
      num: mb.timeSignatureNumerator,
      den: mb.timeSignatureDenominator,
      stepsPerQuarter: spq,
      hits,
    }
  })
  return {
    version: 1,
    path: meta.path,
    title: meta.title,
    artist: meta.artist,
    bars,
    source: 'file',
    edited: false,
    style: null,
    updatedAt: Date.now(),
    updatedBy: meta.updatedBy,
  }
}

interface Piece {
  /** Length in grid steps. */
  steps: number
  /** alphaTab Duration value (1 whole … 16 sixteenth). */
  duration: number
  dots: number
  tuplet: boolean
}

/** Note values that fit the grid, longest first. */
function piecesFor(spq: 3 | 4 | 6): Piece[] {
  const out: Piece[] = []
  for (const duration of [1, 2, 4, 8, 16]) {
    for (const dots of [0, 1]) {
      for (const tuplet of spq === 4 ? [false] : [false, true]) {
        const quarters = (4 / duration) * (dots ? 1.5 : 1) * (tuplet ? 2 / 3 : 1)
        const steps = quarters * spq
        const rounded = Math.round(steps)
        if (rounded < 1 || Math.abs(steps - rounded) > 1e-9) continue
        out.push({ steps: rounded, duration, dots, tuplet })
      }
    }
  }
  return out.sort((a, b) => b.steps - a.steps)
}

/** Splits a run of `length` steps starting at `start` into note values, keeping beats aligned where possible. */
function splitRun(start: number, length: number, spq: 3 | 4 | 6): Piece[] {
  const candidates = piecesFor(spq)
  const out: Piece[] = []
  let pos = start
  let rem = length
  while (rem > 0) {
    const pick = candidates.find((c) => c.steps <= rem && pos % c.steps === 0)
      ?? candidates.find((c) => c.steps <= rem)
    if (!pick) break
    out.push(pick)
    pos += pick.steps
    rem -= pick.steps
  }
  return out
}

/** Beats for one bar: each hit step starts a beat; the gaps are rests; a hit-free bar is one whole rest. */
function layoutBar(steps: number, spq: 3 | 4 | 6, hitsByStep: Map<number, DrumHit[]>): Array<{ piece: Piece; hits: DrumHit[] }> {
  const hitSteps = [...hitsByStep.keys()].sort((a, b) => a - b)
  if (hitSteps.length === 0) return [{ piece: { steps, duration: DURATION_WHOLE, dots: 0, tuplet: false }, hits: [] }]
  const out: Array<{ piece: Piece; hits: DrumHit[] }> = []
  let pos = 0
  while (pos < steps) {
    const hits = hitsByStep.get(pos) ?? []
    const next = hitSteps.find((s) => s > pos) ?? steps
    const pieces = splitRun(pos, next - pos, spq)
    pieces.forEach((piece, k) => out.push({ piece, hits: k === 0 ? hits : [] }))
    pos = next
  }
  return out
}

/** Pitched tracks that use MIDI channel 9 are moved to a free channel, so the drum kit owns channel 9. */
function moveOffDrumChannel(score: model.Score): void {
  const used = new Set<number>()
  for (const t of score.tracks) {
    used.add(t.playbackInfo.primaryChannel)
    used.add(t.playbackInfo.secondaryChannel)
  }
  for (const t of score.tracks) {
    if (t.isPercussion) continue
    const info = t.playbackInfo
    if (info.primaryChannel !== DRUM_CHANNEL && info.secondaryChannel !== DRUM_CHANNEL) continue
    let free = -1
    for (let c = 0; c < CHANNEL_COUNT; c++) {
      if (c !== DRUM_CHANNEL && !used.has(c)) {
        free = c
        break
      }
    }
    if (free < 0) continue
    used.add(free)
    if (info.primaryChannel === DRUM_CHANNEL) info.primaryChannel = free
    if (info.secondaryChannel === DRUM_CHANNEL) info.secondaryChannel = free
  }
}

/**
 * Appends a new percussion track built from `part` to `score` and finishes the score, so
 * `api.renderScore(score, [index])` and playback work. Each master bar gets one bar; a part
 * with fewer bars leaves the rest as whole-bar rests. Pitched tracks that used MIDI channel 9
 * are moved to a free channel so the drum kit is the only thing on channel 9.
 *
 * @returns the new track (its index is `track.index`).
 */
export function buildDrumTrack(at: AT, score: model.Score, part: DrumPart, name = '鼓（自动）'): model.Track {
  moveOffDrumChannel(score)
  const track = new at.model.Track()
  track.name = name
  track.playbackInfo.primaryChannel = DRUM_CHANNEL
  track.playbackInfo.secondaryChannel = DRUM_CHANNEL
  track.playbackInfo.program = 0
  track.ensureStaveCount(1)
  track.percussionArticulations = buildArticulations(at)
  const staff = track.staves[0]
  staff.isPercussion = true
  staff.showTablature = false
  score.addTrack(track)

  score.masterBars.forEach((mb, i) => {
    const spq: 3 | 4 | 6 = part.bars[i]?.stepsPerQuarter ?? 4
    const steps = barSteps({ num: mb.timeSignatureNumerator, den: mb.timeSignatureDenominator, stepsPerQuarter: spq })
    const hitsByStep = new Map<number, DrumHit[]>()
    for (const hit of part.bars[i]?.hits ?? []) {
      if (hit.step < 0 || hit.step >= steps) continue
      const list = hitsByStep.get(hit.step) ?? []
      list.push(hit)
      hitsByStep.set(hit.step, list)
    }

    const bar = new at.model.Bar()
    // The percussion clef, so the sheet (and a GP file written from it) shows a drum staff.
    bar.clef = at.model.Clef.Neutral
    staff.addBar(bar)
    const voice = new at.model.Voice()
    bar.addVoice(voice)
    for (const { piece, hits } of layoutBar(steps, spq, hitsByStep)) {
      const beat = new at.model.Beat()
      beat.duration = piece.duration as model.Duration
      beat.dots = piece.dots
      if (piece.tuplet) {
        beat.tupletNumerator = 3
        beat.tupletDenominator = 2
      }
      beat.dynamics = DYN_MF as model.DynamicValue
      for (const hit of hits) {
        const note = new at.model.Note()
        note.percussionArticulation = DRUM_PIECES.findIndex((p) => p.id === hit.piece)
        note.isGhost = hit.vel === 1
        note.accentuated = (hit.vel === 3 ? ACCENT_HEAVY : ACCENT_NONE) as model.AccentuationType
        beat.addNote(note)
      }
      voice.addBeat(beat)
    }
  })

  score.finish(new at.Settings())
  return track
}

/** Removes a track and renumbers the rest. To rebuild a generated track: removeTrack, then buildDrumTrack. */
export function removeTrack(score: model.Score, index: number): void {
  if (index < 0 || index >= score.tracks.length) throw new Error(`removeTrack: no track ${index}`)
  score.tracks.splice(index, 1)
  score.tracks.forEach((t, i) => {
    t.index = i
  })
}

/** Guitar Pro 7 (.gp) bytes of the score, via alphaTab's Gp7Exporter (present in 1.8.4). */
export function exportGp(at: AT, score: model.Score): Uint8Array {
  return new at.exporter.Gp7Exporter().export(score)
}
