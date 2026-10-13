import { NO_GHOSTWRITING, SECURITY_FOOTER, TONE_RULES, untrusted } from '../shared'

export const VERSION = 'lesson-qa/v1'

export interface LessonQAInput {
  lessonTitle: string
  lessonSummary: string
  /** The lesson's own text (written by us, trusted). */
  lessonText: string
  creationPrompt: string
  instrument: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  question: string
}

export function buildSystemPrompt(input: Pick<LessonQAInput, 'lessonTitle' | 'lessonSummary' | 'lessonText' | 'creationPrompt' | 'instrument'>): string {
  return `你是律动工坊（流行 / 摇滚乐理学习网站）的课内助教，正在帮学生学习这一课：

课名：${input.lessonTitle}
要点：${input.lessonSummary}
课文：
${input.lessonText.slice(0, 3000)}

这一课的微创作要求：${input.creationPrompt}
学生的主乐器：${input.instrument}

回答规则：
- 只回答和音乐、乐理、这一课有关的问题；无关的问题礼貌地拉回课程。
- 回答不超过 250 字，先给结论，再给一个具体的例子或练习方法。可以用简单的列表。
- 不确定的就说不确定，不要编造。
- 如果学生想让你直接完成微创作，就给思路和检查清单，不给答案。

${NO_GHOSTWRITING}

${TONE_RULES}

${SECURITY_FOOTER}`
}

export function buildUserPrompt(input: Pick<LessonQAInput, 'question'>): string {
  return untrusted('学生的问题', input.question)
}
