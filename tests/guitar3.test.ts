import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GrooveLabDB, getDb, setDbForTests } from '@/infrastructure/db/database'
import type { ChatMessage } from '@/infrastructure/ai/types'
import type * as AIClient from '@/services/ai/aiClient'

const fake = { json: null as unknown, calls: [] as ChatMessage[][] }
vi.mock('@/services/ai/aiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof AIClient>()
  return {
    ...actual,
    getAI: vi.fn(async () => ({
      chatJSON: async (messages: ChatMessage[]) => {
        fake.calls.push(messages)
        return { data: fake.json, raw: { content: '', model: 'fake' } }
      },
    })),
  }
})

import { analyzeImprov, downbeatTargets, improvSuggestions, improvToScore, segmentNotes, type NoteEvent } from '@/guitar/improv'
import { MAJOR_SCALE, scaleInWindow, playNotes, LICKS } from '@/guitar/scales'
import { validateCoachExercises, validateImprovReview } from '@/services/ai/validate'
import { GuitarAIService, coachToExercise } from '@/services/guitarAIService'
import { buildPlan } from '@/services/dailyPlanService'
import { afterGuitarAttempt } from '@/services/guitarRewards'
import { GuitarService } from '@/services/guitarService'
import { ProfileService } from '@/services/profileService'
import { chordSymbolFor } from '@/music/score'
import { STRUM_PATTERNS } from '@/guitar/strum'

const STD = [40, 45, 50, 55, 59, 64]
let n = 0
beforeEach(() => {
  setDbForTests(new GrooveLabDB(`g3-${Date.now()}-${n++}`))
  fake.json = null
  fake.calls = []
})

const track = (notes: Array<[number, number, number]>, rate = 40) => {
  const end = Math.max(...notes.map(([s, d]) => s + d)) + 0.5
  return Array.from({ length: Math.ceil(end * rate) }, (_, i) => {
    const t = i / rate
    const hit = notes.find(([s, d]) => t >= s && t < s + d)
    return { t, midi: hit ? hit[2] + 0.05 : null }
  })
}

describe('improvisation analysis', () => {
  it('segments notes from a pitch track, splitting on pitch changes and silence', () => {
    const notes = segmentNotes(track([[0, 0.4, 57], [0.4, 0.3, 60], [1.2, 0.5, 64]]))
    expect(notes.map((x) => x.midi)).toEqual([57, 60, 64])
    expect(notes[2]!.start).toBeCloseTo(1.2, 1)
  })
  it('computes scale, chord-tone, rest, phrase and range statistics', () => {
    const beat = 0.5
    const ctx = { startAt: 0, beat, bars: 2, chordPcs: [[9, 0, 4], [5, 9, 0]], scalePcs: [9, 11, 0, 2, 4, 5, 7] }
    const notes: NoteEvent[] = [
      { start: 0, end: 0.4, midi: 57 }, // A on beat 1 of bar 1: chord tone
      { start: 0.5, end: 0.9, midi: 60 },
      { start: 2, end: 2.4, midi: 65 }, // F on beat 1 of bar 2: chord tone
      { start: 3.25, end: 3.6, midi: 66 }, // F#, off the beat: out of scale
    ]
    const s = analyzeImprov(notes, ctx)
    expect(s.notes).toBe(4)
    expect(s.inScale).toBe(0.75)
    expect(s.strongChordTones).toBe(1)
    expect(s.phrases).toBe(3)
    expect(s.rangeSemitones).toBe(9)
    expect(s.rest).toBeGreaterThan(0.5)
    expect(improvSuggestions(s).some((t) => t.includes('音阶外'))).toBe(true)
    expect(improvSuggestions({ ...s, notes: 0 })[0]).toContain('没有检测到')
  })
  it('checks the first note of each bar against the chord', () => {
    const pts = track([[0.05, 0.4, 57], [2.05, 0.4, 62]])
    const r = downbeatTargets(pts, { startAt: 0, beat: 0.5, bars: 2, chordPcs: [[9, 0, 4], [5, 9, 0]] })
    expect(r.map((x) => x.chordTone)).toEqual([true, false])
    expect(r[1]!.midi).toBe(62)
  })
  it('turns an improvisation into a score on an eighth grid without crossing bars', () => {
    const notes: NoteEvent[] = [
      { start: 0.02, end: 0.5, midi: 57 },
      { start: 1.48, end: 2.6, midi: 60 },
    ]
    const sc = improvToScore(notes, { startAt: 0, beat: 0.5, bars: 2, keyTonic: 57, mode: 'minor', bpm: 120, romans: ['i', 'VI'] })
    expect(sc.melody[0]).toEqual({ start: 0, beats: 1, midi: 57 })
    expect(sc.melody[1]!.start).toBe(3)
    expect(sc.melody[1]!.start + sc.melody[1]!.beats).toBeLessThanOrEqual(4)
    expect(sc.chords.map((c) => c.roman)).toEqual(['i', 'VI'])
  })
})

describe('scales and licks for G3', () => {
  it('major scale windows stay inside the window, three notes per string at most', () => {
    const g = scaleInWindow(7, MAJOR_SCALE, STD, 2, 5)
    expect(g.every((x) => x.fret >= 2 && x.fret <= 5)).toBe(true)
    for (let s = 0; s < 6; s++) expect(g.filter((x) => x.string === s).length).toBeLessThanOrEqual(3)
    expect(g.every((x) => MAJOR_SCALE.includes((STD[x.string]! + x.fret - 7 + 120) % 12))).toBe(true)
    expect(playNotes({ type: 'scale', name: 'G', tonicPc: 7, scale: 'major', lowFret: 2, highFret: 5 }, STD).notes.length).toBe(g.length * 2 - 1)
  })
  it('legato licks mark the technique on the note before the legato note', () => {
    const legato = LICKS.filter((l) => l.id.startsWith('legato'))
    expect(legato).toHaveLength(3)
    for (const l of legato) expect(l.notes.some((x) => x.tech === 'hammer' || x.tech === 'pull' || x.tech === 'slide')).toBe(true)
  })
})

describe('guitar AI', () => {
  const ctx = { patterns: new Set(STRUM_PATTERNS.map((p) => p.id)), romansMajor: ['I', 'ii', 'IV', 'V', 'vi'], romansMinor: ['i', 'iv', 'v', 'III', 'VI', 'VII'], strings: STD }
  it('keeps only playable exercises', () => {
    const { valid, rejected } = validateCoachExercises(
      {
        exercises: [
          { type: 'strum', pattern: 'pop', mode: 'major', romans: ['I', 'V', 'vi', 'IV'], bpm: 80, reason: '万能型' },
          { type: 'strum', pattern: 'made-up', mode: 'major', romans: ['I', 'V', 'vi', 'IV'], bpm: 80 },
          { type: 'strum', pattern: 'pop', mode: 'major', romans: ['I', 'iii', 'vi', 'IV'], bpm: 80 },
          { type: 'lick', notes: [{ string: 3, fret: 5, beats: 0.5 }, { string: 3, fret: 7, beats: 0.5 }, { string: 4, fret: 5, beats: 1 }, { string: 4, fret: 8, beats: 2, tech: 'vibrato' }], bpm: 72, reason: '句型' },
          { type: 'lick', notes: [{ string: 3, fret: 6, beats: 1 }, { string: 3, fret: 7, beats: 1 }, { string: 4, fret: 5, beats: 1 }, { string: 4, fret: 8, beats: 1 }], bpm: 72 },
          { type: 'bend', string: 3, fret: 7, semitones: 2, reason: '推弦' },
          { type: 'bend', string: 3, fret: 7, semitones: 1 },
        ],
      },
      ctx,
    )
    expect(valid.map((v) => v.type)).toEqual(['strum', 'lick', 'bend'])
    expect(rejected).toBe(4)
  })
  it('minor strums become relative-major chords so the desk can play them', () => {
    const ex = coachToExercise({ type: 'strum', pattern: 'pop', mode: 'minor', romans: ['i', 'VI', 'III', 'VII'], bpm: 80, reason: 'r' }, 'x')
    if (ex.kind !== 'strum') throw new Error('expected strum')
    expect(ex.romans.map((r) => chordSymbolFor({ keyTonic: ex.tonic, mode: 'major' }, r))).toEqual(['Am', 'F', 'C', 'G'])
  })
  it('improv reviews drop written-out music and bad bar numbers', () => {
    const { review, dropped } = validateImprovReview({ summary: '留白不错', strengths: ['句子分得清楚'], suggestions: [{ bar: 9, text: '高潮再高一点' }, { text: '弹 A C D E G A C' }], nextStep: '重复一个动机' }, 8)
    expect(review.suggestions).toEqual([{ text: '高潮再高一点' }])
    expect(dropped).toBe(1)
  })
  it('stores generated guitar exercises apart from ear-training exercises', async () => {
    fake.json = { exercises: [{ type: 'bend', string: 4, fret: 8, semitones: 2, reason: '推到根音' }] }
    const { saved } = await GuitarAIService.generate()
    expect(saved).toHaveLength(1)
    expect(saved[0]!.module).toBe('guitar')
    expect(await GuitarAIService.pending()).toHaveLength(1)
    const { ExerciseService } = await import('@/services/exerciseService')
    expect(await ExerciseService.pending()).toHaveLength(0)
    const user = fake.calls[0]!.find((m) => m.role === 'user')!.content
    expect(user).toContain('可用节奏型')
  })
})

describe('integration', () => {
  it('the guitar workshop stays out of the daily plan', () => {
    const plan = buildPlan([], [], '2026-10-09', 1, [])
    expect(plan.items.some((i) => i.link || i.module === 'I1' || i.module === 'I2')).toBe(false)
  })
  it('an older started plan keeps its progress but loses instrument items', async () => {
    const { DailyPlanService } = await import('@/services/dailyPlanService')
    const { localDateKey } = await import('@/services/progressRules')
    const date = localDateKey()
    const base = { level: 1, questions: 4, focusSkills: [], reason: 'x' }
    await getDb().dailyPlans.put({
      date,
      version: 3,
      createdAt: 0,
      items: [
        { ...base, id: 'a', module: 'E1', completed: true },
        { ...base, id: 'b', module: 'I1', completed: false },
        { ...base, id: 'c', module: 'I1', completed: false, link: '/guitar/R1', label: '吉他工坊' },
      ],
    })
    const plan = await DailyPlanService.today()
    expect(plan.items.map((i) => i.id)).toEqual(['a'])
    expect(plan.completedAt).toBeDefined()
  })
  it('the first guitar pass earns a badge', async () => {
    await ProfileService.ensure()
    await ProfileService.update({ instrument: 'guitar', setupDone: true })
    const r = await GuitarService.record('R1-1', 'R1', 1, true, 'ok')
    const rewards = await afterGuitarAttempt(r.firstPass)
    expect(rewards.badges.map((b) => b.id)).toContain('guitar-first')
    expect(await getDb().badges.get('guitar-first')).toBeDefined()
  })
})
