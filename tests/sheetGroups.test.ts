import { describe, expect, it } from 'vitest'
import type { SongSheet } from '@/entities/types'
import { UNKNOWN_ARTIST, groupSheets, matchesSearch, versionLabel } from '@/songs/sheetGroups'

const sheet = (over: Partial<SongSheet> & Pick<SongSheet, 'id' | 'title'>): SongSheet => ({
  source: 'gp',
  bpm: 80,
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
})

describe('groupSheets', () => {
  it('groups by singer, ignoring case, spaces and punctuation', () => {
    const groups = groupSheets([
      sheet({ id: 'a', title: '晴天', artist: 'Jay Chou' }),
      sheet({ id: 'b', title: '七里香', artist: 'jay  chou' }),
      sheet({ id: 'c', title: 'Yesterday', artist: 'The Beatles' }),
    ])
    expect(groups).toHaveLength(2)
    const jay = groups.find((g) => g.artist === 'Jay Chou')!
    expect(jay.songs.map((s) => s.title).sort()).toEqual(['七里香', '晴天'])
  })

  it('folds same-title sheets of the same singer into one song with versions', () => {
    const groups = groupSheets([
      sheet({ id: 'v1', title: '晴天!', artist: '周杰伦', versionLabel: '原版', updatedAt: 100 }),
      sheet({ id: 'v2', title: '晴天', artist: '周杰伦', versionLabel: '简化版', updatedAt: 300 }),
      sheet({ id: 'v3', title: '晴天', artist: '林俊杰', updatedAt: 200 }),
    ])
    const jay = groups.find((g) => g.artist === '周杰伦')!
    expect(jay.songs).toHaveLength(1)
    expect(jay.songs[0]!.versions.map((v) => v.id)).toEqual(['v2', 'v1'])
    expect(groups.find((g) => g.artist === '林俊杰')!.songs[0]!.versions).toHaveLength(1)
  })

  it('sorts versions by most recent activity (opened or practised counts)', () => {
    const groups = groupSheets([
      sheet({ id: 'old', title: 'Song', artist: 'A', updatedAt: 500 }),
      sheet({ id: 'practised', title: 'Song', artist: 'A', updatedAt: 100, lastPracticedAt: 900 }),
    ])
    expect(groups[0]!.songs[0]!.versions.map((v) => v.id)).toEqual(['practised', 'old'])
  })

  it('puts the unknown singer last', () => {
    const groups = groupSheets([
      sheet({ id: 'n', title: '无名', updatedAt: 9999 }),
      sheet({ id: 'k', title: '有名', artist: 'Zed', updatedAt: 1 }),
    ])
    expect(groups.map((g) => g.artist)).toEqual(['Zed', UNKNOWN_ARTIST])
    expect(groups[1]!.known).toBe(false)
    expect(groups[0]!.known).toBe(true)
  })

  it('sorts songs by recent activity, title, or import time', () => {
    const sheets = [
      sheet({ id: 'apple', title: 'Apple', artist: 'X', updatedAt: 500, createdAt: 100 }),
      sheet({ id: 'banana', title: 'Banana', artist: 'X', updatedAt: 50, createdAt: 900 }),
      sheet({ id: 'cherry', title: 'Cherry', artist: 'X', updatedAt: 900, createdAt: 500 }),
    ]
    const order = (sort: 'recent' | 'title' | 'created') => groupSheets(sheets, sort)[0]!.songs.map((s) => s.title)
    expect(order('recent')).toEqual(['Cherry', 'Apple', 'Banana'])
    expect(order('title')).toEqual(['Apple', 'Banana', 'Cherry'])
    expect(order('created')).toEqual(['Banana', 'Cherry', 'Apple'])
  })

  it('defaults to recent order', () => {
    const sheets = [sheet({ id: 'a', title: 'A', artist: 'X', updatedAt: 1 }), sheet({ id: 'b', title: 'B', artist: 'X', updatedAt: 2 })]
    expect(groupSheets(sheets)[0]!.songs.map((s) => s.title)).toEqual(['B', 'A'])
  })
})

describe('versionLabel', () => {
  it('uses the custom label when there is one', () => {
    expect(versionLabel(sheet({ id: 'a', title: 'T', versionLabel: '简化版', format: 'gp5' }))).toBe('简化版')
  })

  it('defaults to format label and tabber', () => {
    const label = versionLabel(sheet({ id: 'a', title: 'T', format: 'gp5', tabber: 'Alice' }))
    expect(label).toContain('Guitar Pro 5')
    expect(label).toContain('制谱 Alice')
  })

  it('falls back to the source when there is no format', () => {
    expect(versionLabel(sheet({ id: 'a', title: 'T', source: 'midi' }))).toContain('MIDI')
  })
})

describe('matchesSearch', () => {
  const s = sheet({ id: 'a', title: 'Let it be!', artist: 'The Beatles', versionLabel: '简化版', tags: ['民谣', '练习'] })

  it('matches the title ignoring punctuation and case', () => {
    expect(matchesSearch(s, 'letitbe')).toBe(true)
    expect(matchesSearch(s, 'LET IT')).toBe(true)
  })

  it('matches the singer, version name and tags', () => {
    expect(matchesSearch(s, 'beatles')).toBe(true)
    expect(matchesSearch(s, '简化')).toBe(true)
    expect(matchesSearch(s, '民谣')).toBe(true)
  })

  it('rejects unrelated text and accepts an empty query', () => {
    expect(matchesSearch(s, 'xyz')).toBe(false)
    expect(matchesSearch(s, '   ')).toBe(true)
  })
})
