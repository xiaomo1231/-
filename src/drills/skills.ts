import { chordTypeById, INVERSION_LABEL, type ChordTypeId } from '@/music/chords'
import { intervalById, type IntervalId } from '@/music/intervals'
import { FIGURE_LABEL, type RhythmFigure } from '@/music/rhythm'
import { degreeLabel, scaleById, type DegreeId, type ScaleId } from '@/music/scales'
import type { ModuleId } from './types'

/**
 * Skill ids are the keys of fine-grained mastery. They are stable strings so
 * they can be stored, compared and shown on the skill map.
 */
export const pitchSkill = (cents: number): string => `pitch:res:${cents}`
export const intervalSkill = (id: IntervalId): string => `interval:${id}`
export const degreeSkill = (id: DegreeId): string => `degree:${id}`
export const scaleSkill = (id: ScaleId): string => `scale:${id}`
export const chordSkill = (id: ChordTypeId): string => `chord:${id}`
export const inversionSkill = (inv: number): string => `chord:inv:${inv}`
export const rhythmTempoSkill = (bpm: number): string => `rhythm:tempo:${bpm}`
export const rhythmFigureSkill = (figure: RhythmFigure): string => `rhythm:fig:${figure}`

export const romanSkill = (mode: 'major' | 'minor', roman: string): string => `roman:${mode}:${roman}`
export const bassSkill = (degree: DegreeId): string => `bass:${degree}`
export const melodySkill = (kind: 'step' | 'leap' | 'chromatic'): string => `melody:${kind}`
export const rhythmReadSkill = (figure: RhythmFigure): string => `rhythmread:${figure}`
export type SingKind = 'pitch' | 'sustain' | 'interval' | 'scale' | 'degree' | 'sight' | 'echo'
export const singSkill = (kind: SingKind, key: string): string => `sing:${kind}:${key}`
export const readSkill = (clef: 'treble' | 'bass', letter: string): string => `read:${clef}:${letter}`
export const readAccSkill = (): string => 'read:acc:any'
export const theorySkill = (topic: string): string => `theory:${topic}`
export const playSkill = (instrument: string, mode: string): string => `play:${instrument}:${mode}`

const SING_MODULE: Record<SingKind, ModuleId> = {
  pitch: 'S1',
  sustain: 'S2',
  interval: 'S3',
  scale: 'S4',
  degree: 'S5',
  sight: 'S6',
  echo: 'S7',
}

export function skillModule(skillId: string): ModuleId {
  if (skillId.startsWith('roman:')) return 'E6'
  if (skillId.startsWith('bass:')) return 'E7'
  if (skillId.startsWith('melody:')) return 'E8'
  if (skillId.startsWith('rhythmread:')) return 'E9'
  if (skillId.startsWith('sing:')) return SING_MODULE[skillId.split(':')[1] as SingKind] ?? 'S1'
  if (skillId.startsWith('read:')) return 'N1'
  if (skillId.startsWith('theory:')) return 'T1'
  if (skillId.startsWith('play:')) return 'I1'
  if (skillId.startsWith('pitch:')) return 'E1'
  if (skillId.startsWith('interval:')) return 'E2'
  if (skillId.startsWith('degree:')) return 'E3'
  if (skillId.startsWith('scale:')) return 'E4'
  if (skillId.startsWith('chord:')) return 'E5'
  if (skillId.startsWith('rhythm:tempo:')) return 'R1'
  return 'R2'
}

const THEORY_LABEL: Record<string, string> = {
  rhythm: '时值与拍号',
  pitch: '音名与半音全音',
  major: '大调与调号',
  interval: '看音名判音程',
  minor: '小调与关系调',
}
const INSTRUMENT_NAME: Record<string, string> = { guitar: '吉他', bass: '贝斯', piano: '键盘' }
const PLAY_LABEL: Record<string, string> = {
  find_note: '找音',
  interval: '音程',
  scale: '音阶',
  melody: '旋律',
  arpeggio: '分解和弦',
}

function singLabel(kind: SingKind, key: string): string {
  switch (kind) {
    case 'pitch':
      return `唱准 ±${key} 音分`
    case 'sustain':
      return `长音 ${key} 秒`
    case 'interval':
      return `唱${intervalById(key as IntervalId).name}`
    case 'scale':
      return `唱${scaleById(key as ScaleId).name}`
    case 'degree':
      return `唱第 ${degreeLabel(key as DegreeId)} 级`
    case 'sight':
      return `视唱 L${key}`
    case 'echo':
      return `模唱 L${key}`
  }
}

/** Human label for a skill id. Unknown ids are returned as-is. */
export function skillLabel(skillId: string): string {
  const [domain, a, b] = skillId.split(':')
  try {
    switch (domain) {
      case 'pitch':
        return `${b} 音分分辨`
      case 'interval':
        return intervalById(a as IntervalId).name
      case 'degree':
        return `第 ${degreeLabel(a as DegreeId)} 级`
      case 'scale':
        return scaleById(a as ScaleId).name
      case 'chord':
        if (a === 'inv') return INVERSION_LABEL[Number(b)] ?? skillId
        return chordTypeById(a as ChordTypeId).name
      case 'rhythm':
        if (a === 'tempo') return `${b} BPM 跟拍`
        return FIGURE_LABEL[b as RhythmFigure] ?? skillId
      case 'roman':
        return `${a === 'minor' ? '小调' : '大调'} ${b!.replace(/^b/, '♭')}`
      case 'bass':
        return `低音 ${degreeLabel(a as DegreeId)} 级`
      case 'melody':
        return a === 'step' ? '级进旋律' : a === 'leap' ? '跳进旋律' : '变化音旋律'
      case 'rhythmread':
        return `读谱 · ${FIGURE_LABEL[a as RhythmFigure] ?? a}`
      case 'sing':
        return singLabel(a as SingKind, b!)
      case 'read':
        if (a === 'acc') return '升降号'
        return `${a === 'treble' ? '高音' : '低音'}谱号 ${b}`
      case 'theory':
        return THEORY_LABEL[a!] ?? skillId
      case 'play':
        return `${INSTRUMENT_NAME[a!] ?? a} · ${PLAY_LABEL[b!] ?? b}`
      default:
        return skillId
    }
  } catch {
    return skillId
  }
}
