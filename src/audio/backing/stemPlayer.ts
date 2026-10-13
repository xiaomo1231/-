/**
 * Plays a recording's stems together, following an external clock (the sheet
 * player). Each stem is an <audio> element: the browser keeps the pitch when
 * the speed changes (preservesPitch), and the element can be routed to the
 * output device chosen in settings.
 */
import { inputManager } from '@/audio/input/inputManager'
import { OnsetDetector } from '@/audio/onset/onset'
import type { StemKind, StemMix } from '@/songs/backingSync'

/** Correct drift when the audio is this far from where the sheet says it should be. */
export const RESYNC_MS = 70

interface Voice {
  stem: StemKind
  el: HTMLAudioElement
  url: string
  /** A play() is in flight: seeking or calling play() again now would abort it. */
  starting: boolean
}

type SinkAudio = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void>; preservesPitch?: boolean }

export class StemPlayer {
  private voices: Voice[] = []
  private master = 1
  private playing = false

  constructor(stems: ReadonlyArray<{ stem: StemKind; blob: Blob }>) {
    for (const s of stems) {
      const url = URL.createObjectURL(s.blob)
      const el = new Audio(url) as SinkAudio
      el.preload = 'auto'
      el.preservesPitch = true
      const sink = inputManager.outputId
      if (sink && typeof el.setSinkId === 'function') void el.setSinkId(sink).catch(() => undefined)
      this.voices.push({ stem: s.stem, el, url, starting: false })
    }
  }

  get duration(): number {
    return Math.max(0, ...this.voices.map((v) => (Number.isFinite(v.el.duration) ? v.el.duration * 1000 : 0)))
  }

  setMix(mix: Partial<Record<StemKind, StemMix>>, master = this.master): void {
    this.master = master
    for (const v of this.voices) {
      const m = mix[v.stem] ?? { volume: 1, muted: false }
      // Muting by volume: Chrome may pause an off-page element that is muted.
      v.el.volume = m.muted ? 0 : Math.max(0, Math.min(1, m.volume * master))
    }
  }

  setRate(rate: number): void {
    for (const v of this.voices) v.el.playbackRate = rate
  }

  /** Current position of the recording, ms (first stem). */
  positionMs(): number {
    const v = this.voices[0]
    return v ? v.el.currentTime * 1000 : 0
  }

  /** Play from `ms` (clamped to the start). */
  play(ms: number): void {
    this.seek(ms)
    this.playing = true
    for (const v of this.voices) this.start(v)
  }

  private start(v: Voice): void {
    if (v.starting) return
    v.starting = true
    void v.el
      .play()
      .catch(() => undefined)
      .finally(() => {
        v.starting = false
      })
  }

  pause(): void {
    this.playing = false
    for (const v of this.voices) v.el.pause()
  }

  seek(ms: number): void {
    const t = Math.max(0, ms / 1000)
    for (const v of this.voices) {
      if (Math.abs(v.el.currentTime - t) > 0.005) v.el.currentTime = t
    }
  }

  /** Seek and wait until every stem has the new position ready (or `timeoutMs` passes). */
  async seekReady(ms: number, timeoutMs = 1500): Promise<void> {
    const t = Math.max(0, ms / 1000)
    await Promise.all(
      this.voices.map(
        (v) =>
          new Promise<void>((resolve) => {
            const move = Math.abs(v.el.currentTime - t) > 0.005
            if (!move && v.el.readyState >= 3) return resolve()
            const event = move ? 'seeked' : 'canplay'
            const done = () => {
              clearTimeout(timer)
              v.el.removeEventListener(event, done)
              resolve()
            }
            const timer = setTimeout(done, timeoutMs)
            v.el.addEventListener(event, done)
            if (move) v.el.currentTime = t
          }),
      ),
    )
  }

  /** Resolves once the stems are really moving (the clock advanced), or after `timeoutMs`. */
  async whenRunning(timeoutMs = 1500): Promise<void> {
    const v = this.voices[0]
    if (!v) return
    const from = v.el.currentTime
    const t0 = performance.now()
    while (performance.now() - t0 < timeoutMs) {
      if (!v.el.paused && v.el.currentTime > from + 0.001) return
      await new Promise((r) => setTimeout(r, 5))
    }
  }

  /** Called on every sheet position update while playing: keep stems where the sheet says (and together). */
  follow(targetMs: number): void {
    if (!this.playing) return
    if (targetMs < 0) {
      for (const v of this.voices) if (!v.el.paused) v.el.pause()
      return
    }
    for (const v of this.voices) {
      if (v.starting) continue
      if (v.el.paused) {
        v.el.currentTime = targetMs / 1000
        this.start(v)
      } else if (Math.abs(v.el.currentTime * 1000 - targetMs) > RESYNC_MS) {
        v.el.currentTime = targetMs / 1000
      }
    }
  }

  get isPlaying(): boolean {
    return this.playing
  }

  destroy(): void {
    this.pause()
    for (const v of this.voices) {
      v.el.removeAttribute('src')
      v.el.load()
      URL.revokeObjectURL(v.url)
    }
    this.voices = []
  }
}

/**
 * Time of the first clear sound in a recording, ms (for aligning the sheet's
 * first note). Decodes up to the first minute and runs the onset detector.
 * Null when nothing clear is found.
 */
export async function firstSoundMs(blob: Blob): Promise<number | null> {
  const ctx = new OfflineAudioContext(1, 44100, 44100)
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
  const len = Math.min(buf.length, buf.sampleRate * 60)
  const mono = new Float32Array(len)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < len; i++) mono[i]! += d[i]! / buf.numberOfChannels
  }
  let peak = 0
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(mono[i]!))
  if (peak < 1e-4) return null
  // Normalise so the level floor is relative to this recording.
  for (let i = 0; i < len; i++) mono[i] = mono[i]! / peak
  const onsets = new OnsetDetector(buf.sampleRate, 'mic', { floorDb: -30 }).feed(mono, 0)
  return onsets.length ? Math.round(onsets[0]!.time * 1000) : null
}
