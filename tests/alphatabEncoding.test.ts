import { describe, expect, it } from 'vitest'
import { garbleScore } from '@/audio/alphatabEncoding'

describe('Guitar Pro text encoding', () => {
  it('scores broken texts higher than clean ones', () => {
    const gbkAsUtf8 = ['����1', 'Acoustic Guitar', 'C����']
    const gbkAsLatin1 = ['ÄãºÃ', 'Acoustic Guitar']
    const clean = ['木吉他1', 'Acoustic Guitar', '贝斯', 'Verse I']
    expect(garbleScore(clean)).toBe(0)
    expect(garbleScore(gbkAsUtf8)).toBeGreaterThan(garbleScore(clean))
    expect(garbleScore(gbkAsLatin1)).toBeGreaterThan(0)
    // accented Latin next to Chinese is not counted
    expect(garbleScore(['Café 咖啡'])).toBe(0)
  })
})
