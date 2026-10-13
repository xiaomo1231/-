// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { GrooveLabDB, getDb, setDbForTests } from '@/infrastructure/db/database'
import {
  FullBackupError,
  exportFullBackup,
  isFullBackup,
  restoreFullBackup,
  summarizeFullBackup,
} from '@/services/fullBackup'

let n = 0
beforeEach(() => setDbForTests(new GrooveLabDB(`fb-${Date.now()}-${n++}`)))

const bytes = (b: Blob) => b.arrayBuffer().then((x) => [...new Uint8Array(x)])

describe('full backup', () => {
  it('round-trips rows with blobs, buffers and typed arrays; keeps AI settings and library folders', async () => {
    const db = getDb()
    await db.table('profile').put({ id: 'me', displayName: '小明', createdAt: 1 })
    await db
      .table('audioFiles')
      .put({
        id: 'a1',
        sheetId: 's1',
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }),
      })
    await db.table('sheetFiles').put({ id: 's1', bytes: new Uint8Array([9, 8, 7]).buffer })
    await db.table('pitchCurves').put({ fileId: 'a1', midi: new Float32Array([60.5, 61]) })
    await db.table('aiSettings').put({ id: 'default', provider: 'x' })
    await db.table('libraryFolders').put({ id: 'f', name: 'here', handle: null, addedAt: 1 })

    const file = await exportFullBackup('0.23.0')
    expect(await isFullBackup(file)).toBe(true)
    const sum = await summarizeFullBackup(file)
    expect(sum.counts.profile).toBe(1)
    expect(sum.counts.aiSettings).toBeUndefined()

    // A different computer: other data, its own AI settings.
    setDbForTests(new GrooveLabDB(`fb-target-${n++}`))
    const target = getDb()
    await target.table('profile').put({ id: 'me', displayName: '别人', createdAt: 2 })
    await target.table('aiSettings').put({ id: 'default', provider: 'mine' })
    await restoreFullBackup(file)

    expect((await target.table('profile').get('me')).displayName).toBe('小明')
    const audio = await target.table('audioFiles').get('a1')
    expect(audio.blob.type).toBe('audio/wav')
    expect(await bytes(audio.blob)).toEqual([1, 2, 3])
    expect([...new Uint8Array((await target.table('sheetFiles').get('s1')).bytes)]).toEqual([
      9, 8, 7,
    ])
    const curve = (await target.table('pitchCurves').get('a1')).midi
    expect(curve).toBeInstanceOf(Float32Array)
    expect([...curve]).toEqual([60.5, 61])
    expect((await target.table('aiSettings').get('default')).provider).toBe('mine')
  })

  it('refuses a cut-off file and changes nothing', async () => {
    const db = getDb()
    await db.table('profile').put({ id: 'me', displayName: '小明', createdAt: 1 })
    await db
      .table('audioFiles')
      .put({ id: 'a1', sheetId: 's1', blob: new Blob([new Uint8Array(1000)]) })
    const file = await exportFullBackup('x')
    const cut = file.slice(0, file.size - 10)
    await expect(summarizeFullBackup(cut)).rejects.toBeInstanceOf(FullBackupError)
    await expect(restoreFullBackup(cut)).rejects.toBeInstanceOf(FullBackupError)
    expect(await isFullBackup(new Blob(['{"app":"groovelab"}']))).toBe(false)
  })
})
