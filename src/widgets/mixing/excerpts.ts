/**
 * 后期课堂 playback of rendered excerpts: render a stretch of lesson material
 * with given settings (offline, the same chain as the desk), optionally at
 * matched loudness, and play one excerpt at a time.
 */
import * as Tone from 'tone'
import { renderMix } from '@/audio/sing/mixChain'
import { integratedLufs } from '@/audio/fx/loudness'
import type { MixSettings } from '@/songs/singTypes'
import type { LessonAudio } from '@/mixing/material'
import { BPM, MATERIAL_RATE } from '@/mixing/material'

export interface Excerpt {
  channels: Float32Array[]
  rate: number
  lufs: number
}

export async function renderExcerpt(audio: LessonAudio, mix: MixSettings, region: { start: number; end: number }): Promise<Excerpt> {
  const channels = await renderMix({ voice: audio.voice, backing: audio.backing, backingNames: audio.backingNames, mix, bpm: BPM, region, sampleRate: MATERIAL_RATE })
  return { channels, rate: MATERIAL_RATE, lufs: integratedLufs(channels, MATERIAL_RATE) }
}

/** Gains (linear) that bring every excerpt to the quietest one's loudness. */
export function matchGains(xs: readonly Excerpt[]): number[] {
  const finite = xs.map((x) => x.lufs).filter((l) => Number.isFinite(l))
  if (!finite.length) return xs.map(() => 1)
  const target = Math.min(...finite)
  return xs.map((x) => (Number.isFinite(x.lufs) ? Math.pow(10, (target - x.lufs) / 20) : 1))
}

let current: AudioBufferSourceNode | null = null
let token = 0

export function stopExcerpt(): void {
  token++
  try {
    current?.stop()
  } catch {
    // already stopped
  }
  current = null
}

/** Play an excerpt; resolves when it ends or is stopped (false when stopped). */
export async function playExcerpt(x: Excerpt, gain = 1): Promise<boolean> {
  stopExcerpt()
  const my = ++token
  await Tone.start()
  const ctx = Tone.getContext().rawContext as AudioContext
  const buf = ctx.createBuffer(x.channels.length, x.channels[0]?.length ?? 1, x.rate)
  x.channels.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i))
  const src = ctx.createBufferSource()
  src.buffer = buf
  const g = ctx.createGain()
  g.gain.value = gain
  src.connect(g).connect(ctx.destination)
  current = src
  return new Promise((resolve) => {
    src.onended = () => {
      if (current === src) current = null
      resolve(my === token)
    }
    src.start()
  })
}
