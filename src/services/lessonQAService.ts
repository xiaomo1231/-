import type { Lesson } from '@/course/types'
import { INSTRUMENT_LABEL } from '@/entities/types'
import { lessonQA } from '@/infrastructure/ai/prompts'
import { ProfileService } from './profileService'
import { AIValidationError, getAI } from './ai/aiClient'
import { cleanText, looksLikeGhostwriting } from './ai/validate'

export interface QAMessage {
  role: 'user' | 'assistant'
  content: string
}

export const MAX_QUESTION_CHARS = 300

/** The lesson's own prose (trusted content we wrote) for the assistant's context. */
export function lessonText(lesson: Lesson): string {
  return lesson.blocks
    .map((b) => (b.type === 'text' || b.type === 'tip' ? b.md : 'title' in b ? `【${b.title}】${'caption' in b && b.caption ? b.caption : ''}` : ''))
    .filter(Boolean)
    .join('\n\n')
}

export const GHOSTWRITE_NOTICE = '这条回答直接写出了一整段旋律或和弦进行。按“不代写”规则，它没有显示出来。可以换个问法，比如问原理、问怎么检查自己的写法。'

export const LessonQAService = {
  async ask(lesson: Lesson, history: QAMessage[], question: string, signal?: AbortSignal): Promise<{ answer: string; hidden: boolean }> {
    const q = cleanText(question, MAX_QUESTION_CHARS)
    if (!q) throw new AIValidationError('先写下你的问题。')
    const ai = await getAI()
    if (!ai) throw new AIValidationError('还没有配置 AI。到“设置 → AI 导师”填入服务商和 API Key 后再试。')
    const profile = await ProfileService.ensure()
    const system = lessonQA.buildSystemPrompt({
      lessonTitle: lesson.title,
      lessonSummary: lesson.summary,
      lessonText: lessonText(lesson),
      creationPrompt: lesson.creation.prompt,
      instrument: INSTRUMENT_LABEL[profile.instrument],
    })
    const past = history.slice(-6).map((m) => ({ role: m.role, content: m.role === 'user' ? lessonQA.buildUserPrompt({ question: m.content }) : m.content }))
    const res = await ai.chat([{ role: 'system', content: system }, ...past, { role: 'user', content: lessonQA.buildUserPrompt({ question: q }) }], {
      maxTokens: 800,
      ...(signal ? { signal } : {}),
    })
    const answer = res.content.trim()
    if (!answer) throw new AIValidationError('AI 没有给出回答，可以再问一次。')
    if (looksLikeGhostwriting(answer)) return { answer: GHOSTWRITE_NOTICE, hidden: true }
    return { answer: answer.slice(0, 2000), hidden: false }
  },
}
