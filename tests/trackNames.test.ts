import { describe, expect, it } from 'vitest'
import { trackLabel, trackLabels, type TrackLike } from '../web/viewer/trackNames'

function track(name: string, program = 0, extra: Partial<TrackLike> = {}): TrackLike {
  return { name, playbackInfo: { program }, staves: [{ tuning: [] }], ...extra }
}

describe('trackLabel dictionary', () => {
  it.each([
    ['Guitar', '吉他'],
    ['Electric Guitar', '电吉他'],
    ['E-Guitar', '电吉他'],
    ['Overdrive', '电吉他'],
    ['Acoustic Guitar', '木吉他'],
    ['Nylon', '木吉他'],
    ['Lead Guitar', '主音吉他'],
    ['Rhythm', '节奏吉他'],
    ['Bass', '贝斯'],
    ['E-Bass', '贝斯'],
    ['BS', '贝斯'],
    ['Drums', '鼓'],
    ['Percussion', '鼓'],
    ['Keys', '键盘'],
    ['Vox', '人声'],
    ['Lead Vocal', '人声'],
    ['Strings', '弦乐'],
    ['Violin', '小提琴'],
    ['Trumpet', '小号'],
    ['Intro', '前奏'],
    ['Outro', '尾奏'],
    ['Chorus', '副歌'],
    ['  guitar  ', '吉他'],
  ])('%s -> %s', (name, zh) => {
    const label = trackLabel([track(name)], 0)
    expect(label.zh).toBe(zh)
    expect(label.original).toBe(name.trim() === zh ? '' : name.trim())
  })

  it('shows the original name only when it differs from the Chinese label', () => {
    expect(trackLabel([track('Guitar')], 0)).toEqual({ zh: '吉他', original: 'Guitar' })
    expect(trackLabel([track('吉他')], 0)).toEqual({ zh: '吉他', original: '' })
  })
})

describe('numbers', () => {
  it('reads trailing numbers, including Roman numerals and abbreviations', () => {
    expect(trackLabel([track('Guitar 1')], 0).zh).toBe('吉他 1')
    expect(trackLabel([track('Guitar II')], 0).zh).toBe('吉他 2')
    expect(trackLabel([track('Gtr. 2')], 0).zh).toBe('吉他 2')
    expect(trackLabel([track('Gt 3')], 0).zh).toBe('吉他 3')
    expect(trackLabel([track('Gtr. 2')], 0).original).toBe('Gtr. 2')
  })
})

describe('Chinese names', () => {
  it('passes a name that already contains CJK through unchanged', () => {
    expect(trackLabel([track('主音吉他 合奏')], 0)).toEqual({ zh: '主音吉他 合奏', original: '' })
    expect(trackLabel([track('人声 2')], 0)).toEqual({ zh: '人声 2', original: '' })
  })
})

describe('program fallback', () => {
  it.each([
    [0, '钢琴'],
    [12, '色彩打击乐'],
    [19, '风琴'],
    [25, '木吉他'],
    [27, '电吉他'],
    [33, '贝斯'],
    [45, '弦乐'],
    [53, '人声'],
    [50, '合奏'],
    [60, '铜管'],
    [73, '笛'],
    [90, '合成器'],
    [127, '乐器'],
  ])('program %i -> %s', (program, zh) => {
    expect(trackLabel([track('Synth Mystery', program)], 0)).toEqual({ zh, original: 'Synth Mystery' })
  })

  it('uses the instrument for an empty name, with no original', () => {
    expect(trackLabel([track('', 33)], 0)).toEqual({ zh: '贝斯', original: '' })
    expect(trackLabel([track('   ', 0)], 0)).toEqual({ zh: '钢琴', original: '' })
  })

  it('treats percussion as drums when the name tells us nothing', () => {
    expect(trackLabel([track('Shaker', 0, { isPercussion: true })], 0).zh).toBe('鼓')
    expect(trackLabel([track('Shaker', 0, { staves: [{ isPercussion: true, tuning: [] }] })], 0).zh).toBe('鼓')
  })
})

describe('duplicates', () => {
  it('numbers duplicates in track order', () => {
    const labels = trackLabels([track('Guitar'), track('Guitar'), track('Bass')])
    expect(labels.map((l) => l.zh)).toEqual(['吉他 1', '吉他 2', '贝斯'])
  })

  it('keeps distinct explicit numbers', () => {
    const labels = trackLabels([track('Guitar 2'), track('Guitar 1')])
    expect(labels.map((l) => l.zh)).toEqual(['吉他 2', '吉他 1'])
  })

  it('renumbers when explicit numbers collide or are missing', () => {
    const labels = trackLabels([track('Guitar 1'), track('Guitar 1'), track('Guitar')])
    expect(labels.map((l) => l.zh)).toEqual(['吉他 1', '吉他 2', '吉他 3'])
  })

  it('numbers unknown names that fall back to the same instrument', () => {
    const labels = trackLabels([track('Synth Lead', 80), track('Synth Pad', 81)])
    expect(labels.map((l) => l.zh)).toEqual(['合成器 1', '合成器 2'])
    expect(labels[0]!.original).toBe('Synth Lead')
  })
})

describe('trackLabels', () => {
  it('returns one label per track in order', () => {
    expect(trackLabels([track('Piano', 0), track('Bass', 33)])).toEqual([
      { zh: '钢琴', original: 'Piano' },
      { zh: '贝斯', original: 'Bass' },
    ])
  })

  it('handles an out-of-range index', () => {
    expect(trackLabel([], 0)).toEqual({ zh: '音轨 1', original: '' })
  })
})
