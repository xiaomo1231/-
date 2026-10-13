/**
 * Every adjustable setting a lesson (or the desk) can show: path into
 * MixSettings → label, range, unit. Lessons list paths; the page renders
 * NumField / switch / select from this registry.
 */
import type { MixSettings } from '@/songs/singTypes'

export interface NumberControl {
  kind: 'number'
  label: string
  min: number
  max: number
  step: number
  unit: string
  log?: boolean
  percent?: boolean
  digits?: number
}
export interface SwitchControl {
  kind: 'switch'
  label: string
}
export interface SelectControl {
  kind: 'select'
  label: string
  options: Array<{ value: string; label: string }>
}
export type ControlSpec = NumberControl | SwitchControl | SelectControl

const num = (label: string, min: number, max: number, step: number, unit: string, extra: Partial<NumberControl> = {}): NumberControl => ({ kind: 'number', label, min, max, step, unit, ...extra })
const sw = (label: string): SwitchControl => ({ kind: 'switch', label })
const db = (label: string, min = -24, max = 12) => num(label, min, max, 0.5, 'dB')
const pct = (label: string) => num(label, 0, 1, 0.01, '%', { percent: true, digits: 0 })
const hz = (label: string, min: number, max: number) => num(label, min, max, 1, 'Hz', { log: true, digits: 0 })
const ms = (label: string, min: number, max: number) => num(label, min, max, 0.1, 'ms', { log: true, digits: 1 })

const bandControls: Record<string, ControlSpec> = {}
;['低频段', '低中频段', '中高频段', '高频段'].forEach((name, i) => {
  bandControls[`vocal.eq.bands.${i}.freq`] = hz(`${name}频率`, 20, 20000)
  bandControls[`vocal.eq.bands.${i}.gainDb`] = db(`${name}增益`, -15, 15)
  bandControls[`vocal.eq.bands.${i}.q`] = num(`${name} Q 值`, 0.1, 10, 0.05, '', { log: true, digits: 2 })
})

const compControls = (base: string, name: string): Record<string, ControlSpec> => ({
  [`${base}.on`]: sw(`${name}开关`),
  [`${base}.thresholdDb`]: db(`${name}阈值`, -60, 0),
  [`${base}.ratio`]: num(`${name}比率`, 1, 20, 0.5, ':1', { digits: 1 }),
  [`${base}.attackMs`]: ms(`${name}启动时间`, 0.1, 200),
  [`${base}.releaseMs`]: num(`${name}释放时间`, 10, 2000, 1, 'ms', { log: true, digits: 0 }),
  [`${base}.makeupDb`]: db(`${name}补偿增益`, 0, 24),
})

export const CONTROLS: Record<string, ControlSpec> = {
  'vocal.gainDb': db('人声音量'),
  'vocal.pan': num('人声声像（负左正右）', -1, 1, 0.01, '%', { percent: true, digits: 0 }),
  'vocal.lowCut.on': sw('低切开关'),
  'vocal.lowCut.freq': hz('低切频率', 20, 1000),
  'vocal.eq.on': sw('EQ 开关'),
  ...bandControls,
  ...compControls('vocal.comp', '压缩'),
  ...compControls('vocal.comp2', '第二级压缩'),
  'vocal.deEss.on': sw('去齿音开关'),
  'vocal.deEss.freq': hz('齿音频率', 3000, 12000),
  'vocal.deEss.thresholdDb': db('去齿音阈值', -60, 0),
  'vocal.deEss.amountDb': db('最多压低', 0, 12),
  'vocal.gate.on': sw('噪声门开关'),
  'vocal.gate.thresholdDb': db('噪声门阈值', -80, 0),
  'vocal.gate.rangeDb': db('压低多少', 0, 60),
  'vocal.gate.releaseMs': num('噪声门释放', 10, 1000, 1, 'ms', { log: true, digits: 0 }),
  'vocal.dynEq.on': sw('动态 EQ 开关'),
  'vocal.dynEq.freq': hz('动态 EQ 频率', 40, 16000),
  'vocal.dynEq.q': num('动态 EQ Q 值', 0.3, 8, 0.05, '', { log: true, digits: 2 }),
  'vocal.dynEq.thresholdDb': db('动态 EQ 阈值', -60, 0),
  'vocal.dynEq.ratio': num('动态 EQ 比率', 1, 20, 0.5, ':1', { digits: 1 }),
  'vocal.dynEq.maxCutDb': db('最多衰减', 0, 18),
  'vocal.parallel.on': sw('并行压缩开关'),
  'vocal.parallel.thresholdDb': db('并行压缩阈值', -60, 0),
  'vocal.parallel.ratio': num('并行压缩比率', 1, 20, 0.5, ':1', { digits: 1 }),
  'vocal.parallel.blend': pct('并行信号比例'),
  'vocal.saturation.on': sw('饱和开关'),
  'vocal.saturation.type': {
    kind: 'select',
    label: '饱和类型',
    options: [
      { value: 'tape', label: '磁带（柔和）' },
      { value: 'tube', label: '电子管（温暖、偏偶次谐波）' },
      { value: 'hard', label: '硬削波（失真）' },
    ],
  },
  'vocal.saturation.drive': pct('驱动量'),
  'vocal.saturation.mix': pct('干湿比'),
  'vocal.mod.on': sw('调制效果开关'),
  'vocal.mod.type': {
    kind: 'select',
    label: '调制类型',
    options: [
      { value: 'chorus', label: '合唱' },
      { value: 'flanger', label: '镶边' },
      { value: 'phaser', label: '移相' },
      { value: 'doubler', label: '加倍（左右两个略有不同的副本）' },
    ],
  },
  'vocal.mod.rate': num('调制速度', 0.05, 8, 0.05, 'Hz', { log: true, digits: 2 }),
  'vocal.mod.depth': pct('调制深度'),
  'vocal.mod.mix': pct('干湿比'),
  'vocal.reverb.on': sw('混响开关'),
  'vocal.reverb.type': {
    kind: 'select',
    label: '混响类型',
    options: [
      { value: 'room', label: '房间' },
      { value: 'plate', label: '板式' },
      { value: 'hall', label: '大厅' },
    ],
  },
  'vocal.reverb.size': pct('空间大小'),
  'vocal.reverb.decay': num('衰减时间', 0.2, 8, 0.1, 's', { log: true, digits: 1 }),
  'vocal.reverb.preDelayMs': num('预延迟', 0, 200, 1, 'ms', { digits: 0 }),
  'vocal.reverb.mix': pct('混响比例'),
  'vocal.reverb.lowCut': hz('混响低切', 20, 1000),
  'vocal.reverb.highCut': hz('混响高切', 1000, 20000),
  'vocal.delay.on': sw('延迟开关'),
  'vocal.delay.sync': sw('按歌曲速度同步'),
  'vocal.delay.division': {
    kind: 'select',
    label: '延迟时值',
    options: [
      { value: '1/4', label: '四分音符' },
      { value: '1/8', label: '八分音符' },
      { value: '1/8.', label: '附点八分音符' },
      { value: '1/16', label: '十六分音符' },
    ],
  },
  'vocal.delay.timeMs': num('延迟时间', 20, 2000, 1, 'ms', { log: true, digits: 0 }),
  'vocal.delay.feedback': pct('回授（重复次数）'),
  'vocal.delay.mix': pct('延迟比例'),
  'vocal.delay.pingPong': sw('乒乓（左右来回）'),
  'vocal.delay.highCut': hz('延迟高切', 1000, 20000),
  'vocal.autoLevel.on': sw('逐句音量平衡开关'),
  'vocal.autoLevel.strength': pct('平衡力度'),
  'vocal.tune.on': sw('音高修正开关'),
  'vocal.tune.amount': pct('修正力度'),
  'vocal.tune.speedMs': num('修正速度（越小越快、越像电音）', 0, 400, 1, 'ms', { digits: 0 }),
  'backing.gainDb': db('伴奏音量'),
  'backing.eq.on': sw('伴奏 EQ 开关'),
  'backing.eq.lowDb': db('伴奏低频', -15, 15),
  'backing.eq.midDb': db('伴奏中频', -15, 15),
  'backing.eq.highDb': db('伴奏高频', -15, 15),
  'backing.duck.on': sw('人声出现时伴奏让位（侧链）'),
  'backing.duck.amountDb': db('让位多少', 0, 12),
  'backing.duck.releaseMs': num('恢复时间', 20, 2000, 1, 'ms', { log: true, digits: 0 }),
  'backing.pocket.on': sw('给人声留位置（伴奏中频凹陷）'),
  'backing.pocket.freq': hz('凹陷频率', 500, 8000),
  'backing.pocket.amountDb': db('凹陷深度', 0, 9),
  'master.gainDb': db('总输出音量'),
  'master.limiter': sw('限幅器'),
  'master.ceilingDb': num('限幅上限（真峰值）', -6, 0, 0.1, 'dB', { digits: 1 }),
  'master.multiband.on': sw('多段压缩开关'),
  'master.multiband.lowHz': hz('低 / 中分频点', 40, 1000),
  'master.multiband.highHz': hz('中 / 高分频点', 1000, 12000),
  'master.multiband.bands.0.thresholdDb': db('低频段阈值', -60, 0),
  'master.multiband.bands.0.ratio': num('低频段比率', 1, 20, 0.5, ':1', { digits: 1 }),
  'master.multiband.bands.1.thresholdDb': db('中频段阈值', -60, 0),
  'master.multiband.bands.1.ratio': num('中频段比率', 1, 20, 0.5, ':1', { digits: 1 }),
  'master.multiband.bands.2.thresholdDb': db('高频段阈值', -60, 0),
  'master.multiband.bands.2.ratio': num('高频段比率', 1, 20, 0.5, ':1', { digits: 1 }),
  'master.width.on': sw('立体声宽度开关'),
  'master.width.amount': num('宽度（1 = 原样）', 0, 2, 0.01, '×', { digits: 2 }),
}

/** Read a dotted path from settings. */
export function getPath(m: MixSettings, path: string): unknown {
  let cur: unknown = m
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

/** A copy of the settings with one dotted path set. */
export function setPath(m: MixSettings, path: string, value: unknown): MixSettings {
  const out = JSON.parse(JSON.stringify(m)) as MixSettings
  const keys = path.split('.')
  let cur = out as unknown as Record<string, unknown>
  for (const k of keys.slice(0, -1)) cur = cur[k] as Record<string, unknown>
  cur[keys[keys.length - 1]!] = value
  return out
}
