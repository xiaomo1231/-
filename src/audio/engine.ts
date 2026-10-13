import * as Tone from 'tone'
import { midiToFrequency } from '@/music/pitch'
import { arrangementEvents, ensureTracks } from '@/music/arrangement'
import type { Score } from '@/music/score'
import { PluckPool, buildRig, scheduleOnRig, type Rig } from './rig'
import { loadPianoBank, makeSampler, pianoBank, playSameSample } from './piano'
import type { InstrumentId, StudentProfile } from '@/entities/types'

/**
 * Audio engine built on Tone.js. One module-level instance; everything is
 * scheduled against the AudioContext clock so drills can compare tap times
 * with the exact moment a click was heard.
 *
 * Nothing here records audio — the microphone line (P2) is a separate module.
 */

export type Timbre = 'piano' | 'guitar' | 'bass' | 'sine'

let started = false
let synth: Tone.PolySynth | null = null
let currentTimbre: Timbre = 'piano'
let click: Tone.MembraneSynth | null = null
let accentClick: Tone.MembraneSynth | null = null
let master: Tone.Volume | null = null
/** Inaudible signal that keeps Bluetooth / USB outputs from sleeping between questions. */
let keepAwake: Tone.Noise | null = null
/** AudioContext time the last sequence finished (for the wake-up lead-in). */
let lastSoundEnd = -Infinity

/** Extra lead-in after this many seconds of silence. */
const IDLE_SECONDS = 2.5
/** How early sequences start after a silence, so a waking output does not swallow the first note. */
export const WAKE_LEAD_SECONDS = 0.35

/** Start offset for a sequence: short when sound played recently, longer after a silence. Pure. */
export function sequenceLead(nowTime: number, lastEnd: number, base = 0.08): number {
  return nowTime - lastEnd > IDLE_SECONDS ? Math.max(base, WAKE_LEAD_SECONDS) : base
}

/** Must be called from a user gesture before any playback. Safe to call often. */
export async function ensureAudio(): Promise<void> {
  if (!started) {
    await Tone.start()
    // Shorter look-ahead keeps answer playback feeling immediate.
    Tone.getContext().lookAhead = 0.05
    started = true
  }
  if (!master) {
    master = new Tone.Volume(-6).toDestination()
  }
  if (!keepAwake) {
    // About -80 dBFS of pink noise: far below hearing, but not digital silence,
    // which is what makes many Bluetooth earbuds and USB headsets power down
    // and cut the start of the next note. Paused while the tab is hidden.
    keepAwake = new Tone.Noise({ type: 'pink', volume: -80 }).toDestination()
    keepAwake.start()
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!keepAwake) return
        if (document.hidden) keepAwake.stop()
        else if (keepAwake.state !== 'started') keepAwake.start()
      })
    }
  }
  if (!synth) {
    synth = buildSynth(currentTimbre)
    synth.connect(master)
  }
  // The bundled piano loads in the background; the synth covers until it is ready.
  void loadPianoBank()
  if (!click) {
    click = new Tone.MembraneSynth({
      pitchDecay: 0.008,
      octaves: 2,
      envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 },
      volume: -8,
    }).connect(master)
    accentClick = new Tone.MembraneSynth({
      pitchDecay: 0.01,
      octaves: 3,
      envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 },
      volume: -4,
    }).connect(master)
  }
}

export function isAudioReady(): boolean {
  return started && synth !== null
}

/** Current AudioContext time in seconds. */
export function now(): number {
  return Tone.now()
}

function buildSynth(timbre: Timbre): Tone.PolySynth {
  switch (timbre) {
    case 'guitar':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'fmtriangle', modulationType: 'sine', harmonicity: 2, modulationIndex: 1.2 } as never,
        envelope: { attack: 0.004, decay: 0.6, sustain: 0.1, release: 0.8 },
        volume: -4,
      })
    case 'bass':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'fatsawtooth', count: 2, spread: 8 } as never,
        envelope: { attack: 0.006, decay: 0.5, sustain: 0.4, release: 0.5 },
        volume: -6,
      })
    case 'sine':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.3 },
        volume: -8,
      })
    case 'piano':
    default:
      // Fallback while the sampled piano loads (or if it cannot): a soft FM
      // tone with a piano-like decay.
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 2,
        modulationIndex: 1.6,
        oscillator: { type: 'sine' },
        modulation: { type: 'triangle' },
        envelope: { attack: 0.003, decay: 1.1, sustain: 0.08, release: 0.6 },
        modulationEnvelope: { attack: 0.002, decay: 0.35, sustain: 0.1, release: 0.4 },
        volume: -6,
      } as never)
  }
}

/** The timbre chosen in settings; scoped overrides (guitar workshop) return to it. */
let baseTimbre: Timbre = 'piano'
let overrides: Timbre[] = []

export function setTimbre(timbre: Timbre): void {
  baseTimbre = timbre
  applyTimbre(overrides.length ? overrides[overrides.length - 1]! : timbre)
}

/**
 * Use another timbre while a page is open (the guitar workshop plays guitar
 * whatever the training timbre is). Returns the function that undoes it.
 */
export function overrideTimbre(timbre: Timbre): () => void {
  overrides = [...overrides, timbre]
  applyTimbre(timbre)
  let done = false
  return () => {
    if (done) return
    done = true
    const i = overrides.lastIndexOf(timbre)
    if (i >= 0) overrides = [...overrides.slice(0, i), ...overrides.slice(i + 1)]
    applyTimbre(overrides.length ? overrides[overrides.length - 1]! : baseTimbre)
  }
}

export function currentTimbreName(): Timbre {
  return currentTimbre
}

function applyTimbre(timbre: Timbre): void {
  if (timbre === currentTimbre && synth) return
  currentTimbre = timbre
  pluck?.dispose()
  pluck = null
  if (!master) return
  synth?.dispose()
  synth = buildSynth(timbre)
  synth.connect(master)
}

/** Timbre for drills, placement and lessons: piano unless the student chose "follow my instrument". */
export function trainingTimbre(p: Pick<StudentProfile, 'instrument' | 'trainingTimbre'>): Timbre {
  return p.trainingTimbre === 'instrument' ? timbreForInstrument(p.instrument) : 'piano'
}

export function timbreForInstrument(instrument: InstrumentId): Timbre {
  switch (instrument) {
    case 'guitar':
      return 'guitar'
    case 'bass':
      return 'bass'
    default:
      return 'piano'
  }
}

export interface NoteEvent {
  midi: number
  /** Cents offset applied to the frequency (pitch-comparison drill). */
  detuneCents?: number
  /** Seconds. */
  duration: number
  /** Seconds relative to the sequence start. */
  at: number
  velocity?: number
}

let pluck: PluckPool | null = null

/** Short-release sampler for drills (notes must not run into the next question). */
let drillSampler: Tone.Sampler | null = null

function drillPiano(): Tone.Sampler | null {
  if (drillSampler) return drillSampler
  const bank = pianoBank()
  if (!bank || !master) return null
  drillSampler = makeSampler(bank, 0.6)
  drillSampler.connect(master)
  return drillSampler
}

/** Notes of a chord start this far apart, like a real hand (≤ 10 ms in total). */
export function chordStagger(count: number): number[] {
  const step = count > 1 ? Math.min(0.004, 0.01 / (count - 1)) : 0
  return Array.from({ length: count }, (_, i) => i * step)
}

/** Route single notes: sampled piano when loaded, plucked strings for guitar, otherwise the synth. */
function trigger(freqs: number | number[], duration: number, time: number, velocity: number): void {
  const list = Array.isArray(freqs) ? freqs : [freqs]
  if (currentTimbre === 'piano') {
    const piano = drillPiano()
    if (piano) {
      const offsets = chordStagger(list.length)
      list.forEach((f, i) => piano.triggerAttackRelease(f, duration, time + offsets[i]!, velocity))
      return
    }
  }
  if (currentTimbre === 'guitar') {
    if (!pluck && master) pluck = makePluck(master)
    if (pluck) {
      pluck.play(list.map((f) => Math.round(69 + 12 * Math.log2(f / 440))), duration, time, velocity)
      return
    }
  }
  synth?.triggerAttackRelease(list, duration, time, velocity)
}

function makePluck(out: Tone.InputNode): PluckPool {
  return new PluckPool(out, 8, { volume: -2 })
}

function freqOf(midi: number, detuneCents = 0): number {
  return midiToFrequency(midi) * Math.pow(2, detuneCents / 1200)
}

/** Play a single note now (or at `time`). */
export function playNote(midi: number, duration = 0.8, time?: number, detuneCents = 0, velocity = 0.9): void {
  if (!synth) return
  trigger(freqOf(midi, detuneCents), duration, time ?? Tone.now(), velocity)
}

/** Play notes together. */
export function playChord(midis: readonly number[], duration = 1.4, time?: number, velocity = 0.8): void {
  if (!synth) return
  const t = time ?? Tone.now()
  trigger(midis.map((m) => freqOf(m)), duration, t, velocity)
}

/**
 * Schedule a sequence of events starting slightly in the future. Returns the
 * absolute start time and the total length in seconds so the UI can animate.
 */
export function playSequence(events: readonly NoteEvent[], startOffset = 0.08): { startAt: number; endAt: number } {
  const t0 = Tone.now()
  const startAt = t0 + sequenceLead(t0, lastSoundEnd, startOffset)
  let endAt = startAt
  if (!synth) return { startAt, endAt }
  // Pitch comparison (the only caller that sets detuneCents): one recording,
  // re-pitched, so the cents between the notes are exact.
  const bank = pianoBank()
  if (currentTimbre === 'piano' && bank && master && events.some((e) => e.detuneCents !== undefined)) {
    playSameSample(bank, master, events, startAt)
    for (const e of events) endAt = Math.max(endAt, startAt + e.at + e.duration)
    lastSoundEnd = endAt
    return { startAt, endAt }
  }
  for (const e of events) {
    const t = startAt + e.at
    trigger(freqOf(e.midi, e.detuneCents ?? 0), e.duration, t, e.velocity ?? 0.9)
    endAt = Math.max(endAt, t + e.duration)
  }
  lastSoundEnd = endAt
  return { startAt, endAt }
}

/** Stop everything that is sounding. */
export function stopAll(): void {
  synth?.releaseAll()
  drillSampler?.releaseAll()
  // Plucked voices may hold notes scheduled in the future; a fresh pool cancels them.
  pluck?.dispose()
  pluck = null
}

export interface ClickSchedule {
  /** Absolute AudioContext times of every click, in order. */
  times: number[]
  startAt: number
  endAt: number
  /** Seconds per beat. */
  beatSeconds: number
}

/**
 * Schedule metronome clicks. Beat 0 of every `accentEvery` beats is accented.
 * `muted` beats are skipped in sound but still returned (inner-pulse drill).
 */
export function scheduleClicks(
  bpm: number,
  beats: number,
  opts: { startOffset?: number; accentEvery?: number; muted?: (beatIndex: number) => boolean; /** Absolute start time (overrides startOffset). */ at?: number } = {},
): ClickSchedule {
  const beatSeconds = 60 / bpm
  const startAt = opts.at ?? Tone.now() + (opts.startOffset ?? 0.15)
  const times: number[] = []
  for (let i = 0; i < beats; i++) {
    const t = startAt + i * beatSeconds
    times.push(t)
    if (opts.muted?.(i)) continue
    const accent = opts.accentEvery ? i % opts.accentEvery === 0 : false
    const inst = accent ? accentClick : click
    inst?.triggerAttackRelease(accent ? 'G4' : 'C4', 0.05, t)
  }
  return { times, startAt, endAt: startAt + beats * beatSeconds, beatSeconds }
}

/** A short rhythm "tick" on a pitched percussive synth, used to play patterns. */
export function scheduleRhythmHits(times: readonly number[]): void {
  for (const t of times) accentClick?.triggerAttackRelease('A5', 0.04, t)
}

/** Fire a callback at an AudioContext time, aligned with the display. */
export function onAudioTime(time: number, cb: () => void): () => void {
  const ms = Math.max(0, (time - Tone.now()) * 1000)
  const id = setTimeout(cb, ms)
  return () => clearTimeout(id)
}

/** Small UI sounds. */
export function playSuccess(): void {
  if (!synth) return
  const t = Tone.now()
  synth.triggerAttackRelease(freqOf(76), 0.12, t, 0.5)
  synth.triggerAttackRelease(freqOf(83), 0.25, t + 0.09, 0.5)
}

export function playFail(): void {
  if (!synth) return
  synth.triggerAttackRelease(freqOf(50), 0.3, Tone.now(), 0.35)
}

/**
 * Raw AudioContext time (no Tone look-ahead) and the output latency to
 * subtract from a key press so taps line up with what the student heard.
 */
export function rawTime(): number {
  return Tone.getContext().rawContext.currentTime
}

export function outputLatencySeconds(): number {
  const ctx = Tone.getContext().rawContext as AudioContext
  const out = typeof ctx.outputLatency === 'number' ? ctx.outputLatency : 0
  const base = typeof ctx.baseLatency === 'number' ? ctx.baseLatency : 0
  return out + base
}

// ---------------------------------------------------------------------------
// Multitrack playback (composer, lessons, portfolio). A fresh rig per play;
// stopping disposes it, which cancels every note already scheduled.
// ---------------------------------------------------------------------------

let liveRig: Rig | null = null
/** Long-release sampler for arrangements, shared across plays (survives each rig). */
let liveSampler: Tone.Sampler | null = null

function arrangementPiano(): Tone.Sampler | null {
  if (liveSampler) return liveSampler
  const bank = pianoBank()
  if (!bank) return null
  liveSampler = makeSampler(bank, 1.2)
  return liveSampler
}

/** Play a score with all its tracks. */
export async function playScore(score: Score, opts: { fromBeat?: number } = {}): Promise<{ startAt: number; endAt: number; beatSeconds: number }> {
  await ensureAudio()
  stopArrangement()
  const tracks = ensureTracks(score)
  const sampler = arrangementPiano()
  liveRig = buildRig(score, tracks, master ?? Tone.getDestination(), sampler)
  const startAt = Tone.now() + 0.12
  const events = arrangementEvents({ ...score, tracks })
  const endAt = scheduleOnRig(liveRig, events, score.bpm, startAt, opts.fromBeat ?? 0)
  return { startAt, endAt, beatSeconds: 60 / score.bpm }
}

/** Stop immediately, including notes already scheduled in the future. */
export function stopArrangement(): void {
  if (liveRig) {
    // The shared sampler must survive the rig.
    liveSampler?.disconnect()
    liveRig.dispose()
    liveRig = null
  }
  if (synth && master) {
    synth.dispose()
    synth = buildSynth(currentTimbre)
    synth.connect(master)
  }
}
