import type { TrackKind, VersionInfo } from './scoreServerTypes'

/** Instruments in the order they are named on a version line. */
const INSTRUMENTS: Array<{ kind: TrackKind; name: string }> = [
  { kind: 'guitar', name: '吉他' },
  { kind: 'bass', name: '贝斯' },
  { kind: 'drums', name: '鼓' },
  { kind: 'keys', name: '键盘' },
  { kind: 'vocal', name: '人声' },
]

/**
 * One line that says what a version is: for a GP file its instruments, track
 * count, tempo and bars; for other formats the format and page count.
 */
export function versionLine(input: {
  format: string
  info: VersionInfo | null
  pages: number
}): { main: string; detail: string } {
  switch (input.format) {
    case 'score':
      return input.info ? scoreLine(input.info) : { main: 'GP 谱', detail: '正在读取音轨…' }
    case 'pdf':
      return { main: 'PDF', detail: '' }
    case 'image':
      return { main: '图片谱', detail: input.pages > 1 ? `${input.pages} 页` : '' }
    case 'text':
      return { main: '文本谱', detail: '' }
    default:
      return { main: '其他文件', detail: '' }
  }
}

function scoreLine(info: VersionInfo): { main: string; detail: string } {
  if (info.unreadable) return { main: 'GP 谱', detail: '读不出音轨，可以打开试试' }
  const counts: Partial<Record<TrackKind, number>> = {}
  for (const t of info.tracks) counts[t.kind] = (counts[t.kind] ?? 0) + 1
  const parts = INSTRUMENTS.flatMap(({ kind, name }) => {
    const n = counts[kind] ?? 0
    return n === 0 ? [] : [n > 1 ? `${name}×${n}` : name]
  })
  // 'other' tracks count only in the total.
  const main = parts.length > 0 ? parts.join(' · ') : info.tracks.length > 0 ? '其他乐器' : '无音轨'
  const detail = [
    `${info.tracks.length} 轨`,
    info.tempo ? `♩${info.tempo}` : null,
    info.bars ? `${info.bars} 小节` : null,
  ]
    .filter((s): s is string => s !== null)
    .join(' · ')
  return { main, detail }
}
