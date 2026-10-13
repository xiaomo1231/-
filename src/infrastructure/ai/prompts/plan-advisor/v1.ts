import { SECURITY_FOOTER, TONE_RULES } from '../shared'

export const VERSION = 'plan-advisor/v1'

export interface PlanAdvisorInput {
  stage: number
  nextStage: { title: string; requirements: Array<{ module: string; label: string; met: boolean }> } | null
  modules: Array<{ id: string; name: string; level: number; maxLevel: number; mastery: number; attempts7d: number; due: number }>
  confusions: Array<{ module: string; expected: string; given: string; count: number }>
  minutesPerDay: number
}

export function buildSystemPrompt(): string {
  return `你是律动工坊（流行 / 摇滚乐理学习网站）的训练教练。根据学生最近的练习记录，给出这一周每天的训练重点。

只输出 JSON：
{"focus":[{"module":"E2","minutes":8,"reason":"……"}],"tip":"……"}

- focus 2–4 项，module 只能用给出的模块 id；每项 3–20 分钟，加起来大约等于学生每天的练习时间。
- 优先：下一阶段还没达到的门槛、估计掌握度低的模块、到期复习多的模块、最近 7 天很少练的基础模块（音准和节奏不要长期不练）。
- reason 一句话说明为什么（不超过 40 字），引用数据，例如“音程听辨估计掌握度 52%，是进入阶段 3 的门槛”。
- tip 一条本周的练习方法建议，不超过 60 字。

${TONE_RULES}

${SECURITY_FOOTER}`
}

export function buildUserPrompt(input: PlanAdvisorInput): string {
  const mods = input.modules
    .map((m) => `- ${m.id} ${m.name}：第 ${m.level}/${m.maxLevel} 级，估计掌握度 ${Math.round(m.mastery * 100)}%，近 7 天 ${m.attempts7d} 题，到期复习 ${m.due} 项`)
    .join('\n')
  const next = input.nextStage
    ? `下一阶段「${input.nextStage.title}」的门槛：\n${input.nextStage.requirements.map((r) => `- ${r.label}：${r.met ? '已达到' : '未达到'}`).join('\n')}`
    : '已经解锁全部阶段。'
  const conf = input.confusions.length ? input.confusions.map((c) => `- ${c.module}：${c.expected} 常被听成 ${c.given}（${c.count} 次）`).join('\n') : '- （暂无）'
  return `学生目前在阶段 ${input.stage}，每天大约练 ${input.minutesPerDay} 分钟。

${next}

各模块情况：
${mods}

常见混淆：
${conf}`
}
