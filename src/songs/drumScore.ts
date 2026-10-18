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
const DYN_F = 5
const DYN_FF = 6
const DYN_FFF = 7
const ACCENT_NONE = 0
const ACCENT_NORMAL = 1
const ACCENT_HEAVY = 2
/** alphaTab BeamDirection (Up = 0, Down = 1) and SimileMark.Simple, as numbers. */
const STEM_UP = 0
const STEM_DOWN = 1
const SIMILE_SIMPLE = 1
/** Pieces written on the feet voice (voice 1, stems down); everything else is on the hands voice (voice 0, stems up). */
const FEET_PIECES: ReadonlySet<DrumPiece> = new Set<DrumPiece>(['kick', 'hihatPedal'])
/** A repeated bar is written out again after this many simile bars in a row. */
const MAX_SIMILE_RUN = 3
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
 * element name, staff line and note head family. Positions follow the PAS (Percussion Art
 * Society) convention. Guitar Pro steps: odd = line, even = space, 1 = top line, 9 = bottom line,
 * 0 = space above the staff, -1 = first ledger line above, 10 = space below the staff.
 * Open hi-hat is the circled x (alphaTab's own GM head for it) instead of a technique symbol.
 */
const ARTICULATION_LOOK: Record<DrumPiece, { name: string; staffLine: number; head: 'black' | 'x' | 'heavyX' | 'heavyXHat' | 'circleX' | 'diamond' | 'triangle' }> = {
  crash: { name: 'Crash High', staffLine: -1, head: 'heavyX' },
  china: { name: 'China', staffLine: -3, head: 'heavyXHat' },
  splash: { name: 'Splash', staffLine: -2, head: 'x' },
  ride: { name: 'Ride', staffLine: 1, head: 'x' },
  rideBell: { name: 'Ride Bell', staffLine: 1, head: 'diamond' },
  hihatOpen: { name: 'Charley (open)', staffLine: 0, head: 'circleX' },
  hihatClosed: { name: 'Charley', staffLine: 0, head: 'x' },
  hihatPedal: { name: 'Charley (pedal)', staffLine: 10, head: 'x' },
  tomHigh: { name: 'Tom High', staffLine: 3, head: 'black' },
  tomMid: { name: 'Tom Low', staffLine: 5, head: 'black' },
  snare: { name: 'Snare', staffLine: 4, head: 'black' },
  sideStick: { name: 'Snare (side stick)', staffLine: 4, head: 'x' },
  tomFloor: { name: 'Tom Very Low', staffLine: 6, head: 'black' },
  kick: { name: 'Kick Drum', staffLine: 8, head: 'black' },
  cowbell: { name: 'Cowbell Medium', staffLine: 0, head: 'triangle' },
  tambourine: { name: 'Tambourine', staffLine: 2, head: 'triangle' },
  clap: { name: 'Hand Clap', staffLine: 4, head: 'black' },
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
  const bars: DrumBar[] = []
  score.masterBars.forEach((mb, i) => {
    const staffBars = track.staves.map((s) => s.bars[i]).filter((b): b is model.Bar => !!b)
    // A simile bar written without notes repeats the bar before it (see buildDrumTrack).
    const repeatsPrevious = staffBars.length > 0
      && staffBars.every((b) => b.simileMark === SIMILE_SIMPLE && b.voices.every((v) => v.beats.every((beat) => beat.notes.length === 0)))
    if (repeatsPrevious && i > 0 && bars[i - 1]) {
      const prev = bars[i - 1]!
      bars.push({ ...prev, hits: prev.hits.map((h) => ({ ...h })) })
      return
    }
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
    bars.push({
      num: mb.timeSignatureNumerator,
      den: mb.timeSignatureDenominator,
      stepsPerQuarter: spq,
      hits,
    })
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

/** Beat length in grid steps, and whether the meter is compound (6/8, 9/8, 12/8, 3/8: beat = dotted quarter). */
function beatGrid(num: number, den: number, spq: 3 | 4 | 6): { beatSteps: number; compound: boolean } {
  const compound = den === 8 && num % 3 === 0
  const beatQuarters = compound ? 1.5 : 4 / den
  return { beatSteps: beatQuarters * spq, compound }
}

/** True when the open interval (pos, end) contains a beat boundary. Beat boundaries may be fractional (6/8 triplet grid). */
function crossesBeat(pos: number, end: number, beatSteps: number): boolean {
  const next = (Math.floor(pos / beatSteps + 1e-9) + 1) * beatSteps
  return next < end - 1e-9
}

function startsOnBeat(pos: number, beatSteps: number): boolean {
  const q = pos / beatSteps
  return Math.abs(q - Math.round(q)) < 1e-9
}

/**
 * Whether a value may start at `pos`. A note (a hit) never crosses a beat boundary, so a hit
 * is written as quarters, dotted eighths and so on, not as a sustained half or whole note.
 * A rest may cross a boundary only when it is a half or whole rest starting on a beat (simple
 * meters); compound meters never use half or whole values, they group by dotted quarters.
 */
function fitsBeat(piece: Piece, pos: number, beatSteps: number, compound: boolean, isNote: boolean): boolean {
  if (!crossesBeat(pos, pos + piece.steps, beatSteps)) return true
  if (isNote) return false
  const longValue = piece.duration <= 2
  return longValue && !compound && startsOnBeat(pos, beatSteps)
}

/**
 * The note value that starts at `pos` in a run of `rem` steps (no hit before the run ends):
 * the longest one that fits the beats, else the longest that fits the run.
 */
function pickPiece(candidates: Piece[], pos: number, rem: number, beatSteps: number, compound: boolean, isNote: boolean): Piece {
  const fitting = candidates.find((c) => c.steps <= rem && fitsBeat(c, pos, beatSteps, compound, isNote))
  const pick = fitting ?? candidates.find((c) => c.steps <= rem)
  if (!pick) throw new Error(`pickPiece: no note value fits ${rem} steps`)
  return pick
}

/** One voice of a bar: each hit step starts a note value, the gaps are rests. Covers every step of the bar. */
function layoutVoice(steps: number, spq: 3 | 4 | 6, beatSteps: number, compound: boolean, hitsByStep: Map<number, DrumHit[]>): Array<{ piece: Piece; hits: DrumHit[] }> {
  const candidates = piecesFor(spq)
  const hitSteps = [...hitsByStep.keys()].sort((a, b) => a - b)
  const out: Array<{ piece: Piece; hits: DrumHit[] }> = []
  let pos = 0
  while (pos < steps) {
    const next = hitSteps.find((s) => s > pos) ?? steps
    const piece = pickPiece(candidates, pos, next - pos, beatSteps, compound, hitsByStep.has(pos))
    out.push({ piece, hits: hitsByStep.get(pos) ?? [] })
    pos += piece.steps
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

/** Options for buildDrumTrack. */
export interface DrumTrackOptions {
  /**
   * Write a bar that repeats the bar before it as a simile mark (% sign), without notes, when the
   * hits, meter and grid are identical and the bar starts no section. At most 3 in a row; every
   * 4th repeat is written out again. Playback is unchanged: alphaTab plays the previous bar.
   * Default true.
   */
  simile?: boolean
}

/** Hits of one bar, split by voice: hands (voice 0) and feet (voice 1). */
function splitHits(hits: DrumHit[]): { hands: DrumHit[]; feet: DrumHit[] } {
  return {
    hands: hits.filter((h) => !FEET_PIECES.has(h.piece)),
    feet: hits.filter((h) => FEET_PIECES.has(h.piece)),
  }
}

function sameHits(a: DrumHit[], b: DrumHit[]): boolean {
  return a.length === b.length && a.every((h, i) => h.step === b[i]!.step && h.piece === b[i]!.piece && h.vel === b[i]!.vel)
}

/**
 * Which bars of `part` are written as simile marks. A bar qualifies when it does not start a
 * section, neither it nor the bar before it has a tempo change, its meter and grid match the bar
 * before, and its hits are identical. Runs are capped at MAX_SIMILE_RUN so every 4th repeat is
 * written out.
 */
function simileFlags(score: model.Score, part: DrumPart): boolean[] {
  const flags = score.masterBars.map(() => false)
  // Bars whose tempo changes (a tempo marking that differs from the tempo before it).
  const tempoChanged: boolean[] = []
  let bpm = score.tempo
  for (const mb of score.masterBars) {
    tempoChanged.push(mb.tempoAutomations.some((t) => t.value !== bpm))
    if (mb.tempoAutomations.length > 0) bpm = mb.tempoAutomations[mb.tempoAutomations.length - 1]!.value
  }
  let run = 0
  for (let i = 1; i < score.masterBars.length && i < part.bars.length; i++) {
    const mb = score.masterBars[i]!
    const bar = part.bars[i]!
    const prev = part.bars[i - 1]!
    // Empty bars stay rests: a % sign means "play the previous bar again", not "rest".
    const qualifies = bar.hits.length > 0 && !mb.section
      && !tempoChanged[i]
      && !tempoChanged[i - 1]
      && bar.num === prev.num && bar.den === prev.den && bar.stepsPerQuarter === prev.stepsPerQuarter
      && sameHits(bar.hits, prev.hits)
    if (qualifies && run < MAX_SIMILE_RUN) {
      flags[i] = true
      run++
    } else {
      run = 0
    }
  }
  return flags
}

/** Appends one voice's beats for `slices`; the feet voice (voice 1) is placed with stems down. */
function fillVoice(at: AT, voice: model.Voice, slices: Array<{ piece: Piece; hits: DrumHit[] }>, voiceIndex: number): void {
  for (const { piece, hits } of slices) {
    const beat = new at.model.Beat()
    beat.duration = piece.duration as model.Duration
    beat.dots = piece.dots
    if (piece.tuplet) {
      beat.tupletNumerator = 3
      beat.tupletDenominator = 2
    }
    // F is alphaTab's default: no dynamic mark is printed (accents and ghost notes carry the level).
    beat.dynamics = DYN_F as model.DynamicValue
    beat.preferredBeamDirection = voiceIndex === 0 ? STEM_UP : STEM_DOWN
    for (const hit of hits) {
      const note = new at.model.Note()
      note.percussionArticulation = DRUM_PIECES.findIndex((p) => p.id === hit.piece)
      note.isGhost = hit.vel === 1
      note.accentuated = (hit.vel === 3 ? ACCENT_NORMAL : ACCENT_NONE) as model.AccentuationType
      beat.addNote(note)
    }
    voice.addBeat(beat)
  }
}

/**
 * Adds a voice that alphaTab treats as empty (one beat flagged isEmpty: not drawn, not counted as
 * a second voice). Every bar keeps two voices because alphaTab chains a voice to the same voice of
 * the next bar, so a missing voice 1 breaks the score.
 */
function addEmptyVoice(at: AT, bar: model.Bar): void {
  const voice = new at.model.Voice()
  bar.addVoice(voice)
  const beat = new at.model.Beat()
  beat.isEmpty = true
  voice.addBeat(beat)
}

/**
 * Appends a new percussion track built from `part` to `score` and finishes the score, so
 * `api.renderScore(score, [index])` and playback work. Each master bar gets one bar; a part
 * with fewer bars leaves the rest as whole-bar rests. Pitched tracks that used MIDI channel 9
 * are moved to a free channel so the drum kit is the only thing on channel 9.
 *
 * Standard drum notation: voice 0 holds the hands (cymbals, hi-hat, snare, toms, …) with stems
 * up, voice 1 holds the feet (kick, hi-hat pedal) with stems down. A bar without feet hits has no
 * feet voice. Accents are normal accents, ghost notes are ghost notes.
 *
 * @returns the new track (its index is `track.index`).
 */
export function buildDrumTrack(at: AT, score: model.Score, part: DrumPart, name = '鼓（自动）', options: DrumTrackOptions = {}): model.Track {
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

  const simile = options.simile === false ? score.masterBars.map(() => false) : simileFlags(score, part)
  score.masterBars.forEach((mb, i) => {
    const spq: 3 | 4 | 6 = part.bars[i]?.stepsPerQuarter ?? 4
    const steps = barSteps({ num: mb.timeSignatureNumerator, den: mb.timeSignatureDenominator, stepsPerQuarter: spq })
    const { beatSteps, compound } = beatGrid(mb.timeSignatureNumerator, mb.timeSignatureDenominator, spq)

    const bar = new at.model.Bar()
    // The percussion clef, so the sheet (and a GP file written from it) shows a drum staff.
    bar.clef = at.model.Clef.Neutral
    staff.addBar(bar)

    if (simile[i]) {
      // Playback follows the previous bar (MidiFileGenerator), so the notes are not needed here.
      bar.simileMark = SIMILE_SIMPLE as model.SimileMark
      addEmptyVoice(at, bar)
      addEmptyVoice(at, bar)
      return
    }

    const { hands, feet } = splitHits(part.bars[i]?.hits ?? [])
    const toMap = (hits: DrumHit[]) => {
      const map = new Map<number, DrumHit[]>()
      for (const hit of hits) {
        if (hit.step < 0 || hit.step >= steps) continue
        const list = map.get(hit.step) ?? []
        list.push(hit)
        map.set(hit.step, list)
      }
      return map
    }
    const handsMap = toMap(hands)
    const feetMap = toMap(feet)

    const handsVoice = new at.model.Voice()
    bar.addVoice(handsVoice)
    const handsSlices = handsMap.size === 0
      ? [{ piece: { steps, duration: DURATION_WHOLE, dots: 0, tuplet: false }, hits: [] }]
      : layoutVoice(steps, spq, beatSteps, compound, handsMap)
    fillVoice(at, handsVoice, handsSlices, 0)

    if (feetMap.size === 0) addEmptyVoice(at, bar)
    else {
      const feetVoice = new at.model.Voice()
      bar.addVoice(feetVoice)
      fillVoice(at, feetVoice, layoutVoice(steps, spq, beatSteps, compound, feetMap), 1)
    }
  })

  score.finish(new at.Settings())
  return track
}

/**
 * Converts an existing percussion track of a loaded score into a standard-notation copy: the
 * track is read with partFromTrack and written again with buildDrumTrack as `${name}（标准鼓谱）`.
 * The copy is appended to the score and finished.
 *
 * @returns the index of the new track.
 */
export function standardizeDrumTrack(at: AT, score: model.Score, trackIndex: number): number {
  const source = score.tracks[trackIndex]
  if (!source) throw new Error(`standardizeDrumTrack: no track ${trackIndex}`)
  const part = partFromTrack(score, trackIndex, { path: '', title: score.title, artist: score.artist, updatedBy: '' })
  const copy = buildDrumTrack(at, score, part, `${source.name}（标准鼓谱）`)
  return copy.index
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
