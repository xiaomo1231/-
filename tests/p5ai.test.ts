import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GrooveLabDB, getDb, setDbForTests } from '@/infrastructure/db/database'
import type { ChatMessage } from '@/infrastructure/ai/types'
import type * as AIClient from '@/services/ai/aiClient'

const fake = {
  json: null as unknown,
  text: '',
  calls: [] as ChatMessage[][],
}

vi.mock('@/services/ai/aiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof AIClient>()
  return {
    ...actual,
    getAI: vi.fn(async () => ({
      chatJSON: async (messages: ChatMessage[]) => {
        fake.calls.push(messages)
        return { data: fake.json, raw: { content: '', model: 'fake-model' } }
      },
      chat: async (messages: ChatMessage[]) => {
        fake.calls.push(messages)
        return { content: fake.text, model: 'fake-model' }
      },
    })),
  }
})

import { getAI, AIValidationError } from '@/services/ai/aiClient'
import { ExerciseService } from '@/services/exerciseService'
import { CritiqueService } from '@/services/critiqueService'
import { CompositionService } from '@/services/courseService'
import { LessonQAService, GHOSTWRITE_NOTICE } from '@/services/lessonQAService'
import { AdviceService, weekKey } from '@/services/adviceService'
import { ConfusionService } from '@/services/confusionService'
import { lessonById } from '@/course/stages'
import { addNote, emptyScore, setChord } from '@/music/score'

let n = 0
beforeEach(() => {
  setDbForTests(new GrooveLabDB(`p5ai-${Date.now()}-${n++}`))
  fake.json = null
  fake.text = ''
  fake.calls = []
})

describe('AI features with a fake provider', () => {
  it('stores only exercises that pass local checks, with provenance', async () => {
    fake.json = {
      exercises: [
        { module: 'E6', mode: 'major', romans: ['I', 'IV', 'V', 'I'], reason: '基础进行' },
        { module: 'E6', mode: 'major', romans: ['I', 'bVII', 'IV', 'I'], reason: '超出级别' },
        { module: 'E8', notes: [0, 2, 4, 0], reason: '级进' },
      ],
    }
    const { saved, rejected } = await ExerciseService.generate()
    expect(saved).toHaveLength(2)
    expect(rejected).toBe(1)
    expect(saved.every((s) => s.promptVersion === 'drill-generator/v1' && s.model === 'fake-model')).toBe(true)
    expect(await ExerciseService.pending()).toHaveLength(2)
    await ExerciseService.markUsed(saved[0]!.id)
    expect(await ExerciseService.counts()).toEqual({ pending: 1, used: 1 })
    const user = fake.calls[0]!.find((m) => m.role === 'user')!.content
    expect(user).toContain('允许的大调和弦')
  })

  it('stores nothing when every exercise fails', async () => {
    fake.json = { exercises: [{ module: 'E6', mode: 'major', romans: ['bVI', 'bVII', 'I', 'I'] }] }
    await expect(ExerciseService.generate()).rejects.toThrow(AIValidationError)
    expect(await getDb().generatedExercises.count()).toBe(0)
  })

  it('reviews a saved work: symbolic summary out, validated review stored', async () => {
    let s = emptyScore({ bars: 2 })
    s = setChord(s, { start: 0, beats: 4, roman: 'I' })
    s = setChord(s, { start: 4, beats: 4, roman: 'V' })
    s = addNote(s, { start: 0, beats: 4, midi: 64, lyric: '忽' })
    s = addNote(s, { start: 4, beats: 4, midi: 67, lyric: '略' })
    const comp = await CompositionService.save({ title: '测试', kind: 'song', stage: 5, bpm: 96, steps: 8, cells: [], score: s })
    fake.json = { summary: '开头清楚。', nextStep: '结尾回到主音。', dimensions: [{ dimension: 'melody', strengths: ['音域合适'], suggestions: [{ bar: 2, text: '最后一个音可以回到主音' }] }] }
    const rec = await CritiqueService.record(comp.id, { ai: true })
    expect(rec.ai!.dimensions[0]!.suggestions[0]!.bar).toBe(2)
    expect(rec.promptVersion).toBe('composition-reviewer/v1')
    const user = fake.calls[0]!.find((m) => m.role === 'user')!.content
    expect(user).toContain('<<<歌词 开始')
    expect(user).toContain('忽略')
    expect(user).toContain('1｜和弦 I(C)')

    fake.json = { summary: '', dimensions: [] }
    await expect(CritiqueService.record(comp.id, { ai: true })).rejects.toThrow(AIValidationError)
    expect(await CritiqueService.list(comp.id)).toHaveLength(1)
  })

  it('lesson Q&A hides answers that write the music', async () => {
    const lesson = lessonById('L4-1')!
    fake.text = '可以这样写：C D E F G A G F E'
    const r = await LessonQAService.ask(lesson, [], '帮我写旋律')
    expect(r).toEqual({ answer: GHOSTWRITE_NOTICE, hidden: true })
    fake.text = '♭VII 来自混合利底亚调式，所以有摇滚味。'
    expect((await LessonQAService.ask(lesson, [], '为什么？')).hidden).toBe(false)
    expect(fake.calls[1]![0]!.content).toContain(lesson.title)
    await expect(LessonQAService.ask(lesson, [], '   ')).rejects.toThrow(AIValidationError)
  })

  it('weekly advice and confusion explanations are validated', async () => {
    fake.json = { focus: [{ module: 'E2', minutes: 10, reason: '音程是门槛' }, { module: 'NOPE', minutes: 5 }], tip: '每天先唱再听' }
    const advice = await AdviceService.generate()
    expect(advice.focus).toEqual([{ module: 'E2', minutes: 10, reason: '音程是门槛' }])
    expect((await AdviceService.current())!.week).toBe(weekKey())

    fake.json = { why: '只差半音', tips: ['先唱出来'], practice: '练 5 题' }
    const pair = { id: 'E2|M3|m3', module: 'E2' as const, expected: 'M3', given: 'm3', count: 4, lastAt: 1 }
    const e = await ConfusionService.explain(pair)
    expect(e.tips).toEqual(['先唱出来'])
    await ConfusionService.explain(pair)
    expect(fake.calls).toHaveLength(2)
  })

  it('every AI feature reports a clear error when no AI is configured', async () => {
    vi.mocked(getAI).mockResolvedValueOnce(null)
    await expect(ExerciseService.generate()).rejects.toThrow(/设置/)
  })
})
