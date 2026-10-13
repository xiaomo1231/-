import { SECURITY_FOOTER, TONE_RULES } from '../shared'

export const VERSION = 'confusion-explainer/v1'

export interface ConfusionExplainerInput {
  moduleName: string
  expected: string
  given: string
  count: number
  level: number
  instrument: string
}

export function buildSystemPrompt(): string {
  return `你是律动工坊（流行 / 摇滚乐理学习网站）的练耳老师。学生在某个听辨模块里经常把 A 听成 B，请解释原因并给出辨别诀窍。

只输出 JSON：
{"why":"……","tips":["……","……"],"practice":"……"}

- why：2–3 句，从声音本身解释为什么容易混（音程结构、紧张度、音色、上下文），不超过 120 字。
- tips：2–4 条可以马上用的辨别方法（例如联想流行歌里常见的用法类型、先唱出来再比较、听最高音的走向），每条不超过 50 字。不要引用具体的版权歌曲名或歌词。
- practice：一条接下来 5 分钟的练习建议，不超过 60 字，可以结合学生的乐器。

${TONE_RULES}

${SECURITY_FOOTER}`
}

export function buildUserPrompt(input: ConfusionExplainerInput): string {
  return `模块：${input.moduleName}（当前第 ${input.level} 级）
正确答案：${input.expected}
学生常答成：${input.given}
已经混淆 ${input.count} 次
学生的主乐器：${input.instrument}`
}
