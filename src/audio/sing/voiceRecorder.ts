import * as Tone from 'tone'
import { inputManager } from '@/audio/input/inputManager'
import { createWorkletNode, ensureWorklets } from '@/audio/guitar/worklets'

/**
 * Raw microphone recording for 跟唱 takes. Samples come from the shared
 * input bus through the "groove-tap" worklet with their AudioContext frame
 * numbers, so any stretch can be cut out exactly and lined up with the song.
 * Keeps the last `maxSeconds` (default 8 minutes) in memory.
 */
export class VoiceRecorder {
  private chunks: Array<{ frame: number; samples: Float32Array }> = []
  private tap: AudioWorkletNode | null = null
  private sink: GainNode | null = null
  readonly sampleRate: number

  constructor(private maxSeconds = 480) {
    this.sampleRate = (Tone.getContext().rawContext as AudioContext).sampleRate
  }

  /** Start capturing (the microphone must already be open via the pitch detector). */
  async start(): Promise<boolean> {
    if (this.tap) return true
    const ctx = Tone.getContext().rawContext as AudioContext
    if (!(await ensureWorklets(ctx))) return false
    const tap = createWorkletNode('groove-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
    const sink = ctx.createGain()
    sink.gain.value = 0
    inputManager.bus.connect(tap)
    tap.connect(sink).connect(ctx.destination)
    tap.port.onmessage = (e: MessageEvent<{ frame: number; samples: Float32Array }>) => {
      this.chunks.push({ frame: e.data.frame, samples: e.data.samples.slice() })
      const keepFrom = e.data.frame - this.maxSeconds * this.sampleRate
      while (this.chunks.length && this.chunks[0]!.frame + this.chunks[0]!.samples.length < keepFrom) this.chunks.shift()
    }
    this.tap = tap
    this.sink = sink
    return true
  }

  stop(): void {
    if (!this.tap) return
    this.tap.port.onmessage = null
    try {
      inputManager.bus.disconnect(this.tap)
    } catch {
      // already disconnected
    }
    this.tap.disconnect()
    this.sink?.disconnect()
    this.tap = null
    this.sink = null
  }

  /** Samples between two AudioContext times (seconds); silence where nothing was captured. */
  clip(fromTime: number, toTime: number): Float32Array {
    const from = Math.round(fromTime * this.sampleRate)
    const to = Math.round(toTime * this.sampleRate)
    const out = new Float32Array(Math.max(0, to - from))
    for (const c of this.chunks) {
      const a = Math.max(from, c.frame)
      const b = Math.min(to, c.frame + c.samples.length)
      if (b > a) out.set(c.samples.subarray(a - c.frame, b - c.frame), a - from)
    }
    return out
  }

  /** Forget everything captured so far (e.g. when the student restarts a full-song take). */
  clear(): void {
    this.chunks = []
  }
}

/**
 * Song position ↔ AudioContext time. The <audio> stems keep their own clock,
 * so the session records (ctxTime, songMs) pairs while playing and converts
 * by interpolating between the nearest pairs.
 */
export class SongClock {
  private pairs: Array<{ t: number; ms: number }> = []

  mark(ctxTime: number, songMs: number): void {
    const last = this.pairs[this.pairs.length - 1]
    // A jump (seek / loop) starts a new segment: drop pairs that would interpolate across it.
    if (last && (songMs < last.ms - 50 || songMs - last.ms > (ctxTime - last.t) * 1000 * 2 + 200)) this.pairs = []
    this.pairs.push({ t: ctxTime, ms: songMs })
    if (this.pairs.length > 4000) this.pairs.splice(0, 1000)
  }

  reset(): void {
    this.pairs = []
  }

  /** AudioContext time at which the song was at `songMs` (null when unknown). */
  timeAt(songMs: number): number | null {
    const p = this.pairs
    if (p.length < 2) return null
    let i = p.findIndex((x) => x.ms >= songMs)
    if (i === -1) i = p.length - 1
    if (i === 0) i = 1
    const a = p[i - 1]!
    const b = p[i]!
    if (b.ms === a.ms) return a.t
    return a.t + ((songMs - a.ms) / (b.ms - a.ms)) * (b.t - a.t)
  }
}

/** Mono WAV (16-bit) of a recording; 48 kHz input is halved to 24 kHz (integer factors only, so 44.1 kHz stays). */
export function encodeTake(samples: Float32Array, sampleRate: number): { blob: Blob; sampleRate: number } {
  const factor = Math.max(1, Math.floor(sampleRate / 24000))
  const rate = sampleRate / factor
  const n = Math.floor(samples.length / factor)
  const pcm = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let k = 0; k < factor; k++) s += samples[i * factor + k]!
    pcm[i] = Math.max(-1, Math.min(1, s / factor)) * 32767
  }
  const header = new ArrayBuffer(44)
  const v = new DataView(header)
  const w = (o: number, str: string) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  w(0, 'RIFF')
  v.setUint32(4, 36 + pcm.byteLength, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  w(36, 'data')
  v.setUint32(40, pcm.byteLength, true)
  return { blob: new Blob([header, pcm.buffer], { type: 'audio/wav' }), sampleRate: rate }
}

/** Ratio of energy (0–1) a recording shares with the backing at the same moments: a hint that the backing leaked in. */
export function leakHint(voice: Float32Array, backing: Float32Array): number {
  const n = Math.min(voice.length, backing.length)
  if (!n) return 0
  let vb = 0
  let vv = 0
  let bb = 0
  for (let i = 0; i < n; i += 4) {
    vb += voice[i]! * backing[i]!
    vv += voice[i]! * voice[i]!
    bb += backing[i]! * backing[i]!
  }
  return vv && bb ? Math.abs(vb) / Math.sqrt(vv * bb) : 0
}
