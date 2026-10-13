import { beforeEach, describe, expect, it } from 'vitest'
import { GrooveLabDB, getDb, setDbForTests } from '@/infrastructure/db/database'
import { STAGES, allLessons, lessonById } from '@/course/stages'
import { checkCreation, checkSong, requirementMet, scoreFromSpec, signatureTonic } from '@/course/rules'
import { isSongCreation, type CreationSpec, type SongCreationSpec } from '@/course/types'
import { analyzeScore } from '@/analysis/ruleEngine'
import { applyLyrics, chordPitchClasses, type ChordSlot, type Score, type ScoreNote } from '@/music/score'
import type { RomanId } from '@/music/keys'
import { STYLES, applyStyle, ensureTracks, materialize, withTracks } from '@/music/arrangement'
import { levelTitles } from '@/drills/levels'
import { MODULES, moduleInfo } from '@/drills/types'
import { scaleById } from '@/music/scales'
import { generateQuestion } from '@/drills/generators'
import { computeStageStatus, nextUnlock, CompositionService, CourseService } from '@/services/courseService'
import { DAY_MS, gradeFromOutcome, scheduleItem } from '@/services/reviewService'
import { buildPlan, PLAN_PREREQ } from '@/services/dailyPlanService'
import { ProfileService, defaultProfile } from '@/services/profileService'
import { ModuleProgressService } from '@/services/moduleProgressService'
import type { ModuleProgress, ReviewItem } from '@/entities/types'

let counter = 0
beforeEach(() => {
  setDbForTests(new GrooveLabDB(`course-${Date.now()}-${counter++}`))
})

describe('lesson content', () => {
  it('stages 0–3 have 8, 10, 10 and 10 lessons with unique ids and sequential indices', () => {
    expect(STAGES[0]!.lessons).toHaveLength(8)
    expect(STAGES[1]!.lessons).toHaveLength(10)
    expect(STAGES[2]!.lessons).toHaveLength(10)
    expect(STAGES[3]!.lessons).toHaveLength(10)
    const ids = allLessons().map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of STAGES) s.lessons.forEach((l, i) => expect(l.index).toBe(i + 1))
  })

  it('every drill block points at a real module and level, and can be generated', () => {
    for (const l of allLessons()) {
      const drills = l.blocks.filter((b) => b.type === 'drill')
      expect(drills.length).toBeGreaterThan(0)
      const blockIds = new Set<string>()
      for (const b of drills) {
        if (b.type !== 'drill') continue
        expect(blockIds.has(b.id)).toBe(false)
        blockIds.add(b.id)
        expect(MODULES.some((m) => m.id === b.module)).toBe(true)
        expect(b.level).toBeLessThanOrEqual(moduleInfo(b.module).maxLevel)
        expect(() => generateQuestion(b.module, b.level, { seed: 1, instrument: 'guitar' })).not.toThrow()
        if (b.noInstrument) expect(b.noInstrument.level).toBeLessThanOrEqual(levelTitles(b.noInstrument.module).length)
      }
    }
  })

  it('every composer creation can be completed (harmonisations with their example, songs with a generated solution)', () => {
    for (const l of allLessons()) {
      const c = l.creation
      if (!isSongCreation(c)) continue
      const score = solveCreation(c)
      if (c.kind === 'chords') expect(c.exampleChords, `${l.id} has an example`).toBeDefined()
      const r = checkSong(c, score)
      expect(r.problems, `${l.id}: ${r.problems.join(' ')}`).toEqual([])
    }
  })

  it('example songs in lessons have no rule-engine warnings except open endings', () => {
    for (const l of allLessons()) {
      for (const b of l.blocks) {
        if (b.type !== 'song') continue
        const warns = analyzeScore(b.score).findings.filter((f) => f.severity === 'warn' && f.id !== 'end-tonic')
        expect(warns.map((w) => w.message), `${l.id} ${b.title}`).toEqual([])
      }
    }
  })

  it('every creation spec is satisfiable on its own grid', () => {
    for (const l of allLessons()) {
      const c = l.creation
      if (isSongCreation(c)) continue
      expect(c.steps).toBeGreaterThan(0)
      if (c.kind === 'melody') {
        expect(c.tonic).toBeDefined()
        // A simple solution: tonic everywhere except a leap / start note when required.
        const tonic = c.tonic!
        const steps = scaleById(c.scale ?? 'major').steps
        const cells: Array<number | null> = Array.from({ length: c.steps }, () => tonic)
        if (c.check.startDegree !== undefined) cells[0] = tonic + c.check.startDegree - (c.check.startDegree > 7 ? 12 : 0)
        if (c.check.needsLeap) cells[1] = tonic + (c.check.needsLeap <= 7 ? (steps.includes(c.check.needsLeap) ? c.check.needsLeap : 7) : 12)
        if (c.check.startDegree === 7) cells[0] = tonic + 7
        if (c.check.endDegree !== undefined && c.check.endDegree !== 0) {
          // Walk down the scale, one step at a time, to the required last note.
          const below = [...steps].reverse().map((st) => tonic + st - 12)
          const path = below.slice(0, below.findIndex((m) => ((m - tonic) % 12 + 12) % 12 === c.check.endDegree) + 1)
          path.forEach((m, i) => (cells[cells.length - path.length + i] = m))
        }
        const r = checkCreation(c, cells)
        expect(r.problems, `${l.id}: ${r.problems.join(' ')}`).toEqual([])
      } else {
        // Per bar: hits on 1, 1&, 2& and 4 — has a syncopation (2& with beat 3 silent) and a rest (beat 3).
        const cells: Array<number | null> = Array.from({ length: c.steps }, (_, i) => ([0, 1, 3, 6].includes(i % 8) ? 1 : null))
        const r = checkCreation(c, cells)
        expect(r.problems, `${l.id}: ${r.problems.join(' ')}`).toEqual([])
      }
    }
  })

  it('lookup helpers', () => {
    expect(lessonById('L1-3')?.title).toContain('调号')
    expect(signatureTonic(57, 'natural_minor')).toBe(60)
  })
})

/** A solution for any composer creation: the example for harmonisations, generated otherwise, then arranged. */
function solveCreation(spec: SongCreationSpec): Score {
  let s: Score =
    spec.kind === 'chords' ? { ...scoreFromSpec(spec), chords: spec.exampleChords ?? [] } : spec.kind === 'song' ? solveSong(spec) : scoreFromSpec(spec)
  const style = STYLES.find((st) => st.id === spec.exampleStyle)
  if (style) s = { ...applyStyle(s, style), bpm: s.bpm }
  if (spec.exampleSections) s = { ...s, sections: spec.exampleSections.map((x) => ({ ...x })) }
  const c = spec.check
  if (c.needsTracks || c.needsWidePan || c.needsManual || (c.minVoices ?? 0) > 4) {
    s = withTracks(s)
    let tracks = ensureTracks(s)
    const wanted = new Set([...(c.needsTracks ?? []), ...(c.needsWidePan ? (['guitar', 'keys'] as const) : []), ...((c.minVoices ?? 0) > 4 ? (['keys', 'guitar', 'bass', 'drums'] as const) : [])])
    tracks = tracks.map((t) => (wanted.has(t.kind) ? { ...t, mute: false } : t))
    if (c.needsWidePan) tracks = tracks.map((t) => (t.kind === 'guitar' ? { ...t, pan: -0.6 } : t.kind === 'keys' ? { ...t, pan: 0.6 } : t))
    if (c.needsManual) {
      const kind = c.needsManual === true ? 'keys' : c.needsManual
      tracks = tracks.map((t) => (t.kind === kind ? { ...materialize({ ...s, tracks }, t), mute: false } : t))
    }
    s = { ...s, tracks }
  }
  return s
}

/**
 * A mechanical solution for a song creation: arpeggiate each bar's chord in
 * close position, then adjust for the lesson's specific requirements.
 */
function solveSong(spec: SongCreationSpec): Score {
  const base = scoreFromSpec(spec)
  const romans: RomanId[] = ['I', 'V', 'vi', 'IV']
  const chords: ChordSlot[] =
    spec.givenChords ??
    spec.exampleChords ??
    Array.from({ length: spec.bars }, (_, i) => ({ start: i * 4, beats: 4, roman: i === spec.bars - 1 ? 'I' : romans[i % 4]! }))
  const s: Score = { ...base, chords }
  const tonicPc = spec.tonic % 12
  const fold = (pc: number, lo: number) => lo + ((pc - lo) % 12 + 12) % 12
  const melody: ScoreNote[] = []
  const half = spec.bars / 2
  const climaxBar = Math.max(1, Math.floor((spec.bars * 2) / 3) - 1)
  for (let b = 0; b < spec.bars; b++) {
    const slot = chords.find((c) => c.start <= b * 4 && c.start + c.beats > b * 4)!
    const lo = spec.check.secondHalfHigher && b >= half ? 64 : 60
    const tones = chordPitchClasses(s, slot.roman).map((pc) => fold(pc, lo)).sort((x, y) => x - y)
    const t = (i: number) => tones[i % tones.length]!
    let bar: Array<[number, number]> = [[0, t(0)], [1, t(1)], [2, t(2)], [3, t(1)]].map(([o, m]) => [o!, m!])
    const last = b === spec.bars - 1
    if (last) {
      const home = tones.find((m) => m % 12 === tonicPc) ?? t(0)
      bar = [[0, t(1)], [1, t(0)], [2, home]]
    }
    if (spec.check.climaxOnce && b === climaxBar) bar[2] = [2, Math.min(...tones.map((m) => fold(m % 12, 72)))]
    bar.forEach(([o, m], i) => {
      const beats = last && i === bar.length - 1 ? 2 : 1
      melody.push({ start: b * 4 + o, beats, midi: m })
    })
  }
  let out: Score = { ...s, melody }
  if (spec.check.needsNct) {
    // Bar 1 over I: E F(passing) G A(neighbour) G.
    out = { ...out, melody: [...out.melody.filter((n) => n.start >= 4), { start: 0, beats: 1, midi: 64 }, { start: 1, beats: 1, midi: 65 }, { start: 2, beats: 1, midi: 67 }, { start: 3, beats: 0.5, midi: 69 }, { start: 3.5, beats: 0.5, midi: 67 }] }
  }
  if (spec.check.repeatBars) {
    const [x, y] = spec.check.repeatBars
    // Use tones shared by both bars' chords.
    const cx = chordPitchClasses(out, chords.find((c) => c.start === x * 4)!.roman)
    const cy = chordPitchClasses(out, chords.find((c) => c.start === y * 4)!.roman)
    const common = cx.filter((pc) => cy.includes(pc)).map((pc) => fold(pc, 60)).sort((p, q) => p - q)
    const pattern: Array<[number, number, number]> = [[0, 0.5, common[1] ?? common[0]!], [0.5, 0.5, common[1] ?? common[0]!], [1, 1, common[0]!], [2, 2, common[1] ?? common[0]!]]
    const mk = (bar: number) => pattern.map(([o, beats, midi]) => ({ start: bar * 4 + o, beats, midi }))
    out = { ...out, melody: [...out.melody.filter((n) => Math.floor(n.start / 4) !== x && Math.floor(n.start / 4) !== y), ...mk(x), ...mk(y)].sort((p, q) => p.start - q.start) }
  }
  if (spec.check.needsRest) out = { ...out, melody: out.melody.filter((n) => n.start !== 7) }
  if (spec.check.needsLyrics || spec.lyrics) out = applyLyrics(out, '啦'.repeat(out.melody.length))
  return out
}

describe('creation checks', () => {
  it('song checks report missing chords, cadence and contrast', () => {
    const spec = lessonById('L2-7')!.creation as SongCreationSpec
    const bare = scoreFromSpec(spec)
    const r = checkSong(spec, bare)
    expect(r.ok).toBe(false)
    expect(r.problems.some((p) => p.includes('还没有和弦'))).toBe(true)
    expect(r.problems.some((p) => p.includes('正格终止'))).toBe(true)
  })
  const rhythm = lessonById('L0-5')!.creation as CreationSpec
  it('rhythm syncopation and rest rules', () => {
    const none: Array<number | null> = Array(16).fill(null)
    const plain = none.map((_, i) => (i % 2 === 0 ? 1 : null))
    expect(checkCreation(rhythm, plain).ok).toBe(false)
    const sync = [...plain]
    sync[3] = 1
    sync[4] = null
    expect(checkCreation(rhythm, sync).ok).toBe(true)
    const rest = lessonById('L0-4')!.creation as CreationSpec
    expect(checkCreation(rest, plain).problems.some((p) => p.includes('休止'))).toBe(true)
  })
  it('melody start / end / distinct / leap rules', () => {
    const c = lessonById('L0-8')!.creation as CreationSpec
    expect(checkCreation(c, [60, 62, 64, 62, 60, 62, 64, 60]).ok).toBe(true)
    expect(checkCreation(c, [60, 62, 64, 65, 60, 62, 64, 60]).problems.some((p) => p.includes('不同的音'))).toBe(true)
    expect(checkCreation(c, [60, 62, 64, 62, 60, 62, 64, 62]).problems.some((p) => p.includes('最后一个音'))).toBe(true)
  })
})

describe('stage rules', () => {
  const prog = (moduleId: ModuleProgress['moduleId'], unlockedLevel: number, extra: Partial<ModuleProgress> = {}): ModuleProgress => ({
    moduleId,
    level: unlockedLevel,
    unlockedLevel,
    recentAtLevel: [],
    totalAttempts: 10,
    totalCorrect: 10,
    updatedAt: 0,
    ...extra,
  })
  it('requirement met when the next level is unlocked or the top level is held', () => {
    expect(requirementMet({ module: 'E1', level: 3, label: '' }, prog('E1', 4))).toBe(true)
    expect(requirementMet({ module: 'E1', level: 3, label: '' }, prog('E1', 3))).toBe(false)
    const top = moduleInfo('S2').maxLevel
    const held = prog('S2', top, { recentAtLevel: Array.from({ length: 10 }, () => ({ correct: true, credit: 1 })) })
    expect(requirementMet({ module: 'S2', level: top, label: '' }, held)).toBe(true)
  })
  it('unlocks the next stage only when lessons and thresholds are both done', () => {
    const profile = { ...defaultProfile(), unlockedStage: 0 }
    const lessons0 = STAGES[0]!.lessons.map((l) => ({ lessonId: l.id, stage: 0, exercisesDone: [], completedAt: 1, updatedAt: 1 }))
    const modulesMet = [prog('E1', 4), prog('R1', 2), prog('N1', 2)]
    expect(nextUnlock(computeStageStatus(profile, lessons0, modulesMet), 0)).toBe(1)
    expect(nextUnlock(computeStageStatus(profile, lessons0.slice(1), modulesMet), 0)).toBeNull()
    expect(nextUnlock(computeStageStatus(profile, lessons0, [prog('E1', 4), prog('R1', 2)]), 0)).toBeNull()
  })
})

describe('review scheduling', () => {
  const now = 1_000_000
  it('maps outcomes to grades', () => {
    expect(gradeFromOutcome(0.2)).toBe('again')
    expect(gradeFromOutcome(0.6)).toBe('hard')
    expect(gradeFromOutcome(1, 2000, 10000)).toBe('easy')
    expect(gradeFromOutcome(1, 9000, 10000)).toBe('good')
  })
  it('grows intervals on success and resets on a miss', () => {
    let item: ReviewItem | undefined
    item = scheduleItem(item, 'interval:M3', 'E2', 'good', now)
    expect(item.interval).toBe(1)
    item = scheduleItem(item, 'interval:M3', 'E2', 'good', now)
    expect(item.interval).toBe(3)
    item = scheduleItem(item, 'interval:M3', 'E2', 'good', now)
    expect(item.interval).toBe(Math.round(3 * 2.5))
    item = scheduleItem(item, 'interval:M3', 'E2', 'again', now)
    expect(item.interval).toBe(0)
    expect(item.lapses).toBe(1)
    expect(item.due - now).toBeLessThan(DAY_MS)
  })
})

describe('daily plan (P2)', () => {
  const p = (id: ModuleProgress['moduleId'], attempts: number, level = 1): ModuleProgress => ({
    moduleId: id,
    level,
    unlockedLevel: level,
    recentAtLevel: [],
    totalAttempts: attempts,
    totalCorrect: attempts,
    updatedAt: 0,
  })
  it('has 3 knowledge + 1 rhythm + 1 singing item and no instrument task', () => {
    const plan = buildPlan([], [], '2026-10-07', 0, [])
    const kinds = plan.items.map((i) => moduleInfo(i.module).kind)
    expect(plan.items).toHaveLength(5)
    expect(kinds.filter((k) => k === 'ear' || k === 'read')).toHaveLength(3)
    expect(kinds.filter((k) => k === 'rhythm')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'sing')).toHaveLength(1)
    expect(plan.items.some((i) => i.module === 'I1' || i.module === 'I2' || i.link)).toBe(false)
  })
  it('respects prerequisites for a beginner', () => {
    const plan = buildPlan([], [], '2026-10-07', 0, [])
    for (const item of plan.items) expect(PLAN_PREREQ[item.module]).toBeUndefined()
    expect(plan.items.find((i) => moduleInfo(i.module).kind === 'sing')!.module).toBe('S1')
  })
  it('prioritises due skills', () => {
    const due: ReviewItem[] = [{ skillId: 'chord:maj7', module: 'E5', due: 0, interval: 1, ease: 2.5, reps: 1, lapses: 0, lastAt: 0 }]
    const plan = buildPlan([p('E5', 40, 4), p('E1', 0)], [], '2026-10-07', 0, due)
    expect(plan.items[0]!.module).toBe('E5')
    expect(plan.items[0]!.reason).toContain('到期复习')
    expect(plan.items[0]!.focusSkills).toContain('chord:maj7')
  })
})

describe('CourseService (fake-indexeddb)', () => {
  it('completes a lesson once drills pass and a creation is saved', async () => {
    await ProfileService.ensure()
    const lesson = lessonById('L0-1')!
    expect((await CourseService.completeIfReady(lesson)).completed).toBe(false)
    await CourseService.markExercise(lesson.id, 'd1')
    expect((await CourseService.completeIfReady(lesson)).completed).toBe(false)
    const comp = await CompositionService.save({ title: 't', kind: 'melody', lessonId: lesson.id, stage: 0, bpm: 90, steps: 4, cells: [60, 62, 64, 60] })
    await CourseService.attachCreation(lesson.id, comp.id)
    const r = await CourseService.completeIfReady(lesson)
    expect(r.completed).toBe(true)
    expect(r.xp).toBe(30)
    expect((await ProfileService.ensure()).xp).toBe(30)
    expect((await CourseService.completeIfReady(lesson)).completed).toBe(false)
  })

  it('deleting a composition detaches it from an unfinished lesson only', async () => {
    const comp = await CompositionService.save({ title: 't', kind: 'rhythm', lessonId: 'L0-3', stage: 0, bpm: 90, steps: 8, cells: Array(8).fill(1) })
    await CourseService.attachCreation('L0-3', comp.id)
    await CompositionService.remove(comp.id)
    expect((await CourseService.progress('L0-3')).compositionId).toBeUndefined()
    expect(await getDb().compositions.count()).toBe(0)
  })

  it('unlocks stage 1 when stage 0 is done and thresholds are met', async () => {
    await ProfileService.ensure()
    for (const l of STAGES[0]!.lessons) {
      await getDb().lessonProgress.put({ lessonId: l.id, stage: 0, exercisesDone: [], completedAt: 1, updatedAt: 1 })
    }
    expect(await CourseService.evaluateUnlock()).toBeNull()
    await ModuleProgressService.setStartingLevel('E1', 4)
    await ModuleProgressService.setStartingLevel('R1', 2)
    await ModuleProgressService.setStartingLevel('N1', 2)
    expect(await CourseService.evaluateUnlock()).toBe(1)
    expect((await ProfileService.ensure()).unlockedStage).toBe(1)
  })
})
