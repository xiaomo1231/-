import * as Tone from 'tone'
import { inputManager } from '@/audio/input/inputManager'
import { createWorkletNode, ensureWorklets } from '@/audio/guitar/worklets'
import { OnsetDetector, type Onset } from './onset'
import { AppError } from '@/infrastructure/errors/AppError'

/**
 * Live onset detection on the dry instrument input. An audio-thread tap
 * forwards raw sample blocks with their frame position, so onset times are
 * on the AudioContext clock (the same clock the metronome is scheduled on),
 * independent of main-thread jitter.
 */
export interface OnsetSession {
  /** Peak level of the last block, 0–1 (for meters). */
  level(): number
  stop(): void
}

export class OnsetUnavailableError extends AppError {}

export async function listenForOnsets(onOnset: (o: Onset) => void): Promise<OnsetSession> {
  const release = await inputManager.acquire('instrument')
  const ctx = Tone.getContext().rawContext as AudioContext
  if (!(await ensureWorklets(ctx))) {
    release()
    throw new OnsetUnavailableError('这个浏览器不能在音频线程里分析信号，无法判定节奏。请使用最新版电脑 Chrome。', 'ONSET_UNAVAILABLE')
  }
  const profile = inputManager.current?.kind ?? 'mic'
  const detector = new OnsetDetector(ctx.sampleRate, profile)
  const tap = createWorkletNode('groove-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
  // A silent path to the destination keeps the tap running.
  const sink = ctx.createGain()
  sink.gain.value = 0
  inputManager.bus.connect(tap)
  tap.connect(sink).connect(ctx.destination)
  let peak = 0
  tap.port.onmessage = (e: MessageEvent<{ frame: number; samples: Float32Array }>) => {
    const { frame, samples } = e.data
    let p = 0
    for (let i = 0; i < samples.length; i++) p = Math.max(p, Math.abs(samples[i]!))
    peak = Math.max(p, peak * 0.97)
    for (const o of detector.feed(samples, frame)) onOnset(o)
  }
  const offChange = inputManager.onChange(() => detector.reset())
  return {
    level: () => peak,
    stop() {
      offChange()
      tap.port.onmessage = null
      try {
        inputManager.bus.disconnect(tap)
      } catch {
        // already disconnected
      }
      tap.disconnect()
      sink.disconnect()
      release()
    },
  }
}
