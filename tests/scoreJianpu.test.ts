import { describe, expect, it } from 'vitest'
import { loadFromFiles, type FileList, tools } from '../server/library'
import {
  annotateSongs,
  artistNamesOf,
  buildJianpuIndex,
  isJianpuCategory,
  jianpuForSong,
  stripVersionNote,
} from '../server/jianpu'

const files: FileList = [
  ['1-华语/男歌手/周杰伦/晴天/晴天.gp5', 10],
  ['13-简谱/按歌手/周杰伦/晴天/晴天.pdf', 10],
  ['13-简谱/按歌手/周杰伦/晴天/晴天 (简单版).pdf', 10],
  ['1-华语/男歌手/周杰伦/告白气球/告白气球.gp5', 10],
  ['13-简谱/按歌手/周杰伦/告白氣球/告白氣球.pdf', 10],
  ['1-华语/男歌手/张学友/相思风雨中/相思风雨中.gp4', 10],
  ['13-简谱/按歌手/张学友+汤宝如/相思风雨中/相思风雨中.pdf', 10],
  ['1-华语/男歌手/林俊杰/晴天/晴天.gp5', 10],
  ['13-简谱/按歌手/陈奕迅/晴天/晴天.pdf', 10],
  ['13-简谱/未识别/合集A/晴天.pdf', 10],
]

const lib = loadFromFiles(files, 0)
const index = buildJianpuIndex(lib, tools)
const nameOf = (id: string) => lib.lib.artistById.get(id)?.name ?? ''

describe('scoreJianpu', () => {
  it('recognises the 简谱 category', () => {
    expect(isJianpuCategory('13-简谱')).toBe(true)
    expect(isJianpuCategory('1-华语')).toBe(false)
    expect(isJianpuCategory('13-简谱-x')).toBe(false)
  })

  it('strips trailing version notes and splits duet names', () => {
    expect(stripVersionNote('晴天 (简单版)')).toBe('晴天')
    expect(stripVersionNote('晴天（钢琴版）【伴奏】')).toBe('晴天')
    expect(artistNamesOf('张学友+汤宝如')).toEqual(['张学友', '汤宝如'])
    expect(artistNamesOf('张学友&汤宝如、刘德华和郭富城')).toEqual([
      '张学友',
      '汤宝如',
      '刘德华',
      '郭富城',
    ])
    expect(artistNamesOf('和晶')).toEqual(['和晶'])
  })

  it('matches versions of a song by artist and title', () => {
    const r = jianpuForSong(index, '周杰伦', '晴天')
    expect(r.map((e) => e.path).sort()).toEqual([
      '13-简谱/按歌手/周杰伦/晴天/晴天 (简单版).pdf',
      '13-简谱/按歌手/周杰伦/晴天/晴天.pdf',
    ])
    expect(r.map((e) => e.label).sort()).toEqual(['晴天 (简单版).pdf', '晴天.pdf'])
    expect(r[0]!.artist).toBe('周杰伦')
  })

  it('matches a traditional title against a simplified one', () => {
    const r = jianpuForSong(index, '周杰伦', '告白气球')
    expect(r.map((e) => e.path)).toEqual(['13-简谱/按歌手/周杰伦/告白氣球/告白氣球.pdf'])
  })

  it('indexes a duet under each singer and under the full name', () => {
    const p = '13-简谱/按歌手/张学友+汤宝如/相思风雨中/相思风雨中.pdf'
    expect(jianpuForSong(index, '张学友', '相思风雨中').map((e) => e.path)).toEqual([p])
    expect(jianpuForSong(index, '汤宝如', '相思风雨中').map((e) => e.path)).toEqual([p])
    expect(jianpuForSong(index, '张学友+汤宝如', '相思风雨中').map((e) => e.path)).toEqual([p])
  })

  it('never matches another artist with the same title', () => {
    expect(jianpuForSong(index, '林俊杰', '晴天')).toEqual([])
    const chen = jianpuForSong(index, '陈奕迅', '晴天')
    expect(chen.map((e) => e.path)).toEqual(['13-简谱/按歌手/陈奕迅/晴天/晴天.pdf'])
    expect(jianpuForSong(index, '周杰伦', '晴天').some((e) => e.artist === '陈奕迅')).toBe(false)
  })

  it('ignores 未识别 and returns nothing for unknown songs', () => {
    const all = [...index.byKey.values()].flat()
    expect(all.some((e) => e.path.includes('未识别'))).toBe(false)
    expect(jianpuForSong(index, '周杰伦', '不存在的歌')).toEqual([])
    expect(jianpuForSong(index, '', '晴天')).toEqual([])
  })

  it('caches the index per loaded library', () => {
    expect(buildJianpuIndex(lib, tools)).toBe(index)
  })

  it('annotates songs with their 简谱 counts', () => {
    const songs = [
      ...(lib.lib.songs.get('1-华语/男歌手/周杰伦') ?? []),
      ...(lib.lib.songs.get('1-华语/男歌手/张学友') ?? []),
      ...(lib.lib.songs.get('1-华语/男歌手/林俊杰') ?? []),
      ...(lib.lib.songs.get('13-简谱/按歌手/陈奕迅') ?? []),
    ]
    const out = annotateSongs(index, lib, songs, nameOf)
    const byTitle = (t: string, artistId: string) =>
      out.find((s) => s.title === t && s.artistId === artistId)
    expect(byTitle('晴天', '1-华语/男歌手/周杰伦')?.jianpu).toBe(2)
    expect(byTitle('告白气球', '1-华语/男歌手/周杰伦')?.jianpu).toBe(1)
    expect(byTitle('相思风雨中', '1-华语/男歌手/张学友')?.jianpu).toBe(1)
    expect(byTitle('晴天', '1-华语/男歌手/林俊杰')).not.toHaveProperty('jianpu')
    expect(byTitle('晴天', '13-简谱/按歌手/陈奕迅')).not.toHaveProperty('jianpu')
    // Input songs are not mutated.
    expect(songs.some((s) => 'jianpu' in s)).toBe(false)
  })
})
