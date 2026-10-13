import { useProfileStore } from '@/features/profile/profileStore'
import { BASS_STANDARD, GUITAR_TUNINGS, shapeForSetup, withCapo, type SetupShape, type Tuning } from '@/music/fretboard'

/**
 * The student's fretted-instrument setup: tuning (standard / Drop D / half
 * step down) and capo. `played` is what the hand sees (capo applied);
 * `open` is for the tuner.
 */
export function useGuitarSetup(): { open: Tuning; played: Tuning; capo: number; bass: Tuning } {
  const profile = useProfileStore((s) => s.profile)
  const open = GUITAR_TUNINGS[profile?.guitarTuning ?? 'standard']
  const capo = Math.max(0, Math.min(9, profile?.capo ?? 0))
  return { open, played: withCapo(open, capo), capo, bass: BASS_STANDARD }
}

/** Chord-shape lookup that respects the student's tuning and capo. */
export function useChordShapes(): (rootPc: number, suffix: string, rootName: string) => SetupShape | null {
  const tuning = useProfileStore((s) => s.profile?.guitarTuning ?? 'standard')
  const capo = useProfileStore((s) => Math.max(0, Math.min(9, s.profile?.capo ?? 0)))
  return (rootPc, suffix, rootName) => shapeForSetup(rootPc, suffix, rootName, { tuning, capo })
}
