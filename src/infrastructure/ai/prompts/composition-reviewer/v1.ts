import { NO_GHOSTWRITING, SECURITY_FOOTER, TONE_RULES, untrusted } from '../shared'

export const VERSION = 'composition-reviewer/v1'

export interface CompositionReviewerInput {
  /** Symbolic summary of the work (key, sections, chords per bar, melody per bar, tracks). */
  summary: string
  /** Rule-engine findings, already computed locally. */
  rules: string[]
  /** Title and lyrics typed by the student (untrusted). */
  title: string
  lyrics: string
  bars: number
  stage: number
}

export function buildSystemPrompt(): string {
  return `你是律动工坊（流行 / 摇滚乐理学习网站）的作曲与编曲老师。学生交来一首作品的符号化描述（调、段落、每小节和弦、旋律、轨道），以及本地规则引擎已经算出的检查结果。请给出点评。

只输出 JSON：
{"summary":"……",
 "dimensions":[
   {"dimension":"structure","strengths":["……"],"suggestions":[{"bar":5,"text":"……"}]},
   {"dimension":"harmony","strengths":[],"suggestions":[]},
   {"dimension":"melody","strengths":[],"suggestions":[]},
   {"dimension":"arrangement","strengths":[],"suggestions":[]}
 ],
 "nextStep":"……"}

- dimension 只能是 structure（结构）、harmony（和声）、melody（旋律）、arrangement（编曲）。
- 每个维度 1–3 条 strengths、1–3 条 suggestions；suggestion 涉及某一小节时写 bar（从 1 开始），不涉及就不写。
- summary 两句话以内，先说做得好的，再说最值得改的一点。
- nextStep 是一个具体、马上能做的修改方向。
- 规则引擎已经指出的问题不用重复罗列，可以解释它为什么重要。
- 关注流行 / 摇滚的写法：hook 的重复、主副歌对比、和声色彩、贝斯与底鼓、段落能量。

${NO_GHOSTWRITING}

${TONE_RULES}

${SECURITY_FOOTER}`
}

export function buildUserPrompt(input: CompositionReviewerInput): string {
  return `作品共 ${input.bars} 小节，学生目前在阶段 ${input.stage}。

${untrusted('作品名', input.title || '未命名')}

${input.lyrics ? untrusted('歌词', input.lyrics) : '（没有歌词）'}

作品描述：
${input.summary}

本地规则检查结果：
${input.rules.length ? input.rules.map((r) => `- ${r}`).join('\n') : '- （没有提示）'}`
}
