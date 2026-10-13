import { intervalById, type IntervalId } from '@/music/intervals'
import { chordTypeById, INVERSION_LABEL, type ChordTypeId } from '@/music/chords'
import { degreeLabel, scaleById, type DegreeId, type ScaleId } from '@/music/scales'
import type { ModuleId } from '@/drills/types'
import { romanLabel, type RomanId } from '@/music/keys'
import { noteNameLabel } from '@/drills/generatorsP2'

/** Human label for a raw answer key stored in the confusion matrix. */
export function confusionLabel(module: ModuleId, key: string): string {
  try {
    switch (module) {
      case 'E1':
        return key === 'higher' ? '更高' : key === 'lower' ? '更低' : '相同'
      case 'E2':
        return intervalById(key as IntervalId).name
      case 'E3':
        return `第 ${degreeLabel(key as DegreeId)} 级`
      case 'E4':
        return scaleById(key as ScaleId).name
      case 'E5':
        return /^\d$/.test(key) ? (INVERSION_LABEL[Number(key)] ?? key) : chordTypeById(key as ChordTypeId).name
      case 'E6':
        return romanLabel(key as RomanId)
      case 'E7':
        return `${degreeLabel(key as DegreeId)} 级`
      case 'N1':
        return noteNameLabel(key)
      default:
        return key
    }
  } catch {
    return key
  }
}
