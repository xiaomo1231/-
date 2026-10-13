import { SECURITY_FOOTER, TONE_RULES } from '../shared'

export const VERSION = 'mix-reviewer/v1'

/** Desk panels the review may point to. */
export const MIX_MODULES = ['lowcut', 'eq', 'comp', 'deess', 'gate', 'dynEq', 'comp2', 'parallel', 'saturation', 'mod', 'reverb', 'delay', 'balance', 'duck', 'pocket', 'autoLevel', 'tune', 'master'] as const

export interface MixReviewerInput {
  /** Measured locally on the student's voice and the backing. */
  metrics: {
    voiceDb: number
    backingDb: number
    bandShares: Record<string, number>
    dynamicRangeDb: number
    noiseFloorDb: number
    clipped: number
    masking: number
  }
  /** Which modules are on, with their main values, one line each. */
  settings: string[]
  /** Local rule-based suggestions already shown to the student (titles). */
  shownSuggestions: string[]
}

export function buildSystemPrompt(): string {
  return `你是律动工坊（流行 / 摇滚乐理学习网站）的混音老师。学生用网站的后期工作台给自己的翻唱人声做后期，程序在本地测出了人声和伴奏的一些数据，并列出了当前打开的效果。请点评这个混音设置。

只输出 JSON：
{"summary":"……","strengths":["……"],"suggestions":[{"module":"comp","text":"……"}],"nextStep":"……"}

- summary 两句话以内：先说现在的设置做对了什么，再说最值得改进的一点。
- strengths 1–3 条；suggestions 1–4 条，module 只能是：${MIX_MODULES.join(', ')}。
- 建议要具体到参数范围（例如"把压缩比从 6:1 降到 3:1 左右"），并说明为什么、听的时候注意什么。
- 已经显示给学生的本地建议不要重复，除非你有不同看法。
- 数据是自动测出来的估计值，可能不准；只根据给出的数据说话，不要假装听过这段录音。
- 不评价嗓音和唱功，只谈后期处理。

${TONE_RULES}

${SECURITY_FOOTER}`
}

export function buildUserPrompt(input: MixReviewerInput): string {
  const m = input.metrics
  const bands = Object.entries(m.bandShares)
    .map(([k, v]) => `${k} ${Math.round(v * 100)}%`)
    .join('，')
  return `本地测量：
- 人声电平约 ${m.voiceDb.toFixed(1)} dB，伴奏约 ${Number.isFinite(m.backingDb) ? m.backingDb.toFixed(1) : '无'} dB
- 人声能量分布：${bands}
- 动态范围约 ${m.dynamicRangeDb.toFixed(1)} dB；句间底噪约 ${m.noiseFloorDb.toFixed(1)} dBFS；削波比例 ${(m.clipped * 100).toFixed(3)}%
- 伴奏与人声在 1–5 kHz 的重叠程度 ${Math.round(m.masking * 100)}%

当前设置：
${input.settings.join('\n')}

已经显示的本地建议：${input.shownSuggestions.length ? input.shownSuggestions.join('；') : '（无）'}`
}
