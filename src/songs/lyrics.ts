/**
 * 歌词 (pure): LRC parsing and formatting, plain-text lyric splitting,
 * assignment of lyric lines to sung phrases, editing helpers for the lyric
 * timing editor, and karaoke-style progress lookup. No DOM, no I/O.
 *
 * All times are milliseconds from the start of the recording.
 */
import type { Phrase } from './singAlong'
import type { LyricLine } from './singTypes'

/** Gap between extra lyric lines appended after the last phrase. */
const EXTRA_LINE_GAP_MS = 3000
/** Fallback end for a line that has no explicit end and no next line (lineEnd). */
const LINE_FALLBACK_MS = 4000
/** Fallback end used when splitting a line with no explicit end and no next line. */
const SPLIT_FALLBACK_MS = 3000
/** A phrase's lyric may start this much before the phrase starts (lyricForPhrase). */
const PHRASE_LEAD_MS = 500

type Word = NonNullable<LyricLine['words']>[number]

/** `mm:ss`, `mm:ss.x`, `mm:ss.xx`, `mm:ss.xxx` (also `mm:ss:xx` in the wild). */
const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const LEADING_TIME_TAGS = /^(?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+/
const WORD_TAG = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g
const METADATA_TAG = /^\[([A-Za-z]+):(.*)\]$/

/** Words that mark a section header in pasted lyrics (English and Chinese). */
const SECTION_WORDS =
  'verse|chorus|pre-?chorus|post-?chorus|bridge|intro|outro|refrain|interlude|instrumental|hook|主歌|副歌|桥段|前奏|间奏|尾奏|结尾|导歌|预副歌|后副歌'
/** A whole line that is only a section label, e.g. `[Verse 1]`, `(Chorus)`, `主歌:`, `Verse 1`. */
const SECTION_LINE = new RegExp(
  `^[\\[(（【]?\\s*(?:${SECTION_WORDS})\\s*\\d*\\s*[\\])）】]?\\s*[:：]?\\s*$`,
  'i',
)

const LATIN_END = /[A-Za-z0-9]$/
const LATIN_START = /^[A-Za-z0-9]/

/** Milliseconds from `mm`, `ss` and a 1–3 digit fraction (`5` = tenths, `50` = centiseconds). */
function toMs(min: string | undefined, sec: string | undefined, frac: string | undefined): number {
  const fracMs = frac ? Number(frac.padEnd(3, '0')) : 0
  return (Number(min ?? 0) * 60 + Number(sec ?? 0)) * 1000 + fracMs
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

function sortLines(lines: readonly LyricLine[]): LyricLine[] {
  return [...lines].sort((a, b) => a.startMs - b.startMs)
}

/** A line with no end and no words; `endMs` is only set when given. */
function timed(startMs: number, text: string, endMs?: number): LyricLine {
  const line: LyricLine = { startMs, text }
  if (endMs !== undefined) line.endMs = endMs
  return line
}

/** Parses the text of one `<mm:ss.xx>word` run. Segments before the first tag have no time. */
function parseWordRun(rest: string): {
  text: string
  words: Array<{ startMs: number | undefined; text: string }> | null
} {
  const matches = [...rest.matchAll(WORD_TAG)]
  if (!matches.length) return { text: rest.trim(), words: null }
  const segments: Array<{ startMs: number | undefined; text: string }> = []
  const first = matches[0]!
  if (first.index! > 0) segments.push({ startMs: undefined, text: rest.slice(0, first.index) })
  matches.forEach((m, k) => {
    const textStart = m.index! + m[0].length
    const textEnd = matches[k + 1] ? matches[k + 1]!.index! : rest.length
    segments.push({ startMs: toMs(m[1], m[2], m[3]), text: rest.slice(textStart, textEnd) })
  })
  const text = segments
    .map((s) => s.text)
    .join('')
    .trim()
  return { text, words: segments.filter((s) => s.text.length > 0) }
}

/**
 * Parses LRC text. Supports multiple time tags per line, `[offset:±ms]`
 * (a positive offset makes lyrics appear earlier, so it is subtracted from
 * every time), enhanced word timing (`<mm:ss.xx>word`, also the A2 form
 * `[mm:ss.xx]<mm:ss.xx>word`), metadata `[ti:]` / `[ar:]` and empty timed lines
 * that mark where the previous line ends. Lines without a time tag are ignored.
 * Never throws.
 */
export function parseLrc(text: string): { lines: LyricLine[]; title?: string; artist?: string } {
  const entries: Array<{
    startMs: number
    text: string
    words: Array<{ startMs: number | undefined; text: string }> | null
  }> = []
  const endMarkers: number[] = []
  let offsetMs = 0
  let title: string | undefined
  let artist: string | undefined

  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const lead = LEADING_TIME_TAGS.exec(line)
    if (!lead) {
      const meta = METADATA_TAG.exec(line)
      if (meta) {
        const key = meta[1]!.toLowerCase()
        const value = meta[2]!.trim()
        if (key === 'offset') {
          const n = Number(value)
          if (Number.isFinite(n)) offsetMs = n
        } else if (key === 'ti' && value) title = value
        else if (key === 'ar' && value) artist = value
      }
      continue
    }
    const times = [...lead[0].matchAll(TIME_TAG)].map((m) => toMs(m[1], m[2], m[3]))
    const parsed = parseWordRun(line.slice(lead[0].length))
    if (!parsed.text) {
      // Empty timed line: marks the end of the previous line.
      endMarkers.push(...times)
      continue
    }
    for (const t of times) entries.push({ startMs: t, text: parsed.text, words: parsed.words })
  }

  const adjust = (ms: number) => Math.max(0, Math.round(ms - offsetMs))
  const lines: LyricLine[] = entries.map((e) => {
    const line = timed(adjust(e.startMs), e.text)
    const words = e.words
      ?.filter((w) => w.text.length > 0)
      .map((w): Word => ({ startMs: adjust(w.startMs ?? e.startMs), text: w.text }))
    if (words?.length) line.words = words
    return line
  })
  const sorted = sortLines(lines)

  for (const marker of endMarkers) {
    const end = adjust(marker)
    let target: LyricLine | undefined
    for (const l of sorted) if (l.startMs < end) target = l
    if (!target) continue
    target.endMs = target.endMs === undefined ? end : Math.min(target.endMs, end)
  }

  const result: { lines: LyricLine[]; title?: string; artist?: string } = { lines: sorted }
  if (title) result.title = title
  if (artist) result.artist = artist
  return result
}

/** `mm:ss.xx` for a millisecond time (negative values clamp to 0). */
function stamp(ms: number): string {
  const cs = Math.round(Math.max(0, ms) / 10)
  const mm = Math.floor(cs / 6000)
  const ss = Math.floor(cs / 100) % 60
  const cc = cs % 100
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cc).padStart(2, '0')}`
}

/**
 * Writes lines as LRC (`[mm:ss.xx]text`). Lines with word timings are written
 * as `[mm:ss.xx]<mm:ss.xx>word...`. A line with an explicit end gets an empty
 * timed line after it, so `parseLrc(formatLrc(lines))` keeps the ends.
 */
export function formatLrc(lines: LyricLine[]): string {
  const out: string[] = []
  for (const line of sortLines(lines)) {
    const head = `[${stamp(line.startMs)}]`
    if (line.words?.length)
      out.push(head + line.words.map((w) => `<${stamp(w.startMs)}>${w.text}`).join(''))
    else out.push(head + line.text)
    if (line.endMs !== undefined) out.push(`[${stamp(line.endMs)}]`)
  }
  return out.length ? out.join('\n') + '\n' : ''
}

/**
 * Splits pasted plain lyrics into trimmed, non-empty lines. Section labels
 * such as `[Verse]`, `(Chorus)`, `主歌:`, `副歌：` and `Verse 1` are dropped;
 * every other line is kept.
 */
export function splitLyricText(text: string): string[] {
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !SECTION_LINE.test(s))
}

/**
 * Gives line i the timing of phrase i. Lines beyond the phrases are appended
 * after the last phrase, 3000 ms apart. Fewer lines than phrases simply leaves
 * the later phrases without lyrics.
 */
export function assignToPhrases(textLines: string[], phrases: Phrase[]): LyricLine[] {
  const last = phrases[phrases.length - 1]
  const base = last ? last.endMs : 0
  return textLines.map((text, i) => {
    const phrase = phrases[i]
    if (phrase) return timed(phrase.startMs, text, phrase.endMs)
    return timed(base + (i - phrases.length) * EXTRA_LINE_GAP_MS, text)
  })
}

/**
 * End time of line i: its explicit end, else the next line's start, else
 * start + 4000 ms. Returns 0 when i is out of range.
 */
export function lineEnd(lines: LyricLine[], i: number): number {
  const line = lines[i]
  if (!line) return 0
  return line.endMs ?? lines[i + 1]?.startMs ?? line.startMs + LINE_FALLBACK_MS
}

/**
 * Merges line i with the next line. The text is joined with a space when both
 * sides look Latin, otherwise without one. Keeps line i's start, the next
 * line's end and concatenates word timings.
 */
export function mergeWithNext(lines: LyricLine[], i: number): LyricLine[] {
  const a = lines[i]
  const b = lines[i + 1]
  if (!a || !b || i < 0) return lines.slice()
  const left = a.text.trimEnd()
  const right = b.text.trimStart()
  const sep = LATIN_END.test(left) && LATIN_START.test(right) ? ' ' : ''
  const merged = timed(a.startMs, left + sep + right, b.endMs)
  if (a.words || b.words) {
    const aWords: Word[] = a.words ?? [{ startMs: a.startMs, text: left }]
    const bWords: Word[] = (b.words ?? [{ startMs: b.startMs, text: right }]).map((w, k) =>
      k === 0 && sep ? { startMs: w.startMs, text: sep + w.text } : w,
    )
    merged.words = [...aWords, ...bWords]
  }
  return [...lines.slice(0, i), merged, ...lines.slice(i + 2)]
}

/**
 * Splits line i before `charIndex`. The split time is interpolated by
 * character position between the line's start and end (end = endMs, else the
 * next start, else start + 3000). Word timings go to whichever side they start
 * in. Does nothing when either side would be empty.
 */
export function splitLine(lines: LyricLine[], i: number, charIndex: number): LyricLine[] {
  const a = lines[i]
  if (!a || charIndex <= 0 || charIndex >= a.text.length) return lines.slice()
  const left = a.text.slice(0, charIndex).trimEnd()
  const right = a.text.slice(charIndex).trimStart()
  if (!left || !right) return lines.slice()

  const next = lines[i + 1]
  const end = Math.max(a.startMs, a.endMs ?? next?.startMs ?? a.startMs + SPLIT_FALLBACK_MS)
  const at = Math.round(a.startMs + ((end - a.startMs) * charIndex) / a.text.length)

  const leftWords: Word[] = []
  const rightWords: Word[] = []
  let offset = 0
  for (const w of a.words ?? []) {
    if (offset < charIndex) leftWords.push(w)
    else rightWords.push(w)
    offset += w.text.length
  }

  const leftLine = timed(a.startMs, left, at)
  if (leftWords.length) leftLine.words = leftWords
  const rightLine = timed(at, right, a.endMs)
  if (rightWords.length) rightLine.words = rightWords
  return [...lines.slice(0, i), leftLine, rightLine, ...lines.slice(i + 1)]
}

/**
 * Moves line i (start, end and word timings together) by `deltaMs` and keeps
 * the lines sorted. Start is clamped at 0.
 */
export function shiftLine(lines: LyricLine[], i: number, deltaMs: number): LyricLine[] {
  const a = lines[i]
  if (!a) return lines.slice()
  return setLineStart(lines, i, a.startMs + deltaMs)
}

/**
 * Sets line i's start to `ms` (clamped at 0). The line keeps its duration:
 * the end and word timings move by the same amount. Keeps the lines sorted.
 */
export function setLineStart(lines: LyricLine[], i: number, ms: number): LyricLine[] {
  const a = lines[i]
  if (!a) return lines.slice()
  const start = Math.max(0, Math.round(ms))
  const delta = start - a.startMs
  const moved = timed(
    start,
    a.text,
    a.endMs === undefined ? undefined : Math.max(start, a.endMs + delta),
  )
  if (a.words?.length)
    moved.words = a.words.map((w): Word => ({
      startMs: Math.max(0, w.startMs + delta),
      text: w.text,
    }))
  return sortLines(lines.map((l, k) => (k === i ? moved : l)))
}

/** Moves every line (and its end and word timings) by `deltaMs`; times stop at 0. */
export function shiftAll(lines: LyricLine[], deltaMs: number): LyricLine[] {
  const at = (ms: number) => Math.max(0, Math.round(ms + deltaMs))
  return lines.map((l) => {
    const moved: LyricLine = { ...l, startMs: at(l.startMs) }
    if (l.endMs !== undefined) moved.endMs = at(l.endMs)
    if (l.words) moved.words = l.words.map((w) => ({ startMs: at(w.startMs), text: w.text }))
    return moved
  })
}

/**
 * Swaps the text of line i with its neighbour (-1 = previous, 1 = next) and
 * keeps both timings in place. Word timings are dropped on both lines, since
 * they belong to the old text. Returns a copy when there is no neighbour.
 */
export function moveText(lines: LyricLine[], i: number, direction: -1 | 1): LyricLine[] {
  const j = i + direction
  const a = lines[i]
  const b = lines[j]
  if (!a || !b || j < 0 || j >= lines.length) return lines.slice()
  const out = lines.slice()
  out[i] = timed(a.startMs, b.text, a.endMs)
  out[j] = timed(b.startMs, a.text, b.endMs)
  return out
}

/**
 * Taps: line fromIndex+k gets start `tapsMs[k]`. Retimed lines lose their word
 * timings and explicit end (their end comes from the next line again). Other
 * lines are not touched. Returns sorted lines.
 */
export function tapsToStarts(lines: LyricLine[], fromIndex: number, tapsMs: number[]): LyricLine[] {
  const out = lines.slice()
  tapsMs.forEach((ms, k) => {
    const idx = fromIndex + k
    const line = out[idx]
    if (!line || idx < 0) return
    out[idx] = timed(Math.max(0, Math.round(ms)), line.text)
  })
  return sortLines(out)
}

/** Result of `karaokeState`. */
export interface KaraokeState {
  /** Index of the current line (last line starting at or before `ms`), -1 before the first. */
  index: number
  /** 0–1 progress through the line. */
  progress: number
  /** Current word when the line has word timings, else -1. */
  wordIndex: number
}

/**
 * Where playback is at `ms`. With word timings, progress is the completed
 * words plus the fraction of the current word; otherwise it is linear between
 * the line's start and `lineEnd`. Progress is 1 once past the line's end.
 */
export function karaokeState(lines: LyricLine[], ms: number): KaraokeState {
  let index = -1
  for (const [k, line] of lines.entries()) if (line.startMs <= ms) index = k
  if (index < 0) return { index: -1, progress: 0, wordIndex: -1 }

  const line = lines[index]!
  const end = lineEnd(lines, index)
  const words = line.words ?? []
  if (words.length) {
    let wordIndex = -1
    for (const [k, w] of words.entries()) if (w.startMs <= ms) wordIndex = k
    if (wordIndex < 0) return { index, progress: 0, wordIndex: -1 }
    const word = words[wordIndex]!
    const wordEnd = words[wordIndex + 1]?.startMs ?? end
    const span = wordEnd - word.startMs
    const within = span > 0 ? clamp01((ms - word.startMs) / span) : 1
    return { index, progress: clamp01((wordIndex + within) / words.length), wordIndex }
  }

  const span = end - line.startMs
  const progress = span > 0 ? clamp01((ms - line.startMs) / span) : 1
  return { index, progress, wordIndex: -1 }
}

/**
 * Text of the first line (by start time) that begins within the phrase, from
 * 500 ms before its start to its end. Empty string when none does.
 */
export function lyricForPhrase(
  lines: LyricLine[],
  phrase: Pick<Phrase, 'startMs' | 'endMs'>,
): string {
  for (const line of sortLines(lines)) {
    if (line.startMs >= phrase.startMs - PHRASE_LEAD_MS && line.startMs <= phrase.endMs)
      return line.text
  }
  return ''
}
