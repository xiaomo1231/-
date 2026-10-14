import { getDb } from '@/infrastructure/db/database'
import { ANALYSIS_RATE, CURVE_VERSION, type PitchCurve } from '@/songs/singAlong'
import { analyzeReference } from '@/audio/pitch/referenceCurve'
import { desktop } from '@/app/desktop'

/**
 * The singer's pitch line for a vocals stem: computed once (decode at 16 kHz,
 * mono; RMVPE / SwiftF0 / YIN, see audio/pitch/referenceCurve) and cached in IndexedDB.
 * A line made without RMVPE is made again once the app can use RMVPE.
 */
export async function loadPitchCurve(
  fileId: string,
  onProgress?: (done: number) => void,
): Promise<PitchCurve> {
  const db = getDb()
  const cached = await db.pitchCurves.get(fileId)
  const method = cached?.method
  if (cached && cached.version === CURVE_VERSION && (method === 'rmvpe' || !desktop()))
    return { hop: cached.hop, midi: cached.midi }
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
  const { curve, method: made } = await analyzeReference(mono, onProgress)
  await db.pitchCurves.put({
    fileId,
    version: CURVE_VERSION,
    hop: curve.hop,
    midi: curve.midi,
    createdAt: Date.now(),
    method: made,
  })
  return curve
}
