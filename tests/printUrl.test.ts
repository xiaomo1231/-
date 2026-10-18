import { describe, expect, it } from 'vitest'
import { buildPrintQuery, parsePrintQuery, type PrintParams } from '@/widgets/sheets/printUrl'

describe('print query', () => {
  it('round-trips a library score with a Chinese path', () => {
    const p: PrintParams = {
      source: { kind: 'library', path: '吉他谱/民谣 & 流行/晴天 (周杰伦).gp5' },
      track: 2,
      staff: 'Tab',
      transpose: -3,
    }
    const q = buildPrintQuery(p)
    expect(q).not.toContain(' ')
    expect(q).not.toContain('晴天')
    expect(parsePrintQuery(q)).toEqual(p)
    expect(parsePrintQuery('?' + q)).toEqual(p)
  })

  it('round-trips a sheet with all tracks', () => {
    const p: PrintParams = {
      source: { kind: 'sheet', id: 'abc-123' },
      track: 'all',
      staff: 'Score',
      transpose: 5,
    }
    expect(parsePrintQuery(buildPrintQuery(p))).toEqual(p)
  })

  it('rejects missing or malformed parts', () => {
    expect(parsePrintQuery('')).toBeNull()
    expect(parsePrintQuery('src=library')).toBeNull()
    expect(parsePrintQuery('src=sheet')).toBeNull()
    expect(parsePrintQuery('src=other&id=1')).toBeNull()
    expect(parsePrintQuery('src=sheet&id=1&track=-1')).toBeNull()
    expect(parsePrintQuery('src=sheet&id=1&track=x')).toBeNull()
    expect(parsePrintQuery('src=sheet&id=1&staff=Nope')).toBeNull()
  })

  it('defaults track, staff and transpose', () => {
    expect(parsePrintQuery('src=sheet&id=1')).toEqual({
      source: { kind: 'sheet', id: '1' },
      track: 0,
      staff: 'ScoreTab',
      transpose: 0,
    })
  })
})
