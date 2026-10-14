/**
 * The audio-thread host 'groove-aw': runs one Airwindows effect (by name,
 * from processorOptions) on a stereo signal. Parameters arrive through
 * processorOptions (offline renders) and port messages (live changes).
 * Bundled by Vite as its own script (`?worker&url`) and loaded with
 * audioWorklet.addModule.
 */
import { AIRWINDOWS, type AirwindowsName } from './registry'
import type { AirwindowsEffect } from './types'

declare const sampleRate: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, ctor: unknown): void

interface Options {
  processorOptions?: { effect: AirwindowsName; params: number[] }
}

const BLOCK = 128

class GrooveAirwindows extends AudioWorkletProcessor {
  private fx: AirwindowsEffect | null
  private name: AirwindowsName | null
  private l = new Float32Array(BLOCK)
  private r = new Float32Array(BLOCK)

  constructor(options: Options) {
    super()
    const o = options.processorOptions
    const info = o ? AIRWINDOWS[o.effect] : undefined
    this.fx = info ? info.create(sampleRate) : null
    this.name = info ? o!.effect : null
    if (o && this.fx) this.fx.setParams(o.params)
    this.port.onmessage = (
      e: MessageEvent<{ effect?: AirwindowsName; params?: number[]; reset?: boolean }>,
    ) => {
      // A different plugin (e.g. plate → hall): a fresh instance.
      const want = e.data.effect
      if (want && want !== this.name && AIRWINDOWS[want]) {
        this.fx = AIRWINDOWS[want].create(sampleRate)
        this.name = want
      }
      if (e.data.params) this.fx?.setParams(e.data.params)
      if (e.data.reset) this.fx?.reset()
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0] ?? []
    const out = outputs[0]!
    const n = out[0]?.length ?? BLOCK
    if (this.l.length < n) {
      this.l = new Float32Array(n)
      this.r = new Float32Array(n)
    }
    const inL = input[0]
    const inR = input[1] ?? inL
    if (inL) {
      this.l.set(inL.subarray(0, n))
      this.r.set(inR!.subarray(0, n))
    } else {
      // No input connected: keep running so reverb tails ring out.
      this.l.fill(0, 0, n)
      this.r.fill(0, 0, n)
    }
    if (this.fx) this.fx.process(this.l, this.r, n)
    out[0]?.set(this.l.subarray(0, n))
    out[1]?.set(this.r.subarray(0, n))
    return true
  }
}

registerProcessor('groove-aw', GrooveAirwindows)
