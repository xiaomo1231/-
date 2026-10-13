import { SECURITY_FOOTER, TONE_RULES } from '../shared'

export const VERSION = 'drill-generator/v1'

export interface DrillGeneratorInput {
  progression: { level: number; chords: number; allowed: { major: readonly string[]; minor: readonly string[] } }
  melody: { level: number; notes: number; maxLeapSemitones: number; chromatic: boolean }
  weakSkills: Array<{ skillId: string; label: string; mastery: number }>
  confusions: Array<{ module: string; expected: string; given: string; count: number }>
  count: { progression: number; melody: number }
}

export function buildSystemPrompt(): string {
  return `你是律动工坊（流行 / 摇滚乐理学习网站）的练耳出题助手。你根据学生的薄弱技能和常见混淆，设计针对性的听辨练习。

你只输出 JSON，格式：
{"exercises":[
  {"module":"E6","mode":"major","romans":["I","V","vi","IV"],"targets":["roman:major:vi"],"reason":"……"},
  {"module":"E8","notes":[0,2,4,2,0],"targets":["melody:step"],"reason":"……"}
]}

规则：
- E6 是和声进行听辨：romans 只能用题目给出的允许和弦，长度必须等于要求的和弦数，第一个和弦一般是主和弦。写出流行 / 摇滚里真实常见、好听的进行，把薄弱和弦放在后面的位置（第一个和弦会直接告诉学生）。
- E8 是旋律听写：notes 是相对主音的半音数（0 = 主音，2 = 第 2 级，4 = 第 3 级，5、7、9、11、12 依次类推，-1 = 下方导音）。第一个音必须是 0，最后一个音必须是 0 或 12，音数必须等于要求。除非允许变化音，只用大调音阶音（-1, 0, 2, 4, 5, 7, 9, 11, 12, 14）。相邻两音的距离不能超过给定的最大半音数（只有最后一个音回到主音时可以跳到纯四度以内）。写成像流行歌一样有方向感、能唱的短旋律。
- targets 写这道题针对的技能 id（从给出的薄弱技能里选）。
- reason 用一句话（不超过 40 个字）告诉学生这道题在练什么。
- 不要出版权歌曲的片段。

${TONE_RULES}

${SECURITY_FOOTER}`
}

export function buildUserPrompt(input: DrillGeneratorInput): string {
  const weak = input.weakSkills.length ? input.weakSkills.map((w) => `- ${w.skillId}（${w.label}，估计掌握度 ${Math.round(w.mastery * 100)}%）`).join('\n') : '- （暂无明显薄弱技能，出综合练习）'
  const conf = input.confusions.length ? input.confusions.map((c) => `- ${c.module}：${c.expected} 常被听成 ${c.given}（${c.count} 次）`).join('\n') : '- （暂无）'
  return `请出 ${input.count.progression} 道 E6 和 ${input.count.melody} 道 E8。

E6 要求：每道 ${input.progression.chords} 个和弦。
允许的大调和弦：${input.progression.allowed.major.join(' ')}
允许的小调和弦：${input.progression.allowed.minor.join(' ') || '（这一级不出小调）'}

E8 要求：每道 ${input.melody.notes} 个音，相邻音最大 ${input.melody.maxLeapSemitones} 个半音，${input.melody.chromatic ? '可以有 1 个变化音（作为下一个音的下方半音辅助）' : '不要变化音'}。

学生可能需要加强的技能：
${weak}

常见混淆：
${conf}`
}
