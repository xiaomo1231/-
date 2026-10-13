/**
 * 歌词来自谱子 (跟唱 2.0): the syllables a Guitar Pro / MusicXML file carries,
 * turned into timed lyric lines in recording time.
 *
 * `lyricsFromScore` is pure and returns [] when the score has no lyrics.
 * `lyricsFromSheet` loads the sheet's own file and throws a Chinese Error in
 * that case, so the UI can show the message as it is.
 */
import { loadScoreDecoded } from '@/audio/alphatabEncoding'
import type { model } from '@coderline/alphatab'
import type { LyricLine } from '@/songs/singTypes'
import { EMPTY_SYNC, audioMsForScoreMs, barTimeline, scoreMsAt, type BarTime, type SyncMap } from '@/songs/backingSync'
import { SongService } from '@/services/songService'
import { loadAlphaTab } from '@/audio/alphatabLoader'

type AtScore = model.Score
type Word = NonNullable<LyricLine['words']>[number]

/** A gap of more than this between one syllable's end and the next one's start begins a new line. */
const LINE_GAP_MS = 1200
const SENTENCE_END = /[.!?。！？…]$/
const LATIN_END = /[A-Za-z0-9]$/
const LATIN_START = /^[A-Za-z0-9]/

export const NO_LYRICS_MESSAGE = '这份谱子里没有歌词。'

interface Syllable {
  bar: number
  startMs: number
  endMs: number
  /** Text without a trailing hyphen. */
  text: string
  /** The written syllable ended with '-' (the word continues in the next syllable). */
  hyphen: boolean
  /** The syllable's bar starts a section (verse, chorus, ...). */
  sectionAt: boolean
}

/** Syllables of one track's first staff and voice, in playback order, with recording times. */
function syllablesOf(score: AtScore, trackIndex: number, timeline: readonly BarTime[], sync: SyncMap): Syllable[] {
  const out: Syllable[] = []
  const staff = score.tracks[trackIndex]?.staves[0]
  if (!staff) return out
  const toMs = (tick: number) => Math.round(audioMsForScoreMs(timeline, sync, scoreMsAt(timeline, tick)))
  for (const bar of staff.bars) {
    const mb = score.masterBars[bar.index]
    const voice = bar.voices[0]
    if (!mb || !voice) continue
    for (const beat of voice.beats) {
      const raw = beat.lyrics?.[0]?.trim()
      if (!raw) continue
      const hyphen = raw.endsWith('-')
      const text = (hyphen ? raw.slice(0, -1) : raw).trim()
      // A lone '-' or '_' is a melisma / hyphen marker, not a syllable.
      if (!text || text === '_') continue
      const tick = mb.start + beat.playbackStart
      out.push({
        bar: bar.index,
        startMs: toMs(tick),
        endMs: toMs(tick + beat.playbackDuration),
        text,
        hyphen,
        sectionAt: mb.section !== null,
      })
    }
  }
  return out
}

/** One line from its syllables: words keep their own times; spacing follows the hyphens and scripts. */
function lineOf(list: Syllable[]): LyricLine {
  const words: Word[] = []
  let text = ''
  list.forEach((s, k) => {
    const prev = list[k - 1]
    let sep = ''
    if (prev && !prev.hyphen && LATIN_END.test(prev.text) && LATIN_START.test(s.text)) sep = ' '
    words.push({ startMs: s.startMs, text: sep + s.text })
    text += sep + s.text
  })
  return { startMs: list[0]!.startMs, text, words }
}

/** Splits syllables into lines at long gaps, section starts and sentence ends. */
function groupLines(syllables: Syllable[]): LyricLine[] {
  const lines: LyricLine[] = []
  let current: Syllable[] = []
  const flush = () => {
    if (current.length) lines.push(lineOf(current))
    current = []
  }
  let prev: Syllable | null = null
  for (const s of syllables) {
    if (
      prev &&
      (s.startMs - prev.endMs > LINE_GAP_MS || (s.sectionAt && s.bar !== prev.bar) || SENTENCE_END.test(prev.text))
    )
      flush()
    current.push(s)
    prev = s
  }
  flush()
  return lines
}

/**
 * Lyric lines of a score. Uses `preferredTrack` (the sheet's default track);
 * when that track has no lyrics, the first track that has some. Times go
 * score → recording through `timeline` and `sync`. Returns [] when there are
 * no lyrics at all.
 */
export function lyricsFromScore(score: AtScore, timeline: readonly BarTime[], sync: SyncMap, preferredTrack = 0): LyricLine[] {
  const order = [preferredTrack, ...score.tracks.map((_, i) => i)]
  const tried = new Set<number>()
  for (const t of order) {
    if (t < 0 || t >= score.tracks.length || tried.has(t)) continue
    tried.add(t)
    const lines = groupLines(syllablesOf(score, t, timeline, sync))
    if (lines.length) return lines
  }
  return []
}

/** Lyrics of a sheet's own file (Guitar Pro or MusicXML), in recording time. Throws a Chinese Error when there are none. */
export async function lyricsFromSheet(sheetId: string): Promise<LyricLine[]> {
  const sheet = await SongService.get(sheetId)
  if (!sheet) throw new Error('找不到这份谱子。')
  if (!sheet.fileId) throw new Error('这份谱子没有保存原始文件，读不出歌词。可以重新导入 Guitar Pro 或 MusicXML 文件。')
  const bytes = await SongService.fileBytes(sheet.fileId)
  if (!bytes) throw new Error('这份谱子的原始文件丢失了，读不出歌词。')
  const at = await loadAlphaTab()
  let score: AtScore
  try {
    score = loadScoreDecoded(at, bytes).score
  } catch {
    throw new Error('读不懂这份谱子文件，没法取出歌词。')
  }
  const lines = lyricsFromScore(score, barTimeline(score), sheet.backing?.sync ?? EMPTY_SYNC, sheet.defaultTrack ?? 0)
  if (!lines.length) throw new Error(NO_LYRICS_MESSAGE)
  return lines
}
