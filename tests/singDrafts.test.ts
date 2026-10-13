import { beforeEach, describe, expect, it } from 'vitest'
import { GrooveLabDB, setDbForTests } from '@/infrastructure/db/database'
import { SingService } from '@/services/singService'
import type { SingTake } from '@/entities/types'

let n = 0
beforeEach(() => setDbForTests(new GrooveLabDB(`drafts-${Date.now()}-${n++}`)))

const K = 'song:x'
const take = (id: string, phrase: number, score: number | null, at: number, fromMs = phrase * 5000): SingTake => ({
  id,
  key: K,
  phrase,
  createdAt: at,
  fromMs,
  toMs: fromMs + 4000,
  score: score === null ? null : { score, notesSung: 3, notesTotal: 4, meanAbsCents: 20, biasCents: 0, lagMs: 0, octaveShift: 0, noteCents: [] },
  sungMs: new Float32Array(),
  sungMidi: new Float32Array(),
})

describe('重新开始 and drafts', () => {
  it('puts the current takes away, keeps them safe, and brings them back', async () => {
    await SingService.saveTake(take('a', 0, 0.6, 1))
    await SingService.saveTake(take('b', 1, 0.8, 2))
    const m = await SingService.saveDraft(K, '第一次')
    expect(m?.drafts?.[0]).toMatchObject({ name: '第一次', takes: 2, phrases: 2 })
    expect(m?.drafts?.[0]?.avgBest).toBeCloseTo(0.7)
    expect(m?.phraseBests).toEqual({})
    expect(await SingService.takes(K)).toEqual([])

    // New singing does not prune the drafted takes of the same stretch.
    for (let i = 0; i < 4; i++) await SingService.saveTake(take(`n${i}`, 0, 0.5, 10 + i))
    expect((await SingService.takes(K)).map((t) => t.id)).not.toContain('a')

    // Restoring puts the current takes into a draft of their own first.
    const back = await SingService.restoreDraft(K, m!.drafts![0]!.id)
    expect((await SingService.takes(K)).map((t) => t.id).sort()).toEqual(['a', 'b'])
    expect(back.drafts).toHaveLength(1)
    expect(back.drafts![0]!.name).toContain('自动保存')

    // Deleting a draft removes its takes; the current ones stay.
    const after = await SingService.deleteDraft(K, back.drafts![0]!.id)
    expect(after.drafts).toEqual([])
    expect((await SingService.takes(K)).length).toBe(2)
  })

  it('clears one phrase or everything', async () => {
    await SingService.saveTake(take('a', 0, 0.6, 1))
    await SingService.saveTake(take('b', 1, 0.8, 2))
    await SingService.clearTakes(K, ['a'])
    expect((await SingService.takes(K)).map((t) => t.id)).toEqual(['b'])
    await SingService.clearTakes(K)
    expect(await SingService.takes(K)).toEqual([])
    expect(await SingService.saveDraft(K, 'x')).toBeNull()
  })
})
