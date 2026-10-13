import type { NotationId } from '@/entities/types'
import { useProfileStore } from '@/features/profile/profileStore'

/** Which views the student may use, and their default. Staff is mandatory in stages 0–1. */
export function useNotationViews() {
  const profile = useProfileStore((s) => s.profile)
  const unlocked = (profile?.unlockedStage ?? 0) >= 2
  const fretted = profile?.instrument === 'guitar' || profile?.instrument === 'bass'
  const allowed: Record<NotationId, boolean> = { staff: true, jianpu: unlocked, tab: unlocked && fretted }
  const preferred = profile?.notation ?? 'staff'
  return {
    allowed,
    defaultView: allowed[preferred] ? preferred : ('staff' as NotationId),
    tabLabel: profile?.instrument === 'bass' ? '四线谱' : '六线谱',
    instrument: (profile?.instrument === 'bass' ? 'bass' : 'guitar') as 'guitar' | 'bass',
  }
}

