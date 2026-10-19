import { describe, expect, it } from 'vitest'
import { splitTail } from '../web/components/MiddleText'

describe('splitTail', () => {
  it('keeps short names whole', () => {
    expect(splitTail('晴天.gp5')).toEqual({ head: '晴天.gp5', tail: '' })
  })
  it('cuts before the last bracket so the version stays visible', () => {
    expect(splitTail('Smells Like Teen Spirit (Live at Reading Festival 1992) (songsterr 18).gp')).toEqual({
      head: 'Smells Like Teen Spirit (Live at Reading Festival 1992)',
      tail: ' (songsterr 18).gp',
    })
  })
  it('keeps the last characters when there is no short bracketed ending', () => {
    const r = splitTail('IMG_20250914_183022_HDR_portrait_edited_edited.gp', 10)
    expect(r.tail).toBe('_edited.gp')
    expect(r.head + r.tail).toBe('IMG_20250914_183022_HDR_portrait_edited_edited.gp')
  })
  it('never splits an emoji', () => {
    const r = splitTail('🦊🦊🦊🦊🦊🦊🦊🦊🦊🦊🦊🦊🦊🦊🦊🦊🦊🦊🦊🦊🦊🦊🦊🦊', 4)
    expect(Array.from(r.tail)).toHaveLength(4)
  })
})
