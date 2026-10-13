/**
 * 后期工作台的实时预览：把人声与伴奏分片接到 buildMixGraph 的效果链上播放。
 * 图只在第一次播放时建立（同一个 Tone 上下文），之后参数通过 update 即时生效。
 */
import * as Tone from 'tone'
import { buildMixGraph, type MixGraph } from '@/audio/sing/mixChain'
import type { MixSettings } from '@/songs/singTypes'

export interface Region {
  start: number
  end: number
}

export interface Pass {
  mix: MixSettings
  label: string
}

const GAP_SEC = 0.4

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export class MixPlayer {
  private ctx: AudioContext | null = null
  private voiceIn: GainNode | null = null
  private backingIn: GainNode | null = null
  private graph: MixGraph | null = null
  private sources: AudioBufferSourceNode[] = []
  private voice: AudioBuffer | null = null
  private backing: AudioBuffer[] = []
  private bpm = 100
  private mix: MixSettings | null = null

  private playing = false
  private looping = false
  private loopRegion: Region | null = null
  /** Song position (s) at ctx time `startedAt`. */
  private startOffset = 0
  private startedAt = 0
  private pausedAt = 0
  /** Bumped to cancel pending excerpt passes and timers. */
  private gen = 0
  private excerptActive = false

  /** Total length of the song (longest stem), seconds. */
  total(): number {
    return Math.max(this.voice?.duration ?? 0, ...this.backing.map((b) => b.duration), 0)
  }

  setBuffers(voice: AudioBuffer | null, backing: AudioBuffer[]): void {
    if (voice === this.voice && backing === this.backing) return
    this.stop()
    this.voice = voice
    this.backing = backing
  }

  setBpm(bpm: number): void {
    this.bpm = bpm
    this.applyMix()
  }

  /** Update the live chain. Safe before the graph exists; applied when it is built. */
  setMix(m: MixSettings): void {
    this.mix = m
    if (!this.excerptActive) this.applyMix()
  }

  private applyMix(): void {
    if (this.graph && this.mix) this.graph.update(this.mix, this.bpm)
  }

  /** Builds the audio graph on first use. Must run from a user gesture. */
  private async ensure(): Promise<AudioContext> {
    await Tone.start()
    const ctx = Tone.getContext().rawContext as AudioContext
    if (!this.ctx || this.ctx !== ctx) {
      this.graph?.dispose()
      this.voiceIn?.disconnect()
      this.backingIn?.disconnect()
      this.ctx = ctx
      this.voiceIn = ctx.createGain()
      this.backingIn = ctx.createGain()
      this.graph = null
    }
    if (!this.graph && this.voiceIn && this.backingIn && this.mix) {
      this.graph = buildMixGraph(
        ctx,
        this.voiceIn,
        this.backingIn,
        ctx.destination,
        this.mix,
        this.bpm,
      )
    }
    return ctx
  }

  private stopSources(): void {
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {
        // already stopped
      }
      s.disconnect()
    }
    this.sources = []
  }

  /** Starts the stems at ctx time `when`, from song position `offset`, optionally for `duration` seconds. */
  private spawn(
    ctx: AudioContext,
    when: number,
    offset: number,
    duration?: number,
    loop?: Region | null,
  ): void {
    if (!this.voiceIn || !this.backingIn) return
    const make = (buffer: AudioBuffer, dest: AudioNode) => {
      const s = ctx.createBufferSource()
      s.buffer = buffer
      if (loop) {
        s.loop = true
        s.loopStart = loop.start
        s.loopEnd = loop.end
      }
      s.connect(dest)
      if (duration !== undefined) s.start(when, offset, duration)
      else s.start(when, offset)
      this.sources.push(s)
    }
    if (this.voice) make(this.voice, this.voiceIn)
    for (const b of this.backing) make(b, this.backingIn)
  }

  /** Song position in seconds. */
  position(): number {
    if (!this.playing || !this.ctx) return this.pausedAt
    const t = this.startOffset + (this.ctx.currentTime - this.startedAt)
    if (this.looping && this.loopRegion) {
      const { start, end } = this.loopRegion
      if (t < start || end <= start) return t
      return start + ((t - start) % (end - start))
    }
    const total = this.total()
    if (t >= total) {
      this.playing = false
      this.pausedAt = total
      this.stopSources()
      return total
    }
    return t
  }

  isPlaying(): boolean {
    return this.playing && this.position() < this.total() + 1e-3
  }

  /** Start (or restart) playback from `from`. `loop` loops that region (end must be > start). */
  async play(from: number, loop: Region | null): Promise<void> {
    const ctx = await this.ensure()
    this.gen++
    this.excerptActive = false
    this.stopSources()
    this.applyMix()
    const start = Math.min(Math.max(0, from), this.total())
    this.looping = !!loop && loop.end > loop.start
    this.loopRegion = this.looping ? loop : null
    this.startOffset = start
    this.startedAt = ctx.currentTime + 0.03
    this.playing = true
    this.spawn(ctx, this.startedAt, start, undefined, this.loopRegion)
  }

  pause(): void {
    if (!this.playing) return
    this.pausedAt = this.position()
    this.playing = false
    this.stopSources()
  }

  stop(): void {
    this.gen++
    this.excerptActive = false
    this.stopSources()
    this.playing = false
    this.pausedAt = 0
  }

  /** Move the playhead; restarts playback from there if it was playing. */
  async seek(to: number, loop: Region | null): Promise<void> {
    const t = Math.min(Math.max(0, to), this.total())
    if (this.playing) await this.play(t, loop)
    else this.pausedAt = t
  }

  /**
   * Plays `region` once per pass with a different mix each time (A/B), then restores
   * the live mix. `onPass` fires before each pass with its index.
   */
  async playPasses(
    region: Region,
    passes: Pass[],
    onPass?: (index: number) => void,
  ): Promise<void> {
    const ctx = await this.ensure()
    this.gen++
    const my = this.gen
    this.stopSources()
    this.playing = false
    this.excerptActive = true
    const dur = region.end - region.start
    try {
      for (let i = 0; i < passes.length; i++) {
        if (my !== this.gen) return
        const pass = passes[i]!
        onPass?.(i)
        this.graph?.update(pass.mix, this.bpm)
        this.stopSources()
        this.spawn(ctx, ctx.currentTime + 0.05, region.start, dur, null)
        await sleep((dur + 0.05 + GAP_SEC) * 1000)
      }
    } finally {
      if (my === this.gen) {
        this.stopSources()
        this.excerptActive = false
        this.applyMix()
      }
    }
  }

  /** Stop the excerpt (if any) and return to the live mix. */
  cancelPasses(): void {
    this.gen++
    this.stopSources()
    this.excerptActive = false
    this.applyMix()
  }

  reduction(): number {
    return this.graph?.reduction() ?? 0
  }

  meters(): MixGraph['meters'] | null {
    return this.graph?.meters ?? null
  }

  dispose(): void {
    this.gen++
    this.stopSources()
    this.playing = false
    this.graph?.dispose()
    this.graph = null
    this.voiceIn?.disconnect()
    this.backingIn?.disconnect()
    this.voiceIn = null
    this.backingIn = null
    this.ctx = null
  }
}
