import { beforeEach, describe, expect, it } from 'vitest'
import { GrooveLabDB, setDbForTests } from '@/infrastructure/db/database'
import { RECENT_KEEP, ScorePrefs } from '@/services/scorePrefsService'

let n = 0
beforeEach(() => setDbForTests(new GrooveLabDB(`score-prefs-${Date.now()}-${n++}`)))

const fav = (path: string, title = path, artist = '歌手') => ({ path, title, artist })

describe('谱库 favourites', () => {
  it('toggles a score on and off and reports the new state', async () => {
    expect(await ScorePrefs.isFavorite('a.gp5')).toBe(false)
    expect(await ScorePrefs.toggleFavorite(fav('a.gp5', '七里香', '周杰伦'))).toBe(true)
    expect(await ScorePrefs.isFavorite('a.gp5')).toBe(true)
    expect(await ScorePrefs.toggleFavorite(fav('a.gp5'))).toBe(false)
    expect(await ScorePrefs.isFavorite('a.gp5')).toBe(false)
  })

  it('lists favourites newest first and keeps image pages', async () => {
    await ScorePrefs.toggleFavorite(fav('old.gp4'))
    await new Promise((r) => setTimeout(r, 5))
    await ScorePrefs.toggleFavorite({ ...fav('new.png'), pages: ['new.png', 'new2.png'] })
    const rows = await ScorePrefs.favorites()
    expect(rows.map((r) => r.path)).toEqual(['new.png', 'old.gp4'])
    expect(rows[0]!.pages).toEqual(['new.png', 'new2.png'])
    expect(rows[1]!.pages).toBeUndefined()
  })
})

describe('谱库 recently opened', () => {
  it('upserts by path so a re-opened score moves to the top', async () => {
    await ScorePrefs.recordOpen({ path: 'a.gp5', title: 'A', artist: 'x' })
    await new Promise((r) => setTimeout(r, 5))
    await ScorePrefs.recordOpen({ path: 'b.gp5', title: 'B', artist: 'x' })
    await new Promise((r) => setTimeout(r, 5))
    await ScorePrefs.recordOpen({ path: 'a.gp5', title: 'A', artist: 'x' })
    const rows = await ScorePrefs.recent()
    expect(rows.map((r) => r.path)).toEqual(['a.gp5', 'b.gp5'])
  })

  it('keeps at most RECENT_KEEP rows and drops the oldest', async () => {
    const db = (await import('@/infrastructure/db/database')).getDb()
    const base = 1_000_000
    // Seed old rows directly so the test does not wait for real time.
    await db.scoreRecent.bulkPut(
      Array.from({ length: RECENT_KEEP }, (_, i) => ({
        path: `old-${i}.gp5`,
        openedAt: base + i,
        title: `t${i}`,
        artist: 'x',
      })),
    )
    await ScorePrefs.recordOpen({ path: 'fresh.gp5', title: 'fresh', artist: 'x' })
    expect(await db.scoreRecent.count()).toBe(RECENT_KEEP)
    expect(await db.scoreRecent.get('old-0.gp5')).toBeUndefined()
    expect((await ScorePrefs.recent(1))[0]!.path).toBe('fresh.gp5')
  })
})

describe('谱库 artist merges', () => {
  it('stores merges and returns them as pairs', async () => {
    await ScorePrefs.setMerge('Jay Chou', '周杰伦')
    await ScorePrefs.setMerge('Jay Chow', '周杰伦')
    expect(await ScorePrefs.merges()).toEqual([
      ['Jay Chou', '周杰伦'],
      ['Jay Chow', '周杰伦'],
    ])
  })

  it('removes a merge when the target is null', async () => {
    await ScorePrefs.setMerge('Jay Chou', '周杰伦')
    await ScorePrefs.setMerge('Jay Chou', null)
    expect(await ScorePrefs.merges()).toEqual([])
  })

  it('follows a target that is itself merged to its final artist', async () => {
    await ScorePrefs.setMerge('Jay Zhou', 'Jay Chou')
    await ScorePrefs.setMerge('Jay Chou', '周杰伦')
    await ScorePrefs.setMerge('Jay Chow', 'Jay Zhou')
    const map = Object.fromEntries(await ScorePrefs.merges())
    expect(map['Jay Chow']).toBe('周杰伦')
  })

  it('refuses a merge that would make a cycle', async () => {
    await ScorePrefs.setMerge('A', 'B')
    await expect(ScorePrefs.setMerge('B', 'A')).rejects.toThrow()
    await expect(ScorePrefs.setMerge('C', 'C')).resolves.toBeUndefined()
    expect(await ScorePrefs.merges()).toEqual([['A', 'B']])
  })
})
