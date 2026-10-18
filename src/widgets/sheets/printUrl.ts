/**
 * 谱子导出 PDF (0.30.0): the query string of the bare print page (/print/score).
 * Shared by the export button (builds it) and the print page (reads it).
 */
import type { StaffMode } from '@/widgets/sheets/AlphaTabView'

export const PRINT_PATH = '/print/score'

export type PrintSource = { kind: 'library'; path: string } | { kind: 'sheet'; id: string }

export interface PrintParams {
  source: PrintSource
  /** A track's index, or 'all' for every track. */
  track: number | 'all'
  staff: StaffMode
  /** 变调 in semitones (same as the viewer). */
  transpose: number
}

const STAFFS: readonly StaffMode[] = ['ScoreTab', 'Tab', 'Score']

export function buildPrintQuery(p: PrintParams): string {
  const q = new URLSearchParams()
  if (p.source.kind === 'library') {
    q.set('src', 'library')
    q.set('p', p.source.path)
  } else {
    q.set('src', 'sheet')
    q.set('id', p.source.id)
  }
  q.set('track', String(p.track))
  q.set('staff', p.staff)
  q.set('transpose', String(Math.round(p.transpose)))
  return q.toString()
}

/** Reads a print query; null when a required part is missing or malformed. */
export function parsePrintQuery(search: string): PrintParams | null {
  const q = new URLSearchParams(search)
  const src = q.get('src')
  let source: PrintSource
  if (src === 'library') {
    const path = q.get('p')
    if (!path) return null
    source = { kind: 'library', path }
  } else if (src === 'sheet') {
    const id = q.get('id')
    if (!id) return null
    source = { kind: 'sheet', id }
  } else {
    return null
  }
  const rawTrack = q.get('track') ?? '0'
  const track = rawTrack === 'all' ? 'all' : Number(rawTrack)
  if (track !== 'all' && (!Number.isInteger(track) || track < 0)) return null
  const staff = (q.get('staff') ?? 'ScoreTab') as StaffMode
  if (!STAFFS.includes(staff)) return null
  const transpose = Number(q.get('transpose') ?? '0')
  if (!Number.isFinite(transpose)) return null
  return { source, track, staff, transpose: Math.round(transpose) }
}
