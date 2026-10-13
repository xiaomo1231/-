import { beforeEach, describe, expect, it } from 'vitest'
import { GrooveLabDB, getDb, setDbForTests } from '@/infrastructure/db/database'
import { RunService, endOfLocalDay, RUN_TTL_MS } from '@/services/runService'
import { DrillService } from '@/services/drillService'
import type { ModuleId } from '@/drills/types'

let n = 0
beforeEach(() => setDbForTests(new GrooveLabDB(`runs-${Date.now()}-${n++}`)))

const DAY = 24 * 60 * 60 * 1000

function input(id: string, extra: Partial<Parameters<typeof RunService.save>[0]> = {}) {
  return { id, kind: 'drill' as const, title: `训练 ${id}`, link: `/drill/${id}`, done: 1, total: 5, correct: 1, data: { id }, ...extra }
}

/** Start a real drill session and attach it to a saved run, as a drill flow does. */
async function runWithSession(id: string, extra: Partial<Parameters<typeof RunService.save>[0]> = {}) {
  const session = await DrillService.startSession('free', ['E2' as ModuleId])
  await RunService.save(input(id, { sessionId: session.id, ...extra }))
  return session.id
}

describe('RunService', () => {
  it('round-trips a saved run', async () => {
    await RunService.save(input('a', { done: 2, correct: 1, data: { i: 2 } }))
    const got = await RunService.get('a')
    expect(got).not.toBeNull()
    expect(got).toMatchObject({ id: 'a', kind: 'drill', title: '训练 a', link: '/drill/a', done: 2, total: 5, correct: 1, data: { i: 2 } })
    expect(got!.expiresAt - got!.createdAt).toBe(RUN_TTL_MS)
  })

  it('returns null for a missing run', async () => {
    expect(await RunService.get('nope')).toBeNull()
  })

  it('daily runs expire at local midnight', async () => {
    const t = Date.now()
    await RunService.save(input('daily', { daily: true }))
    const got = await RunService.get('daily')
    expect(got).not.toBeNull()
    expect(got!.expiresAt).toBe(endOfLocalDay(got!.createdAt))
    expect(got!.expiresAt).toBeGreaterThan(t)
    expect(got!.expiresAt - got!.createdAt).toBeLessThanOrEqual(DAY)
  })

  it('get() of an expired run returns null and closes its session', async () => {
    const sessionId = await runWithSession('old')
    await getDb().activeRuns.update('old', { expiresAt: Date.now() - 1 })
    expect(await RunService.get('old')).toBeNull()
    expect(await getDb().activeRuns.get('old')).toBeUndefined()
    const session = await DrillService.session(sessionId)
    expect(session?.endedAt).toBeDefined()
  })

  it('discard() closes the session and deletes the run', async () => {
    const sessionId = await runWithSession('d')
    await RunService.discard('d')
    expect(await RunService.get('d')).toBeNull()
    const session = await DrillService.session(sessionId)
    expect(session?.endedAt).toBeDefined()
  })

  it('clear() deletes the run but leaves the session alone', async () => {
    const sessionId = await runWithSession('c')
    await RunService.clear('c')
    expect(await getDb().activeRuns.get('c')).toBeUndefined()
    expect((await DrillService.session(sessionId))?.endedAt).toBeUndefined()
  })

  it('cleanup() closes old unheld sessions and keeps sessions held by a run', async () => {
    const old = await DrillService.startSession('free', ['E2' as ModuleId])
    const held = await DrillService.startSession('free', ['E2' as ModuleId])
    const recent = await DrillService.startSession('free', ['E2' as ModuleId])
    const eightDaysAgo = Date.now() - 8 * DAY
    await getDb().drillSessions.update(old.id, { startedAt: eightDaysAgo })
    await getDb().drillSessions.update(held.id, { startedAt: eightDaysAgo })
    await RunService.save(input('held', { sessionId: held.id }))

    const result = await RunService.cleanup()
    expect(result.sessions).toBe(1)
    expect((await DrillService.session(old.id))?.endedAt).toBeDefined()
    expect((await DrillService.session(held.id))?.endedAt).toBeUndefined()
    expect((await DrillService.session(recent.id))?.endedAt).toBeUndefined()
  })

  it('list() returns the most recent run first', async () => {
    await RunService.save(input('first'))
    await RunService.save(input('second'))
    await RunService.save(input('third'))
    const base = Date.now()
    await getDb().activeRuns.update('first', { updatedAt: base - 3000 })
    await getDb().activeRuns.update('second', { updatedAt: base - 1000 })
    await getDb().activeRuns.update('third', { updatedAt: base - 2000 })
    const ids = (await RunService.list()).map((r) => r.id)
    expect(ids).toEqual(['second', 'third', 'first'])
  })
})
