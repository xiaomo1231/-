import { Navigate, useParams } from 'react-router-dom'
import { librarySong, librarySongScore } from '@/songs/library'
import { useTimbreOverride } from '@/features/audio/useTimbreOverride'
import { SongPractice } from '@/widgets/songs/SongPractice'

/** A built-in library song. Imported sheets live under /sheets. */
export function SongDetailPage() {
  useTimbreOverride('guitar')
  const { kind, id } = useParams()
  if (kind === 'sheet') return <Navigate to={`/sheets/${id ?? ''}`} replace />
  const s = id ? librarySong(id) : undefined
  if (!s) return <Navigate to="/songs" replace />
  return <SongPractice view={{ title: s.title, subtitle: s.origin, note: s.note, score: librarySongScore(s), pattern: s.pattern, bpm: s.bpm }} />
}
