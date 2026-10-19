import { describe, expect, it } from 'vitest'
import type { FavoriteItem } from '../web/lib/api'
import {
  fileNameOf,
  filterGroups,
  groupFavorites,
  normalizeForSearch,
  songFolderOf,
} from '../web/lib/favoriteGroups'

function fav(path: string, addedAt: number, extra: Partial<FavoriteItem> = {}): FavoriteItem {
  return {
    path,
    format: 'score',
    pages: [],
    title: fileNameOf(path),
    artist: '',
    addedAt,
    ...extra,
  }
}

describe('songFolderOf', () => {
  it('男歌手 / 女歌手 layout: the song is under <歌手>', () => {
    expect(songFolderOf('1-华语/男歌手/周杰伦/晴天/晴天.gp5')).toEqual({
      key: '1-华语/男歌手/周杰伦/晴天',
      name: '晴天',
      artist: '周杰伦',
    })
    expect(songFolderOf('1-华语/女歌手/邓紫棋/光年之外/a.gp5').name).toBe('光年之外')
  })

  it('欧美 by genre: <曲风>/<歌手>/<歌名>', () => {
    expect(songFolderOf('2-欧美/摇滚/Queen/Bohemian Rhapsody/x.gp5')).toEqual({
      key: '2-欧美/摇滚/Queen/Bohemian Rhapsody',
      name: 'Bohemian Rhapsody',
      artist: 'Queen',
    })
  })

  it('欧美 未分曲风: <未分曲风>/<字母>/<歌手>/<歌名>', () => {
    expect(songFolderOf('2-欧美/未分曲风/Q/Queen/Bohemian Rhapsody/x.gp5')).toEqual({
      key: '2-欧美/未分曲风/Q/Queen/Bohemian Rhapsody',
      name: 'Bohemian Rhapsody',
      artist: 'Queen',
    })
    expect(songFolderOf('2-欧美/未分曲风/0-9与符号/50 Cent/In Da Club/x.gp5').name).toBe(
      'In Da Club',
    )
  })

  it('flat categories: 指弹演奏家 / 网友原创 / 动漫音乐', () => {
    expect(songFolderOf('4-指弹演奏家/Tommy Emmanuel/Classical Gas/x.gp5')).toEqual({
      key: '4-指弹演奏家/Tommy Emmanuel/Classical Gas',
      name: 'Classical Gas',
      artist: 'Tommy Emmanuel',
    })
    expect(songFolderOf('8-网友原创/小明/我的歌/x.gp5').artist).toBe('小明')
    expect(songFolderOf('6-动漫音乐/BanG Dream!/春日影/Final春日影.gp5')).toEqual({
      key: '6-动漫音乐/BanG Dream!/春日影',
      name: '春日影',
      artist: 'BanG Dream!',
    })
  })

  it('deeper variant folders stay under the song folder', () => {
    expect(
      songFolderOf('6-动漫音乐/BanG Dream!/Fire Bird/bass校正版/GTP/Fire Bird Final bass校正版.gp'),
    ).toEqual({
      key: '6-动漫音乐/BanG Dream!/Fire Bird',
      name: 'Fire Bird',
      artist: 'BanG Dream!',
    })
  })

  it('unknown layouts fall back to the immediate parent folder', () => {
    expect(songFolderOf('9-其它/某人/歌/x.gp5')).toEqual({
      key: '9-其它/某人/歌',
      name: '歌',
      artist: '某人',
    })
    expect(songFolderOf('1-华语/周杰伦/晴天/晴天.gp5').name).toBe('晴天')
  })

  it('a file directly under a category folder falls back without inventing a song', () => {
    expect(songFolderOf('1-华语/男歌手/周杰伦/晴天.gp5')).toEqual({
      key: '1-华语/男歌手/周杰伦',
      name: '周杰伦',
      artist: '男歌手',
    })
  })

  it('a bare file name has no folder', () => {
    expect(songFolderOf('x.gp5')).toEqual({ key: '', name: '', artist: '' })
  })
})

describe('fileNameOf / normalizeForSearch', () => {
  it('returns the last path segment', () => {
    expect(fileNameOf('a/b/Final春日影.gp5')).toBe('Final春日影.gp5')
  })

  it('folds full-width characters, case and spaces', () => {
    expect(normalizeForSearch('ＢＡＮＧ Dream')).toBe('bangdream')
  })
})

describe('groupFavorites', () => {
  const a1 = fav('6-动漫音乐/BanG Dream!/春日影/Final春日影.gp5', 100)
  const a2 = fav('6-动漫音乐/BanG Dream!/春日影/春日影 (songsterr 3).gp5', 300)
  const b1 = fav('1-华语/男歌手/周杰伦/晴天/晴天.gp5', 200, { artist: '周杰伦' })
  const c1 = fav('2-欧美/未分曲风/Q/Queen/Bohemian Rhapsody/x.gp5', 50, { artist: 'Queen' })

  it('groups starred files of one song together, newest first inside', () => {
    const groups = groupFavorites([a1, b1, a2, c1], 'added')
    const spring = groups.find((g) => g.name === '春日影')
    expect(spring?.items.map((f) => f.path)).toEqual([a2.path, a1.path])
    expect(spring?.artist).toBe('BanG Dream!')
    expect(groups.length).toBe(3)
  })

  it("'added' orders groups by their newest starred item", () => {
    expect(groupFavorites([a1, b1, a2, c1], 'added').map((g) => g.name)).toEqual([
      '春日影',
      '晴天',
      'Bohemian Rhapsody',
    ])
  })

  it("'artist' orders by artist then song name", () => {
    const groups = groupFavorites([a1, b1, a2, c1], 'artist')
    expect(groups.map((g) => g.artist)).toEqual(['BanG Dream!', 'Queen', '周杰伦'].sort(
      (x, y) => new Intl.Collator('zh-Hans-u-co-pinyin', { numeric: true }).compare(x, y),
    ))
  })

  it("'practiced' puts recently practised groups first, others by added time", () => {
    const practice: Record<string, number> = {
      [c1.path]: 900,
      [b1.path]: 500,
    }
    const groups = groupFavorites([a1, b1, a2, c1], 'practiced', (p) => practice[p])
    expect(groups.map((g) => g.name)).toEqual(['Bohemian Rhapsody', '晴天', '春日影'])
  })

  it('returns no groups for no items', () => {
    expect(groupFavorites([], 'added')).toEqual([])
  })
})

describe('filterGroups', () => {
  const a1 = fav('6-动漫音乐/BanG Dream!/春日影/Final春日影.gp5', 100)
  const a2 = fav('6-动漫音乐/BanG Dream!/春日影/春日影 (songsterr 3).gp5', 300)
  const b1 = fav('1-华语/男歌手/周杰伦/晴天/晴天.gp5', 200)
  const groups = groupFavorites([a1, a2, b1], 'added')

  it('an empty query keeps everything', () => {
    expect(filterGroups(groups, '  ')).toBe(groups)
  })

  it('matches the song name and returns all its starred files', () => {
    const out = filterGroups(groups, '春日')
    expect(out.map((g) => g.name)).toEqual(['春日影'])
    expect(out[0]?.items.length).toBe(2)
  })

  it('matches the artist', () => {
    expect(filterGroups(groups, '周杰伦').map((g) => g.name)).toEqual(['晴天'])
  })

  it('matches file names and keeps only those files', () => {
    const out = filterGroups(groups, 'songsterr')
    expect(out.length).toBe(1)
    expect(out[0]?.items.map((f) => fileNameOf(f.path))).toEqual(['春日影 (songsterr 3).gp5'])
  })

  it('is case-insensitive, full-width tolerant and ignores spaces', () => {
    expect(filterGroups(groups, 'ＢＡＮＧ dream').map((g) => g.name)).toEqual(['春日影'])
    expect(filterGroups(groups, 'songsterr3').length).toBe(1)
  })

  it('returns nothing when no group matches', () => {
    expect(filterGroups(groups, '不存在')).toEqual([])
  })
})

describe('renamed files and songs', () => {
  const a1 = fav('6-动漫音乐/BanG Dream!/春日影/Final春日影.gp5', 100, { alias: '我的指弹版' })
  const a2 = fav('6-动漫音乐/BanG Dream!/春日影/春日影 (songsterr 3).gp5', 300, {
    songAlias: '春日影（练习）',
  })
  const b1 = fav('1-华语/男歌手/周杰伦/晴天/晴天.gp5', 200)

  it('the heading shows the song alias when any item has one, else the song name', () => {
    const groups = groupFavorites([a1, a2, b1], 'added')
    const spring = groups.find((g) => g.name === '春日影')!
    expect(spring.songAlias).toBe('春日影（练习）')
    expect(spring.displayTitle).toBe('春日影（练习）')
    expect(spring.originalTitle).toBe('春日影')
    const sunny = groups.find((g) => g.name === '晴天')!
    expect(sunny.songAlias).toBeUndefined()
    expect(sunny.displayTitle).toBe('晴天')
    expect(sunny.originalTitle).toBe('晴天')
  })

  it('search matches the file alias and the song alias', () => {
    const groups = groupFavorites([a1, a2, b1], 'added')
    expect(filterGroups(groups, '指弹版').map((g) => g.name)).toEqual(['春日影'])
    expect(filterGroups(groups, '指弹版')[0]?.items.map((f) => f.alias)).toEqual(['我的指弹版'])
    expect(filterGroups(groups, '练习').map((g) => g.name)).toEqual(['春日影'])
    expect(filterGroups(groups, '练习')[0]?.items.length).toBe(2)
  })

  it('original names still match', () => {
    const groups = groupFavorites([a1, a2, b1], 'added')
    expect(filterGroups(groups, 'Final春日影').map((g) => g.name)).toEqual(['春日影'])
    expect(filterGroups(groups, '周杰伦').map((g) => g.name)).toEqual(['晴天'])
  })
})
