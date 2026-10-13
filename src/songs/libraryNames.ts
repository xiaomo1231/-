/**
 * 歌曲库 names (pure): turning file names and embedded tags into a clean
 * "title / artist", repairing garbled Chinese (mojibake), and the file name to
 * write back. No I/O.
 */

export interface SongTags {
  title?: string
  artist?: string
  album?: string
}

export type NameSource = 'tags' | 'filename' | 'manual'

export interface SongName {
  title: string
  artist: string
  source: NameSource
  /** Could not be worked out with confidence: the student should check it. */
  needsReview: boolean
}

const CJK = /[㐀-鿿豈-﫿]/
const HIGH_LATIN = /[\u0080-ÿ]/

/** Bytes of a string whose characters are all ≤ U+00FF (as if it had been read as Latin-1). */
function latin1Bytes(s: string): Uint8Array | null {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c > 0xff) return null
    out[i] = c
  }
  return out
}

function decode(bytes: Uint8Array, label: string): string | null {
  try {
    return new TextDecoder(label, { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * Garbled Chinese back to Chinese: text that was really UTF-8 or GBK but was
 * read as Latin-1 (e.g. "ÄãºÃ" → "你好"). Only accepted when the result
 * decodes cleanly and contains Chinese; anything else is returned unchanged.
 */
export function repairMojibake(s: string): string {
  if (!HIGH_LATIN.test(s) || CJK.test(s)) return s
  const bytes = latin1Bytes(s)
  if (!bytes) return s
  for (const label of ['utf-8', 'gbk', 'big5']) {
    const t = decode(bytes, label)
    if (t && CJK.test(t) && !/[\u0080-ÿ]/.test(t)) return t
  }
  return s
}

/** Decode tag bytes stored as "Latin-1" (ID3 encoding 0, ID3v1): often GBK in Chinese files. */
export function decodeLegacyText(bytes: Uint8Array): string {
  let end = bytes.length
  while (end > 0 && (bytes[end - 1] === 0 || bytes[end - 1] === 0x20)) end--
  const b = bytes.subarray(0, end)
  if (b.every((x) => x < 0x80)) return new TextDecoder('latin1').decode(b)
  for (const label of ['utf-8', 'gbk']) {
    const t = decode(b, label)
    if (t && (label === 'utf-8' || CJK.test(t))) return t
  }
  return new TextDecoder('latin1').decode(b)
}

const EXT = /\.(mp3|flac|m4a|aac|wav|ogg|opus|wma|ape|webm|alac)$/i
/** Quality / source marks in brackets or after a separator. */
const MARKS =
  '无损|高品质|高音质|超品|标准|母带|臻品|hi-?res|hires|sq|hq|lossless|flac|mp3|ape|wav|\\d{2,4}\\s*k(bps)?|mqms\\d*|pmqms\\d*|kgma|kwm|ncm|qmc\\d?|mflac|mgg|咪咕|网易云?|网易云音乐|qq音乐|酷我|酷狗|官方|下载|音乐站|music'
const BRACKET_MARK = new RegExp(`[\\[(（【《{]\\s*(?:${MARKS})[^\\])）】》}]*[\\])）】》}]`, 'gi')
const TRAIL_MARK = new RegExp(`[\\s._-]+(?:${MARKS})$`, 'i')

/** A file name without the noise: extension, track numbers, quality marks, hash-like tokens, underscores. */
export function cleanFileName(name: string): string {
  let s = repairMojibake(name.replace(EXT, ''))
  s = s.replace(BRACKET_MARK, ' ')
  for (let i = 0; i < 3; i++) s = s.replace(TRAIL_MARK, '')
  s = s
    // leading track number: "01. ", "01 - ", "(1)", "1_"
    .replace(/^\s*(?:\(\d{1,3}\)|\[\d{1,3}\]|\d{1,3}(?=[\s._-]))[\s._-]*/, '')
    // hash-like tokens and long ids
    .replace(/\b[0-9a-f]{12,}\b/gi, ' ')
    .replace(/\b\d{7,}\b/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return s.replace(/^[\s.\-–—·]+|[\s.\-–—·]+$/g, '').trim()
}

const SEP = /\s+[-–—]\s+|\s*[-–—]{1,2}\s*(?=\S)/

/** Key for comparing singer names (brackets such as "(Live)" ignored). */
export const artistKey = (x: string) =>
  x
    .toLowerCase()
    .replace(/[(（[【].*?[)）\]】]/g, '')
    .replace(/[\s·・]+/g, '')

/**
 * How much a name looks like a singer elsewhere in the library: > 0 means it
 * appears as a singer (tags, other file names), < 0 as a song title.
 */
export type ArtistScore = (key: string) => number

/** A trailing "(Live)" / "（伴奏）" on the singer's side belongs to the title. */
function moveSuffix(artist: string, title: string): { artist: string; title: string } {
  const m = artist.match(/\s*([(（[【][^)）\]】]*[)）\]】])\s*$/)
  return m ? { artist: artist.slice(0, m.index).trim(), title: `${title} ${m[1]}` } : { artist, title }
}

/**
 * "歌手 - 歌名" or "歌名 - 歌手": the side that matches the folder name or
 * scores higher as a singer in the library, or looks like a list of singers
 * (、 / & , feat.), is the artist; otherwise the usual download layout
 * "歌手 - 歌名" is assumed.
 */
export function splitArtistTitle(clean: string, hint?: string, score?: ArtistScore): { artist: string; title: string } | null {
  const parts = clean.split(SEP).map((x) => x.trim()).filter(Boolean)
  if (parts.length < 2) return null
  const [a, ...rest] = parts
  const b = rest.join(' - ')
  const looksArtist = (x: string) => /[、&,，/]|feat\.?|ft\./i.test(x)
  const points = (x: string) => (hint !== undefined && artistKey(x) === artistKey(hint) ? 100 : 0) + (score?.(artistKey(x)) ?? 0)
  const pa = points(a!)
  const pb = points(b)
  if (pb > pa) return moveSuffix(b, a!)
  if (pa > pb) return moveSuffix(a!, b)
  if (looksArtist(b) && !looksArtist(a!)) return moveSuffix(b, a!)
  return moveSuffix(a!, b)
}

/** True when a name is probably not a real title (ids, "track 3", nothing left). */
function meaningless(s: string): boolean {
  return !s || /^(track|audio|song|music|未知|unknown|新建|录音)\s*\d*$/i.test(s) || /^[\d\s\-_.]+$/.test(s)
}

/**
 * The best name for a song: embedded tags first (repaired), else the cleaned
 * file name (split into artist and title when it has a separator). `folder`
 * is the name of the folder it is in, used as a hint for the artist.
 */
export function decideName(fileName: string, tags: SongTags | null, folder?: string, score?: ArtistScore): SongName {
  const title = tags?.title ? repairMojibake(tags.title).trim() : ''
  const artist = tags?.artist ? repairMojibake(tags.artist).trim() : ''
  if (title && !meaningless(title)) {
    return { title: cleanFileName(title) || title, artist, source: 'tags', needsReview: !artist }
  }
  const clean = cleanFileName(fileName)
  const split = splitArtistTitle(clean, folder, score)
  if (split && !meaningless(split.title)) return { title: split.title, artist: artist || split.artist, source: 'filename', needsReview: false }
  // A folder named after a singer the library already knows.
  const byFolder = !artist && folder && (score?.(artistKey(folder)) ?? 0) > 0 ? folder : ''
  if (!meaningless(clean)) return { title: clean, artist: artist || byFolder, source: 'filename', needsReview: !(artist || byFolder) }
  return { title: fileName.replace(EXT, ''), artist, source: 'filename', needsReview: true }
}

/** File name to write back: "歌手 - 歌名.ext", with characters Windows does not allow replaced. */
export function tidyFileName(name: Pick<SongName, 'title' | 'artist'>, original: string): string {
  const ext = original.match(EXT)?.[0] ?? ''
  const safe = (x: string) => x.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim()
  const base = name.artist ? `${safe(name.artist)} - ${safe(name.title)}` : safe(name.title)
  return `${base.slice(0, 150)}${ext.toLowerCase()}`
}

/** Key for "same song, different file" (版本): lower-case title without spaces and brackets. */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s·・]+/g, '')
    .replace(/[(（[【].*?[)）\]】]/g, '')
}
