import { NO_GHOSTWRITING, SECURITY_FOOTER, TONE_RULES } from '../shared'

export const VERSION = 'improv-reviewer/v1'

export interface ImprovReviewerInput {
  key: string
  chords: string[]
  bpm: number
  bars: number
  /** Measured locally. */
  stats: { notes: number; inScale: number; strongChordTones: number; rest: number; phrases: number; rangeSemitones: number; notesPerBar: number }
  /** Note names per bar, e.g. "1｜A4 C5 D5 · E5(长)". */
  notesByBar: string[]
}

export function buildSystemPrompt(): string {
  return `你是律动工坊（流行 / 摇滚乐理学习网站）的主音吉他老师。学生刚跟伴奏即兴了几小节，程序测出了他弹的音和一些统计。请点评。

只输出 JSON：
{"summary":"……","strengths":["……"],"suggestions":[{"bar":3,"text":"……"}],"nextStep":"……"}

- summary 两句话以内，先说做得好的，再说最值得改进的一点。
- strengths 1–3 条，suggestions 1–3 条；涉及某一小节时写 bar（从 1 开始）。
- 关注：乐句和留白、强拍是否落在和弦音、音域和高潮、动机的重复与变化、推弦揉弦的使用。
- nextStep 是一个下一次即兴可以马上尝试的具体方法。
- 检测可能漏音或多音，不要因为个别音下结论。

${NO_GHOSTWRITING}

${TONE_RULES}

${SECURITY_FOOTER}`
}

export function buildUserPrompt(input: ImprovReviewerInput): string {
  const s = input.stats
  return `调：${input.key}；和弦（每小节）：${input.chords.join(' | ')}；${input.bpm} BPM，共 ${input.bars} 小节。

统计（本地测量）：
- 检测到 ${s.notes} 个音，平均每小节 ${s.notesPerBar.toFixed(1)} 个
- 在音阶内的比例 ${Math.round(s.inScale * 100)}%
- 强拍落在和弦音的比例 ${Math.round(s.strongChordTones * 100)}%
- 留白占 ${Math.round(s.rest * 100)}%，分成 ${s.phrases} 句
- 音域 ${s.rangeSemitones} 个半音

每小节弹的音：
${input.notesByBar.join('\n')}`
}
