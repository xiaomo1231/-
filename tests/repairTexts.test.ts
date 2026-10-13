import { beforeEach, describe, expect, it } from 'vitest'
import { GrooveLabDB, getDb, setDbForTests } from '@/infrastructure/db/database'
import { SongService } from '@/services/songService'
import type { SongSheet } from '@/entities/types'

let n = 0
beforeEach(() => setDbForTests(new GrooveLabDB(`repair-${Date.now()}-${n++}`)))

const sheet = (patch: Partial<SongSheet>): SongSheet =>
  ({ id: 's1', title: '测试', createdAt: 0, updatedAt: 0, tracks: [{ index: 0, name: 'Guitar', instrument: 'guitar', tuning: [], capo: 0, notes: 1 }], ...patch }) as SongSheet

describe('repairing names stored by an older import', () => {
  it('replaces garbled track names, title and advert-laden artist', async () => {
    await getDb().songSheets.put(
      sheet({
        title: '��',
        artist: '示例歌手 www.example.cn 某网为您提供优秀的谱子',
        tracks: [
          { index: 0, name: 'Acoustic Guitar', instrument: 'guitar', tuning: [], capo: 0, notes: 1 },
          { index: 1, name: '��1', instrument: 'other', tuning: [], capo: 0, notes: 1 },
        ],
      }),
    )
    const fixed = await SongService.repairTexts('s1', { title: '示例歌名', artist: '示例歌手 www.example.cn', tracks: [{ index: 0, name: 'Acoustic Guitar' }, { index: 1, name: '键盘1' }] })
    expect(fixed?.title).toBe('示例歌名')
    expect(fixed?.artist).toBe('示例歌手')
    expect(fixed?.tracks?.map((t) => t.name)).toEqual(['Acoustic Guitar', '键盘1'])
  })
  it('leaves clean sheets alone', async () => {
    await getDb().songSheets.put(sheet({ artist: '示例歌手' }))
    expect(await SongService.repairTexts('s1', { title: '别的', artist: '别人', tracks: [{ index: 0, name: 'X' }] })).toBeUndefined()
  })
})
