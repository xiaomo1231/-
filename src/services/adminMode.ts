/**
 * 管理员模式 (pure): a student named "admin" (any case) gets every stage,
 * level and project unlocked. It is a local convenience switch, not a
 * security boundary. Stored progress is never rewritten: only what pages and
 * services *read* is widened, so renaming back restores the normal gates.
 */
import type { StudentProfile } from '@/entities/types'
import { STAGES } from '@/course/stages'

export const MAX_STAGE = Math.max(...STAGES.map((s) => s.stage))

export function isAdmin(profile: Pick<StudentProfile, 'displayName'> | null | undefined): boolean {
  return profile?.displayName?.trim().toLowerCase() === 'admin'
}

/** The profile as the gates should see it (every stage unlocked for admin). */
export function effectiveProfile<P extends StudentProfile>(profile: P): P {
  return isAdmin(profile) ? { ...profile, unlockedStage: Math.max(profile.unlockedStage, MAX_STAGE) } : profile
}
