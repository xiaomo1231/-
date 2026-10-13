/**
 * 跟唱 2.0 混音预设与纯计算（无 Web Audio 依赖，可在测试中直接运行）。
 *
 * 滤波器响应按 Web Audio BiquadFilterNode 规范（RBJ Audio EQ Cookbook）计算：
 * 峰值 / 搁架使用 Q（搁架按规范取 S = 1，Q 被忽略），低切为 Q = 1/√2 的二阶高通。
 * 这样画出的曲线与实际听到的效果一致。
 */
import { DEFAULT_ORDER, type CompSettings, type EqBand, type InsertId, type MixPresetId, type MixSettings, type MultibandBand } from './singTypes'

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
    deEss: { on: true, freq: 6500, amountDb: 4, thresholdDb: -30 },
    reverb: { on: true, type: 'plate', size: 0.4, decay: 1.6, preDelayMs: 20, mix: 0.18, lowCut: 200, highCut: 8000 },
    delay: { on: false, timeMs: 250, sync: true, division: '1/8', feedback: 0.25, mix: 0.12, pingPong: false, highCut: 6000 },
    gate: { on: false, thresholdDb: -50, rangeDb: 15, releaseMs: 120 },
    dynEq: { on: false, freq: 300, q: 1.4, thresholdDb: -24, ratio: 3, maxCutDb: 6 },
    comp2: { on: false, thresholdDb: -10, ratio: 2, attackMs: 3, releaseMs: 80, makeupDb: 0 },
    parallel: { on: false, thresholdDb: -35, ratio: 10, blend: 0.3 },
    saturation: { on: false, type: 'tape', drive: 0.3, mix: 0.5 },
    mod: { on: false, type: 'doubler', rate: 0.6, depth: 0.4, mix: 0.35 },
    order: [...DEFAULT_ORDER],
    autoLevel: { on: false, strength: 0.6, phraseDb: {} },
    tune: { on: false, amount: 0.5, speedMs: 60, scale: 'chromatic', keyTonic: 0, mode: 'major', range: 2, gaps: 'keep' },
  },
  backing: {
    gainDb: -2,
    eq: { on: false, lowDb: 0, midDb: 0, highDb: 0 },
    duck: { on: false, amountDb: 2, releaseMs: 250 },
    pocket: { on: false, freq: 3000, amountDb: 2 },
    stems: {},
  },
  master: {
    limiter: true,
    gainDb: 0,
    ceilingDb: -1,
    multiband: {
      on: false,
      lowHz: 200,
      highHz: 3000,
      bands: [
        { thresholdDb: -20, ratio: 2, gainDb: 0 },
        { thresholdDb: -20, ratio: 2, gainDb: 0 },
        { thresholdDb: -20, ratio: 2, gainDb: 0 },
      ],
    },
    width: { on: false, amount: 1 },
    targetLufs: null,
  },
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
      m.vocal.reverb = { ...m.vocal.reverb, type: 'room', size: 0.25, decay: 1.1, preDelayMs: 15, mix: 0.12 }
      m.vocal.saturation = { on: true, type: 'tube', drive: 0.35, mix: 0.4 }
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
      m.vocal.reverb = { ...m.vocal.reverb, type: 'hall', size: 0.55, decay: 2.4, preDelayMs: 25, mix: 0.25 }
      m.vocal.saturation = { on: true, type: 'tape', drive: 0.2, mix: 0.4 }
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
      m.vocal.saturation = { on: true, type: 'hard', drive: 0.4, mix: 0.5 }
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
  ballad: {
    label: '抒情慢歌',
    description: '人声靠前、气息清楚：压缩温和平稳，大厅混响加较长预延迟，伴奏在人声出现时让一点。',
    settings: derive((m) => {
      m.vocal.comp = { on: true, thresholdDb: -22, ratio: 2.5, attackMs: 20, releaseMs: 180, makeupDb: 3 }
      m.vocal.reverb = { ...m.vocal.reverb, type: 'hall', size: 0.7, decay: 2.8, preDelayMs: 40, mix: 0.24 }
      m.vocal.delay = { ...m.vocal.delay, on: true, division: '1/4', feedback: 0.2, mix: 0.08 }
      m.vocal.autoLevel = { on: true, strength: 0.6, phraseDb: {} }
      m.backing.duck = { on: true, amountDb: 2, releaseMs: 300 }
      m.backing.gainDb = -3
    }),
  },
  folk: {
    label: '民谣',
    description: '自然少修饰：轻压缩、房间混响、保留一点空气感，像坐在你面前唱。',
    settings: derive((m) => {
      m.vocal.eq.bands = [
        { type: 'lowshelf', freq: 120, gainDb: -1, q: 0.7 },
        { type: 'peaking', freq: 250, gainDb: -1.5, q: 1.0 },
        { type: 'peaking', freq: 2500, gainDb: 1, q: 1.0 },
        { type: 'highshelf', freq: 12000, gainDb: 2, q: 0.7 },
      ]
      m.vocal.comp = { on: true, thresholdDb: -20, ratio: 2, attackMs: 15, releaseMs: 150, makeupDb: 2 }
      m.vocal.reverb = { ...m.vocal.reverb, type: 'room', size: 0.3, decay: 1.2, preDelayMs: 10, mix: 0.14 }
      m.backing.gainDb = -2
    }),
  },
  rap: {
    label: '说唱',
    description: '字字清楚、贴耳：重压缩加并行压缩、去掉混响只留很短的延迟，伴奏为人声让出中频。',
    settings: derive((m) => {
      m.vocal.lowCut = { on: true, freq: 120 }
      m.vocal.eq.bands[2] = { type: 'peaking', freq: 3500, gainDb: 3, q: 1.0 }
      m.vocal.comp = { on: true, thresholdDb: -20, ratio: 5, attackMs: 3, releaseMs: 60, makeupDb: 5 }
      m.vocal.parallel = { on: true, thresholdDb: -38, ratio: 12, blend: 0.35 }
      m.vocal.reverb.on = false
      m.vocal.delay = { ...m.vocal.delay, on: true, sync: false, timeMs: 90, feedback: 0.05, mix: 0.08 }
      m.vocal.gate = { on: true, thresholdDb: -48, rangeDb: 12, releaseMs: 100 }
      m.backing.pocket = { on: true, freq: 2500, amountDb: 3 }
    }),
  },
  rnb: {
    label: 'R&B',
    description: '顺滑有光泽：两级压缩、柔和饱和、加倍让声音更宽，乒乓延迟营造空间。',
    settings: derive((m) => {
      m.vocal.comp = { on: true, thresholdDb: -20, ratio: 3, attackMs: 10, releaseMs: 120, makeupDb: 3 }
      m.vocal.comp2 = { on: true, thresholdDb: -10, ratio: 2, attackMs: 2, releaseMs: 60, makeupDb: 1 }
      m.vocal.saturation = { on: true, type: 'tube', drive: 0.25, mix: 0.35 }
      m.vocal.mod = { on: true, type: 'doubler', rate: 0.5, depth: 0.35, mix: 0.3 }
      m.vocal.delay = { ...m.vocal.delay, on: true, division: '1/8.', feedback: 0.3, mix: 0.12, pingPong: true }
      m.vocal.reverb = { ...m.vocal.reverb, type: 'plate', decay: 1.9, mix: 0.2 }
    }),
  },
  lofi: {
    label: 'Lo-fi',
    description: '旧旧的、毛茸茸：切掉高低频、磁带饱和、轻微摇晃的合唱，混响偏暗。',
    settings: derive((m) => {
      m.vocal.lowCut = { on: true, freq: 180 }
      m.vocal.eq.bands = [
        { type: 'lowshelf', freq: 150, gainDb: -2, q: 0.7 },
        { type: 'peaking', freq: 1200, gainDb: 2, q: 0.8 },
        { type: 'peaking', freq: 3500, gainDb: -1, q: 1.0 },
        { type: 'highshelf', freq: 6000, gainDb: -8, q: 0.7 },
      ]
      m.vocal.saturation = { on: true, type: 'tape', drive: 0.6, mix: 0.7 }
      m.vocal.mod = { on: true, type: 'chorus', rate: 0.4, depth: 0.25, mix: 0.25 }
      m.vocal.reverb = { ...m.vocal.reverb, type: 'room', mix: 0.2, highCut: 4000 }
    }),
  },
  ktv: {
    label: 'KTV',
    description: '熟悉的 K 歌味：明显的回声加大混响，人声音量偏大，唱起来更有自信。',
    settings: derive((m) => {
      m.vocal.gainDb = 2
      m.vocal.reverb = { ...m.vocal.reverb, type: 'hall', size: 0.75, decay: 2.6, preDelayMs: 15, mix: 0.3 }
      m.vocal.delay = { ...m.vocal.delay, on: true, division: '1/4', feedback: 0.35, mix: 0.18 }
      m.backing.gainDb = -3
    }),
  },
}

const clampTo = (v: number, lo: number, hi: number): number => {
  // 非有限数（NaN / Infinity）按 0 处理，再限制到范围内
  const x = Number.isFinite(v) ? v : 0
  return Math.min(hi, Math.max(lo, x))
}

const DEF = POP_SETTINGS
const INSERTS = new Set<InsertId>(DEFAULT_ORDER)
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
const pick = <T extends string>(v: unknown, options: readonly T[], d: T): T => (options.includes(v as T) ? (v as T) : d)

function clampComp(x: Partial<CompSettings> | undefined, d: CompSettings): CompSettings {
  const c = clampTo
  const v = { ...d, ...x }
  return {
    on: bool(v.on, d.on),
    thresholdDb: c(v.thresholdDb, -60, 0),
    ratio: c(v.ratio, 1, 20),
    attackMs: c(v.attackMs, 0.1, 200),
    releaseMs: c(v.releaseMs, 10, 2000),
    makeupDb: c(v.makeupDb, 0, 24),
  }
}

/** The order with every insert exactly once (unknown ids dropped, missing ones added in their default place). */
export function fixOrder(order: unknown): InsertId[] {
  const given = Array.isArray(order) ? (order.filter((x) => INSERTS.has(x as InsertId)) as InsertId[]) : []
  const seen = new Set<InsertId>()
  const out: InsertId[] = []
  for (const id of given) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  for (const id of DEFAULT_ORDER) if (!seen.has(id)) out.splice(Math.min(out.length, DEFAULT_ORDER.indexOf(id)), 0, id)
  return out
}

/**
 * 把所有数值限制到安全范围，返回新对象（不修改输入）。较早保存的混音缺少
 * 0.21.0 新增的字段，这里用中性（关闭）的默认值补齐。
 */
export function clampMix(input: MixSettings): MixSettings {
  // Older saves may lack any of the newer fields.
  const m = input as unknown as { vocal: Partial<MixSettings['vocal']>; backing: Partial<MixSettings['backing']>; master: Partial<MixSettings['master']> }
  const v = { ...DEF.vocal, ...m.vocal }
  const c = clampTo
  const gate = { ...DEF.vocal.gate, ...v.gate }
  const dynEq = { ...DEF.vocal.dynEq, ...v.dynEq }
  const par = { ...DEF.vocal.parallel, ...v.parallel }
  const sat = { ...DEF.vocal.saturation, ...v.saturation }
  const mod = { ...DEF.vocal.mod, ...v.mod }
  const rev = { ...DEF.vocal.reverb, ...v.reverb }
  const del = { ...DEF.vocal.delay, ...v.delay }
  const de = { ...DEF.vocal.deEss, ...v.deEss }
  const al = { ...DEF.vocal.autoLevel, ...v.autoLevel }
  const tune = { ...DEF.vocal.tune, ...v.tune }
  const b = { ...DEF.backing, ...m.backing }
  const ms = { ...DEF.master, ...m.master }
  const mb = { ...DEF.master.multiband, ...ms.multiband }
  const band = (x: Partial<MultibandBand> | undefined): MultibandBand => {
    const y = { ...DEF.master.multiband.bands[0], ...x }
    return { thresholdDb: c(y.thresholdDb, -60, 0), ratio: c(y.ratio, 1, 20), gainDb: c(y.gainDb, -12, 12) }
  }
  const phraseDb: Record<number, number> = {}
  for (const [k, x] of Object.entries(al.phraseDb ?? {})) if (Number.isFinite(Number(k))) phraseDb[Number(k)] = c(x, -12, 12)
  const stems: Record<string, { gainDb: number; mute: boolean }> = {}
  for (const [k, x] of Object.entries(b.stems ?? {})) stems[k] = { gainDb: c(x?.gainDb ?? 0, -24, 12), mute: bool(x?.mute, false) }
  return {
    vocal: {
      gainDb: c(v.gainDb, -24, 12),
      pan: c(v.pan, -1, 1),
      lowCut: { on: bool(v.lowCut.on, false), freq: c(v.lowCut.freq, 20, 20000) },
      eq: {
        on: bool(v.eq.on, false),
        bands: v.eq.bands.map((x) => ({
          type: x.type,
          freq: c(x.freq, 20, 20000),
          gainDb: c(x.gainDb, -15, 15),
          q: c(x.q, 0.1, 10),
        })),
      },
      comp: clampComp(v.comp, DEF.vocal.comp),
      deEss: { on: bool(de.on, false), freq: c(de.freq, 3000, 12000), amountDb: c(de.amountDb, 0, 12), thresholdDb: c(de.thresholdDb, -60, 0) },
      reverb: {
        on: bool(rev.on, false),
        type: pick(rev.type, ['room', 'plate', 'hall'] as const, 'plate'),
        size: c(rev.size, 0, 1),
        decay: c(rev.decay, 0.2, 8),
        preDelayMs: c(rev.preDelayMs, 0, 200),
        mix: c(rev.mix, 0, 1),
        lowCut: c(rev.lowCut, 20, 1000),
        highCut: c(rev.highCut, 1000, 20000),
      },
      delay: {
        on: bool(del.on, false),
        timeMs: c(del.timeMs, 20, 2000),
        sync: bool(del.sync, true),
        division: pick(del.division, ['1/4', '1/8', '1/8.', '1/16'] as const, '1/8'),
        feedback: c(del.feedback, 0, 0.9),
        mix: c(del.mix, 0, 1),
        pingPong: bool(del.pingPong, false),
        highCut: c(del.highCut, 1000, 20000),
      },
      gate: { on: bool(gate.on, false), thresholdDb: c(gate.thresholdDb, -80, 0), rangeDb: c(gate.rangeDb, 0, 60), releaseMs: c(gate.releaseMs, 10, 1000) },
      dynEq: { on: bool(dynEq.on, false), freq: c(dynEq.freq, 40, 16000), q: c(dynEq.q, 0.3, 8), thresholdDb: c(dynEq.thresholdDb, -60, 0), ratio: c(dynEq.ratio, 1, 20), maxCutDb: c(dynEq.maxCutDb, 0, 18) },
      comp2: clampComp(v.comp2, DEF.vocal.comp2),
      parallel: { on: bool(par.on, false), thresholdDb: c(par.thresholdDb, -60, 0), ratio: c(par.ratio, 1, 20), blend: c(par.blend, 0, 1) },
      saturation: { on: bool(sat.on, false), type: pick(sat.type, ['tape', 'tube', 'hard'] as const, 'tape'), drive: c(sat.drive, 0, 1), mix: c(sat.mix, 0, 1) },
      mod: { on: bool(mod.on, false), type: pick(mod.type, ['chorus', 'flanger', 'phaser', 'doubler'] as const, 'doubler'), rate: c(mod.rate, 0.05, 8), depth: c(mod.depth, 0, 1), mix: c(mod.mix, 0, 1) },
      order: fixOrder(v.order),
      autoLevel: { on: bool(al.on, false), strength: c(al.strength, 0, 1), phraseDb },
      tune: {
        on: bool(tune.on, false),
        amount: c(tune.amount, 0, 1),
        speedMs: c(tune.speedMs, 0, 400),
        scale: pick(tune.scale, ['chromatic', 'key', 'reference'] as const, 'chromatic'),
        keyTonic: Math.round(c(tune.keyTonic, 0, 11)),
        mode: pick(tune.mode, ['major', 'minor'] as const, 'major'),
        range: c(tune.range, 0.5, 6),
        gaps: pick(tune.gaps, ['keep', 'nearest'] as const, 'keep'),
      },
    },
    backing: {
      gainDb: c(b.gainDb, -24, 12),
      eq: {
        on: bool(b.eq.on, false),
        lowDb: c(b.eq.lowDb, -15, 15),
        midDb: c(b.eq.midDb, -15, 15),
        highDb: c(b.eq.highDb, -15, 15),
      },
      duck: { on: bool(b.duck?.on, false), amountDb: c(b.duck?.amountDb ?? 2, 0, 12), releaseMs: c(b.duck?.releaseMs ?? 250, 20, 2000) },
      pocket: { on: bool(b.pocket?.on, false), freq: c(b.pocket?.freq ?? 3000, 500, 8000), amountDb: c(b.pocket?.amountDb ?? 2, 0, 9) },
      stems,
    },
    master: {
      limiter: bool(ms.limiter, true),
      gainDb: c(ms.gainDb, -24, 12),
      ceilingDb: c(ms.ceilingDb, -6, 0),
      multiband: {
        on: bool(mb.on, false),
        lowHz: c(mb.lowHz, 40, 1000),
        highHz: c(Math.max(mb.highHz, mb.lowHz * 2), 1000, 12000),
        bands: [band(mb.bands?.[0]), band(mb.bands?.[1]), band(mb.bands?.[2])],
      },
      width: { on: bool(ms.width?.on, false), amount: c(ms.width?.amount ?? 1, 0, 2) },
      targetLufs: ms.targetLufs === null || ms.targetLufs === undefined ? null : c(ms.targetLufs, -30, -6),
    },
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
