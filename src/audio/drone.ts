import * as Tone from 'tone'
import { ensureAudio } from './engine'

/**
 * 持续音：一直响着的主音（加上方五度），在上面唱级数用。柔和的三角波，
 * 音量低于参考音，不盖住自己的声音。同一时间只有一个。
 */
let synth: Tone.PolySynth | null = null
let playing: string[] = []

export async function startDrone(midis: readonly number[], volumeDb = -16): Promise<void> {
  await ensureAudio()
  stopDrone()
  if (!synth) {
    synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.4, decay: 0.2, sustain: 0.9, release: 0.8 },
    }).toDestination()
  }
  synth.volume.value = volumeDb
  playing = midis.map((m) => Tone.Frequency(m, 'midi').toNote())
  synth.triggerAttack(playing)
}

export function stopDrone(): void {
  if (synth && playing.length) synth.triggerRelease(playing)
  playing = []
}

export function droneActive(): boolean {
  return playing.length > 0
}
