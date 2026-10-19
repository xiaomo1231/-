import { describe, expect, it } from 'vitest'
import { versionLine } from '../src/songs/versionLine'
import type { VersionInfo } from '../src/songs/scoreServerTypes'

const info = (kinds: VersionInfo['tracks'][number]['kind'][], over: Partial<VersionInfo> = {}): VersionInfo => ({
  tracks: kinds.map((kind, i) => ({ name: `t${i}`, kind })),
  tempo: 120,
  bars: 64,
  ...over,
})

describe('versionLine', () => {
  it('names the instruments in order, with counts, and the track total', () => {
    const line = versionLine({
      format: 'score',
      info: info(['vocal', 'drums', 'guitar', 'bass', 'guitar', 'guitar', 'keys']),
      pages: 1,
    })
    expect(line.main).toBe('吉他×3 · 贝斯 · 鼓 · 键盘 · 人声')
    expect(line.detail).toBe('7 轨 · ♩120 · 64 小节')
  })

  it('a single instrument has no count', () => {
    expect(versionLine({ format: 'score', info: info(['guitar']), pages: 1 }).main).toBe('吉他')
  })

  it('other tracks count only in the total', () => {
    const line = versionLine({ format: 'score', info: info(['guitar', 'other', 'other']), pages: 1 })
    expect(line.main).toBe('吉他')
    expect(line.detail).toBe('3 轨 · ♩120 · 64 小节')
  })

  it('only other tracks: 其他乐器', () => {
    expect(versionLine({ format: 'score', info: info(['other']), pages: 1 }).main).toBe('其他乐器')
  })

  it('no tracks at all: 无音轨', () => {
    expect(versionLine({ format: 'score', info: info([]), pages: 1 }).main).toBe('无音轨')
  })

  it('omits tempo and bars when unknown', () => {
    const line = versionLine({
      format: 'score',
      info: info(['guitar', 'bass'], { tempo: null, bars: null }),
      pages: 1,
    })
    expect(line.detail).toBe('2 轨')
    const onlyBars = versionLine({ format: 'score', info: info(['guitar'], { tempo: 0, bars: 12 }), pages: 1 })
    expect(onlyBars.detail).toBe('1 轨 · 12 小节')
  })

  it('score without info: not read yet', () => {
    expect(versionLine({ format: 'score', info: null, pages: 1 })).toEqual({
      main: 'GP 谱',
      detail: '正在读取音轨…',
    })
  })

  it('pdf', () => {
    expect(versionLine({ format: 'pdf', info: null, pages: 1 })).toEqual({ main: 'PDF', detail: '' })
  })

  it('image: page count only above one page', () => {
    expect(versionLine({ format: 'image', info: null, pages: 1 })).toEqual({ main: '图片谱', detail: '' })
    expect(versionLine({ format: 'image', info: null, pages: 6 })).toEqual({ main: '图片谱', detail: '6 页' })
  })

  it('text and other formats', () => {
    expect(versionLine({ format: 'text', info: null, pages: 1 })).toEqual({ main: '文本谱', detail: '' })
    expect(versionLine({ format: 'mystery', info: null, pages: 1 })).toEqual({ main: '其他文件', detail: '' })
  })
})

describe('unreadable files', () => {
  it('says the tracks could not be read', () => {
    expect(
      versionLine({ format: 'score', info: { tracks: [], tempo: null, bars: null, unreadable: true }, pages: 1 }),
    ).toEqual({ main: 'GP 谱', detail: '读不出音轨，可以打开试试' })
  })
})
