import { describe, expect, it } from 'vitest'
import { buildContinueList, whenLabel } from '../web/lib/continueList'
import type { FavoriteItem, PracticeRecord } from '../web/lib/api'
import type { RecentItem } from '../web/lib/recent'

// Monday 19 Oct 2026, 12:00 local.
const NOW = new Date(2026, 9, 19, 12, 0).getTime()
const HOUR = 3_600_000

function practice(over: Partial<PracticeRecord>): PracticeRecord {
  return {
    path: 'A/春日影/春日影.gp',
    title: '春日影',
    artist: '某歌手',
    speedPct: 80,
    loopBars: null,
    muted: [],
    totalSeconds: 420,
    maxSpeedPct: 80,
    firstAt: NOW - 10 * HOUR,
    lastAt: NOW - 2 * HOUR,
    ...over,
  }
}

function recent(over: Partial<RecentItem>): RecentItem {
  return {
    path: 'A/春日影/春日影.gp',
    format: 'score',
    pages: [],
    title: '春日影',
    artist: '某歌手',
    at: NOW - 3 * HOUR,
    ...over,
  }
}

function fav(over: Partial<FavoriteItem>): FavoriteItem {
  return {
    path: 'A/春日影/春日影.gp',
    format: 'score',
    pages: [],
    title: '春日影',
    artist: '某歌手',
    addedAt: NOW - 100 * HOUR,
    ...over,
  }
}

describe('buildContinueList', () => {
  it('merges two versions of one song into one row and opens the most recently used path', () => {
    const rows = buildContinueList({
      practice: [
        practice({ path: 'A/春日影/春日影 v1.gp', lastAt: NOW - 5 * HOUR }),
        practice({ path: 'A/春日影/春日影 v2.gp', lastAt: NOW - 1 * HOUR, speedPct: 90 }),
      ],
      recent: [],
      favorites: [],
      now: NOW,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.path).toBe('A/春日影/春日影 v2.gp')
    expect(rows[0]!.at).toBe(NOW - 1 * HOUR)
  })

  it('does not merge same-title songs from different folders', () => {
    const rows = buildContinueList({
      practice: [practice({ path: 'A/春日影/a.gp' }), practice({ path: 'B/春日影/a.gp' })],
      recent: [],
      favorites: [],
      now: NOW,
    })
    expect(rows).toHaveLength(2)
  })

  it('uses the latest activity across practice and recent opening', () => {
    const rows = buildContinueList({
      practice: [practice({ lastAt: NOW - 5 * HOUR })],
      recent: [recent({ path: 'A/春日影/春日影 v2.gp', at: NOW - 1 * HOUR })],
      favorites: [],
      now: NOW,
    })
    expect(rows[0]!.path).toBe('A/春日影/春日影 v2.gp')
    expect(rows[0]!.at).toBe(NOW - 1 * HOUR)
  })

  it('writes the practice line with speed and rounded minutes', () => {
    const rows = buildContinueList({
      practice: [practice({ speedPct: 80, totalSeconds: 7 * 60 + 20 })],
      recent: [],
      favorites: [],
      now: NOW,
    })
    expect(rows[0]!.line).toBe('上次 80% · 共练 7 分钟')
  })

  it('says 不到 1 分钟 under a minute of practice', () => {
    const rows = buildContinueList({
      practice: [practice({ totalSeconds: 30 })],
      recent: [],
      favorites: [],
      now: NOW,
    })
    expect(rows[0]!.line).toBe('上次 80% · 共练 不到 1 分钟')
  })

  it('says 看过，还没练 for a song only opened', () => {
    const rows = buildContinueList({
      practice: [],
      recent: [recent({})],
      favorites: [],
      now: NOW,
    })
    expect(rows[0]!.line).toBe('看过，还没练')
    expect(rows[0]!.starred).toBe(false)
  })

  it('adds the favourite count: 已收藏 for one, 收藏了 N 个版本 for several', () => {
    const one = buildContinueList({
      practice: [],
      recent: [recent({})],
      favorites: [fav({})],
      now: NOW,
    })
    expect(one[0]!.line).toBe('看过，还没练 · 已收藏')
    expect(one[0]!.starred).toBe(true)

    const two = buildContinueList({
      practice: [practice({})],
      recent: [],
      favorites: [fav({ path: 'A/春日影/a.gp' }), fav({ path: 'A/春日影/b.gp' })],
      now: NOW,
    })
    expect(two[0]!.line).toBe('上次 80% · 共练 7 分钟 · 收藏了 2 个版本')
    expect(two[0]!.starred).toBe(true)
  })

  it('leaves out favourites that were never opened or practised', () => {
    const rows = buildContinueList({
      practice: [],
      recent: [],
      favorites: [fav({ path: 'C/别的歌/x.gp', title: '别的歌' })],
      now: NOW,
    })
    expect(rows).toEqual([])
  })

  it('sorts by activity and applies the limit (default 6)', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      practice({ path: `A/歌${i}/x.gp`, title: `歌${i}`, lastAt: NOW - i * HOUR }),
    )
    const rows = buildContinueList({ practice: many, recent: [], favorites: [], now: NOW })
    expect(rows).toHaveLength(6)
    expect(rows.map((r) => r.title)).toEqual(['歌0', '歌1', '歌2', '歌3', '歌4', '歌5'])

    const two = buildContinueList({ practice: many, recent: [], favorites: [], now: NOW, limit: 2 })
    expect(two).toHaveLength(2)
  })
})

describe('whenLabel', () => {
  it('uses 今天 and 昨天', () => {
    expect(whenLabel(NOW - 2 * HOUR, NOW)).toBe('今天')
    expect(whenLabel(NOW - 26 * HOUR, NOW)).toBe('昨天')
  })

  it('uses the weekday within the last 7 days', () => {
    // 3 days before Monday 19 Oct is Friday 16 Oct.
    expect(whenLabel(NOW - 3 * 24 * HOUR, NOW)).toBe('周五')
    // 6 days before is Tuesday 13 Oct.
    expect(whenLabel(NOW - 6 * 24 * HOUR, NOW)).toBe('周二')
  })

  it('uses M 月 D 日 beyond a week', () => {
    expect(whenLabel(new Date(2026, 8, 30, 20, 0).getTime(), NOW)).toBe('9 月 30 日')
  })
})
