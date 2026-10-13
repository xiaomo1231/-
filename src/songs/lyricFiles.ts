/**
 * 歌词文件 (0.22.0, pure): reading lyric files the student downloaded
 * themselves (for example with LDDC) — LRC (line, enhanced and LDDC's
 * word-by-word form), SRT and ASS — and matching a file to a song by its name
 * and tags. No I/O; the library service reads the folder.
 */
import type { LyricLine } from './singTypes'
import { parseLrc } from './lyrics'
import { artistKey, repairMojibake, titleKey } from './libraryNames'

export const LYRIC_EXT = /\.(lrc|srt|ass|ssa)$/i

export type LyricFormat = 'lrc' | 'srt' | 'ass'

export function lyricFormat(name: string): LyricFormat | null {
  const m = LYRIC_EXT.exec(name)
  if (!m) return null
  const ext = m[1]!.toLowerCase()
  return ext === 'lrc' ? 'lrc' : ext === 'srt' ? 'srt' : 'ass'
}

/** Text of a lyric file: UTF-8 / UTF-16 with BOM, else UTF-8, else GBK (older Chinese LRC files). */
export function decodeLyricBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      return new TextDecoder('gbk').decode(bytes)
    } catch {
      return new TextDecoder('utf-8').decode(bytes)
    }
  }
}

// ---- Parsing -------------------------------------------------------------

const BRACKET_TIME = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

/**
 * LDDC's word-by-word LRC puts a `[mm:ss.xx]` tag before every word and one
 * after the last (`[00:01.00]我[00:01.40]记[00:01.90]`). Rewritten to the
 * enhanced form (`<mm:ss.xx>`) that parseLrc reads, with the closing tag
 * turned into an empty timed line that marks the line's end.
 */
export function normaliseWordLrc(text: string): string {
  const out: string[] = []
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
    const line = raw.trim()
    const lead = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/.exec(line)
    const rest = lead ? line.slice(lead[0].length) : ''
    if (!lead || !/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(rest) || /^\[\d/.test(rest)) {
      out.push(raw)
      continue
    }
    const tags = [...line.matchAll(BRACKET_TIME)]
    let enhanced = lead[0]
    let endTag = ''
    tags.forEach((m, k) => {
      const from = m.index! + m[0].length
      const to = tags[k + 1]?.index ?? line.length
      const word = line.slice(from, to)
      if (word) enhanced += `<${m[1]}:${m[2]}${m[3] !== undefined ? '.' + m[3] : ''}>${word}`
      else if (k === tags.length - 1) endTag = m[0]
    })
    out.push(enhanced)
    if (endTag) out.push(endTag)
  }
  return out.join('\n')
}

/**
 * LDDC (and many players) write a translation / romanisation as a second line
 * with the same time. The first line at a time is the lyric; later ones with
 * other text become its translation.
 */
function foldTranslations(lines: LyricLine[]): LyricLine[] {
  const out: LyricLine[] = []
  for (const l of lines) {
    const prev = out[out.length - 1]
    if (prev && prev.startMs === l.startMs) {
      if (l.text !== prev.text && !prev.translation) prev.translation = l.text
      continue
    }
    out.push({ ...l })
  }
  return out
}

const SRT_TIME =
  /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/
const hmsMs = (h: string, m: string, s: string, f: string) =>
  ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(f.padEnd(3, '0'))

export function parseSrt(text: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const block of text.replace(/^\uFEFF/, '').split(/\r?\n\s*\r?\n/)) {
    const rows = block.split(/\r?\n/).map((r) => r.trim())
    const at = rows.findIndex((r) => SRT_TIME.test(r))
    if (at < 0) continue
    const m = SRT_TIME.exec(rows[at]!)!
    const body = rows
      .slice(at + 1)
      .filter(Boolean)
      .map((r) => r.replace(/<[^>]+>/g, '').trim())
    if (!body.length) continue
    const line: LyricLine = {
      startMs: hmsMs(m[1]!, m[2]!, m[3]!, m[4]!),
      endMs: hmsMs(m[5]!, m[6]!, m[7]!, m[8]!),
      text: body[0]!,
    }
    if (body[1]) line.translation = body.slice(1).join(' ')
    lines.push(line)
  }
  return foldTranslations(lines.sort((a, b) => a.startMs - b.startMs))
}

const ASS_TIME = /^(\d{1,2}):(\d{2}):(\d{2})[.:](\d{1,3})$/

/** ASS / SSA "Dialogue:" lines; karaoke tags `{\k50}` (centiseconds) become word timings. */
export function parseAss(text: string): LyricLine[] {
  const lines: LyricLine[] = []
  let fields = [
    'layer',
    'start',
    'end',
    'style',
    'name',
    'marginl',
    'marginr',
    'marginv',
    'effect',
    'text',
  ]
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const row = raw.trim()
    if (/^format\s*:/i.test(row) && fields.length && /text/i.test(row)) {
      fields = row
        .slice(row.indexOf(':') + 1)
        .split(',')
        .map((f) => f.trim().toLowerCase())
      continue
    }
    if (!/^dialogue\s*:/i.test(row)) continue
    const parts = row.slice(row.indexOf(':') + 1).split(',')
    const textAt = fields.indexOf('text')
    const cell = (name: string) => (parts[fields.indexOf(name)] ?? '').trim()
    const body = parts.slice(textAt).join(',')
    const s = ASS_TIME.exec(cell('start'))
    const e = ASS_TIME.exec(cell('end'))
    if (!s || !e) continue
    const startMs = hmsMs(s[1]!, s[2]!, s[3]!, s[4]!.padEnd(2, '0').slice(0, 2) + '0')
    const endMs = hmsMs(e[1]!, e[2]!, e[3]!, e[4]!.padEnd(2, '0').slice(0, 2) + '0')
    const words: Array<{ startMs: number; text: string }> = []
    let t = startMs
    const karaoke = /\{[^}]*\\k[fo]?(\d+)[^}]*\}([^{]*)/gi
    let m: RegExpExecArray | null
    while ((m = karaoke.exec(body))) {
      const w = m[2]!.replace(/\\[Nnh]/g, ' ')
      if (w) words.push({ startMs: t, text: w })
      t += Number(m[1]) * 10
    }
    const plain = body
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\[Nnh]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
    if (!plain) continue
    const line: LyricLine = { startMs, endMs, text: plain }
    if (words.length > 1) line.words = words
    lines.push(line)
  }
  return foldTranslations(lines.sort((a, b) => a.startMs - b.startMs))
}

export interface ParsedLyricFile {
  lines: LyricLine[]
  title?: string
  artist?: string
}

/** Reads a lyric file of any supported kind. Lines are empty when nothing timed was found. */
export function parseLyricFile(name: string, text: string): ParsedLyricFile {
  const kind = lyricFormat(name) ?? 'lrc'
  if (kind === 'srt') return { lines: parseSrt(text) }
  if (kind === 'ass') return { lines: parseAss(text) }
  const parsed = parseLrc(normaliseWordLrc(text))
  return { ...parsed, lines: foldTranslations(parsed.lines) }
}

/** `[ti:]` / `[ar:]` from the start of an LRC file (cheap: used while scanning a folder). */
export function lrcHeader(text: string): { title?: string; artist?: string } {
  const out: { title?: string; artist?: string } = {}
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/).slice(0, 15)) {
    const m = /^\[(ti|ar):(.*)\]\s*$/i.exec(raw.trim())
    if (!m || !m[2]!.trim()) continue
    if (m[1]!.toLowerCase() === 'ti') out.title = m[2]!.trim()
    else out.artist = m[2]!.trim()
  }
  return out
}

// ---- Matching ------------------------------------------------------------

/** A lyric file found in a lyrics folder (names only; the text is read when used). */
export interface LyricFileEntry {
  path: string
  fileName: string
  size: number
  lastModified: number
  /** From `[ti:]` / `[ar:]` when the file has them. */
  title?: string
  artist?: string
}

/** The parts of a lyric file name, e.g. "赵雷 - 我记得 (1974443814).lrc" → ["赵雷", "我记得"]. */
export function lyricNameParts(fileName: string): string[] {
  const base = repairMojibake(fileName.replace(LYRIC_EXT, ''))
    // LDDC adds the song's id in brackets; players add "[mqms]" and the like.
    .replace(/[([（【]\s*\d{5,}\s*[)\]）】]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return base
    .split(/\s+[-–—]\s+|\s*[-–—]{1,2}\s*(?=\S)/)
    .map((p) => p.trim())
    .filter(Boolean)
}

/** Several singers in one field: "A、B", "A/B", "A & B", "A feat. B". */
const splitArtists = (a: string) =>
  a
    .split(/\s*(?:[、/&，,;；]|\bfeat\.?|\bft\.?|\bx\b)\s*/i)
    .map(artistKey)
    .filter(Boolean)

const sameArtist = (a: string, b: string) => {
  const x = splitArtists(a)
  const y = splitArtists(b)
  return x.some((k) => y.includes(k)) || (artistKey(a) !== '' && artistKey(a) === artistKey(b))
}

/**
 * How well a lyric file fits a song, 0–100: 100 = title and singer, 70 =
 * title with no singer on one side, 40 = the title only (another singer's
 * version), 0 = no. Titles compare without spaces and bracketed notes
 * ("我记得 (Live)" = "我记得").
 */
export function lyricMatchScore(
  song: { title: string; artist?: string },
  entry: LyricFileEntry,
): number {
  if (!song.title.trim()) return 0
  const parts = lyricNameParts(entry.fileName)
  // Possible (title, artist) readings of the file: its tags, then both orders of its name.
  const readings: Array<{ title: string; artist: string }> = []
  if (entry.title) readings.push({ title: entry.title, artist: entry.artist ?? '' })
  if (parts.length >= 2) {
    readings.push({ title: parts.slice(1).join(' - '), artist: parts[0]! })
    readings.push({ title: parts[0]!, artist: parts.slice(1).join(' - ') })
  } else if (parts[0]) readings.push({ title: parts[0], artist: entry.artist ?? '' })
  let best = 0
  const artist = song.artist?.trim() ?? ''
  for (const r of readings) {
    if (!titleKey(r.title) || titleKey(r.title) !== titleKey(song.title)) continue
    const bothArtists = artist !== '' && r.artist.trim() !== ''
    best = Math.max(best, bothArtists ? (sameArtist(artist, r.artist) ? 100 : 40) : 70)
  }
  return best
}

export interface LyricMatch {
  entry: LyricFileEntry
  score: number
}

/**
 * Lyric files that could belong to the song, best first. `sure` = the best
 * one fits title and singer (or the title with no singer known) and no other
 * file fits as well — then it can be used without asking.
 */
export function findLyricMatches(
  song: { title: string; artist?: string },
  entries: readonly LyricFileEntry[],
): { matches: LyricMatch[]; sure: boolean } {
  const matches = entries
    .map((entry) => ({ entry, score: lyricMatchScore(song, entry) }))
    .filter((m) => m.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.entry.fileName.localeCompare(b.entry.fileName, 'zh-Hans-CN'),
    )
  const top = matches[0]
  const tied = matches.filter((m) => top && m.score === top.score)
  // Same file in two formats (.lrc and .srt of one song) is not a real tie.
  const distinct = new Set(tied.map((m) => m.entry.fileName.replace(LYRIC_EXT, '')))
  const sure = !!top && top.score >= 70 && distinct.size === 1
  return { matches: matches.slice(0, 8), sure }
}
