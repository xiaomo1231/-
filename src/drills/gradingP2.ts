import { romanLabel, type RomanId } from '@/music/keys'
import { degreeLabel, type DegreeId } from '@/music/scales'
import { midiToName, pitchClass } from '@/music/pitch'
import { spell, spelledName, LETTER_SOLFEGE } from '@/music/spelling'
import type { NoteMeasure } from '@/audio/pitch/analysis'
import { bassSkill, romanSkill } from './skills'
import { noteNameLabel } from './generatorsP2'
import type {
  BassLineQuestion,
  DictationQuestion,
  DrillResponse,
  GradeResult,
  NoteNameQuestion,
  PerformQuestion,
  ProgressionQuestion,
  RhythmChoiceQuestion,
  TheoryQuestion,
} from './types'

const PRAISE = ['对了。', '准确。', '就是它。', '听得很清楚。', '稳。']
const praise = (seed: number) => PRAISE[seed % PRAISE.length]!

function values(r: DrillResponse): string[] {
  return r.kind === 'choices' ? r.values : r.kind === 'choice' ? [r.value] : []
}

/**
 * Sequence questions with the first `given` items shown. Only the remaining
 * items are scored; the response may or may not include the given ones.
 */
function gradeSequence<T extends string>(
  answer: readonly T[],
  given: number,
  r: DrillResponse,
  label: (v: T) => string,
  skill: (v: T) => string,
  seed: number,
  hint: string,
): GradeResult {
  const raw = values(r) as T[]
  const asked = answer.slice(given)
  const submitted = raw.length === answer.length ? raw.slice(given) : raw
  let hits = 0
  const skillCredits: Record<string, number> = {}
  let firstMiss = -1
  asked.forEach((expected, i) => {
    const ok = submitted[i] === expected
    if (ok) hits++
    else if (firstMiss < 0) firstMiss = i
    const s = skill(expected)
    // A skill counts as correct only if every occurrence was right.
    skillCredits[s] = Math.min(skillCredits[s] ?? 1, ok ? 1 : 0)
  })
  const credit = asked.length ? hits / asked.length : 0
  const correct = hits === asked.length
  const confused = firstMiss >= 0 ? submitted[firstMiss] : undefined
  return {
    correct,
    credit,
    expectedLabel: answer.map(label).join(' → '),
    givenLabel: submitted.length ? [...answer.slice(0, given), ...submitted].map((v) => label(v as T)).join(' → ') : '未作答',
    ...(confused ? { confusedWith: confused, confusedExpected: asked[firstMiss]! } : {}),
    skillCredits,
    feedback: correct ? praise(seed) : `答对 ${hits} / ${asked.length} 个。${hint}`,
  }
}

export function gradeProgression(q: ProgressionQuestion, r: DrillResponse): GradeResult {
  return gradeSequence<RomanId>(
    q.answer,
    q.given,
    r,
    romanLabel,
    (v) => romanSkill(q.mode, v),
    q.seed,
    '先听每个和弦的低音落在哪个级数，再判断大小：低音在 4 级多半是 IV，在 6 级多半是 vi。',
  )
}

export function gradeBassLine(q: BassLineQuestion, r: DrillResponse): GradeResult {
  return gradeSequence<DegreeId>(
    q.answer,
    q.given,
    r,
    (d) => degreeLabel(d),
    bassSkill,
    q.seed,
    '每小节的第一个音就是根音。在心里唱回主音，再从主音数到这个音。',
  )
}

export function gradeDictation(q: DictationQuestion, r: DrillResponse): GradeResult {
  const midis = r.kind === 'notes' ? r.midis : []
  const expected = q.melody.map((n) => n.midi)
  const asked = expected.slice(q.given)
  const submitted = midis.length === expected.length ? midis.slice(q.given) : midis
  let hits = 0
  let octaveSlips = 0
  asked.forEach((m, i) => {
    const g = submitted[i]
    if (g === undefined) return
    if (pitchClass(g) === pitchClass(m)) {
      hits++
      if (g !== m) octaveSlips++
    }
  })
  const credit = asked.length ? hits / asked.length : 0
  const correct = hits === asked.length
  const keyTonic = q.tonic
  const label = (m: number) => spelledName(spell(m, { keyTonic }))
  let feedback: string
  if (correct) feedback = octaveSlips ? `音名全对。有 ${octaveSlips} 个音写在了别的八度，注意旋律是往上还是往下走。` : praise(q.seed)
  else {
    const firstMiss = asked.findIndex((m, i) => submitted[i] === undefined || pitchClass(submitted[i]!) !== pitchClass(m))
    feedback = `答对 ${hits} / ${asked.length} 个，第 ${firstMiss + q.given + 1} 个音开始出错。先唱出旋律，判断每一步是级进还是跳进，再找键。`
  }
  return {
    correct,
    credit,
    expectedLabel: expected.map(label).join(' '),
    givenLabel: submitted.length ? [...expected.slice(0, q.given), ...submitted].map(label).join(' ') : '未作答',
    feedback,
  }
}

export function gradeRhythmChoice(q: RhythmChoiceQuestion, r: DrillResponse): GradeResult {
  const given = r.kind === 'choice' ? r.value : ''
  const correct = given === q.answer
  const idx = (id: string) => q.options.findIndex((o) => o.id === id) + 1
  return {
    correct,
    credit: correct ? 1 : 0,
    expectedLabel: `第 ${idx(q.answer)} 个节奏谱`,
    givenLabel: given ? `第 ${idx(given)} 个节奏谱` : '未作答',
    feedback: correct ? praise(q.seed) : '再听一遍，跟着节奏数“1 & 2 & 3 & 4 &”，找出哪些音落在“&”（反拍）上。',
  }
}

export function gradeNoteName(q: NoteNameQuestion, r: DrillResponse): GradeResult {
  const given = r.kind === 'choice' ? r.value : ''
  const correct = given === q.answer
  const tip =
    q.clef === 'treble'
      ? '高音谱号：第二线是 G（谱号的圈绕着它）。线上从下往上 E G B D F，间里 F A C E。'
      : '低音谱号：第四线是 F（两个点夹着它）。线上从下往上 G B D F A，间里 A C E G。'
  return {
    correct,
    credit: correct ? 1 : 0,
    expectedLabel: `${noteNameLabel(q.answer)}（${LETTER_SOLFEGE[q.note.letter]}）`,
    givenLabel: given ? noteNameLabel(given) : '未作答',
    ...(correct || !given ? {} : { confusedWith: given, confusedExpected: q.answer }),
    feedback: correct ? praise(q.seed) : `这是 ${noteNameLabel(q.answer)}${q.note.octave}。${tip}`,
  }
}

export function gradeTheory(q: TheoryQuestion, r: DrillResponse): GradeResult {
  const given = r.kind === 'choice' ? r.value : ''
  const correct = given === q.answer
  const label = (v: string) => q.options.find((o) => o.value === v)?.label ?? v
  return {
    correct,
    credit: correct ? 1 : 0,
    expectedLabel: label(q.answer),
    givenLabel: given ? label(given) : '未作答',
    ...(correct || !given ? {} : { confusedWith: given, confusedExpected: q.answer }),
    feedback: correct ? `${praise(q.seed)}${q.explanation}` : q.explanation,
  }
}

/** Is one measured note within the question's tolerance (and sustain rules)? */
export function noteHit(q: PerformQuestion, m: NoteMeasure | undefined): boolean {
  if (!m || m.medianCents === null) return false
  if (Math.abs(m.medianCents) > q.toleranceCents) return false
  if (q.sustainSeconds !== undefined) {
    if (m.stableMs < q.sustainSeconds * 1000 * 0.8) return false
    if (q.maxDriftCents !== undefined && (m.driftCents ?? Infinity) > q.maxDriftCents) return false
  } else if (q.freeTiming) {
    if (m.stableMs < 300) return false
  } else if (m.voicedRatio < 0.4) {
    return false
  }
  return true
}

export function gradePerform(q: PerformQuestion, r: DrillResponse): GradeResult {
  const notes = r.kind === 'performance' ? r.notes : []
  const hits = q.targets.map((_, i) => noteHit(q, notes[i]))
  const hitCount = hits.filter(Boolean).length
  const credit = q.targets.length ? hitCount / q.targets.length : 0
  const correct = hitCount === q.targets.length
  const measured = notes.filter((n) => n.medianCents !== null)
  const meanCents = measured.length ? Math.round(measured.reduce((s, n) => s + n.medianCents!, 0) / measured.length) : null
  const verb = q.source === 'voice' ? '唱' : '弹'

  let feedback: string
  if (measured.length === 0) {
    feedback = q.source === 'voice' ? '没有听到稳定的歌声。靠近麦克风一点，用“啊”或“嗯”唱，声音稳住再结束。' : '没有检测到稳定的音。弹完让音延续一会儿，避开周围的噪音。'
  } else if (correct) {
    feedback = meanCents !== null && Math.abs(meanCents) <= 8 ? '非常准。' : `准确。平均偏差 ${meanCents! > 0 ? '+' : ''}${meanCents} 音分。`
  } else if (q.sustainSeconds !== undefined && notes[0]) {
    const m = notes[0]
    if (m.stableMs < q.sustainSeconds * 800) feedback = `稳定只保持了 ${(m.stableMs / 1000).toFixed(1)} 秒。吸足气再开始，用腹部支撑把音“放平”。`
    else if ((m.driftCents ?? 0) > (q.maxDriftCents ?? Infinity)) feedback = `音高在 ${m.driftCents} 音分的范围内晃动。想象声音沿着一条直线往前走，不要边唱边调。`
    else feedback = `整体${m.medianCents! > 0 ? '偏高' : '偏低'} ${Math.abs(m.medianCents!)} 音分。`
  } else if (meanCents !== null && Math.abs(meanCents) > q.toleranceCents) {
    feedback = `整体${meanCents > 0 ? '偏高' : '偏低'}约 ${Math.abs(meanCents)} 音分。${verb}之前先在心里“听”到目标音，再${verb}出来。`
  } else {
    feedback = `${q.targets.length > 1 ? `${verb}对 ${hitCount} / ${q.targets.length} 个音。` : ''}看看下面每个音的偏差，红色的是超出容差的。`
  }

  return {
    correct,
    credit,
    expectedLabel: q.targets.map((t) => t.label ?? midiToName(t.midi)).join(' · '),
    givenLabel: meanCents === null ? '没有检测到' : `平均 ${meanCents > 0 ? '+' : ''}${meanCents} 音分`,
    feedback,
  }
}
