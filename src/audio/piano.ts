import * as Tone from 'tone'

/**
 * Bundled piano: Salamander Grand Piano (Alexander Holm, CC-BY 3.0), one
 * sample every minor third from C1 to A6, served from public/audio/piano/ and
 * precached by the service worker, so it works offline.
 *
 * The buffers load once per page. Samplers for drills, playback and WAV export
 * are all built from the same buffers. Loudness is evened out once at load
 * (each sample scaled toward the same peak), so low notes are not dull and
 * high notes not harsh.
 */

export interface PianoSample {
  /** Tone note name used as the Sampler key, e.g. "D#3". */
  note: string
  file: string
  midi: number
}

const STEPS = [
  { name: 'C', file: 'C', pc: 0 },
  { name: 'D#', file: 'Ds', pc: 3 },
  { name: 'F#', file: 'Fs', pc: 6 },
  { name: 'A', file: 'A', pc: 9 },
] as const

export const PIANO_SAMPLES: readonly PianoSample[] = [1, 2, 3, 4, 5, 6].flatMap((oct) =>
  STEPS.map((s) => ({ note: `${s.name}${oct}`, file: `${s.file}${oct}.mp3`, midi: 12 * (oct + 1) + s.pc })),
)

export const PIANO_CREDIT = '钢琴采样：Salamander Grand Piano，Alexander Holm 录制，CC-BY 3.0 许可。'

export function pianoBaseUrl(): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/'
  return `${base.endsWith('/') ? base : base + '/'}audio/piano/`
}

/** The sample closest to `midi` (ties go to the lower sample, which sounds more natural pitched up). */
export function nearestSample(midi: number): PianoSample {
  let best = PIANO_SAMPLES[0]!
  for (const s of PIANO_SAMPLES) {
    if (Math.abs(s.midi - midi) < Math.abs(best.midi - midi)) best = s
  }
  return best
}

/**
 * Pitch-comparison playback: every note is the SAME recording, re-pitched, so
 * the interval between notes is exactly what the question asks even when the
 * recorded samples are a few cents out of tune with each other. Returns the
 * shared sample and each note's playback rate. Pure.
 */
export function sameSamplePlan(notes: ReadonlyArray<{ midi: number; detuneCents?: number }>): { sample: PianoSample; rates: number[] } {
  const exact = notes.map((n) => n.midi + (n.detuneCents ?? 0) / 100)
  const centre = (Math.min(...exact) + Math.max(...exact)) / 2
  const sample = nearestSample(Math.round(centre))
  return { sample, rates: exact.map((m) => Math.pow(2, (m - sample.midi) / 12)) }
}

/** Gain that brings a sample with this peak to the target peak, limited to ±6 dB. Pure. */
export function levelGain(peak: number, target = 0.5): number {
  if (!(peak > 0)) return 1
  return Math.min(2, Math.max(0.5, target / peak))
}

export type PianoStatus = 'idle' | 'loading' | 'ready' | 'failed'

export interface PianoBank {
  buffers: Map<string, Tone.ToneAudioBuffer>
}

let bank: PianoBank | null = null
let loading: Promise<PianoBank | null> | null = null
let status: PianoStatus = 'idle'
const listeners = new Set<(s: PianoStatus) => void>()

function setStatus(s: PianoStatus) {
  status = s
  listeners.forEach((l) => l(s))
}

export function pianoStatus(): PianoStatus {
  return status
}

export function onPianoStatus(cb: (s: PianoStatus) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function pianoBank(): PianoBank | null {
  return bank
}

async function loadOne(s: PianoSample): Promise<[string, Tone.ToneAudioBuffer]> {
  const buf = await new Tone.ToneAudioBuffer().load(pianoBaseUrl() + s.file)
  const audio = buf.get()
  if (audio) {
    let peak = 0
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const d = audio.getChannelData(c)
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]!))
    }
    const g = levelGain(peak)
    if (g !== 1) {
      for (let c = 0; c < audio.numberOfChannels; c++) {
        const d = audio.getChannelData(c)
        for (let i = 0; i < d.length; i++) d[i] = d[i]! * g
      }
    }
  }
  return [s.note, buf]
}

/** Load the bundled samples (once). Resolves null when they cannot be loaded. */
export function loadPianoBank(): Promise<PianoBank | null> {
  if (bank) return Promise.resolve(bank)
  if (loading) return loading
  setStatus('loading')
  loading = Promise.all(PIANO_SAMPLES.map(loadOne))
    .then((entries) => {
      bank = { buffers: new Map(entries) }
      setStatus('ready')
      return bank
    })
    .catch(() => {
      setStatus('failed')
      return null
    })
    .finally(() => {
      loading = null
    })
  return loading
}

/** A sampler on the shared buffers. Drills use a short release so notes do not run into the next question. */
export function makeSampler(b: PianoBank, release: number): Tone.Sampler {
  const urls: Record<string, Tone.ToneAudioBuffer> = {}
  for (const [note, buf] of b.buffers) urls[note] = buf
  return new Tone.Sampler({ urls, release })
}

/** Play notes from one shared recording, re-pitched (see sameSamplePlan). */
export function playSameSample(
  b: PianoBank,
  out: Tone.InputNode,
  notes: ReadonlyArray<{ midi: number; detuneCents?: number; at: number; duration: number; velocity?: number }>,
  startAt: number,
  release = 0.4,
): void {
  const { sample, rates } = sameSamplePlan(notes)
  const buffer = b.buffers.get(sample.note)
  if (!buffer) return
  notes.forEach((n, i) => {
    const gain = new Tone.Gain(n.velocity ?? 0.9).connect(out)
    const src = new Tone.ToneBufferSource({ url: buffer, playbackRate: rates[i]!, fadeOut: release, curve: 'exponential' }).connect(gain)
    const t = startAt + n.at
    src.onended = () => {
      src.dispose()
      gain.dispose()
    }
    src.start(t)
    src.stop(t + n.duration)
  })
}
