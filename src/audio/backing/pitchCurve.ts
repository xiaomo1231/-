import { getDb } from '@/infrastructure/db/database'
import { ANALYSIS_RATE, CURVE_VERSION, extractCurve, type PitchCurve } from '@/songs/singAlong'

/**
 * The singer's pitch line for a vocals stem: computed once (decode at 16 kHz,
 * mono, YIN) and cached in IndexedDB.
 */
export async function loadPitchCurve(fileId: string, onProgress?: (done: number) => void): Promise<PitchCurve> {
  const db = getDb()
  const cached = await db.pitchCurves.get(fileId)
  if (cached && cached.version === CURVE_VERSION) return { hop: cached.hop, midi: cached.midi }
  const row = await db.audioFiles.get(fileId)
  if (!row) throw new Error('找不到人声轨的音频，请重新导入。')
  const ctx = new OfflineAudioContext(1, 1, ANALYSIS_RATE)
  let buf: AudioBuffer
  try {
    buf = await ctx.decodeAudioData(await row.blob.arrayBuffer())
  } catch {
    throw new Error('这个音频解码失败，可能格式不受支持。可以在 UVR 里导出成 wav 或 mp3 再试。')
  }
  const mono = new Float32Array(buf.length)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < buf.length; i++) mono[i]! += d[i]! / buf.numberOfChannels
  }
  const curve = await extractCurve(mono, onProgress, buf.sampleRate)
  await db.pitchCurves.put({ fileId, version: CURVE_VERSION, hop: curve.hop, midi: curve.midi, createdAt: Date.now() })
  return curve
}
