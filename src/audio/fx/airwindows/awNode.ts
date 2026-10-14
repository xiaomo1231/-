/**
 * Loading the 'groove-aw' worklet (audio/fx/airwindows/awWorklet) into a
 * context, live or offline, and creating its nodes.
 */
import * as Tone from 'tone'
import workletUrl from './awWorklet.ts?worker&url'
import type { AirwindowsName } from './registry'

const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>()

/** Register 'groove-aw' in a context once. False when it cannot be loaded (the caller falls back to the 经典 sound). */
export function ensureAirwindows(ctx: BaseAudioContext): Promise<boolean> {
  let p = loaded.get(ctx)
  if (!p) {
    p = (async () => {
      if (!ctx.audioWorklet) return false
      try {
        await ctx.audioWorklet.addModule(workletUrl)
        return true
      } catch {
        return false
      }
    })()
    loaded.set(ctx, p)
  }
  return p
}

/** A stereo node running `effect` with `params` (0–1, the plugin's order). */
export function makeAwNode(
  ctx: BaseAudioContext,
  effect: AirwindowsName,
  params: number[],
): AudioWorkletNode {
  const options: AudioWorkletNodeOptions = {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    processorOptions: { effect, params },
  }
  const tone = Tone.getContext()
  if ((tone.rawContext as unknown) === ctx) return tone.createAudioWorkletNode('groove-aw', options)
  return new AudioWorkletNode(ctx, 'groove-aw', options)
}

/** New parameters, and a different effect when it changed (the node keeps running). */
export const setAw = (n: AudioWorkletNode, effect: AirwindowsName, params: number[]) =>
  n.port.postMessage({ effect, params })
