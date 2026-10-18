/**
 * Display helpers for the score library: the format badge (GP 谱 / 图片谱 /
 * PDF / 文本谱 / GTP), file sizes and the search match tags.
 */
import type { ScoreFormat, SearchMatch } from '@/songs/scoreLibraryTypes'

/** Colours come from the theme tokens; the badge is a thin border plus coloured text. */
export const FORMAT_BADGE: Record<ScoreFormat, { label: string; className: string }> = {
  score: { label: 'GP 谱', className: 'border-success/50 text-success' },
  legacy: { label: 'GTP', className: 'border-muted-foreground/40 text-muted-foreground' },
  image: { label: '图片谱', className: 'border-amber/60 text-amber' },
  pdf: { label: 'PDF', className: 'border-destructive/50 text-destructive' },
  text: { label: '文本谱', className: 'border-cyan/50 text-cyan' },
  midi: { label: 'MIDI', className: 'border-muted-foreground/40 text-muted-foreground' },
  audio: { label: '音频', className: 'border-muted-foreground/40 text-muted-foreground' },
  video: { label: '视频', className: 'border-muted-foreground/40 text-muted-foreground' },
  other: { label: '其它', className: 'border-muted-foreground/40 text-muted-foreground' },
}

/** Small tag for how a search result matched; `name` (plain match) shows no tag. */
export const MATCH_LABEL: Record<SearchMatch, string | null> = {
  name: null,
  traditional: '繁简',
  pinyin: '拼音',
  initials: '首字母',
  fuzzy: '相近',
}

export function formatSize(bytes: number): string {
  return bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}
