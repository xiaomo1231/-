import { describe, expect, it } from 'vitest'
import { HOP, type PitchCurve } from '@/songs/singAlong'
import {
  alignLyrics,
  autoPhrases,
  groupTakes,
  lyricsInPhrase,
  mergeWithPrevious,
  phrasesFromLyrics,
  phrasesFromRanges,
  sameStretch,
  splitAt,
  splitPoint,
  syllableCount,
  takeFitsPhrase,
} from '@/songs/phrasing'

/** A pitch line from parts: [ms, midi | null for silence]. Each sung part changes pitch every `noteMs`. */
function curveOf(parts: Array<[number, number | null]>, noteMs = 200): PitchCurve {
  const hopMs = HOP * 1000
  const frames: number[] = []
  for (const [ms, midi] of parts) {
    const n = Math.round(ms / hopMs)
    for (let i = 0; i < n; i++) frames.push(midi === null ? NaN : midi + (Math.floor((i * hopMs) / noteMs) % 2) * 2)
  }
  return { hop: HOP, midi: Float32Array.from(frames) }
}

describe('分句', () => {
  it('keeps a breath inside a line and still splits at a real pause', () => {
    // 1.5 s, 0.4 s breath, 1.6 s | 1.5 s pause | 2 s
    const c = curveOf([[1000, null], [1500, 60], [400, null], [1600, 62], [1500, null], [2000, 64]])
    const ps = autoPhrases(c)
    expect(ps).toHaveLength(2)
    expect(ps[0]!.startMs).toBe(1000)
    expect(ps[0]!.endMs).toBe(4500)
    expect(ps[1]!.startMs).toBe(6000)
  })

  it('follows the lyric lines, tightened to the singing', () => {
    const c = curveOf([[1000, null], [3000, 60], [1000, null], [2000, 64], [500, null]])
    const ps = phrasesFromLyrics(c, [
      { startMs: 900, text: '第一行' },
      { startMs: 4800, text: '第二行' },
    ])
    expect(ps.map((p) => [p.startMs, p.endMs, p.lyric])).toEqual([
      [1000, 4000, '第一行'],
      [5000, 7000, '第二行'],
    ])
    expect(lyricsInPhrase([], ps[1]!)).toBe('第二行')
    expect(lyricsInPhrase([{ startMs: 0, text: 'a' }, { startMs: 1500, text: 'b' }], { startMs: 0, endMs: 3000 })).toBe('a b')
  })

  it('merges, finds a split point and splits by hand', () => {
    const c = curveOf([[1000, null], [1500, 60], [400, null], [1600, 62], [1500, null], [2000, 64]])
    const ps = phrasesFromRanges(c, [
      { startMs: 1000, endMs: 4500 },
      { startMs: 6000, endMs: 8000 },
    ])
    expect(mergeWithPrevious(ps, 1)).toEqual([{ startMs: 1000, endMs: 8000 }])
    const at = splitPoint(c, ps[0]!)
    expect(at).not.toBeNull()
    expect(at!).toBeGreaterThan(2500)
    expect(at!).toBeLessThan(2900)
    expect(splitAt(ps, 0, at!)).toHaveLength(3)
    expect(splitPoint(c, ps[1]!)).toBeNull()
  })
})

describe('歌词自动对齐', () => {
  it('counts sung syllables', () => {
    expect(syllableCount('一二三四五六七 八九十一二三')).toBe(13)
    expect(syllableCount('你好 baby')).toBe(4)
  })

  it('keeps a line together across a breath and changes line at the longer pause', () => {
    // Line 1: 7 notes, 0.35 s breath, 6 notes. 1.2 s pause. Line 2: 4 notes. 1 s pause. Line 3: 5 notes.
    const c = curveOf([
      [500, null],
      [1400, 60],
      [350, null],
      [1200, 62],
      [1200, null],
      [800, 64],
      [1000, null],
      [1000, 60],
      [500, null],
    ])
    const lines = alignLyrics(['一二三四五六七 八九十一二三', '你看着我', '我们走吧'], c)
    // (frame-rounded: the 0.35 s breath is 18 frames)
    expect(lines.map((l) => l.startMs)).toEqual([500, 4660, 6460])
    expect(lines[0]!.endMs).toBe(3460)
    expect(lines.map((l) => l.text)[0]).toBe('一二三四五六七 八九十一二三')
  })

  it('appends lines that find no singing', () => {
    const c = curveOf([[500, null], [1000, 60], [500, null]])
    const lines = alignLyrics(['一', '二'], c)
    expect(lines).toHaveLength(2)
    expect(lines[1]!.startMs).toBeGreaterThan(lines[0]!.startMs)
  })
})

describe('takes follow the phrases by time', () => {
  const take = (phrase: number, fromMs: number, toMs: number) => ({ phrase, fromMs, toMs, sungMs: new Float32Array() })
  it('groups by overlap and tells old-cut takes apart', () => {
    const phrases = [
      { startMs: 1000, endMs: 4500 },
      { startMs: 6000, endMs: 8000 },
    ]
    const a = take(0, 1000, 2500) // sung on the old half phrase
    const b = take(3, 6000, 8000)
    const full = take(-1, 0, 9000)
    const g = groupTakes([a, b, full], phrases)
    expect(g[0]).toEqual([a])
    expect(g[1]).toEqual([b])
    expect(g[-1]).toEqual([full])
    expect(takeFitsPhrase(a, phrases[0]!)).toBe(false)
    expect(takeFitsPhrase(b, phrases[1]!)).toBe(true)
    expect(sameStretch(a, take(0, 1000, 4500))).toBe(true)
    expect(sameStretch(a, b)).toBe(false)
  })

  it('reads the span of older takes from their sung pitch', () => {
    const old = { phrase: 0, sungMs: Float32Array.from([6100, 7000, 7900]) }
    expect(groupTakes([old], [{ startMs: 1000, endMs: 4500 }, { startMs: 6000, endMs: 8000 }])[1]).toEqual([old])
  })
})

describe('歌词自动对齐 on a longer song', () => {
  it('finds every line start of a 12-line song with breaths inside lines', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const hopMs = HOP * 1000
    const frames: number[] = []
    const push = (ms: number, midi: number | null) => {
      for (let i = 0; i < Math.round(ms / hopMs); i++) frames.push(midi === null ? NaN : midi)
    }
    const texts: string[] = []
    const starts: number[] = []
    push(800, null)
    for (let line = 0; line < 12; line++) {
      const syl = 5 + Math.floor(rnd() * 8)
      texts.push('啊'.repeat(syl))
      starts.push(frames.length * hopMs)
      const breathAt = rnd() < 0.5 ? Math.floor(syl / 2) : -1
      for (let k = 0; k < syl; k++) {
        if (k === breathAt) push(250 + rnd() * 200, null)
        push(200 + rnd() * 80, 60 + ((k * 3) % 7))
      }
      push(700 + rnd() * 800, null)
    }
    const c: PitchCurve = { hop: HOP, midi: Float32Array.from(frames) }
    const lines = alignLyrics(texts, c)
    lines.forEach((l, i) => expect(Math.abs(l.startMs - starts[i]!)).toBeLessThanOrEqual(40))
  })
})
