import { describe, expect, it } from 'vitest'
import { MAX_STAGE, effectiveProfile, isAdmin } from '@/services/adminMode'
import { durationText, etaSeconds } from '@/audio/separation/timings'
import { cpuWorkers } from '@/audio/separation/separate'
import type { StudentProfile } from '@/entities/types'

describe('管理员模式', () => {
  it('is on for the name admin in any case, and only widens what is read', () => {
    expect(isAdmin({ displayName: 'admin' })).toBe(true)
    expect(isAdmin({ displayName: ' Admin ' })).toBe(true)
    expect(isAdmin({ displayName: 'administrator' })).toBe(false)
    expect(isAdmin(null)).toBe(false)
    const p = { displayName: 'ADMIN', unlockedStage: 1 } as StudentProfile
    expect(effectiveProfile(p).unlockedStage).toBe(MAX_STAGE)
    expect(p.unlockedStage).toBe(1)
    const q = { displayName: '小明', unlockedStage: 1 } as StudentProfile
    expect(effectiveProfile(q)).toBe(q)
  })
})

describe('separation estimates', () => {
  it('guesses the remaining time only once there is something to go on', () => {
    expect(etaSeconds(1, 0.5)).toBeNull()
    expect(etaSeconds(10, 0.02)).toBeNull()
    expect(etaSeconds(30, 0.25)).toBeCloseTo(90)
    expect(durationText(42)).toBe('42 秒')
    expect(durationText(130)).toBe('2 分 10 秒')
  })
  it('runs a few CPU workers, never more than six', () => {
    expect(cpuWorkers(2)).toBe(1)
    expect(cpuWorkers(12)).toBe(4)
    expect(cpuWorkers(32)).toBe(6)
  })
})
