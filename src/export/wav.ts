import * as Tone from 'tone'
import { arrangementEvents, ensureTracks } from '@/music/arrangement'
import type { Score } from '@/music/score'
import { buildRig, scheduleOnRig } from '@/audio/rig'
import { loadPianoBank, makeSampler } from '@/audio/piano'

/** 16-bit PCM WAV from channel data (pure, testable). */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const numCh = channels.length
  const length = channels[0]?.length ?? 0
  const dataBytes = length * numCh * 2
  const buf = new ArrayBuffer(44 + dataBytes)
  const v = new DataView(buf)
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  v.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, numCh, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * numCh * 2, true)
  v.setUint16(32, numCh * 2, true)
  v.setUint16(34, 16, true)
  ascii(36, 'data')
  v.setUint32(40, dataBytes, true)
  let o = 44
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numCh; c++) {
      const x = Math.max(-1, Math.min(1, channels[c]![i]!))
      v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true)
      o += 2
    }
  }
  return new Uint8Array(buf)
}

/**
 * Render the arrangement offline with the same instruments as playback.
 * A gentle limiter keeps the mix from clipping.
 */
export async function renderWav(score: Score, sampleRate = 44100): Promise<Uint8Array> {
  const tracks = ensureTracks(score)
  const seconds = (score.bars * score.beatsPerBar * 60) / score.bpm + 2.5
  const bank = await loadPianoBank()
  const buffer = await Tone.Offline(async () => {
    const limiter = new Tone.Limiter(-1).toDestination()
    const sampler = bank ? makeSampler(bank, 1.2) : null
    const rig = buildRig(score, tracks, limiter, sampler)
    scheduleOnRig(rig, arrangementEvents({ ...score, tracks }), score.bpm, 0.05)
  }, seconds, 2, sampleRate)
  const audio = buffer.get()
  if (!audio) throw new Error('渲染失败：没有得到音频数据。')
  const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c))
  return encodeWav(channels, audio.sampleRate)
}
