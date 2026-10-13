import { intervalById, type IntervalId } from '@/music/intervals'
import { degreeSolfege, type DegreeId, type ScaleId } from '@/music/scales'
import { chordTypeById, type ChordTypeId } from '@/music/chords'
import { scaleById } from '@/music/scales'
import { beatsToMs } from '@/music/rhythm'
import {
  chordOptionLabel,
  degreeOptionLabel,
  inversionOptionLabel,
  pitchCompareLabel,
  scaleOptionLabel,
} from './generators'
import type { DrillQuestion, DrillResponse, GradeResult, PitchCompareAnswer } from './types'
import {
  gradeBassLine,
  gradeDictation,
  gradeNoteName,
  gradePerform,
  gradeProgression,
  gradeRhythmChoice,
  gradeTheory,
} from './gradingP2'

const EMPTY: DrillResponse = { kind: 'choices', values: [] }

/** Rhythm tolerance: a tap this far from an onset still counts as matched. */
const MATCH_WINDOW_BEATS = 0.5
/** Deviation at or under this is "perfect"; credit falls to zero at MAX. */
const PERFECT_MS = 35
const MAX_MS = 160

export function gradeQuestion(q: DrillQuestion, r: DrillResponse): GradeResult {
  if (r.kind === 'skip') {
    return {
      correct: false,
      credit: 0,
      expectedLabel: expectedLabel(q),
      givenLabel: '跳过',
      feedback: '已跳过。正确答案是：' + expectedLabel(q),
    }
  }
  switch (q.kind) {
    case 'pitch_compare':
      return gradeChoice(q, r, q.answer, (v) => pitchCompareLabel(v as PitchCompareAnswer), pitchFeedback(q))
    case 'interval':
      return gradeChoice(q, r, q.answer, (v) => intervalById(v as IntervalId).name, intervalFeedback(q.answer, r))
    case 'scale':
      return gradeChoice(q, r, q.answer, (v) => scaleOptionLabel(v as ScaleId), scaleFeedback(q.answer, r))
    case 'chord':
      return gradeChoice(q, r, q.answer, (v) => chordOptionLabel(v as ChordTypeId), chordFeedback(q.answer, r))
    case 'chord_inversion':
      return gradeChoice(q, r, String(q.answer), (v) => inversionOptionLabel(Number(v)), inversionFeedback(q.answer))
    case 'degree':
      return gradeDegree(q, r)
    case 'rhythm_tap':
      return gradeTaps(
        Array.from({ length: q.beats }, (_, i) => i),
        q.beats,
        q.bpm,
        r,
        q.skillIds,
      )
    case 'rhythm_echo':
    case 'rhythm_read':
      return gradeTaps(q.onsets, q.beats, q.bpm, r, q.skillIds)
    case 'progression':
      return gradeProgression(q, r)
    case 'bassline':
      return gradeBassLine(q, r)
    case 'dictation':
      return gradeDictation(q, r)
    case 'rhythm_choice':
      return gradeRhythmChoice(q, r)
    case 'perform':
      return gradePerform(q, r)
    case 'note_name':
      return gradeNoteName(q, r)
    case 'theory':
      return gradeTheory(q, r)
  }
}

export function expectedLabel(q: DrillQuestion): string {
  switch (q.kind) {
    case 'pitch_compare':
      return pitchCompareLabel(q.answer)
    case 'interval':
      return intervalById(q.answer).name
    case 'degree':
      return q.answer.map(degreeOptionLabel).join(' → ')
    case 'scale':
      return scaleOptionLabel(q.answer)
    case 'chord':
      return chordOptionLabel(q.answer)
    case 'chord_inversion':
      return inversionOptionLabel(q.answer)
    case 'rhythm_tap':
      return `每拍一下，共 ${q.beats} 拍`
    case 'rhythm_echo':
    case 'rhythm_read':
      return `${q.onsets.length} 个音的节奏型`
    case 'progression':
      return gradeProgression(q, EMPTY).expectedLabel
    case 'bassline':
      return gradeBassLine(q, EMPTY).expectedLabel
    case 'dictation':
      return gradeDictation(q, EMPTY).expectedLabel
    case 'rhythm_choice':
      return gradeRhythmChoice(q, EMPTY).expectedLabel
    case 'perform':
      return gradePerform(q, EMPTY).expectedLabel
    case 'note_name':
      return gradeNoteName(q, EMPTY).expectedLabel
    case 'theory':
      return gradeTheory(q, EMPTY).expectedLabel
  }
}

function gradeChoice(
  q: DrillQuestion,
  r: DrillResponse,
  answer: string,
  label: (v: string) => string,
  feedback: string,
): GradeResult {
  const given = r.kind === 'choice' ? r.value : r.kind === 'choices' ? (r.values[0] ?? '') : ''
  const correct = given === answer
  return {
    correct,
    credit: correct ? 1 : 0,
    expectedLabel: label(answer),
    givenLabel: given ? label(given) : '未作答',
    ...(correct || !given ? {} : { confusedWith: given, confusedExpected: answer }),
    feedback: correct ? praise(q) : feedback,
  }
}

function gradeDegree(q: Extract<DrillQuestion, { kind: 'degree' }>, r: DrillResponse): GradeResult {
  const values = r.kind === 'choices' ? r.values : r.kind === 'choice' ? [r.value] : []
  let hits = 0
  const skillCredits: Record<string, number> = {}
  q.answer.forEach((expected, i) => {
    const ok = values[i] === expected
    if (ok) hits++
    const skill = `degree:${expected}`
    skillCredits[skill] = Math.max(skillCredits[skill] ?? 0, ok ? 1 : 0)
  })
  const credit = q.answer.length === 0 ? 0 : hits / q.answer.length
  const correct = hits === q.answer.length
  const firstMiss = q.answer.findIndex((d, i) => values[i] !== d)
  const confused = firstMiss >= 0 && values[firstMiss] ? values[firstMiss] : undefined
  return {
    correct,
    credit,
    expectedLabel: q.answer.map(degreeOptionLabel).join(' → '),
    givenLabel: values.length ? values.map((v) => degreeOptionLabel(v as DegreeId)).join(' → ') : '未作答',
    ...(confused ? { confusedWith: confused, confusedExpected: q.answer[firstMiss]! } : {}),
    skillCredits,
    feedback: correct
      ? praise(q)
      : q.answer.length === 1
        ? degreeFeedback(q.answer[0]!, values[0] as DegreeId | undefined)
        : `答对 ${hits} / ${q.answer.length} 个。先在心里唱出主音（do），再把每个音和它比较。`,
  }
}

/**
 * Match each expected onset to the nearest unused tap within the window and
 * score by average absolute deviation. Extra taps lower the credit a little;
 * missing taps lower it a lot.
 */
export function gradeTaps(
  onsets: readonly number[],
  _beats: number,
  bpm: number,
  r: DrillResponse,
  skillIds: readonly string[],
): GradeResult {
  const taps = r.kind === 'taps' ? [...r.taps].sort((a, b) => a - b) : []
  const used = new Set<number>()
  const deviations: number[] = []
  for (const onset of onsets) {
    let bestIdx = -1
    let bestDist = Infinity
    taps.forEach((t, i) => {
      if (used.has(i)) return
      const d = Math.abs(t - onset)
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    })
    if (bestIdx >= 0 && bestDist <= MATCH_WINDOW_BEATS) {
      used.add(bestIdx)
      deviations.push(taps[bestIdx]! - onset)
    }
  }
  const matched = deviations.length
  const extra = taps.length - matched
  const expected = onsets.length
  const meanAbsMs = matched ? beatsToMs(deviations.reduce((s, d) => s + Math.abs(d), 0) / matched, bpm) : MAX_MS
  const meanSignedMs = matched ? beatsToMs(deviations.reduce((s, d) => s + d, 0) / matched, bpm) : 0

  const timingScore = clamp01(1 - (meanAbsMs - PERFECT_MS) / (MAX_MS - PERFECT_MS))
  const coverage = expected ? matched / expected : 0
  const extraPenalty = expected ? Math.min(0.3, (extra / expected) * 0.3) : 0
  const credit = clamp01(coverage * timingScore - extraPenalty)
  const correct = coverage === 1 && extra === 0 && meanAbsMs <= 80

  const skillCredits: Record<string, number> = {}
  for (const s of skillIds) skillCredits[s] = credit

  let feedback: string
  if (matched === 0) feedback = '没有对上任何一拍。先跟着预备拍在心里数 1 2 3 4，再开始按。'
  else if (coverage < 1) feedback = `漏了 ${expected - matched} 下。先求稳，不求快。`
  else if (extra > 0) feedback = `多按了 ${extra} 下。多听一遍节奏型，只在有音的地方按。`
  else if (meanSignedMs > 40) feedback = `整体偏晚约 ${Math.round(meanSignedMs)} 毫秒。试着把注意力放在下一拍即将到来的瞬间。`
  else if (meanSignedMs < -40) feedback = `整体偏早约 ${Math.round(-meanSignedMs)} 毫秒。放松一点，等拍点到了再按。`
  else if (meanAbsMs <= 40) feedback = '非常稳。'
  else feedback = `平均偏差 ${Math.round(meanAbsMs)} 毫秒，已经在正确的拍点附近，继续收紧。`

  return {
    correct,
    credit,
    expectedLabel: `${expected} 下`,
    givenLabel: `${taps.length} 下`,
    skillCredits,
    timing: { meanAbsDeviationMs: Math.round(meanAbsMs), meanSignedDeviationMs: Math.round(meanSignedMs), matched, expected, extra },
    feedback,
  }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

// ---------------------------------------------------------------------------
// Feedback copy — never judgemental, always one actionable cue.
// ---------------------------------------------------------------------------

function praise(q: DrillQuestion): string {
  const pool = ['对了。', '准确。', '就是它。', '听得很清楚。', '稳。']
  return pool[q.seed % pool.length]!
}

function pitchFeedback(q: Extract<DrillQuestion, { kind: 'pitch_compare' }>): string {
  const cents = Math.abs(q.b.detuneCents + (q.b.midi - q.a.midi) * 100)
  if (cents >= 100) return '把第一个音在心里哼住，再听第二个音是“往上走”还是“往下掉”。'
  return `这两个音只差 ${Math.round(cents)} 音分。专注听两个音叠在一起时的“晃动感”——有晃动就不是同一个音。`
}

function intervalFeedback(answer: IntervalId, r: DrillResponse): string {
  const given = r.kind === 'choice' ? (r.value as IntervalId) : null
  const a = intervalById(answer)
  if (given) {
    const g = intervalById(given)
    const diff = Math.abs(g.semitones - a.semitones)
    if (diff === 1) {
      return `${a.name}和${g.name}只差半音，这是最常见的混淆。记住${a.name}：${a.hint}`
    }
    if (g.semitones + a.semitones === 12) {
      return `${a.name}和${g.name}互为转位，音色相近。注意两音之间的“宽度”：${a.hint}`
    }
  }
  return `正确答案是${a.name}。${a.hint}`
}

function scaleFeedback(answer: ScaleId, r: DrillResponse): string {
  const a = scaleById(answer)
  const given = r.kind === 'choice' ? (r.value as ScaleId) : null
  if (given) {
    const g = scaleById(given)
    const diff = a.steps.filter((s) => !g.steps.includes(s)).concat(g.steps.filter((s) => !a.steps.includes(s)))
    if (diff.length <= 2) {
      return `${a.name}与${g.name}只差 ${diff.length} 个音。${a.name}的特点：${a.flavor}`
    }
  }
  return `正确答案是${a.name}。${a.flavor}`
}

function chordFeedback(answer: ChordTypeId, r: DrillResponse): string {
  const a = chordTypeById(answer)
  const given = r.kind === 'choice' ? (r.value as ChordTypeId) : null
  if (given) {
    const g = chordTypeById(given)
    if ((answer === 'maj' && given === 'min') || (answer === 'min' && given === 'maj')) {
      return `大小三和弦只差三音的半音。先找根音，再听中间那个音是“亮”还是“暗”。`
    }
    if (a.intervals.length !== g.intervals.length) {
      return `${a.name}有 ${a.intervals.length} 个音，${g.name}有 ${g.intervals.length} 个音。先数一数有几层。`
    }
  }
  return `正确答案是${a.name}。${a.flavor}`
}

function inversionFeedback(answer: number): string {
  if (answer === 0) return '最低音就是根音时，和弦听起来最“落地”。'
  if (answer === 1) return '第一转位的最低音是三音，比原位轻一些、更想往前走。'
  return '第二转位的最低音是五音，听起来悬着，常用来过渡。'
}

function degreeFeedback(answer: DegreeId, given: DegreeId | undefined): string {
  const sol = degreeSolfege(answer)
  if (given) {
    return `正确是第 ${degreeOptionLabel(answer)} 级（${sol}），你选了第 ${degreeOptionLabel(given)} 级。先在心里唱回主音 do，再从 do 一步步数到这个音。`
  }
  return `正确是第 ${degreeOptionLabel(answer)} 级（${sol}）。先在心里唱回主音 do，再从 do 数到这个音。`
}
