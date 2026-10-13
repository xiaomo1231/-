import type { SheetTrackInfo } from '@/import/gpImport'

export const INSTRUMENT_ZH: Record<SheetTrackInfo['instrument'], string> = {
  guitar: '吉他',
  bass: '贝斯',
  drums: '鼓',
  keys: '键盘',
  voice: '人声',
  other: '其它',
}

/** "流行，练习, 民谣" → ["流行", "练习", "民谣"]: Chinese or ASCII commas, no duplicates. */
export function parseTags(text: string): string[] {
  const tags = text
    .split(/[,，、]/)
    .map((t) => t.trim().slice(0, 20))
    .filter(Boolean)
  return Array.from(new Set(tags))
}
