/**
 * Voice processing that happens before the effect chain (offline, on the
 * buffer): phrase-by-phrase level riding, then pitch correction. Shared by
 * the 跟唱 desk and the 后期课堂. Cached per (buffer, settings).
 */
import type { MixSettings } from '@/songs/singTypes'
import { rideLevels, type PhraseSpan } from './autoLevel'
import { correctPitch, emptyStats, scalePitchClasses, type TuneStats } from './pitchCorrect'
import type { RefNote } from '@/songs/singAlong'

const cache = new WeakMap<AudioBuffer, Map<string, AudioBuffer>>()
const statsCache = new WeakMap<AudioBuffer, Map<string, TuneStats>>()

/** How far around a moment to look for the original's note (singers come in a little early or late), ms. */
const REF_WINDOW_MS = 150

/**
 * Target lookup for "按原唱音高对齐": the original's note sounding within
 * ±150 ms (the one closest to what was sung), moved to the student's own
 * octave. Where the original has no note: leave it, or the nearest semitone.
 */
export function referenceTarget(notes: readonly RefNote[], gaps: 'keep' | 'nearest'): (ms: number, centre: number) => number | null {
  const sorted = [...notes].sort((a, b) => a.startMs - b.startMs)
  const starts = sorted.map((n) => n.startMs)
  return (ms, centre) => {
    // first note that could still be sounding at ms − window
    let lo = 0
    let hi = starts.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (starts[mid]! < ms - REF_WINDOW_MS - 4000) lo = mid + 1
      else hi = mid
    }
    let best: number | null = null
    for (let i = lo; i < sorted.length && sorted[i]!.startMs <= ms + REF_WINDOW_MS; i++) {
      const n = sorted[i]!
      if (n.endMs < ms - REF_WINDOW_MS) continue
      const folded = n.midi + 12 * Math.round((centre - n.midi) / 12)
      if (best === null || Math.abs(folded - centre) < Math.abs(best - centre)) best = folded
    }
    if (best !== null) return best
    return gaps === 'nearest' ? Math.round(centre) : null
  }
}

/** What the last pitch correction of this voice with these settings did (null before it ran). */
export function prepStats(voice: AudioBuffer | null, m: MixSettings): TuneStats | null {
  return voice ? (statsCache.get(voice)?.get(prepKey(m)) ?? null) : null
}

/** The key of everything that changes the prepared voice. */
export function prepKey(m: MixSettings): string {
  const { autoLevel, tune } = m.vocal
  return JSON.stringify([autoLevel.on && [autoLevel.strength, autoLevel.phraseDb], tune.on && [tune.amount, tune.speedMs, tune.scale, tune.keyTonic, tune.mode, tune.range, tune.gaps]])
}

export function needsPrep(m: MixSettings): boolean {
  return m.vocal.autoLevel.on || m.vocal.tune.on
}

/** The voice as the chain should receive it (the same buffer when nothing applies). */
export async function prepareVoice(voice: AudioBuffer, m: MixSettings, phrases: readonly PhraseSpan[], refNotes?: readonly RefNote[]): Promise<AudioBuffer> {
  if (!needsPrep(m)) return voice
  const key = prepKey(m)
  const hit = cache.get(voice)?.get(key)
  if (hit) return hit
  // Yield first so a spinner can show; the work itself is synchronous.
  await new Promise((r) => setTimeout(r, 0))
  const rate = voice.sampleRate
  const channels: Float32Array[] = []
  const stats = emptyStats()
  for (let c = 0; c < voice.numberOfChannels; c++) {
    let x: Float32Array = voice.getChannelData(c)
    if (m.vocal.autoLevel.on) x = rideLevels(x, rate, phrases, m.vocal.autoLevel.strength, m.vocal.autoLevel.phraseDb).samples
    if (m.vocal.tune.on) {
      const t = m.vocal.tune
      const byRef = t.scale === 'reference' && refNotes?.length
      x = correctPitch(x, rate, {
        amount: t.amount,
        speedMs: t.speedMs,
        stats,
        ...(t.scale === 'key' ? { scale: scalePitchClasses(t.keyTonic, t.mode) } : {}),
        ...(byRef ? { target: referenceTarget(refNotes, t.gaps), maxShift: t.range } : {}),
      })
    }
    channels.push(x)
  }
  const ctx = new OfflineAudioContext(channels.length, Math.max(1, voice.length), rate)
  const out = ctx.createBuffer(channels.length, Math.max(1, voice.length), rate)
  channels.forEach((x, i) => out.copyToChannel(x as Float32Array<ArrayBuffer>, i))
  let byKey = cache.get(voice)
  if (!byKey) cache.set(voice, (byKey = new Map()))
  byKey.set(key, out)
  let st = statsCache.get(voice)
  if (!st) statsCache.set(voice, (st = new Map()))
  st.set(key, stats)
  if (byKey.size > 6) byKey.delete(byKey.keys().next().value!)
  return out
}
