import { describe, expect, it } from 'vitest'
import { latestPass } from '@/features/sing/useSingSession'

describe('takes keep only the latest pass over a phrase', () => {
  it('drops earlier passes (time jumps back)', () => {
    const pass = (from: number, midi: number) => Array.from({ length: 5 }, (_, i) => ({ ms: from + i * 20, midi }))
    const xs = [...pass(1000, 60), ...pass(1000, 62), ...pass(1000, 64)]
    expect(latestPass(xs)).toEqual(pass(1000, 64))
    expect(latestPass(pass(500, 60))).toEqual(pass(500, 60))
    expect(latestPass([])).toEqual([])
  })
})
