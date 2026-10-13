/**
 * 跟唱 2.0 混音预设与纯计算（无 Web Audio 依赖，可在测试中直接运行）。
 *
 * 滤波器响应按 Web Audio BiquadFilterNode 规范（RBJ Audio EQ Cookbook）计算：
 * 峰值 / 搁架使用 Q（搁架按规范取 S = 1，Q 被忽略），低切为 Q = 1/√2 的二阶高通。
 * 这样画出的曲线与实际听到的效果一致。
 */
import type { EqBand, MixPresetId, MixSettings } from './singTypes'

type DelayDivision = MixSettings['vocal']['delay']['division']

const POP_SETTINGS: MixSettings = {
  vocal: {
    gainDb: 0,
    pan: 0,
    lowCut: { on: true, freq: 100 },
    eq: {
      on: true,
      bands: [
        { type: 'lowshelf', freq: 120, gainDb: -1, q: 0.7 },
        { type: 'peaking', freq: 300, gainDb: -2, q: 1.0 },
        { type: 'peaking', freq: 3000, gainDb: 2, q: 1.0 },
        { type: 'highshelf', freq: 10000, gainDb: 2.5, q: 0.7 },
      ],
    },
    comp: { on: true, thresholdDb: -18, ratio: 3, attackMs: 10, releaseMs: 120, makeupDb: 3 },
    deEss: { on: true, freq: 6500, amountDb: 4 },
    reverb: { on: true, size: 0.4, decay: 1.6, preDelayMs: 20, mix: 0.18 },
    delay: { on: false, timeMs: 250, sync: true, division: '1/8', feedback: 0.25, mix: 0.12 },
  },
  backing: { gainDb: -2, eq: { on: false, lowDb: 0, midDb: 0, highDb: 0 } },
  master: { limiter: true, gainDb: 0 },
}

/** 深拷贝混音设置（所有字段都是普通数据，JSON 往返即可）。 */
export function cloneMix(m: MixSettings): MixSettings {
  return JSON.parse(JSON.stringify(m)) as MixSettings
}

/** 默认混音 = 流行预设。 */
export const DEFAULT_MIX: MixSettings = cloneMix(POP_SETTINGS)

function derive(patch: (m: MixSettings) => void): MixSettings {
  const m = cloneMix(POP_SETTINGS)
  patch(m)
  return m
}

export const MIX_PRESETS: Record<MixPresetId, { label: string; description: string; settings: MixSettings }> = {
  pop: {
    label: '流行人声',
    description: '干净清楚、适度空间感，适合大多数流行歌曲的翻唱。',
    settings: cloneMix(POP_SETTINGS),
  },
  rock: {
    label: '摇滚',
    description: '压缩更有力，加强 2–4 kHz 的临场感，混响短而明亮，能穿透电吉他。',
    settings: derive((m) => {
      m.vocal.eq.bands[2] = { type: 'peaking', freq: 3000, gainDb: 4, q: 1.2 }
      m.vocal.comp = { on: true, thresholdDb: -16, ratio: 4, attackMs: 8, releaseMs: 100, makeupDb: 4 }
      m.vocal.reverb = { on: true, size: 0.25, decay: 1.1, preDelayMs: 15, mix: 0.12 }
      m.backing.gainDb = -1
    }),
  },
  warm: {
    label: '温暖抒情',
    description: '高频柔和、压缩温和，搭配较长的混响，适合慢歌与抒情的情感表达。',
    settings: derive((m) => {
      m.vocal.lowCut.freq = 90
      m.vocal.eq.bands[3] = { type: 'highshelf', freq: 10000, gainDb: 0.5, q: 0.7 }
      m.vocal.comp = { on: true, thresholdDb: -20, ratio: 2, attackMs: 15, releaseMs: 150, makeupDb: 2 }
      m.vocal.reverb = { on: true, size: 0.55, decay: 2.4, preDelayMs: 25, mix: 0.25 }
      m.backing.gainDb = -3
    }),
  },
  bright: {
    label: '明亮',
    description: '高频与 5 kHz 一带提亮，声音通透有光泽，适合轻快的流行与电子风格。',
    settings: derive((m) => {
      m.vocal.eq.bands = [
        { type: 'lowshelf', freq: 120, gainDb: -1, q: 0.7 },
        { type: 'peaking', freq: 300, gainDb: -2, q: 1.0 },
        { type: 'peaking', freq: 4500, gainDb: 2.5, q: 0.9 },
        { type: 'highshelf', freq: 10000, gainDb: 4, q: 0.7 },
      ]
      m.vocal.reverb.mix = 0.15
    }),
  },
  radio: {
    label: '电台感',
    description: '切除低频、突出中频，压缩很重，没有混响，听起来像收音机或老式电话。',
    settings: derive((m) => {
      m.vocal.lowCut = { on: true, freq: 300 }
      m.vocal.eq.bands = [
        { type: 'lowshelf', freq: 200, gainDb: -3, q: 0.7 },
        { type: 'peaking', freq: 1500, gainDb: 5, q: 1.2 },
        { type: 'peaking', freq: 3500, gainDb: 0, q: 1.0 },
        { type: 'highshelf', freq: 6000, gainDb: -6, q: 0.7 },
      ]
      m.vocal.comp = { on: true, thresholdDb: -22, ratio: 6, attackMs: 5, releaseMs: 80, makeupDb: 5 }
      m.vocal.reverb.on = false
      m.vocal.delay.on = false
    }),
  },
  raw: {
    label: '原样',
    description: '人声所有处理全部关闭，只保留限幅器防止爆音，用于听清原始录音。',
    settings: derive((m) => {
      m.vocal.lowCut.on = false
      m.vocal.eq.on = false
      m.vocal.comp.on = false
      m.vocal.deEss.on = false
      m.vocal.reverb.on = false
      m.vocal.delay.on = false
      m.backing.gainDb = 0
      m.backing.eq.on = false
    }),
  },
}

const clampTo = (v: number, lo: number, hi: number): number => {
  // 非有限数（NaN / Infinity）按 0 处理，再限制到范围内
  const x = Number.isFinite(v) ? v : 0
  return Math.min(hi, Math.max(lo, x))
}

/** 把所有数值限制到安全范围，返回新对象（不修改输入）。 */
export function clampMix(m: MixSettings): MixSettings {
  const v = m.vocal
  const c = clampTo
  return {
    vocal: {
      gainDb: c(v.gainDb, -24, 12),
      pan: c(v.pan, -1, 1),
      lowCut: { on: v.lowCut.on, freq: c(v.lowCut.freq, 20, 20000) },
      eq: {
        on: v.eq.on,
        bands: v.eq.bands.map((b) => ({
          type: b.type,
          freq: c(b.freq, 20, 20000),
          gainDb: c(b.gainDb, -15, 15),
          q: c(b.q, 0.1, 10),
        })),
      },
      comp: {
        on: v.comp.on,
        thresholdDb: c(v.comp.thresholdDb, -60, 0),
        ratio: c(v.comp.ratio, 1, 20),
        attackMs: c(v.comp.attackMs, 0.1, 200),
        releaseMs: c(v.comp.releaseMs, 10, 2000),
        makeupDb: c(v.comp.makeupDb, 0, 24),
      },
      deEss: { on: v.deEss.on, freq: c(v.deEss.freq, 3000, 12000), amountDb: c(v.deEss.amountDb, 0, 12) },
      reverb: {
        on: v.reverb.on,
        size: c(v.reverb.size, 0, 1),
        decay: c(v.reverb.decay, 0.2, 8),
        preDelayMs: c(v.reverb.preDelayMs, 0, 200),
        mix: c(v.reverb.mix, 0, 1),
      },
      delay: {
        on: v.delay.on,
        timeMs: c(v.delay.timeMs, 20, 2000),
        sync: v.delay.sync,
        division: v.delay.division,
        feedback: c(v.delay.feedback, 0, 0.9),
        mix: c(v.delay.mix, 0, 1),
      },
    },
    backing: {
      gainDb: c(m.backing.gainDb, -24, 12),
      eq: {
        on: m.backing.eq.on,
        lowDb: c(m.backing.eq.lowDb, -15, 15),
        midDb: c(m.backing.eq.midDb, -15, 15),
        highDb: c(m.backing.eq.highDb, -15, 15),
      },
    },
    master: { limiter: m.master.limiter, gainDb: c(m.master.gainDb, -24, 12) },
  }
}

/** 延迟时间（毫秒）：按 BPM 计算四分音符，再换算各种时值。 */
export function delayMs(bpm: number, division: DelayDivision): number {
  const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 120
  const quarter = 60000 / safeBpm
  switch (division) {
    case '1/4':
      return quarter
    case '1/8':
      return quarter / 2
    case '1/8.':
      return quarter * 0.75
    case '1/16':
      return quarter / 4
  }
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

export function gainToDb(g: number): number {
  return g > 0 ? 20 * Math.log10(g) : -Infinity
}

interface BiquadCoefficients {
  b: [number, number, number]
  a: [number, number, number]
}

/** 峰值 / 搁架的 Web Audio 系数（规范定义，搁架 S = 1）。 */
function bandCoefficients(band: EqBand, fs: number): BiquadCoefficients {
  const A = Math.pow(10, band.gainDb / 40)
  const w0 = (2 * Math.PI * band.freq) / fs
  const cosw = Math.cos(w0)
  const sinw = Math.sin(w0)

  if (band.type === 'peaking') {
    const alpha = sinw / (2 * band.q)
    return {
      b: [1 + alpha * A, -2 * cosw, 1 - alpha * A],
      a: [1 + alpha / A, -2 * cosw, 1 - alpha / A],
    }
  }

  // 搁架：alpha = sin(w0)/2 · sqrt((A + 1/A)(1/S - 1) + 2)，S = 1 时即 sin(w0)/√2
  const alpha = sinw / Math.SQRT2
  const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha

  if (band.type === 'lowshelf') {
    return {
      b: [
        A * (A + 1 - (A - 1) * cosw + twoSqrtAAlpha),
        2 * A * (A - 1 - (A + 1) * cosw),
        A * (A + 1 - (A - 1) * cosw - twoSqrtAAlpha),
      ],
      a: [A + 1 + (A - 1) * cosw + twoSqrtAAlpha, -2 * (A - 1 + (A + 1) * cosw), A + 1 + (A - 1) * cosw - twoSqrtAAlpha],
    }
  }

  return {
    b: [
      A * (A + 1 + (A - 1) * cosw + twoSqrtAAlpha),
      -2 * A * (A - 1 + (A + 1) * cosw),
      A * (A + 1 + (A - 1) * cosw - twoSqrtAAlpha),
    ],
    a: [A + 1 - (A - 1) * cosw + twoSqrtAAlpha, 2 * (A - 1 - (A + 1) * cosw), A + 1 - (A - 1) * cosw - twoSqrtAAlpha],
  }
}

/** 二阶高通（Q = 1/√2，即 Butterworth）的系数。 */
function highpassCoefficients(cutoff: number, fs: number): BiquadCoefficients {
  const w0 = (2 * Math.PI * cutoff) / fs
  const cosw = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2)
  return {
    b: [(1 + cosw) / 2, -(1 + cosw), (1 + cosw) / 2],
    a: [1 + alpha, -2 * cosw, 1 - alpha],
  }
}

/** 在频率 f 处计算数字滤波器的幅度响应（dB）。 */
function responseDb(c: BiquadCoefficients, f: number, fs: number): number {
  const w = (2 * Math.PI * f) / fs
  const c1 = Math.cos(w)
  const s1 = Math.sin(w)
  const c2 = Math.cos(2 * w)
  const s2 = Math.sin(2 * w)
  const [b0, b1, b2] = c.b
  const [a0, a1, a2] = c.a
  const nr = b0 + b1 * c1 + b2 * c2
  const ni = -(b1 * s1 + b2 * s2)
  const dr = a0 + a1 * c1 + a2 * c2
  const di = -(a1 * s1 + a2 * s2)
  return 20 * Math.log10(Math.hypot(nr, ni) / Math.hypot(dr, di))
}

/** 单个 EQ 频段在频率 freq 处的增益（dB）。 */
export function biquadMagnitudeDb(band: EqBand, freq: number, sampleRate = 44100): number {
  return responseDb(bandCoefficients(band, sampleRate), freq, sampleRate)
}

/** 低切（高通）在频率 freq 处的增益（dB）。 */
export function highpassMagnitudeDb(freq: number, cutoff: number, sampleRate = 44100): number {
  return responseDb(highpassCoefficients(cutoff, sampleRate), freq, sampleRate)
}

/** 人声链路的总频响（dB）：低切（若开启）+ 所有 EQ 频段（若开启）。 */
export function eqCurve(vocal: MixSettings['vocal'], freqs: number[], sampleRate = 44100): number[] {
  return freqs.map((f) => {
    let db = 0
    if (vocal.lowCut.on) db += highpassMagnitudeDb(f, vocal.lowCut.freq, sampleRate)
    if (vocal.eq.on) {
      for (const band of vocal.eq.bands) db += biquadMagnitudeDb(band, f, sampleRate)
    }
    return db
  })
}

/** 对数均匀分布的频率点（用于绘制频响曲线），首尾精确为 lo 与 hi。 */
export function logFreqs(n = 128, lo = 20, hi = 20000): number[] {
  if (n <= 1) return [lo]
  const ratio = Math.log(hi / lo)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    out.push(i === n - 1 ? hi : lo * Math.exp((ratio * i) / (n - 1)))
  }
  return out
}
