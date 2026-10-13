import * as Tone from 'tone'
import { midiToFrequency } from '@/music/pitch'
import type { ArrEvent } from '@/music/arrangement'
import type { Score, Track } from '@/music/score'

/**
 * Instruments for multitrack playback. A rig is built per playback (or per
 * offline render) inside the current Tone context, so live playback and WAV
 * export share exactly the same sounds. Disposing the rig cancels every
 * scheduled note.
 */

const freq = (m: number) => midiToFrequency(m)

interface Voice {
  play(midis: number[], duration: number, time: number, velocity: number): void
  dispose(): void
}

/** Round-robin pool of Karplus–Strong plucked strings (PluckSynth is monophonic). */
/**
 * Pick the voice for a note at `time`. A Tone.js voice cannot take a note
 * earlier than its last scheduled one, so only voices whose last start is
 * not after `time` qualify (round-robin among them). Returns -1 when every
 * voice is booked later (the caller adds a voice). Pure, for tests.
 */
export function pickVoice(lastStart: readonly number[], time: number, from: number): number {
  for (let k = 0; k < lastStart.length; k++) {
    const j = (from + k) % lastStart.length
    if (lastStart[j]! <= time) return j
  }
  return -1
}

/** Plucked-string voices that never schedule a note out of order. */
export class PluckPool implements Voice {
  private voices: Tone.PluckSynth[] = []
  private lastStart: number[] = []
  private i = 0
  constructor(
    private out: Tone.InputNode,
    size = 8,
    private opts: Partial<Tone.PluckSynthOptions> = {},
    private max = 32,
  ) {
    for (let k = 0; k < size; k++) this.add()
  }
  private add(): number {
    this.voices.push(new Tone.PluckSynth({ attackNoise: 1.2, dampening: 3800, resonance: 0.96, ...this.opts }).connect(this.out))
    this.lastStart.push(-Infinity)
    return this.voices.length - 1
  }
  play(midis: number[], duration: number, time: number, velocity: number) {
    for (const m of midis) {
      let j = pickVoice(this.lastStart, time, this.i)
      if (j < 0) {
        if (this.voices.length >= this.max) continue
        j = this.add()
      }
      this.i = j + 1
      this.lastStart[j] = time
      this.voices[j]!.triggerAttackRelease(freq(m), Math.max(0.1, duration), time, velocity)
    }
  }
  dispose() {
    this.voices.forEach((v) => v.dispose())
  }
}

class PolyVoice implements Voice {
  /** `owned` false for the shared sampler: disconnect instead of dispose. */
  constructor(
    private synth: Tone.PolySynth | Tone.Sampler,
    private owned = true,
  ) {}
  play(midis: number[], duration: number, time: number, velocity: number) {
    this.synth.triggerAttackRelease(midis.map(freq), Math.max(0.05, duration), time, velocity)
  }
  dispose() {
    if (this.owned) this.synth.dispose()
    else this.synth.disconnect()
  }
}

class MonoVoice implements Voice {
  constructor(private synth: Tone.MonoSynth) {}
  play(midis: number[], duration: number, time: number, velocity: number) {
    this.synth.triggerAttackRelease(freq(midis[0]!), Math.max(0.05, duration), time, velocity)
  }
  dispose() {
    this.synth.dispose()
  }
}

class DrumVoice implements Voice {
  private kick: Tone.MembraneSynth
  private snare: Tone.NoiseSynth
  private hat: Tone.MetalSynth
  private openhat: Tone.MetalSynth
  private crash: Tone.MetalSynth
  constructor(out: Tone.InputNode) {
    this.kick = new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 6, envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.1 }, volume: -2 }).connect(out)
    this.snare = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.17, sustain: 0 }, volume: -12 }).connect(out)
    this.hat = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.05, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5, volume: -26 }).connect(out)
    this.openhat = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.3, release: 0.1 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5, volume: -28 }).connect(out)
    this.crash = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 1.4, release: 0.6 }, harmonicity: 5.1, modulationIndex: 40, resonance: 3000, octaves: 2, volume: -24 }).connect(out)
  }
  play(midis: number[], _d: number, time: number, velocity: number) {
    const m = midis[0]
    if (m === 36) this.kick.triggerAttackRelease('C1', 0.2, time, velocity)
    else if (m === 38) this.snare.triggerAttackRelease(0.16, time, velocity)
    else if (m === 46) this.openhat.triggerAttackRelease(380, 0.25, time, velocity)
    else if (m === 49) this.crash.triggerAttackRelease(300, 1.2, time, velocity)
    else this.hat.triggerAttackRelease(400, 0.05, time, velocity)
  }
  dispose() {
    ;[this.kick, this.snare, this.hat, this.openhat, this.crash].forEach((n) => n.dispose())
  }
}

// ---------------------------------------------------------------------------

function keysVoice(timbre: string, out: Tone.InputNode, sampler: Tone.Sampler | null): Voice {
  if (timbre === 'piano' && sampler) {
    sampler.connect(out)
    return new PolyVoice(sampler, false)
  }
  if (timbre === 'epiano') {
    return new PolyVoice(
      new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3,
        modulationIndex: 1.6,
        oscillator: { type: 'sine' },
        modulation: { type: 'sine' },
        envelope: { attack: 0.005, decay: 1.2, sustain: 0.2, release: 1 },
        modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0.1, release: 0.5 },
        volume: -12,
      } as never).connect(out),
    )
  }
  if (timbre === 'organ') {
    return new PolyVoice(
      new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'custom', partials: [1, 0.6, 0.35, 0.2, 0.1] } as never,
        envelope: { attack: 0.02, decay: 0.1, sustain: 0.9, release: 0.15 },
        volume: -18,
      }).connect(out),
    )
  }
  return new PolyVoice(
    new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle8' } as never,
      envelope: { attack: 0.005, decay: 0.8, sustain: 0.2, release: 0.9 },
      volume: -12,
    }).connect(out),
  )
}

function guitarVoice(timbre: string, out: Tone.InputNode, extra: Tone.ToneAudioNode[]): Voice {
  if (timbre === 'drive') {
    const filter = new Tone.Filter(3200, 'lowpass').connect(out)
    const dist = new Tone.Distortion(0.75).connect(filter)
    extra.push(filter, dist)
    return new PluckPool(dist, 10, { dampening: 2600, resonance: 0.985, volume: -10 } as never)
  }
  return new PluckPool(out, 10, { volume: -4 } as never)
}

function bassVoice(timbre: string, out: Tone.InputNode): Voice {
  return new MonoVoice(
    new Tone.MonoSynth(
      timbre === 'synth'
        ? {
            oscillator: { type: 'sawtooth' },
            filter: { Q: 2, type: 'lowpass', rolloff: -24 },
            envelope: { attack: 0.005, decay: 0.25, sustain: 0.6, release: 0.2 },
            filterEnvelope: { attack: 0.005, decay: 0.15, sustain: 0.4, release: 0.3, baseFrequency: 90, octaves: 3 },
            volume: -12,
          }
        : {
            oscillator: { type: 'fmsquare', modulationType: 'sine', harmonicity: 1, modulationIndex: 0.6 } as never,
            filter: { Q: 1, type: 'lowpass', rolloff: -24 },
            envelope: { attack: 0.004, decay: 0.35, sustain: 0.45, release: 0.25 },
            filterEnvelope: { attack: 0.004, decay: 0.2, sustain: 0.3, release: 0.3, baseFrequency: 110, octaves: 2.2 },
            volume: -8,
          },
    ).connect(out),
  )
}

function leadVoice(timbre: string, out: Tone.InputNode, sampler: Tone.Sampler | null): Voice {
  if (timbre === 'piano' && sampler) {
    sampler.connect(out)
    return new PolyVoice(sampler, false)
  }
  return new PolyVoice(
    new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fatsine', count: 2, spread: 12 } as never,
      envelope: { attack: 0.03, decay: 0.2, sustain: 0.7, release: 0.4 },
      volume: -6,
    }).connect(out),
  )
}

export interface Rig {
  play(e: ArrEvent, time: number, beatSeconds: number): void
  dispose(): void
}

/**
 * Build instruments and mixer channels for a score's tracks in the current
 * Tone context. `sampler` is an already-loaded piano sampler (or null).
 */
export function buildRig(score: Score, tracks: Track[], destination: Tone.InputNode, sampler: Tone.Sampler | null): Rig {
  const voices = new Map<string, Voice>()
  const nodes: Tone.ToneAudioNode[] = []
  const lead = score.lead ?? { volume: 0.9, pan: 0, mute: false, solo: false, timbre: 'lead' }
  const channel = (volume: number, pan: number) => {
    const ch = new Tone.Channel({ volume: Tone.gainToDb(Math.max(0.0001, volume)), pan }).connect(destination)
    nodes.push(ch)
    return ch
  }
  voices.set('lead', leadVoice(lead.timbre, channel(lead.volume, lead.pan), sampler))
  let samplerUsed = lead.timbre === 'piano' && Boolean(sampler)
  for (const t of tracks) {
    const ch = channel(t.volume, t.pan)
    let v: Voice
    if (t.kind === 'keys') {
      // One sampler can only be routed once; later piano tracks fall back to the synth.
      v = keysVoice(t.timbre, ch, samplerUsed ? null : sampler)
      if (t.timbre === 'piano' && sampler) samplerUsed = true
    } else if (t.kind === 'guitar') v = guitarVoice(t.timbre, ch, nodes)
    else if (t.kind === 'bass') v = bassVoice(t.timbre, ch)
    else v = new DrumVoice(ch)
    voices.set(t.id, v)
  }
  return {
    play(e, time, beatSeconds) {
      voices.get(e.track)?.play([e.midi], e.beats * beatSeconds, time, e.velocity)
    },
    dispose() {
      voices.forEach((v) => v.dispose())
      nodes.forEach((n) => n.dispose())
    },
  }
}

/** Schedule events on a rig starting at `startAt` (absolute context seconds). */
export function scheduleOnRig(rig: Rig, events: readonly ArrEvent[], bpm: number, startAt: number, fromBeat = 0): number {
  const beatSeconds = 60 / bpm
  let end = startAt
  for (const e of events) {
    if (e.start < fromBeat - 1e-6) continue
    const t = startAt + (e.start - fromBeat) * beatSeconds
    rig.play(e, t, beatSeconds)
    end = Math.max(end, t + e.beats * beatSeconds)
  }
  return end
}
