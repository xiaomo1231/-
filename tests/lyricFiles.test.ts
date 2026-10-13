import { describe, expect, it } from 'vitest'
import {
  decodeLyricBytes,
  findLyricMatches,
  lrcHeader,
  lyricMatchScore,
  lyricNameParts,
  normaliseWordLrc,
  parseAss,
  parseLyricFile,
  parseSrt,
  type LyricFileEntry,
} from '@/songs/lyricFiles'
import { shiftAll } from '@/songs/lyrics'

const entry = (fileName: string, extra: Partial<LyricFileEntry> = {}): LyricFileEntry => ({
  path: fileName,
  fileName,
  size: 100,
  lastModified: 1,
  ...extra,
})

describe('lyric file parsing', () => {
  it('reads plain LRC and keeps the first line at a time, the second as its translation', () => {
    const text =
      '[ti:测试歌]\n[ar:某歌手]\n[by:tool]\n\n[00:01.00]第一句\n[00:01.00]First line\n[00:04.50]第二句\n'
    const r = parseLyricFile('a.lrc', text)
    expect(r.title).toBe('测试歌')
    expect(r.artist).toBe('某歌手')
    expect(r.lines.map((l) => [l.startMs, l.text, l.translation])).toEqual([
      [1000, '第一句', 'First line'],
      [4500, '第二句', undefined],
    ])
  })

  it('turns LDDC word-by-word LRC into word timings with a line end', () => {
    expect(normaliseWordLrc('[00:01.00]一[00:01.40]二[00:02.00]')).toBe(
      '[00:01.00]<00:01.00>一<00:01.40>二\n[00:02.00]',
    )
    const r = parseLyricFile('w.lrc', '[00:01.00]一[00:01.40]二[00:02.00]\n[00:03.00]三[00:03.50]')
    expect(r.lines[0]).toMatchObject({
      startMs: 1000,
      endMs: 2000,
      text: '一二',
      words: [
        { startMs: 1000, text: '一' },
        { startMs: 1400, text: '二' },
      ],
    })
    expect(r.lines[1]).toMatchObject({ startMs: 3000, text: '三' })
  })

  it('leaves repeated-time lines alone', () => {
    const r = parseLyricFile('r.lrc', '[00:01.00][00:10.00]副歌')
    expect(r.lines.map((l) => l.startMs)).toEqual([1000, 10000])
  })

  it('reads SRT', () => {
    const lines = parseSrt(
      '1\n00:00:01,000 --> 00:00:03,500\n你好\nHello\n\n2\n00:00:04,000 --> 00:00:05,000\n<i>再见</i>\n',
    )
    expect(lines).toEqual([
      { startMs: 1000, endMs: 3500, text: '你好', translation: 'Hello' },
      { startMs: 4000, endMs: 5000, text: '再见' },
    ])
  })

  it('reads ASS with karaoke tags as word timings', () => {
    const text =
      '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\k50}一{\\k100}二\nComment: 0,0:00:00.00,0:00:00.00,Default,,0,0,0,,x\n'
    const lines = parseAss(text)
    expect(lines).toEqual([
      {
        startMs: 1000,
        endMs: 3000,
        text: '一二',
        words: [
          { startMs: 1000, text: '一' },
          { startMs: 1500, text: '二' },
        ],
      },
    ])
  })

  it('decodes UTF-8 and GBK', () => {
    expect(decodeLyricBytes(new TextEncoder().encode('﻿[00:01.00]中文'))).toBe('[00:01.00]中文')
    const gbk = new Uint8Array([0x5b, 0x30, 0x30, 0x3a, 0x30, 0x31, 0x5d, 0xd6, 0xd0, 0xce, 0xc4]) // "[00:01]中文"
    expect(decodeLyricBytes(gbk)).toBe('[00:01]中文')
  })

  it('reads the [ti:] / [ar:] header', () => {
    expect(lrcHeader('[ar:甲]\n[ti:乙]\n[00:01.00]x')).toEqual({ artist: '甲', title: '乙' })
  })

  it('moves all lines together', () => {
    const moved = shiftAll(
      [{ startMs: 50, endMs: 900, text: 'a', words: [{ startMs: 50, text: 'a' }] }],
      -100,
    )
    expect(moved[0]).toEqual({
      startMs: 0,
      endMs: 800,
      text: 'a',
      words: [{ startMs: 0, text: 'a' }],
    })
  })
})

describe('lyric file matching', () => {
  it('splits LDDC file names and drops the song id', () => {
    expect(lyricNameParts('歌手甲 - 歌名乙 (1974443814).lrc')).toEqual(['歌手甲', '歌名乙'])
    expect(lyricNameParts('Some Song.srt')).toEqual(['Some Song'])
  })

  it('scores title + singer, title only, other singer', () => {
    const f = entry('歌手甲 - 歌名乙 (123456789).lrc')
    expect(lyricMatchScore({ title: '歌名乙', artist: '歌手甲' }, f)).toBe(100)
    expect(lyricMatchScore({ title: '歌名乙 (Live)', artist: '歌手甲' }, f)).toBe(100)
    expect(lyricMatchScore({ title: '歌名乙', artist: '' }, f)).toBe(70)
    expect(lyricMatchScore({ title: '歌名乙', artist: '歌手丙' }, f)).toBe(40)
    expect(lyricMatchScore({ title: '别的歌', artist: '歌手甲' }, f)).toBe(0)
    // "歌名 - 歌手" order also matches
    expect(
      lyricMatchScore({ title: '歌名乙', artist: '歌手甲' }, entry('歌名乙 - 歌手甲.lrc')),
    ).toBe(100)
    // several singers in one field
    expect(lyricMatchScore({ title: '合唱', artist: '甲、乙' }, entry('乙 - 合唱.lrc'))).toBe(100)
  })

  it('uses the file tags when the name does not say', () => {
    expect(
      lyricMatchScore(
        { title: '歌名乙', artist: '歌手甲' },
        entry('track01.lrc', { title: '歌名乙', artist: '歌手甲' }),
      ),
    ).toBe(100)
  })

  it('is sure only when one file clearly fits', () => {
    const files = [entry('甲 - 歌.lrc'), entry('乙 - 歌.lrc'), entry('甲 - 别的.lrc')]
    expect(findLyricMatches({ title: '歌', artist: '甲' }, files)).toMatchObject({
      sure: true,
      matches: [{ score: 100 }, { score: 40 }],
    })
    expect(findLyricMatches({ title: '歌', artist: '' }, files).sure).toBe(false)
    expect(
      findLyricMatches({ title: '歌', artist: '甲' }, [entry('甲 - 歌.lrc'), entry('甲 - 歌.srt')])
        .sure,
    ).toBe(true)
    expect(findLyricMatches({ title: '歌', artist: '丙' }, files).sure).toBe(false)
  })
})
