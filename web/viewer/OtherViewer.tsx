import type { ScoreFormat } from '@/songs/scoreLibraryTypes'
import { fileUrl } from '../lib/api'
import { buttonClass, PANEL } from '../lib/classes'
import { FormatBadge } from '../components/ui'

const MESSAGES: Partial<Record<ScoreFormat, string>> = {
  legacy:
    '这是 Guitar Pro 1–2（.gtp）或 Power Tab（.ptb）格式，网页里看不了。请先下载，再用电脑上对应的软件打开。',
  midi: 'MIDI 文件里是演奏数据，网页里不能显示成谱子。请先下载，再用音乐软件打开。',
  audio: '音频文件网页里暂不播放。请先下载，再用电脑或手机上的播放器打开。',
  video: '视频文件网页里暂不播放。请先下载，再用电脑或手机上的播放器打开。',
  other: '这种文件网页里看不了。请先下载，再用电脑上对应的软件打开。',
}

/** Formats the browser cannot show: a calm panel saying so, with the download. */
export function OtherViewer({ format, path }: { format: ScoreFormat; path: string }) {
  return (
    <div className={PANEL + ' space-y-4 p-5'}>
      <FormatBadge format={format} />
      <p className="text-sm leading-relaxed text-muted-foreground">
        {MESSAGES[format] ?? MESSAGES.other}
      </p>
      <a href={fileUrl(path, true)} download className={buttonClass('primary') + ' w-full'}>
        下载
      </a>
    </div>
  )
}
