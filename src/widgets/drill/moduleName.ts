import { moduleInfo, type ModuleId } from '@/drills/types'
import { INSTRUMENT_LABEL, type StudentProfile } from '@/entities/types'

/** Module name with the student's instrument filled in for I1 / I2. */
export function moduleDisplayName(id: ModuleId, profile: Pick<StudentProfile, 'instrument' | 'secondInstrument'> | null): string {
  if (id === 'I1' && profile && profile.instrument !== 'none') return `${INSTRUMENT_LABEL[profile.instrument]}任务`
  if (id === 'I2' && profile?.secondInstrument) return `${INSTRUMENT_LABEL[profile.secondInstrument]}任务`
  return moduleInfo(id).name
}

/** Whether a module applies to this student (instrument modules need an instrument). */
export function moduleVisible(id: ModuleId, profile: Pick<StudentProfile, 'instrument' | 'secondInstrument'>): boolean {
  if (id === 'I1') return profile.instrument !== 'none'
  if (id === 'I2') return Boolean(profile.secondInstrument)
  return true
}
