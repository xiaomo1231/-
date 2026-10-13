import * as Tone from 'tone'
import type { SingTake } from '@/entities/types'

/**
 * Plays recorded takes in the shared audio context (one at a time), with a
 * small decode cache.
 */
const cache = new Map<string, AudioBuffer>()
let current: AudioBufferSourceNode | null = null

export async function takeBuffer(take: SingTake): Promise<AudioBuffer | null> {
  if (!take.audio) return null
  const hit = cache.get(take.id)
  if (hit) return hit
  const ctx = Tone.getContext().rawContext as AudioContext
  try {
    const buf = await ctx.decodeAudioData(await take.audio.arrayBuffer())
    cache.set(take.id, buf)
    if (cache.size > 40) cache.delete(cache.keys().next().value!)
    return buf
  } catch {
    return null
  }
}

/**
 * Play a decoded take from `offsetSec`, starting at AudioContext time `when`
 * (default: now); resolves when it ends or is stopped.
 */
export function playBuffer(buf: AudioBuffer, offsetSec = 0, durationSec?: number, when = 0): Promise<void> {
  stopTake()
  const ctx = Tone.getContext().rawContext as AudioContext
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(ctx.destination)
  current = src
  return new Promise((resolve) => {
    src.onended = () => {
      if (current === src) current = null
      resolve()
    }
    src.start(when, Math.max(0, offsetSec), durationSec)
  })
}

/** Context time now (for scheduling a take against another clock). */
export function audioNow(): number {
  return (Tone.getContext().rawContext as AudioContext).currentTime
}

export function stopTake(): void {
  try {
    current?.stop()
  } catch {
    // already stopped
  }
  current = null
}
