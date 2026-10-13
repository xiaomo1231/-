/**
 * 后期课堂 ear drills (pure): questions in four levels per kind. Each option
 * is a mix patch on the neutral base; the page renders a short excerpt per
 * option (loudness-matched unless loudness is the question) and plays the
 * reference first when there is one.
 */
import type { EarDrillKind, Material, MixPatch } from './types'

export interface DrillOption {
  label: string
  patch: MixPatch
}

export interface DrillQuestion {
  kind: EarDrillKind
  level: number
  /** What to listen for. */
  prompt: string
  material: Material
  /** Played first as "原声" (null = no reference: compare the options themselves). */
  reference: MixPatch | null
  /** The sound to identify (played after the reference). */
  target: MixPatch
  options: DrillOption[]
  answer: number
  /** Keep the level differences (loudness drills). */
  noLevelMatch?: boolean
  /** One sentence after answering. */
  explain: string
}

export const DRILL_INFO: Record<EarDrillKind, { title: string; summary: string }> = {
  eqFreq: { title: 'EQ 频率', summary: '听出哪个频段被提升了。' },
  eqBoostCut: { title: '提升还是衰减', summary: '同一个频段，是加了还是减了。' },
  lowCut: { title: '低切', summary: '低频被切到了哪里。' },
  compAmount: { title: '压缩多少', summary: '没压、轻压还是重压。' },
  reverbSize: { title: '混响长短', summary: '空间是小房间、中等还是大厅。' },
  delayTime: { title: '延迟时值', summary: '回声间隔是几分音符。' },
  pan: { title: '声像位置', summary: '声音在左边、中间还是右边。' },
  distortion: { title: '有没有失真', summary: '两段里哪一段加了饱和。' },
  loudness: { title: '响度差', summary: '哪一段更响（差别越来越小）。' },
  width: { title: '立体声宽度', summary: '窄、正常还是更宽。' },
}

export const DRILL_KINDS = Object.keys(DRILL_INFO) as EarDrillKind[]
export const MAX_LEVEL = 4

export function rng(seed: number) {
  let s = (seed >>> 0) || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const shuffle = <T,>(xs: T[], r: () => number): T[] => {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

const eqBand = (freq: number, gainDb: number, q: number): MixPatch => ({
  vocal: {
    eq: {
      on: true,
      bands: [
        { type: 'peaking', freq, gainDb, q },
        { type: 'peaking', freq: 300, gainDb: 0, q: 1 },
        { type: 'peaking', freq: 3000, gainDb: 0, q: 1 },
        { type: 'peaking', freq: 10000, gainDb: 0, q: 1 },
      ],
    },
  },
})

const hzLabel = (f: number) => (f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`)

/** Choose `n` of `xs` including the answer, keep them sorted, and return the answer's index. */
function pickOptions<T>(xs: T[], answer: T, n: number, r: () => number, key: (t: T) => number): { opts: T[]; index: number } {
  const others = shuffle(xs.filter((x) => x !== answer), r).slice(0, n - 1)
  const opts = [...others, answer].sort((a, b) => key(a) - key(b))
  return { opts, index: opts.indexOf(answer) }
}

/** A question of `kind` at `level` (1–4), deterministic for a seed. */
export function makeDrill(kind: EarDrillKind, level: number, seed: number): DrillQuestion {
  const r = rng(seed * 7919 + level * 131 + kind.length)
  const L = Math.max(1, Math.min(MAX_LEVEL, Math.round(level)))
  switch (kind) {
    case 'eqFreq': {
      const freqs = [125, 250, 500, 1000, 2000, 4000, 8000]
      const n = [3, 4, 5, 7][L - 1]!
      const gain = [12, 9, 6, 4][L - 1]!
      const answer = freqs[Math.floor(r() * freqs.length)]!
      const { opts, index } = pickOptions(freqs, answer, n, r, (x) => x)
      return {
        kind, level: L, material: 'band', prompt: `先听原声，再听提升了 ${gain} dB 的版本：提升的是哪个频率？`,
        reference: {}, target: eqBand(answer, gain, 1.4),
        options: opts.map((f) => ({ label: hzLabel(f), patch: eqBand(f, gain, 1.4) })), answer: index,
        explain: `答案是 ${hzLabel(answer)}。低频提升会更"厚"或"轰"，1–2 kHz 像"鼻音"，4 kHz 以上更"亮"或"刺"。`,
      }
    }
    case 'eqBoostCut': {
      const freqs = [250, 1000, 3000, 8000]
      const f = freqs[Math.floor(r() * freqs.length)]!
      const amt = [10, 7, 5, 3][L - 1]!
      const boost = r() < 0.5
      return {
        kind, level: L, material: 'band', prompt: `${hzLabel(f)} 附近被改动了 ${amt} dB：是提升还是衰减？`,
        reference: {}, target: eqBand(f, boost ? amt : -amt, 1.2),
        options: [{ label: '提升', patch: eqBand(f, amt, 1.2) }, { label: '衰减', patch: eqBand(f, -amt, 1.2) }], answer: boost ? 0 : 1,
        explain: boost ? '是提升：那个频段更突出了。' : '是衰减：那个频段像被挖走了一块。',
      }
    }
    case 'lowCut': {
      const cuts = [0, 80, 150, 300, 500]
      const n = [3, 3, 4, 5][L - 1]!
      const pool = L === 1 ? [0, 150, 500] : cuts
      const answer = pool[Math.floor(r() * pool.length)]!
      const { opts, index } = pickOptions(pool, answer, n, r, (x) => x)
      const patch = (c: number): MixPatch => (c ? { vocal: { lowCut: { on: true, freq: c } } } : {})
      return {
        kind, level: L, material: 'band', prompt: '这段的低频被切到了哪里？（先听原声对比）',
        reference: {}, target: patch(answer),
        options: opts.map((c) => ({ label: c ? `切到 ${c} Hz` : '没有低切', patch: patch(c) })), answer: index,
        explain: '低切越高，底鼓和贝斯越"瘦"；人声通常只切到 80–120 Hz。',
      }
    }
    case 'compAmount': {
      const levels: Array<[string, MixPatch]> = [
        ['不压缩', {}],
        ['轻压（约 2–3 dB）', { vocal: { comp: { on: true, thresholdDb: -16, ratio: 2, attackMs: 20, releaseMs: 150, makeupDb: 0 } } }],
        ['中等（约 5–6 dB）', { vocal: { comp: { on: true, thresholdDb: -24, ratio: 4, attackMs: 10, releaseMs: 120, makeupDb: 0 } } }],
        ['重压（10 dB 以上）', { vocal: { comp: { on: true, thresholdDb: -36, ratio: 10, attackMs: 2, releaseMs: 80, makeupDb: 0 } } }],
      ]
      const pool = L <= 2 ? [levels[0]!, levels[3]!, ...(L === 2 ? [levels[1]!] : [])] : levels
      const answer = pool[Math.floor(r() * pool.length)]!
      return {
        kind, level: L, material: L <= 2 ? 'drums' : 'voice', prompt: '这一段压缩了多少？（音量已经对齐，只听动态）',
        reference: null, target: answer[1],
        options: pool.map(([label, patch]) => ({ label, patch })), answer: pool.indexOf(answer),
        explain: '压得越重，强弱差越小、声音越"贴脸"，鼓的冲击会变钝，句尾和呼吸会被拉上来。',
      }
    }
    case 'reverbSize': {
      const opts: Array<[string, MixPatch]> = [
        ['小房间（约 0.5 秒）', { vocal: { reverb: { on: true, type: 'room', size: 0.2, decay: 0.5, preDelayMs: 10, mix: 0.3 } } }],
        ['中等（约 1.5 秒）', { vocal: { reverb: { on: true, type: 'plate', size: 0.45, decay: 1.5, preDelayMs: 20, mix: 0.3 } } }],
        ['大厅（约 3.5 秒）', { vocal: { reverb: { on: true, type: 'hall', size: 0.8, decay: 3.5, preDelayMs: 30, mix: 0.3 } } }],
      ]
      const pool = L === 1 ? [opts[0]!, opts[2]!] : opts
      const answer = pool[Math.floor(r() * pool.length)]!
      return {
        kind, level: L, material: 'voice', prompt: '这段人声的混响有多长？注意句尾"拖"多久。',
        reference: {}, target: answer[1],
        options: pool.map(([label, patch]) => ({ label, patch })), answer: pool.indexOf(answer),
        explain: '听句子结束后的尾巴：越长空间越大，但也越容易让人声变远、变糊。',
      }
    }
    case 'delayTime': {
      const opts: Array<[string, MixPatch]> = [
        ['四分音符', { vocal: { delay: { on: true, sync: true, division: '1/4', feedback: 0.35, mix: 0.35 } } }],
        ['八分音符', { vocal: { delay: { on: true, sync: true, division: '1/8', feedback: 0.35, mix: 0.35 } } }],
        ['附点八分', { vocal: { delay: { on: true, sync: true, division: '1/8.', feedback: 0.35, mix: 0.35 } } }],
        ['短回声（约 90 ms）', { vocal: { delay: { on: true, sync: false, timeMs: 90, feedback: 0.1, mix: 0.35 } } }],
      ]
      const pool = L === 1 ? [opts[0]!, opts[3]!] : L === 2 ? opts.slice(0, 2).concat(opts[3]!) : opts
      const answer = pool[Math.floor(r() * pool.length)]!
      return {
        kind, level: L, material: 'voice', prompt: '回声的间隔是多少？（歌曲速度 96 BPM）',
        reference: null, target: answer[1],
        options: pool.map(([label, patch]) => ({ label, patch })), answer: pool.indexOf(answer),
        explain: '四分音符正好一拍一次；附点八分会和拍子"错开"，产生律动感；短回声像贴在声音后面。',
      }
    }
    case 'pan': {
      const positions = L === 1 ? [-1, 0, 1] : L === 2 ? [-1, -0.5, 0, 0.5, 1] : [-1, -0.6, -0.3, 0, 0.3, 0.6, 1]
      const answer = positions[Math.floor(r() * positions.length)]!
      const label = (p: number) => (p === 0 ? '正中' : `${p < 0 ? '左' : '右'} ${Math.round(Math.abs(p) * 100)}%`)
      return {
        kind, level: L, material: 'voice', prompt: '请戴耳机：声音在哪个位置？',
        reference: null, target: { vocal: { pan: answer } },
        options: positions.map((p) => ({ label: label(p), patch: { vocal: { pan: p } } })), answer: positions.indexOf(answer),
        explain: '主唱、底鼓、贝斯一般放正中；吉他、键盘、和声常常左右分开，给中间留位置。',
      }
    }
    case 'distortion': {
      const drive = [0.8, 0.55, 0.35, 0.2][L - 1]!
      const type = (['hard', 'tube', 'tape', 'tape'] as const)[L - 1]!
      const first = r() < 0.5
      const sat: MixPatch = { vocal: { saturation: { on: true, type, drive, mix: 1 } } }
      return {
        kind, level: L, material: 'voice', prompt: '下面两段里，哪一段加了饱和 / 失真？',
        reference: null, target: first ? sat : {},
        options: [{ label: '第一段', patch: first ? sat : {} }, { label: '第二段', patch: first ? {} : sat }], answer: first ? 0 : 1,
        explain: '饱和会多出谐波：声音更"毛"、更有颗粒，响亮的地方被"压圆"；轻度时更像变暖、变密。',
      }
    }
    case 'loudness': {
      const diff = [3, 2, 1, 0.5][L - 1]!
      const first = r() < 0.5
      const loud: MixPatch = { master: { gainDb: diff / 2 } }
      const soft: MixPatch = { master: { gainDb: -diff / 2 } }
      return {
        kind, level: L, material: 'band', prompt: `两段只有音量不同（相差 ${diff} dB）：哪一段更响？`,
        reference: null, target: first ? loud : soft, noLevelMatch: true,
        options: [{ label: '第一段', patch: first ? loud : soft }, { label: '第二段', patch: first ? soft : loud }], answer: first ? 0 : 1,
        explain: '1 dB 左右的差别已经很难听出，但它足以让人觉得"更好听"——所以比较效果时一定要先把音量对齐。',
      }
    }
    case 'width': {
      const base: MixPatch['vocal'] = { mod: { on: true, type: 'doubler', rate: 0.5, depth: 0.5, mix: 0.6 } }
      const opts: Array<[string, MixPatch]> = [
        ['单声道（很窄）', { vocal: base, master: { width: { on: true, amount: 0 } } }],
        ['正常', { vocal: base, master: { width: { on: true, amount: 1 } } }],
        ['加宽', { vocal: base, master: { width: { on: true, amount: 1.8 } } }],
      ]
      const pool = L === 1 ? [opts[0]!, opts[2]!] : opts
      const answer = pool[Math.floor(r() * pool.length)]!
      return {
        kind, level: L, material: 'voice', prompt: '请戴耳机：这段的立体声有多宽？',
        reference: null, target: answer[1],
        options: pool.map(([label, patch]) => ({ label, patch })), answer: pool.indexOf(answer),
        explain: '宽度来自左右声道的差别；完全相同就是单声道（声音缩在正中）。加得太宽，用手机外放时反而会变薄。',
      }
    }
  }
}

/** Next level after a run of answers: up after 4 of the last 5 right, down after 3 of the last 5 wrong. */
export function nextLevel(level: number, recent: boolean[]): number {
  const last = recent.slice(-5)
  if (last.length >= 5 && last.filter(Boolean).length >= 4) return Math.min(MAX_LEVEL, level + 1)
  if (last.length >= 5 && last.filter((x) => !x).length >= 3) return Math.max(1, level - 1)
  return level
}
