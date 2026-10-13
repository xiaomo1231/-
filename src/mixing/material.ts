/**
 * 后期课堂 material: what the lessons process. Everything is made here or by
 * the student — no copyrighted music:
 *  - voice: the student's own 20-second recording (stored by MixCourseService)
 *    or, until there is one, a synthetic sung "ah" melody (formant synthesis);
 *  - drums / bass / piano / band: an original 8-bar groove (96 BPM, I–V–vi–IV
 *    in C) rendered offline; the piano uses the bundled Salamander samples.
 * Problems (hum, hiss, harsh, …) are mixed in on purpose for tasks. Instrument
 * materials go through the voice channel (the one the lesson's controls
 * process); 'full' = voice + band as backing.
 */
import type { Material, Problem } from './types'
import { integratedLufs } from '@/audio/fx/loudness'

export const MATERIAL_RATE = 44100
export const BPM = 96
const BEAT = 60 / BPM
const BARS = 8
const LENGTH = BARS * 4 * BEAT + 0.6

export interface LessonAudio {
  voice: AudioBuffer | null
  backing: AudioBuffer[]
  backingNames: string[]
  duration: number
  /** Phrases of the voice (for level riding), ms. */
  phrases: Array<{ startMs: number; endMs: number }>
}

// ---------------------------------------------------------------------------
// small DSP helpers (sample arrays)
// ---------------------------------------------------------------------------

type BiquadKind = 'lowshelf' | 'highshelf' | 'peaking' | 'highpass' | 'lowpass' | 'bandpass'

/** RBJ cookbook biquad, in place on a copy. */
export function filter(x: Float32Array, rate: number, kind: BiquadKind, freq: number, gainDb = 0, q = Math.SQRT1_2): Float32Array {
  const A = Math.pow(10, gainDb / 40)
  const w0 = (2 * Math.PI * freq) / rate
  const cos = Math.cos(w0)
  const sin = Math.sin(w0)
  const alpha = sin / (2 * q)
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0
  if (kind === 'peaking') {
    b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A
  } else if (kind === 'lowshelf' || kind === 'highshelf') {
    const s = 2 * Math.sqrt(A) * (sin / 2) * Math.SQRT2
    const sign = kind === 'lowshelf' ? 1 : -1
    b0 = A * (A + 1 - sign * (A - 1) * cos + s); b1 = 2 * sign * A * (A - 1 - sign * (A + 1) * cos); b2 = A * (A + 1 - sign * (A - 1) * cos - s)
    a0 = A + 1 + sign * (A - 1) * cos + s; a1 = -2 * sign * (A - 1 + sign * (A + 1) * cos); a2 = A + 1 + sign * (A - 1) * cos - s
  } else if (kind === 'highpass') {
    b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha
  } else if (kind === 'lowpass') {
    b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha
  } else {
    b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha
  }
  const out = new Float32Array(x.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i]! + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
    x2 = x1; x1 = x[i]!; y2 = y1; y1 = y
    out[i] = y
  }
  return out
}

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296 - 0.5
  }
}

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

// ---------------------------------------------------------------------------
// synthetic voice: an original 4-phrase "ah" melody with vibrato and an "s"
// ---------------------------------------------------------------------------

/** Notes of the demo melody: [beat, beats, midi] (an original tune). */
const MELODY: Array<[number, number, number]> = [
  [0, 1, 64], [1, 1, 67], [2, 1.5, 69], [3.5, 0.5, 67], [4, 2, 64], // phrase 1
  [8, 1, 62], [9, 1, 64], [10, 1, 67], [11, 1, 64], [12, 2.5, 62],
  [16, 1, 64], [17, 1, 67], [18, 1, 72], [19, 1, 71], [20, 2, 69],
  [24, 1, 67], [25, 1, 65], [26, 1, 64], [27, 1, 62], [28, 3, 60],
]
const PHRASES: Array<[number, number, number]> = [
  // [startBeat, endBeat, level dB]
  [0, 6, -14], [8, 14.5, -20], [16, 22, -11], [24, 31, -17],
]
const VOWELS: Array<[number, number, number]> = [
  [800, 1150, 2900], // a
  [450, 800, 2830], // o
  [400, 1600, 2700], // e
]

export function synthVoice(rate = MATERIAL_RATE): Float32Array {
  const n = Math.round(LENGTH * rate)
  const out = new Float32Array(n)
  const rnd = rng(7)
  let phase = 0
  for (const [beat, beats, midi] of MELODY) {
    const a = Math.round(beat * BEAT * rate)
    const len = Math.round(beats * BEAT * rate * 0.96)
    const f0 = midiHz(midi - 12)
    const pulse = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      const t = i / rate
      const vib = t > 0.25 ? 0.25 * Math.sin(2 * Math.PI * 5.5 * t) : 0
      phase += (f0 * Math.pow(2, vib / 12)) / rate
      // band-limited-ish glottal pulse: a few harmonics with falling amplitude
      let s = 0
      for (let h = 1; h <= 18; h++) s += Math.sin(2 * Math.PI * h * phase) / Math.pow(h, 1.2)
      pulse[i] = s * 0.25 + rnd() * 0.02
    }
    const [f1, f2, f3] = VOWELS[Math.floor(midi + beat) % 3]!
    const v = filter(pulse, rate, 'bandpass', f1, 0, 6)
    const v2 = filter(pulse, rate, 'bandpass', f2, 0, 8)
    const v3 = filter(pulse, rate, 'bandpass', f3, 0, 10)
    for (let i = 0; i < len; i++) {
      const env = Math.min(1, i / (0.03 * rate)) * Math.min(1, (len - i) / (0.06 * rate))
      if (a + i < n) out[a + i] = (v[i]! * 1.0 + v2[i]! * 0.6 + v3[i]! * 0.3) * env
    }
  }
  // an "s" at the start of each phrase
  for (const [beat] of PHRASES) {
    const a = Math.round((beat * BEAT - 0.14) * rate)
    const len = Math.round(0.12 * rate)
    const noise = Float32Array.from({ length: len }, () => rnd())
    const s = filter(filter(noise, rate, 'highpass', 4500, 0, 0.8), rate, 'peaking', 7000, 6, 1.5)
    for (let i = 0; i < len; i++) if (a + i >= 0 && a + i < n) out[a + i]! += s[i]! * 0.5 * Math.sin((Math.PI * i) / len)
  }
  // phrase levels (uneven on purpose, like a real take) and normalisation
  let peak = 0
  for (const x of out) peak = Math.max(peak, Math.abs(x))
  const norm = peak > 0 ? 1 / peak : 1
  for (const [b0, b1, db] of PHRASES) {
    const a = Math.max(0, Math.round((b0 * BEAT - 0.2) * rate))
    const b = Math.min(n, Math.round(b1 * BEAT * rate))
    const g = Math.pow(10, db / 20) * norm * 2
    for (let i = a; i < b; i++) out[i] = out[i]! * g
  }
  return out
}

/** Phrases of the synthetic voice, ms. */
export const SYNTH_PHRASES = PHRASES.map(([a, b]) => ({ startMs: Math.round(a * BEAT * 1000) - 150, endMs: Math.round(b * BEAT * 1000) }))

/** Phrases of a recording found from its level (≥ 300 ms of quiet splits). */
export function findPhrases(x: Float32Array, rate: number): Array<{ startMs: number; endMs: number }> {
  const win = Math.round(rate * 0.02)
  const levels: number[] = []
  for (let i = 0; i + win <= x.length; i += win) {
    let s = 0
    for (let j = i; j < i + win; j++) s += x[j]! * x[j]!
    levels.push(10 * Math.log10(s / win + 1e-12))
  }
  const sorted = [...levels].sort((a, b) => a - b)
  const loud = sorted[Math.floor(sorted.length * 0.95)] ?? -20
  const thr = loud - 25
  const out: Array<{ startMs: number; endMs: number }> = []
  let start = -1
  let quiet = 0
  levels.forEach((l, k) => {
    if (l > thr) {
      if (start < 0) start = k
      quiet = 0
    } else if (start >= 0 && ++quiet >= 15) {
      out.push({ startMs: start * 20, endMs: (k - quiet + 1) * 20 })
      start = -1
      quiet = 0
    }
  })
  if (start >= 0) out.push({ startMs: start * 20, endMs: levels.length * 20 })
  return out.filter((p) => p.endMs - p.startMs >= 400)
}

// ---------------------------------------------------------------------------
// band: drums, bass, piano
// ---------------------------------------------------------------------------

const CHORDS = [
  [48, 60, 64, 67], // C
  [43, 59, 62, 67], // G
  [45, 60, 64, 69], // Am
  [41, 60, 65, 69], // F
]

function drums(rate: number): Float32Array {
  const n = Math.round(LENGTH * rate)
  const out = new Float32Array(n)
  const rnd = rng(3)
  const hit = (t: number, f: (i: number, tt: number) => number, dur: number) => {
    const a = Math.round(t * rate)
    const len = Math.round(dur * rate)
    for (let i = 0; i < len && a + i < n; i++) out[a + i]! += f(i, i / rate)
  }
  for (let bar = 0; bar < BARS; bar++) {
    for (let beat = 0; beat < 4; beat++) {
      const t = (bar * 4 + beat) * BEAT
      if (beat === 0 || beat === 2 || (beat === 3 && bar % 2)) {
        let ph = 0
        hit(t + (beat === 3 ? BEAT / 2 : 0), (_i, tt) => {
          ph += (50 + 110 * Math.exp(-tt * 30)) / rate
          return 0.9 * Math.sin(2 * Math.PI * ph) * Math.exp(-tt * 9)
        }, 0.45)
      }
      if (beat === 1 || beat === 3) {
        hit(t, (_i, tt) => (rnd() * 0.9 * Math.exp(-tt * 18) + 0.35 * Math.sin(2 * Math.PI * 185 * tt) * Math.exp(-tt * 25)), 0.25)
      }
      for (const off of [0, 0.5]) hit(t + off * BEAT, (_i, tt) => rnd() * 0.25 * Math.exp(-tt * 60) * (off ? 0.7 : 1), 0.06)
    }
  }
  // hats bright, the rest as is
  const hats = filter(out, rate, 'highshelf', 6000, 3)
  return hats
}

function bass(rate: number): Float32Array {
  const n = Math.round(LENGTH * rate)
  const out = new Float32Array(n)
  for (let bar = 0; bar < BARS; bar++) {
    const root = CHORDS[bar % 4]![0]! - 12
    for (let e = 0; e < 8; e++) {
      const a = Math.round((bar * 4 + e / 2) * BEAT * rate)
      const len = Math.round(BEAT * 0.48 * rate)
      const f = midiHz(root + (e === 7 ? 7 : 0))
      for (let i = 0; i < len && a + i < n; i++) {
        const t = i / rate
        const saw = 2 * ((f * t) % 1) - 1
        out[a + i] = (0.6 * Math.sin(2 * Math.PI * f * t) + 0.25 * saw) * Math.exp(-t * 3) * Math.min(1, (len - i) / 200)
      }
    }
  }
  return filter(out, rate, 'lowpass', 900, 0, 0.9)
}

const PIANO_NAMES = ['C', 'Ds', 'Fs', 'A']
const sampleCache = new Map<string, Promise<AudioBuffer | null>>()

async function pianoSample(ctx: BaseAudioContext, midi: number): Promise<{ buf: AudioBuffer; rate: number } | null> {
  // nearest of C, D#, F#, A in octaves 1–6
  const pc = ((midi % 12) + 12) % 12
  const choices = [0, 3, 6, 9]
  let best = 0
  for (const c of choices) if (Math.abs(pc - c) < Math.abs(pc - best)) best = c
  if (pc - best > 1.5) best = 9
  const octave = Math.max(1, Math.min(6, Math.floor(midi / 12) - 1))
  const name = `${PIANO_NAMES[choices.indexOf(best)]}${octave}`
  const sampleMidi = (octave + 1) * 12 + best
  let p = sampleCache.get(name)
  if (!p) {
    p = fetch(`${(import.meta.env?.BASE_URL as string | undefined) ?? '/'}audio/piano/${name}.mp3`)
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .catch(() => null)
    sampleCache.set(name, p)
  }
  const buf = await p
  return buf ? { buf, rate: Math.pow(2, (midi - sampleMidi) / 12) } : null
}

async function piano(rate: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(2, Math.round(LENGTH * rate), rate)
  for (let bar = 0; bar < BARS; bar++) {
    const chord = CHORDS[bar % 4]!.slice(1)
    for (const half of [0, 2]) {
      for (const m of chord) {
        const s = await pianoSample(ctx, m)
        if (!s) continue
        const src = ctx.createBufferSource()
        src.buffer = s.buf
        src.playbackRate.value = s.rate
        const g = ctx.createGain()
        g.gain.value = 0.22
        g.gain.setTargetAtTime(0, (bar * 4 + half + 1.9) * BEAT, 0.08)
        src.connect(g).connect(ctx.destination)
        src.start((bar * 4 + half) * BEAT)
      }
    }
  }
  const out = await ctx.startRendering()
  const mono = new Float32Array(out.length)
  const L = out.getChannelData(0)
  const R = out.getChannelData(1)
  for (let i = 0; i < mono.length; i++) mono[i] = (L[i]! + R[i]!) / 2
  return mono
}

// ---------------------------------------------------------------------------
// problems
// ---------------------------------------------------------------------------

export function addProblem(x: Float32Array, rate: number, p: Problem): Float32Array {
  const rnd = rng(11)
  const out = x.slice()
  switch (p) {
    case 'rumble':
      for (let i = 0; i < out.length; i++) out[i] = out[i]! + 0.06 * Math.sin((2 * Math.PI * 40 * i) / rate) + 0.03 * Math.sin((2 * Math.PI * 55 * i) / rate)
      return out
    case 'hiss':
      for (let i = 0; i < out.length; i++) out[i] = out[i]! + rnd() * 0.012
      return out
    case 'sibilance':
      return filter(out, rate, 'highshelf', 5500, 11)
    case 'boomy':
      return filter(out, rate, 'peaking', 220, 9, 0.9)
    case 'harsh':
      return filter(out, rate, 'peaking', 3000, 9, 1.5)
    case 'dull':
      return filter(out, rate, 'highshelf', 3500, -12)
    case 'quiet':
      return out.map((v) => v * 0.12)
    case 'clipping':
      return out.map((v) => Math.max(-1, Math.min(1, v * 5)))
    case 'uneven': {
      const seg = Math.round(rate * 2.4)
      const gains = [0.45, 1.6, 0.6, 1.8, 0.5, 1.4]
      for (let i = 0; i < out.length; i++) {
        const k = Math.floor(i / seg)
        const t = (i % seg) / seg
        const g0 = gains[k % gains.length]!
        const g1 = gains[(k + 1) % gains.length]!
        out[i] = out[i]! * (t > 0.9 ? g0 + (g1 - g0) * ((t - 0.9) / 0.1) : g0)
      }
      return out
    }
    case 'muddyBacking':
      return filter(out, rate, 'peaking', 300, 7, 0.8).map((v) => v * 1.5)
  }
}

/** Loudness the lesson voice is brought to before any problem is added. */
const VOICE_LUFS = -24

function toLoudness(x: Float32Array, rate: number, target: number): Float32Array {
  const l = integratedLufs([x], rate)
  if (!Number.isFinite(l)) return x
  const g = Math.pow(10, (target - l) / 20)
  const out = x.map((v) => v * g)
  // keep clear of clipping (a very dynamic recording)
  let peak = 0
  for (const v of out) peak = Math.max(peak, Math.abs(v))
  return peak > 0.89 ? out.map((v) => (v * 0.89) / peak) : out
}

// ---------------------------------------------------------------------------
// loading
// ---------------------------------------------------------------------------

const cache = new Map<string, Promise<LessonAudio>>()
let voiceSamples: { samples: Float32Array; rate: number } | null = null

/** Use the student's recording as the voice material from now on (null = the synthetic voice). */
export function setLessonVoice(v: { samples: Float32Array; rate: number } | null): void {
  voiceSamples = v
  cache.clear()
}

export function usesOwnVoice(): boolean {
  return voiceSamples !== null
}

const bandCache = new Map<string, Promise<Float32Array>>()
function part(name: 'drums' | 'bass' | 'piano'): Promise<Float32Array> {
  let p = bandCache.get(name)
  if (!p) {
    p = name === 'drums' ? Promise.resolve(drums(MATERIAL_RATE)) : name === 'bass' ? Promise.resolve(bass(MATERIAL_RATE)) : piano(MATERIAL_RATE)
    bandCache.set(name, p)
  }
  return p
}

async function band(): Promise<Float32Array> {
  const [d, b, p] = await Promise.all([part('drums'), part('bass'), part('piano')])
  const out = new Float32Array(Math.max(d.length, b.length, p.length))
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * (d[i] ?? 0) + 0.55 * (b[i] ?? 0) + 0.9 * (p[i] ?? 0)
  return out
}

function toAudioBuffer(x: Float32Array, rate: number): AudioBuffer {
  const ctx = new OfflineAudioContext(1, Math.max(1, x.length), rate)
  const buf = ctx.createBuffer(1, Math.max(1, x.length), rate)
  buf.copyToChannel(x as Float32Array<ArrayBuffer>, 0)
  return buf
}

/** The audio for a lesson demo or task (cached). */
export function loadMaterial(material: Material, problems: readonly Problem[] = []): Promise<LessonAudio> {
  const key = `${material}|${[...problems].sort().join(',')}|${voiceSamples ? 'own' : 'synth'}`
  let p = cache.get(key)
  if (!p) {
    p = (async () => {
      const voiceProblems = problems.filter((x) => x !== 'muddyBacking')
      const rate = voiceSamples?.rate ?? MATERIAL_RATE
      const rawVoice = () => voiceSamples?.samples ?? synthVoice(MATERIAL_RATE)
      let main: Float32Array
      let mainRate = MATERIAL_RATE
      let phrases: LessonAudio['phrases'] = []
      if (material === 'voice' || material === 'full') {
        // A standard level, so the tasks behave the same whatever the recording level.
        main = toLoudness(rawVoice(), rate, VOICE_LUFS)
        mainRate = rate
        phrases = voiceSamples ? findPhrases(main, rate) : SYNTH_PHRASES
      } else if (material === 'band') main = await band()
      else main = await part(material)
      for (const pr of voiceProblems) main = addProblem(main, mainRate, pr)
      const backing: AudioBuffer[] = []
      if (material === 'full') {
        let b = await band()
        if (problems.includes('muddyBacking')) b = addProblem(b, MATERIAL_RATE, 'muddyBacking')
        backing.push(toAudioBuffer(b, MATERIAL_RATE))
      }
      const voice = toAudioBuffer(main, mainRate)
      return { voice, backing, backingNames: backing.map(() => 'band'), duration: Math.max(voice.duration, ...backing.map((b) => b.duration)), phrases }
    })()
    cache.set(key, p)
  }
  return p
}
