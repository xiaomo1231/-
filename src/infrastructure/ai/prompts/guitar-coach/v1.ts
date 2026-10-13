import { SECURITY_FOOTER, TONE_RULES } from '../shared'

export const VERSION = 'guitar-coach/v1'

export interface GuitarCoachInput {
  /** Exercises the student found hard, from local records. */
  weak: Array<{ title: string; kind: string; best: number; attempts: number; last?: string }>
  patterns: Array<{ id: string; name: string }>
  /** Chords the student can already play (roman numerals in G major / A minor). */
  romansMajor: string[]
  romansMinor: string[]
  count: number
}

export function buildSystemPrompt(): string {
  return `你是律动工坊（流行 / 摇滚乐理学习网站）的电吉他教练。根据学生在吉他工坊里的练习记录，设计几道针对性练习。

只输出 JSON：
{"exercises":[
  {"type":"strum","pattern":"pop","mode":"major","romans":["I","V","vi","IV"],"bpm":76,"reason":"……"},
  {"type":"lick","notes":[{"string":3,"fret":5,"beats":0.5},{"string":3,"fret":7,"beats":0.5,"tech":"vibrato"}],"bpm":72,"reason":"……"},
  {"type":"bend","string":3,"fret":7,"semitones":2,"reason":"……"}
]}

规则：
- strum：pattern 只能用给出的节奏型 id；romans 4 个，只能用给出的和弦；mode 为 major（G 大调）或 minor（A 小调）；bpm 60–140。
- lick：A 小调五声第一把位。string 0–5（0 = 最粗的六弦），fret 5–8，每个音必须是 A C D E G 之一；beats 只能是 0.5、1、1.5、2；4–10 个音，总拍数是整数且不超过 8；tech 可选 vibrato、hammer、pull，也可以不写。
- bend：在第一把位里推弦，推完的目标音也必须在 A 小调五声里；semitones 为 1 或 2。
- reason 一句话（不超过 40 字），说明针对哪个薄弱点。
- 不要写版权歌曲的片段。

${TONE_RULES}

${SECURITY_FOOTER}`
}

export function buildUserPrompt(input: GuitarCoachInput): string {
  const weak = input.weak.length
    ? input.weak.map((w) => `- ${w.title}（${w.kind}）：最好 ${Math.round(w.best * 100)} 分，练了 ${w.attempts} 次${w.last ? `，最近一次 ${w.last}` : ''}`).join('\n')
    : '- （记录还少，出综合练习）'
  return `请出 ${input.count} 道练习。

可用节奏型：${input.patterns.map((p) => `${p.id}（${p.name}）`).join('、')}
G 大调可用和弦：${input.romansMajor.join(' ')}
A 小调可用和弦：${input.romansMinor.join(' ')}

学生可能需要加强的练习：
${weak}`
}
