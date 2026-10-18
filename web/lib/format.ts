import type { ScoreFormat, SearchMatch } from '@/songs/scoreLibraryTypes'

/** Format badges: the same labels as the desktop library. */
export const FORMAT_BADGE: Record<ScoreFormat, { label: string; className: string }> = {
  score: { label: 'GP 谱', className: 'border-success/40 bg-success/10 text-success' },
  legacy: { label: 'GTP', className: 'border-border text-muted-foreground' },
  image: { label: '图片谱', className: 'border-amber/40 bg-amber/10 text-amber' },
  pdf: { label: 'PDF', className: 'border-destructive/40 bg-destructive/10 text-destructive' },
  text: { label: '文本谱', className: 'border-cyan/40 bg-cyan/10 text-cyan' },
  midi: { label: 'MIDI', className: 'border-border text-muted-foreground' },
  audio: { label: '音频', className: 'border-border text-muted-foreground' },
  video: { label: '视频', className: 'border-border text-muted-foreground' },
  other: { label: '其它', className: 'border-border text-muted-foreground' },
}

/** Small tag for how a search result matched; a plain name match shows none. */
export const MATCH_LABEL: Record<SearchMatch, string | null> = {
  name: null,
  traditional: '繁简',
  pinyin: '拼音',
  initials: '首字母',
  fuzzy: '相近',
}

export const SCORE_FORMATS: readonly ScoreFormat[] = [
  'score',
  'legacy',
  'image',
  'pdf',
  'text',
  'midi',
  'audio',
  'video',
  'other',
]

export function isScoreFormat(v: string): v is ScoreFormat {
  return (SCORE_FORMATS as readonly string[]).includes(v)
}

const FORMAT_BY_EXT: Partial<Record<string, ScoreFormat>> = {}
for (const e of ['gp3', 'gp4', 'gp5', 'gpx', 'gp', 'musicxml', 'xml', 'mxl'])
  FORMAT_BY_EXT[e] = 'score'
for (const e of ['gtp', 'ptb']) FORMAT_BY_EXT[e] = 'legacy'
for (const e of ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tif', 'tiff', 'webp'])
  FORMAT_BY_EXT[e] = 'image'
FORMAT_BY_EXT.pdf = 'pdf'
FORMAT_BY_EXT.txt = 'text'
for (const e of ['mid', 'midi', 'kar']) FORMAT_BY_EXT[e] = 'midi'
for (const e of ['mp3', 'wav', 'wma', 'ogg', 'm4a', 'flac', 'aac']) FORMAT_BY_EXT[e] = 'audio'
for (const e of ['mp4', 'wmv', 'avi', 'mkv', 'flv', 'mov']) FORMAT_BY_EXT[e] = 'video'

/** The last segment of a '/' separated path. */
export function fileBaseName(path: string): string {
  return path.split('/').pop() ?? path
}

/** Lower-case extension without the dot ('' when there is none). */
export function extOf(path: string): string {
  const name = fileBaseName(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** Format from a file name, used when the link does not say it. */
export function formatOfPath(path: string): ScoreFormat {
  return FORMAT_BY_EXT[extOf(path)] ?? 'other'
}

/** The `pages` parameter: a JSON array of paths (anything else gives []). */
export function parsePages(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v)
      ? v.filter((p): p is string => typeof p === 'string' && p.length > 0)
      : []
  } catch {
    return []
  }
}

/** Artist text from a tab file, or '' when it is a website advert rather than a name. */
export function cleanArtist(text: string | null | undefined): string {
  const t = (text ?? '').trim()
  if (!t || /www\.|https?:|\.com|\.cn|\.net|吉他谱网/i.test(t)) return ''
  return t
}

/** Tab sites put adverts into header texts; keep what comes before them. */
export function stripSiteAds(text: string): string {
  const cut = text.search(
    /(https?:\/\/|www\.|[a-z0-9-]+\.(?:com|cn|net|org)\b|为您提供|提供优秀|中文娱乐网|吉他谱网|曲谱网|制谱[:：]?)/i,
  )
  const kept = (cut >= 0 ? text.slice(0, cut) : text).replace(/[\s\-—_|·:：,，]+$/, '').trim()
  return kept || text.trim()
}

export function formatSize(bytes: number): string {
  return bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** The library's name: the last folder of its path. */
export function libraryName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).pop() ?? root
}
