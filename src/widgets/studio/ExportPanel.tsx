import { useState } from 'react'
import { FileAudio, FileCode2, FileMusic, Loader2 } from 'lucide-react'
import { writeMidi } from '@/export/midi'
import { writeMusicXml } from '@/export/musicxml'
import { renderWav } from '@/export/wav'
import { downloadFile, safeFileName } from '@/export/download'
import { ensureTracks } from '@/music/arrangement'
import type { Score } from '@/music/score'
import { toast } from '@/features/toast/toastStore'
import { Button } from '@/shared/ui/Button'

/** Export the current song as MIDI, MusicXML or WAV. Everything is generated in the browser. */
export function ExportPanel({ score, title, onExported }: { score: Score; title: string; onExported?: () => void }) {
  const [rendering, setRendering] = useState(false)
  const name = safeFileName(title)
  const seconds = Math.round((score.bars * score.beatsPerBar * 60) / score.bpm)
  const tracks = ensureTracks(score).filter((t) => !t.mute)

  const wav = async () => {
    setRendering(true)
    try {
      const bytes = await renderWav(score)
      downloadFile(`${name}.wav`, bytes, 'audio/wav')
      onExported?.()
    } catch (e) {
      toast({ title: 'WAV 渲染失败', description: e instanceof Error ? e.message : '请稍后再试，或先导出 MIDI。', variant: 'error' })
    } finally {
      setRendering(false)
    }
  }

  const items = [
    {
      icon: FileMusic,
      title: 'MIDI',
      ext: '.mid',
      body: `每一轨单独一条（共 ${tracks.length + (score.melody.length ? 1 : 0)} 轨），带速度、调号和歌词。可以拖进任何编曲软件（库乐队、Logic、FL Studio、Cubase）继续做。`,
      action: () => {
        downloadFile(`${name}.mid`, writeMidi(score, title), 'audio/midi')
        onExported?.()
      },
      busy: false,
    },
    {
      icon: FileCode2,
      title: 'MusicXML',
      ext: '.musicxml',
      body: '主旋律 + 和弦名 + 歌词的旋律谱（lead sheet），以及贝斯声部。可以用 MuseScore、Sibelius、Finale 打开、排版、打印。',
      action: () => {
        downloadFile(`${name}.musicxml`, writeMusicXml(score, title), 'application/vnd.recordare.musicxml+xml')
        onExported?.()
      },
      busy: false,
    },
    {
      icon: FileAudio,
      title: 'WAV 音频',
      ext: '.wav',
      body: `用和播放时一样的音色离线渲染，约 ${seconds} 秒，16 位立体声。可以直接发给朋友听。`,
      action: () => void wav(),
      busy: rendering,
    },
  ]

  return (
    <div className="grid grid-cols-3 gap-4">
      {items.map(({ icon: Icon, title: t, ext, body, action, busy }) => (
        <div key={t} className="flex flex-col rounded-2xl border border-border/80 bg-card p-5 surface-gradient">
          <Icon className="h-6 w-6 text-amber" />
          <div className="mt-3 font-display text-lg font-semibold">
            {t} <span className="font-mono text-xs text-muted-foreground">{ext}</span>
          </div>
          <p className="mt-1 flex-1 text-sm leading-6 text-muted-foreground">{body}</p>
          <Button className="mt-4" onClick={action} disabled={busy || (!score.melody.length && !score.chords.length)}>
            {busy ? <Loader2 className="animate-spin" /> : null} {busy ? '渲染中…' : `导出 ${t}`}
          </Button>
        </div>
      ))}
    </div>
  )
}
