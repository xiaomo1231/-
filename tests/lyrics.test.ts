import { describe, expect, it } from 'vitest'
import {
  assignToPhrases,
  formatLrc,
  karaokeState,
  lineEnd,
  lyricForPhrase,
  mergeWithNext,
  moveText,
  parseLrc,
  setLineStart,
  shiftLine,
  splitLine,
  splitLyricText,
  tapsToStarts,
} from '@/songs/lyrics'
import type { Phrase } from '@/songs/singAlong'
import type { LyricLine } from '@/songs/singTypes'

const phrase = (index: number, startMs: number, endMs: number): Phrase => ({
  index,
  startMs,
  endMs,
  medianMidi: 60,
})

describe('parseLrc', () => {
  it('parses basic lines with mm:ss, mm:ss.xx and mm:ss.xxx tags', () => {
    const { lines } = parseLrc('[00:01]one\n[00:02.50]two\n[00:03.250]three')
    expect(lines).toEqual([
      { startMs: 1000, text: 'one' },
      { startMs: 2500, text: 'two' },
      { startMs: 3250, text: 'three' },
    ])
  })

  it('expands multiple time tags on one line and sorts by time', () => {
    const { lines } = parseLrc('[00:30.00][01:10.00]chorus\n[00:10.00]verse')
    expect(lines.map((l) => [l.startMs, l.text])).toEqual([
      [10000, 'verse'],
      [30000, 'chorus'],
      [70000, 'chorus'],
    ])
  })

  it('applies [offset] with the LRC sign: positive shifts lyrics earlier', () => {
    const early = parseLrc('[offset:+500]\n[00:05.00]a')
    expect(early.lines[0]!.startMs).toBe(4500)
    const late = parseLrc('[offset:-500]\n[00:05.00]a')
    expect(late.lines[0]!.startMs).toBe(5500)
  })

  it('clamps times that would go below zero', () => {
    expect(parseLrc('[offset:+5000]\n[00:01.00]a').lines[0]!.startMs).toBe(0)
  })

  it('reads enhanced word timing into words', () => {
    const { lines } = parseLrc('[00:12.00]<00:12.00>Hel<00:12.50>lo <00:13.00>world')
    expect(lines).toHaveLength(1)
    expect(lines[0]!.text).toBe('Hello world')
    expect(lines[0]!.words).toEqual([
      { startMs: 12000, text: 'Hel' },
      { startMs: 12500, text: 'lo ' },
      { startMs: 13000, text: 'world' },
    ])
  })

  it('accepts the A2 style with a line tag and word tags', () => {
    const { lines } = parseLrc('[00:12.00]<00:12.00>Hel<00:12.50>lo')
    expect(lines[0]!.startMs).toBe(12000)
    expect(lines[0]!.words?.map((w) => w.startMs)).toEqual([12000, 12500])
  })

  it('reads title and artist and ignores other metadata', () => {
    const result = parseLrc(
      '\uFEFF[ti:Song]\n[ar:Singer]\n[al:Album]\n[by:me]\n[length:03:00]\n[00:01.00]a',
    )
    expect(result.title).toBe('Song')
    expect(result.artist).toBe('Singer')
    expect(result.lines).toEqual([{ startMs: 1000, text: 'a' }])
    expect(parseLrc('[00:01.00]a').title).toBeUndefined()
  })

  it('uses empty timed lines as the end of the previous line', () => {
    const { lines } = parseLrc('[00:01.00]one\n[00:03.00]\n[00:05.00]two\n[00:07.00]')
    expect(lines).toEqual([
      { startMs: 1000, text: 'one', endMs: 3000 },
      { startMs: 5000, text: 'two', endMs: 7000 },
    ])
  })

  it('keeps an explicit end only when it is earlier than an existing one', () => {
    const { lines } = parseLrc('[00:01.00]one\n[00:04.00]\n[00:02.00]\n')
    expect(lines[0]!.endMs).toBe(2000)
  })

  it('handles CRLF line endings and ignores lines without time tags', () => {
    const { lines } = parseLrc('[00:01.00]a\r\nno time here\r\n[Verse]\r\n[00:02.00]b\r\n')
    expect(lines.map((l) => l.text)).toEqual(['a', 'b'])
  })

  it('never throws on garbage', () => {
    expect(() => parseLrc('[[[ ::: <<< \u0000 ]]]\n[99:99.999]x')).not.toThrow()
    expect(parseLrc('').lines).toEqual([])
  })
})

describe('formatLrc', () => {
  it('writes mm:ss.xx tags and word tags', () => {
    const text = formatLrc([
      { startMs: 1000, text: 'one' },
      {
        startMs: 12000,
        text: 'Hello',
        words: [
          { startMs: 12000, text: 'Hel' },
          { startMs: 12500, text: 'lo' },
        ],
      },
    ])
    expect(text).toBe('[00:01.00]one\n[00:12.00]<00:12.00>Hel<00:12.50>lo\n')
  })

  it('round-trips through parseLrc, including ends and words', () => {
    const original: LyricLine[] = [
      { startMs: 1000, text: 'one', endMs: 2500 },
      {
        startMs: 3000,
        text: 'two',
        words: [
          { startMs: 3000, text: 'tw' },
          { startMs: 3400, text: 'o' },
        ],
      },
    ]
    expect(parseLrc(formatLrc(original)).lines).toEqual(original)
  })

  it('returns an empty string for no lines', () => {
    expect(formatLrc([])).toBe('')
  })
})

describe('splitLyricText', () => {
  it('trims lines and drops empty ones', () => {
    expect(splitLyricText('  hello  \n\n  world \r\n')).toEqual(['hello', 'world'])
  })

  it('drops section headers in several forms', () => {
    const text = [
      '[Verse]',
      '[Chorus 2]',
      '(Bridge)',
      'Verse 1',
      'Intro:',
      '主歌:',
      '副歌：',
      '桥段',
      'keep this',
      'Chorus is nice to hear',
    ].join('\n')
    expect(splitLyricText(text)).toEqual(['keep this', 'Chorus is nice to hear'])
  })
})

describe('assignToPhrases', () => {
  const phrases = [phrase(0, 1000, 2000), phrase(1, 3000, 4500)]

  it('gives line i the timing of phrase i', () => {
    expect(assignToPhrases(['a', 'b'], phrases)).toEqual([
      { startMs: 1000, endMs: 2000, text: 'a' },
      { startMs: 3000, endMs: 4500, text: 'b' },
    ])
  })

  it('appends extra lines after the last phrase, 3000 ms apart', () => {
    const lines = assignToPhrases(['a', 'b', 'c', 'd'], phrases)
    expect(lines.slice(2)).toEqual([
      { startMs: 4500, text: 'c' },
      { startMs: 7500, text: 'd' },
    ])
  })

  it('leaves later phrases without lyrics when there are fewer lines', () => {
    expect(assignToPhrases(['a'], phrases)).toEqual([{ startMs: 1000, endMs: 2000, text: 'a' }])
  })

  it('starts extra lines at 0 when there are no phrases', () => {
    expect(assignToPhrases(['a', 'b'], []).map((l) => l.startMs)).toEqual([0, 3000])
  })
})

describe('lineEnd', () => {
  it('uses endMs, then the next start, then start + 4000', () => {
    const lines: LyricLine[] = [
      { startMs: 0, text: 'a', endMs: 900 },
      { startMs: 2000, text: 'b' },
      { startMs: 5000, text: 'c' },
    ]
    expect(lineEnd(lines, 0)).toBe(900)
    expect(lineEnd(lines, 1)).toBe(5000)
    expect(lineEnd(lines, 2)).toBe(9000)
    expect(lineEnd(lines, 9)).toBe(0)
  })
})

describe('mergeWithNext', () => {
  it('joins Latin text with a space and keeps the next end', () => {
    const lines: LyricLine[] = [
      { startMs: 0, text: 'Hello', endMs: 1000 },
      { startMs: 1000, text: 'world', endMs: 2000 },
    ]
    expect(mergeWithNext(lines, 0)).toEqual([{ startMs: 0, endMs: 2000, text: 'Hello world' }])
  })

  it('joins other text without a space', () => {
    const lines: LyricLine[] = [
      { startMs: 0, text: '我们' },
      { startMs: 1000, text: '一起' },
    ]
    expect(mergeWithNext(lines, 0)).toEqual([{ startMs: 0, text: '我们一起' }])
  })

  it('concatenates word timings', () => {
    const lines: LyricLine[] = [
      {
        startMs: 0,
        text: 'Hel',
        words: [
          { startMs: 0, text: 'Hel' },
          { startMs: 500, text: 'lo' },
        ],
      },
      { startMs: 1000, text: 'world', words: [{ startMs: 1000, text: 'world' }] },
    ]
    const merged = mergeWithNext(lines, 0)
    expect(merged[0]!.words?.map((w) => w.text)).toEqual(['Hel', 'lo', ' world'])
  })

  it('does nothing without a next line', () => {
    const lines: LyricLine[] = [{ startMs: 0, text: 'a' }]
    expect(mergeWithNext(lines, 0)).toEqual(lines)
    expect(mergeWithNext(lines, 0)).not.toBe(lines)
  })
})

describe('splitLine', () => {
  it('splits at a character and interpolates the time by position', () => {
    const lines: LyricLine[] = [{ startMs: 1000, endMs: 3000, text: 'abcd' }]
    expect(splitLine(lines, 0, 1)).toEqual([
      { startMs: 1000, endMs: 1500, text: 'a' },
      { startMs: 1500, endMs: 3000, text: 'bcd' },
    ])
  })

  it('uses the next start, then start + 3000, as the end when there is no endMs', () => {
    const next: LyricLine[] = [
      { startMs: 0, text: 'ab' },
      { startMs: 2000, text: 'x' },
    ]
    expect(splitLine(next, 0, 1)[1]!.startMs).toBe(1000)
    const last: LyricLine[] = [{ startMs: 0, text: 'ab' }]
    expect(splitLine(last, 0, 1)[1]!.startMs).toBe(1500)
  })

  it('keeps word timings on the side they start in', () => {
    const lines: LyricLine[] = [
      {
        startMs: 0,
        endMs: 2000,
        text: 'abcd',
        words: [
          { startMs: 0, text: 'ab' },
          { startMs: 1000, text: 'cd' },
        ],
      },
    ]
    const [left, right] = splitLine(lines, 0, 2)
    expect(left!.words?.map((w) => w.text)).toEqual(['ab'])
    expect(right!.words?.map((w) => w.text)).toEqual(['cd'])
  })

  it('does nothing when a side would be empty', () => {
    const lines: LyricLine[] = [{ startMs: 0, text: 'ab ' }]
    expect(splitLine(lines, 0, 0)).toEqual(lines)
    expect(splitLine(lines, 0, 3)).toEqual(lines)
  })
})

describe('shiftLine and setLineStart', () => {
  const lines: LyricLine[] = [
    { startMs: 1000, endMs: 2000, text: 'a', words: [{ startMs: 1000, text: 'a' }] },
    { startMs: 3000, text: 'b' },
  ]

  it('shifts a line with its end and words, keeping order', () => {
    const shifted = shiftLine(lines, 0, 2500)
    expect(shifted[0]).toEqual({ startMs: 3000, text: 'b' })
    expect(shifted[1]).toEqual({
      startMs: 3500,
      endMs: 4500,
      text: 'a',
      words: [{ startMs: 3500, text: 'a' }],
    })
  })

  it('clamps the start at 0', () => {
    expect(shiftLine(lines, 0, -5000)[0]!.startMs).toBe(0)
  })

  it('setLineStart sets the start and keeps the duration', () => {
    const moved = setLineStart(lines, 0, 1500)
    expect(moved.find((l) => l.text === 'a')).toMatchObject({ startMs: 1500, endMs: 2500 })
  })
})

describe('moveText', () => {
  it('swaps text but keeps timings in place', () => {
    const lines: LyricLine[] = [
      { startMs: 1000, endMs: 2000, text: 'first' },
      { startMs: 3000, text: 'second' },
    ]
    expect(moveText(lines, 0, 1)).toEqual([
      { startMs: 1000, endMs: 2000, text: 'second' },
      { startMs: 3000, text: 'first' },
    ])
  })

  it('does nothing without a neighbour in that direction', () => {
    const lines: LyricLine[] = [
      { startMs: 0, text: 'a' },
      { startMs: 1000, text: 'b' },
    ]
    expect(moveText(lines, 0, -1)).toEqual(lines)
    expect(moveText(lines, 1, 1)).toEqual(lines)
  })
})

describe('tapsToStarts', () => {
  it('sets consecutive line starts from taps and drops words on retimed lines', () => {
    const lines: LyricLine[] = [
      { startMs: 0, text: 'a' },
      { startMs: 1000, text: 'b', words: [{ startMs: 1000, text: 'b' }] },
      { startMs: 2000, text: 'c' },
    ]
    const out = tapsToStarts(lines, 1, [1500, 2500])
    expect(out).toEqual([
      { startMs: 0, text: 'a' },
      { startMs: 1500, text: 'b' },
      { startMs: 2500, text: 'c' },
    ])
  })

  it('ignores taps past the last line', () => {
    const lines: LyricLine[] = [{ startMs: 0, text: 'a' }]
    expect(tapsToStarts(lines, 0, [100, 200, 300])).toEqual([{ startMs: 100, text: 'a' }])
  })
})

describe('karaokeState', () => {
  const plain: LyricLine[] = [
    { startMs: 1000, endMs: 2000, text: 'one' },
    { startMs: 3000, text: 'two' },
  ]

  it('is -1 before the first line', () => {
    expect(karaokeState(plain, 500)).toEqual({ index: -1, progress: 0, wordIndex: -1 })
  })

  it('interpolates linearly inside a line without words', () => {
    expect(karaokeState(plain, 1500)).toEqual({ index: 0, progress: 0.5, wordIndex: -1 })
  })

  it('moves to the next line in the gap after the end', () => {
    expect(karaokeState(plain, 2500)).toEqual({ index: 0, progress: 1, wordIndex: -1 })
    expect(karaokeState(plain, 3500).index).toBe(1)
  })

  it('reports progress 1 after the end of the last line', () => {
    const state = karaokeState(plain, 999999)
    expect(state.index).toBe(1)
    expect(state.progress).toBe(1)
  })

  it('uses word timing when present', () => {
    const lines: LyricLine[] = [
      {
        startMs: 0,
        endMs: 4000,
        text: 'abcd',
        words: [
          { startMs: 0, text: 'ab' },
          { startMs: 1000, text: 'cd' },
        ],
      },
    ]
    expect(karaokeState(lines, 500)).toEqual({ index: 0, progress: 0.25, wordIndex: 0 })
    const second = karaokeState(lines, 1500)
    expect(second.wordIndex).toBe(1)
    expect(second.progress).toBeCloseTo((1 + 500 / 3000) / 2, 10)
    expect(karaokeState(lines, 9000)).toEqual({ index: 0, progress: 1, wordIndex: 1 })
  })

  it('stays at zero progress before the first word of a worded line', () => {
    const lines: LyricLine[] = [
      { startMs: 0, endMs: 4000, text: 'ab', words: [{ startMs: 500, text: 'ab' }] },
    ]
    expect(karaokeState(lines, 100)).toEqual({ index: 0, progress: 0, wordIndex: -1 })
  })
})

describe('lyricForPhrase', () => {
  const lines: LyricLine[] = [
    { startMs: 1000, text: 'one' },
    { startMs: 3000, text: 'two' },
    { startMs: 9000, text: 'three' },
  ]

  it('returns the first line starting within the phrase, with 500 ms lead', () => {
    expect(lyricForPhrase(lines, phrase(0, 2600, 4000))).toBe('two')
    expect(lyricForPhrase(lines, phrase(0, 3600, 4000))).toBe('')
  })

  it('accepts a line starting up to 500 ms before the phrase', () => {
    expect(lyricForPhrase(lines, phrase(0, 2500, 4000))).toBe('two')
  })

  it('returns an empty string when no line matches', () => {
    expect(lyricForPhrase(lines, phrase(0, 5000, 6000))).toBe('')
    expect(lyricForPhrase([], phrase(0, 0, 1000))).toBe('')
  })
})
