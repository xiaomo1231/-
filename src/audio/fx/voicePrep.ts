/**
 * Voice processing that happens before the effect chain (offline, on the
 * buffer): phrase-by-phrase level riding, then pitch correction. Shared by
 * the 跟唱 desk and the 后期课堂. Cached per (buffer, settings).
 */
import type { MixSettings } from '@/songs/singTypes'
import { rideLevels, type PhraseSpan } from './autoLevel'
import { correctPitch, scalePitchClasses } from './pitchCorrect'

const cache = new WeakMap<AudioBuffer, Map<string, AudioBuffer>>()

/** The key of everything that changes the prepared voice. */
export function prepKey(m: MixSettings): string {
  const { autoLevel, tune } = m.vocal
  return JSON.stringify([autoLevel.on && [autoLevel.strength, autoLevel.phraseDb], tune.on && [tune.amount, tune.speedMs, tune.scale, tune.keyTonic, tune.mode]])
}

export function needsPrep(m: MixSettings): boolean {
  return m.vocal.autoLevel.on || m.vocal.tune.on
}

/** The voice as the chain should receive it (the same buffer when nothing applies). */
export async function prepareVoice(voice: AudioBuffer, m: MixSettings, phrases: readonly PhraseSpan[]): Promise<AudioBuffer> {
  if (!needsPrep(m)) return voice
  const key = prepKey(m)
  const hit = cache.get(voice)?.get(key)
  if (hit) return hit
  // Yield first so a spinner can show; the work itself is synchronous.
  await new Promise((r) => setTimeout(r, 0))
  const rate = voice.sampleRate
  const channels: Float32Array[] = []
  for (let c = 0; c < voice.numberOfChannels; c++) {
    let x: Float32Array = voice.getChannelData(c)
    if (m.vocal.autoLevel.on) x = rideLevels(x, rate, phrases, m.vocal.autoLevel.strength, m.vocal.autoLevel.phraseDb).samples
    if (m.vocal.tune.on) {
      const t = m.vocal.tune
      x = correctPitch(x, rate, { amount: t.amount, speedMs: t.speedMs, ...(t.scale === 'key' ? { scale: scalePitchClasses(t.keyTonic, t.mode) } : {}) })
    }
    channels.push(x)
  }
  const ctx = new OfflineAudioContext(channels.length, Math.max(1, voice.length), rate)
  const out = ctx.createBuffer(channels.length, Math.max(1, voice.length), rate)
  channels.forEach((x, i) => out.copyToChannel(x as Float32Array<ArrayBuffer>, i))
  let byKey = cache.get(voice)
  if (!byKey) cache.set(voice, (byKey = new Map()))
  byKey.set(key, out)
  if (byKey.size > 6) byKey.delete(byKey.keys().next().value!)
  return out
}
