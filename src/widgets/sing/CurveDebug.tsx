/**
 * 管理员调试信息 (0.27.0): how the original singer's line was made, under the
 * pitch lane (admin mode only), for reporting problems with a song.
 */
import { useEffect, useState } from 'react'
import { pitchCurveInfo } from '@/audio/backing/pitchCurve'
import type { PitchCurve, RefNote } from '@/songs/singAlong'
import { VOICE_BELOW_LOUD_DB, VOICE_CONFIDENCE } from '@/audio/pitch/referenceCurve'

const NAME: Record<string, string> = { rmvpe: 'RMVPE', swiftf0: 'SwiftF0', yin: 'YIN' }

export function CurveDebug({
  fileId,
  curve,
  notes,
}: {
  fileId: string
  curve: PitchCurve | null
  notes: readonly RefNote[]
}) {
  const [info, setInfo] = useState<{ method: string; version: number } | null>(null)
  useEffect(() => {
    let dead = false
    void pitchCurveInfo(fileId).then((i) => !dead && setInfo(i))
    return () => {
      dead = true
    }
  }, [fileId, curve])
  if (!curve) return null
  let voiced = 0
  for (const m of curve.midi) if (!Number.isNaN(m)) voiced++
  const seconds = curve.midi.length * curve.hop || 1
  return (
    <p className="num rounded-lg border border-dashed border-amber/50 px-2 py-1 text-[11px] text-muted-foreground">
      调试 · 原唱音高：
      {info ? `${NAME[info.method] ?? info.method}（曲线版本 ${info.version}）` : '…'} · 有声{' '}
      {Math.round((voiced / curve.midi.length) * 100)}% · 音符 {notes.length} 个（每秒{' '}
      {(notes.length / seconds).toFixed(1)}）· 门槛：置信度 &gt; {VOICE_CONFIDENCE}
      ，人声比最响处低不超过 {VOICE_BELOW_LOUD_DB} dB
    </p>
  )
}
