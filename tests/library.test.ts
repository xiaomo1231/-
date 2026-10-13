import { describe, expect, it } from 'vitest'
import { cleanFileName, decideName, decodeLegacyText, repairMojibake, splitArtistTitle, tidyFileName, titleKey } from '@/songs/libraryNames'
import { parseFlac, parseId3v1, parseId3v2, parseMp4, parseOgg, parseTags } from '@/audio/library/tags'

const latin1 = (bytes: Uint8Array) => String.fromCharCode(...bytes)
const gbk = (s: string) => {
  // a few GBK code points for the test words (encoder-free)
  const table: Record<string, number[]> = { 你: [0xc4, 0xe3], 好: [0xba, 0xc3], 歌: [0xb8, 0xe8] }
  return Uint8Array.from([...s].flatMap((c) => table[c] ?? [c.charCodeAt(0)]))
}

describe('歌曲库 names', () => {
  it('repairs Chinese that was read as Latin-1 (GBK or UTF-8), leaves normal text alone', () => {
    expect(repairMojibake(latin1(gbk('你好')))).toBe('你好')
    expect(repairMojibake(latin1(new TextEncoder().encode('你好')))).toBe('你好')
    expect(repairMojibake('Café')).toBe('Café')
    expect(repairMojibake('你好')).toBe('你好')
    expect(decodeLegacyText(Uint8Array.from([...gbk('你好'), 0, 0]))).toBe('你好')
    expect(decodeLegacyText(new TextEncoder().encode('Hello  '))).toBe('Hello')
  })

  it('cleans file names: numbers, quality marks, ids, underscores', () => {
    expect(cleanFileName('01. 示例歌手 - 测试歌曲 [无损].flac')).toBe('示例歌手 - 测试歌曲')
    expect(cleanFileName('示例歌手_测试歌曲(320k).mp3')).toBe('示例歌手 测试歌曲')
    expect(cleanFileName('测试歌曲 - 示例歌手 mqms2.mp3')).toBe('测试歌曲 - 示例歌手')
    expect(cleanFileName('测试歌曲 3f9a2b7c8d1e4f60.mp3')).toBe('测试歌曲')
    expect(cleanFileName('(3) 测试歌曲【咪咕】.m4a')).toBe('测试歌曲')
  })

  it('splits artist and title, using the folder name and singer lists as hints', () => {
    expect(splitArtistTitle('示例歌手 - 测试歌曲')).toEqual({ artist: '示例歌手', title: '测试歌曲' })
    expect(splitArtistTitle('测试歌曲 - 示例歌手', '示例歌手')).toEqual({ artist: '示例歌手', title: '测试歌曲' })
    expect(splitArtistTitle('测试歌曲 - 甲、乙')).toEqual({ artist: '甲、乙', title: '测试歌曲' })
    expect(splitArtistTitle('没有分隔')).toBeNull()
    // a singer the library already knows wins over the usual order
    const score = (k: string) => ({ 示例歌手: 1, 测试歌曲: -1, 某乐队: 2 })[k] ?? 0
    expect(splitArtistTitle('测试歌曲 - 示例歌手 (Live)', undefined, score)).toEqual({ artist: '示例歌手', title: '测试歌曲 (Live)' })
    expect(decideName('第二首 320k.mp3', null, '某乐队', score)).toMatchObject({ title: '第二首', artist: '某乐队', needsReview: false })
  })

  it('prefers tags, falls back to the file name, flags what it cannot tell', () => {
    expect(decideName('123456789.mp3', { title: '测试歌曲', artist: '示例歌手' })).toEqual({ title: '测试歌曲', artist: '示例歌手', source: 'tags', needsReview: false })
    expect(decideName('示例歌手 - 测试歌曲.mp3', null)).toEqual({ title: '测试歌曲', artist: '示例歌手', source: 'filename', needsReview: false })
    expect(decideName('测试歌曲.mp3', null).needsReview).toBe(true)
    expect(decideName('20241010123456.mp3', null).needsReview).toBe(true)
    expect(decideName('x.mp3', { title: latin1(gbk('你好')), artist: '' }).title).toBe('你好')
  })

  it('writes back a tidy file name and groups versions by title', () => {
    expect(tidyFileName({ title: '测试: 歌曲?', artist: '示例歌手' }, 'abc.MP3')).toBe('示例歌手 - 测试_ 歌曲_.mp3')
    expect(titleKey('测试 歌曲 (Live)')).toBe(titleKey('测试歌曲'))
  })
})

// ---- tag parsers -------------------------------------------------------------

function id3Frame(id: string, text: string, enc = 3): number[] {
  const body = enc === 3 ? [...new TextEncoder().encode(text)] : [...gbk(text)]
  const data = [enc, ...body]
  const n = data.length
  return [...id].map((c) => c.charCodeAt(0)).concat([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff, 0, 0], data)
}

function id3(frames: number[][]): Uint8Array {
  const body = frames.flat()
  const n = body.length
  return Uint8Array.from([0x49, 0x44, 0x33, 3, 0, 0, (n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f, ...body])
}

const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]
function vorbis(comments: string[]): number[] {
  const enc = comments.map((c) => [...new TextEncoder().encode(c)])
  return [...le32(3), 0x61, 0x62, 0x63, ...le32(enc.length), ...enc.flatMap((e) => [...le32(e.length), ...e])]
}

describe('embedded tags', () => {
  it('reads ID3v2 (UTF-8 and GBK-as-Latin-1) and ID3v1', () => {
    expect(parseId3v2(id3([id3Frame('TIT2', '测试歌曲'), id3Frame('TPE1', '示例歌手')]))).toEqual({ title: '测试歌曲', artist: '示例歌手' })
    expect(parseId3v2(id3([id3Frame('TIT2', '你好', 0)]))).toEqual({ title: '你好' })
    const v1 = new Uint8Array(128)
    v1.set([0x54, 0x41, 0x47])
    v1.set(gbk('你好'), 3)
    v1.set(new TextEncoder().encode('Singer'), 33)
    expect(parseId3v1(v1)).toEqual({ title: '你好', artist: 'Singer' })
  })

  it('reads FLAC and Ogg Vorbis comments', () => {
    const block = vorbis(['TITLE=测试歌曲', 'ARTIST=示例歌手'])
    const flac = Uint8Array.from([0x66, 0x4c, 0x61, 0x43, 0x84, (block.length >> 16) & 0xff, (block.length >> 8) & 0xff, block.length & 0xff, ...block])
    expect(parseFlac(flac)).toEqual({ title: '测试歌曲', artist: '示例歌手' })
    const ogg = Uint8Array.from([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0, 3, ...[...'vorbis'].map((c) => c.charCodeAt(0)), ...vorbis(['title=Song A', 'artist=Band B'])])
    expect(parseOgg(ogg)).toEqual({ title: 'Song A', artist: 'Band B' })
  })

  it('reads MP4 ilst atoms, in the head or the tail', () => {
    const atom = (name: string, body: number[]) => {
      const n = body.length + 8
      return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff, ...[...name].map((c) => c.charCodeAt(0)), ...body]
    }
    const data = (s: string) => atom('data', [0, 0, 0, 1, 0, 0, 0, 0, ...new TextEncoder().encode(s)])
    const ilst = atom('ilst', [...atom('©nam', data('测试歌曲')), ...atom('©ART', data('示例歌手'))])
    const file = Uint8Array.from([...atom('ftyp', [0x4d, 0x34, 0x41, 0x20]), ...atom('moov', atom('udta', atom('meta', [0, 0, 0, 0, ...ilst])))])
    expect(parseMp4(file)).toEqual({ title: '测试歌曲', artist: '示例歌手' })
    expect(parseTags(file, new Uint8Array())).toEqual({ title: '测试歌曲', artist: '示例歌手' })
    expect(parseTags(new Uint8Array(16), new Uint8Array(16))).toBeNull()
  })
})
