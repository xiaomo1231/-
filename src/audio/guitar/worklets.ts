import * as Tone from 'tone'
import { WORKLET_SOURCE } from './dsp'

/**
 * Create a worklet node in Tone's context. Tone's rawContext is a
 * standardized-audio-context wrapper, not a native AudioContext, so the
 * native `new AudioWorkletNode(ctx, …)` throws ("parameter 1 is not of type
 * 'BaseAudioContext'"); Tone's factory builds the matching node. The module
 * must be registered first with ensureWorklets(Tone.getContext().rawContext).
 */
export function createWorkletNode(name: string, options?: Partial<AudioWorkletNodeOptions>): AudioWorkletNode {
  return Tone.getContext().createAudioWorkletNode(name, options)
}

const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>()

/**
 * Register the audio-thread modules (noise gate, capture tap) once per
 * context. Resolves false when the browser cannot load them; callers then
 * fall back (the gate is bypassed, onset detection uses the analyser).
 */
export function ensureWorklets(ctx: BaseAudioContext): Promise<boolean> {
  let p = loaded.get(ctx)
  if (!p) {
    p = (async () => {
      if (!ctx.audioWorklet) return false
      const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }))
      try {
        await ctx.audioWorklet.addModule(url)
        return true
      } catch {
        return false
      } finally {
        URL.revokeObjectURL(url)
      }
    })()
    loaded.set(ctx, p)
  }
  return p
}
