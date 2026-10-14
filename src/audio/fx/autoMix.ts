/**
 * 自动后期 (0.26.0, pure): a whole mix worked out from the recording — the
 * student's voice, the backing, and (when the song has it) the original
 * singer's separated vocals. Two directions:
 *
 * - 'clean' fixes what the voice needs (noise, rumble, uneven level,
 *   sibilance, being covered by the backing) on a preset chosen from the
 *   song's tempo and brightness;
 * - 'reference' also leans toward the original: the voice-to-backing balance
 *   of the original mix, the original voice's tone (a matching EQ, at most
 *   ±6 dB) and its space (reverb amount and length), as far as `strength`.
 *
 * Every decision comes with why, for the student to read.
 */
import { FFT } from '@/audio/separation/fft'
import { clampMix, cloneMix, MIX_PRESETS } from '@/songs/mixPresets'
import type { EqBand, MixPresetId, MixSettings } from '@/songs/singTypes'
import { measureVoice, type VoiceMetrics } from './mixAdvisor'

export type AutoDirection = 'clean' | 'reference'

export interface AutoMixInput {
  /** The student's voice (mono). */
  voice: Float32Array
  /** All backing stems summed (mono), or null. */
  backing: Float32Array | null
  /** The original singer's separated vocals (mono), or null. */
  reference: Float32Array | null
  sampleRate: number
  bpm: number
  /** Lowest note of the song's melody (MIDI), for the low cut. */
  lowestMidi?: number
  direction: AutoDirection
  /** 0–1: how far toward the original ('reference' only). */
  strength: number
}

export interface AutoDecision {
  /** Which part of the desk, e.g. "EQ". */
  area: string
  /** What was set and why (Chinese, one or two sentences). */
  text: string
}

export interface AutoMixResult {
  mix: MixSettings
  decisions: AutoDecision[]
  base: MixPresetId
  /** Measured, for display. */
  metrics: VoiceMetrics
  /** The original's voice-over-backing balance, dB (when known). */
  referenceBalanceDb: number | null
  /** Voice over backing to aim for after processing, dB (autoMixBalance). */
  targetBalanceDb: number
}

const fmt = (x: number, d = 1) => (Math.round(x * 10 ** d) / 10 ** d).toString()
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

// ---- spectra ---------------------------------------------------------------

const N = 2048
const HOP = 1024
/** Log-spaced analysis bands (Hz centres) for tone matching. */
export const TONE_BANDS = Array.from({ length: 28 }, (_, i) => 80 * 2 ** (i / 4)).filter(
  (f) => f <= 14000,
)

/** 50 ms RMS levels in dB. */
function levels(x: Float32Array, rate: number): Float64Array {
  const f = Math.max(1, Math.round(rate * 0.05))
  const n = Math.floor(x.length / f)
  const out = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    let s = 0
    for (let i = k * f; i < (k + 1) * f; i++) s += x[i]! * x[i]!
    out[k] = s > 0 ? 10 * Math.log10(s / f) : -120
  }
  return out
}

const pct = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))] ?? -120

/** Long-term spectrum of the sung (loud enough) frames, dB per TONE_BANDS band, 0 dB = the mean. */
export function toneCurve(x: Float32Array, rate: number): number[] | null {
  if (x.length < N * 4) return null
  const lv = Array.from(levels(x, rate)).sort((a, b) => a - b)
  const gate = Math.max(pct(lv, 0.95) - 25, pct(lv, 0.1) + 6)
  const fft = new FFT(N)
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  const acc = new Float64Array(N / 2 + 1)
  const frames = Math.floor((x.length - N) / HOP) + 1
  const stride = Math.max(1, Math.ceil(frames / 500))
  let used = 0
  for (let f = 0; f < frames; f += stride) {
    const o = f * HOP
    let s = 0
    for (let i = 0; i < N; i++) s += x[o + i]! * x[o + i]!
    if (10 * Math.log10(s / N + 1e-20) < gate) continue
    for (let i = 0; i < N; i++) {
      re[i] = x[o + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N))
      im[i] = 0
    }
    fft.forward(re, im)
    for (let k = 0; k <= N / 2; k++) acc[k]! += re[k]! * re[k]! + im[k]! * im[k]!
    used++
  }
  if (used < 8) return null
  const binHz = rate / N
  const db = TONE_BANDS.map((fc) => {
    const lo = fc / 2 ** (1 / 8)
    const hi = fc * 2 ** (1 / 8)
    let p = 0
    let c = 0
    for (
      let k = Math.max(1, Math.floor(lo / binHz));
      k <= Math.min(N / 2, Math.ceil(hi / binHz));
      k++
    ) {
      p += acc[k]!
      c++
    }
    return 10 * Math.log10(p / Math.max(1, c) + 1e-20)
  })
  const mean = db.reduce((a, b) => a + b, 0) / db.length
  return db.map((d) => d - mean)
}

/** Light smoothing over neighbouring bands. */
const smooth = (xs: number[]) =>
  xs.map((_, i) => (xs[Math.max(0, i - 1)]! + 2 * xs[i]! + xs[Math.min(xs.length - 1, i + 1)]!) / 4)

/**
 * Four EQ bands that move `from` toward `to` (dB curves on TONE_BANDS):
 * a low shelf, two peaks where the difference is largest (low-mid / presence),
 * a high shelf; each at most ±maxDb.
 */
export function matchingEq(from: number[], to: number[], maxDb: number): EqBand[] {
  const d = smooth(to.map((t, i) => t - from[i]!))
  const avg = (lo: number, hi: number) => {
    const xs = d.filter((_, i) => TONE_BANDS[i]! >= lo && TONE_BANDS[i]! <= hi)
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
  }
  const peakIn = (lo: number, hi: number) => {
    let best = -1
    for (let i = 0; i < d.length; i++)
      if (
        TONE_BANDS[i]! >= lo &&
        TONE_BANDS[i]! <= hi &&
        (best < 0 || Math.abs(d[i]!) > Math.abs(d[best]!))
      )
        best = i
    return best < 0
      ? { freq: Math.sqrt(lo * hi), gain: 0 }
      : { freq: TONE_BANDS[best]!, gain: d[best]! }
  }
  const lim = (g: number) => Math.round(clamp(g, -maxDb, maxDb) * 2) / 2
  const low = avg(80, 180)
  const mid = peakIn(220, 1200)
  const pres = peakIn(1500, 6000)
  const air = avg(8000, 14000)
  return [
    { type: 'lowshelf', freq: 150, gainDb: lim(low), q: 0.7 },
    { type: 'peaking', freq: Math.round(mid.freq), gainDb: lim(mid.gain - low * 0.3), q: 1.2 },
    { type: 'peaking', freq: Math.round(pres.freq), gainDb: lim(pres.gain), q: 1.2 },
    { type: 'highshelf', freq: 9000, gainDb: lim(air), q: 0.7 },
  ]
}

/**
 * The original voice's reverb from its phrase endings: how fast the level
 * falls in the 50–450 ms after the voice stops (dB per second → time to fall
 * 60 dB), and how loud that tail is. Null when there are too few endings.
 */
export function reverbFromTails(
  x: Float32Array,
  rate: number,
): { decayS: number; tailDb: number } | null {
  const lv = levels(x, rate) // 50 ms frames
  const sorted = Array.from(lv).sort((a, b) => a - b)
  const loud = pct(sorted, 0.9)
  const slopes: number[] = []
  const tails: number[] = []
  for (let i = 3; i < lv.length - 11; i++) {
    // An ending: singing (within 12 dB of loud) for 3 frames, then a drop of > 10 dB.
    if (lv[i - 1]! < loud - 12 || lv[i - 2]! < loud - 12 || lv[i - 3]! < loud - 12) continue
    // The voice stops: at least 8 dB down within two frames.
    if (lv[i + 1]! > lv[i - 1]! - 8) continue
    const ys = [2, 3, 4, 5, 6, 7, 8, 9, 10].map((k) => lv[i + k]!)
    // Something new starts: not a clean tail.
    if (ys.some((y, k) => k > 0 && y > ys[k - 1]! + 3)) continue
    const n = ys.length
    const mx = (n + 1) / 2
    const my = ys.reduce((a, b) => a + b, 0) / n
    let num = 0
    let den = 0
    ys.forEach((y, k) => {
      num += (k + 1 - mx) * (y - my)
      den += (k + 1 - mx) ** 2
    })
    const slope = num / den / 0.05 // dB per second
    if (slope < -2) slopes.push(-slope)
    tails.push(lv[i + 2]! - loud)
    i += 10
  }
  if (slopes.length < 4) return null
  slopes.sort((a, b) => a - b)
  tails.sort((a, b) => a - b)
  return { decayS: clamp(60 / pct(slopes, 0.5), 0.5, 4), tailDb: pct(tails, 0.5) }
}

/** Level of a signal while it is active (dB, as the advisor measures it). */
function activeDb(x: Float32Array, rate: number): number {
  return measureVoice(x, null, rate).voiceDb
}

/** Base preset from the backing: tempo and brightness. */
function chooseBase(
  backing: Float32Array | null,
  rate: number,
  bpm: number,
): { id: MixPresetId; why: string } {
  if (!backing) return { id: 'pop', why: '没有伴奏可以分析，用「流行人声」作基础。' }
  const b = measureVoice(backing, null, rate).bands
  const bright = b.presence + b.sibilance + b.air
  if (bpm >= 135 || bright > 0.28)
    return {
      id: 'rock',
      why: `伴奏${bpm >= 135 ? `速度快（${Math.round(bpm)} BPM）` : '高频多、比较亮'}，用「摇滚」作基础：人声更靠前、压得更紧。`,
    }
  if (bpm < 85)
    return {
      id: 'ballad',
      why: `速度慢（${Math.round(bpm)} BPM），用「抒情慢歌」作基础：混响长一些、更舒展。`,
    }
  if (bright < 0.1) return { id: 'warm', why: '伴奏偏暗、偏暖，用「温暖抒情」作基础。' }
  return { id: 'pop', why: `速度中等（${Math.round(bpm)} BPM）、明暗适中，用「流行人声」作基础。` }
}

/** The whole automatic mix. `current` provides what is not decided here (stems, pitch correction, level riding). */
export function autoMix(input: AutoMixInput, current: MixSettings): AutoMixResult {
  const { voice, backing, reference, sampleRate: sr, bpm } = input
  const decisions: AutoDecision[] = []
  const say = (area: string, text: string) => decisions.push({ area, text })
  const metrics = measureVoice(voice, backing, sr)
  const base = chooseBase(backing, sr, bpm)
  const m = cloneMix(MIX_PRESETS[base.id].settings)
  // Kept from the student's own settings.
  m.engine = current.engine
  m.vocal.autoLevel = cloneMix(current).vocal.autoLevel
  m.vocal.tune = cloneMix(current).vocal.tune
  m.vocal.order = [...current.vocal.order]
  m.backing.stems = JSON.parse(
    JSON.stringify(current.backing.stems),
  ) as MixSettings['backing']['stems']
  say('基础', base.why)
  const useRef = input.direction === 'reference' && !!reference
  const t = useRef ? clamp(input.strength, 0, 1) : 0

  // Noise between phrases → gate.
  if (metrics.noiseFloorDb > -60 && metrics.voiceDb - metrics.noiseFloorDb > 12) {
    const thr = Math.round(Math.min(metrics.noiseFloorDb + 8, metrics.voiceDb - 12))
    m.vocal.gate = { on: true, thresholdDb: thr, rangeDb: 18, releaseMs: 150 }
    say(
      '噪声门',
      `句子之间的底噪约 ${fmt(metrics.noiseFloorDb)} dBFS，噪声门设在 ${thr} dB：不唱时压低 18 dB。`,
    )
  } else {
    m.vocal.gate = { ...m.vocal.gate, on: false }
    say('噪声门', `底噪很低（约 ${fmt(metrics.noiseFloorDb)} dBFS），不需要噪声门。`)
  }

  // Low cut below the lowest note.
  const lowestHz = input.lowestMidi !== undefined ? 440 * 2 ** ((input.lowestMidi - 69) / 12) : 110
  let cut = Math.round(clamp(lowestHz * 0.7, 60, 160) / 5) * 5
  if (metrics.bands.sub > 0.05 || metrics.noiseHum > 0.5) cut = Math.max(cut, 100)
  m.vocal.lowCut = { on: true, freq: cut }
  say(
    '低切',
    `这首歌最低唱到约 ${Math.round(lowestHz)} Hz，低切设在 ${cut} Hz：去掉喷麦和环境低频，不碰到歌声${metrics.bands.sub > 0.05 ? '（录音里低频偏多）' : ''}。`,
  )

  // Tone: matching EQ toward the original, or the usual clean-up.
  const mine = toneCurve(voice, sr)
  const theirs = useRef ? toneCurve(reference, sr) : null
  if (mine && theirs && t > 0) {
    const bands = matchingEq(mine, theirs, 6 * t)
    m.vocal.eq = { on: true, bands }
    const desc = bands
      .filter((b) => Math.abs(b.gainDb) >= 1)
      .map(
        (b) =>
          `${b.freq >= 1000 ? fmt(b.freq / 1000) + ' kHz' : Math.round(b.freq) + ' Hz'} ${b.gainDb > 0 ? '+' : ''}${b.gainDb} dB`,
      )
    say(
      'EQ',
      desc.length
        ? `对比你和原唱的音色，往原唱靠拢 ${Math.round(t * 100)}%：${desc.join('，')}。`
        : '你的音色和原唱很接近，EQ 基本不用动。',
    )
  } else {
    const bands: EqBand[] = cloneMix(m).vocal.eq.bands
    const notes: string[] = []
    if (metrics.bands.lowMid > 0.35) {
      bands[1] = { type: 'peaking', freq: 300, gainDb: -3, q: 1.2 }
      notes.push('300 Hz 一带偏厚（发闷），减 3 dB')
    }
    if (metrics.bands.presence < 0.08) {
      bands[2] = { type: 'peaking', freq: 3000, gainDb: 2.5, q: 1 }
      notes.push('2–5 kHz 偏少（不够清楚），加 2.5 dB')
    }
    m.vocal.eq = { on: true, bands }
    say('EQ', notes.length ? `${notes.join('；')}。` : '音色比较均衡，用预设的 EQ。')
  }

  // Dynamics: compression aiming at a few dB of gain reduction.
  const lv = Array.from(levels(voice, sr)).sort((a, b) => a - b)
  const sung = lv.filter((d) => d >= Math.max(pct(lv, 0.95) - 25, metrics.noiseFloorDb + 6))
  if (sung.length > 10) {
    const thr = Math.round(pct(sung, 0.55))
    const ratio = metrics.dynamicRangeDb > 14 ? 4 : 3
    const makeup = Math.round(clamp((pct(sung, 0.9) - thr) * (1 - 1 / ratio) * 0.7, 1, 9) * 2) / 2
    m.vocal.comp = {
      on: true,
      thresholdDb: clamp(thr, -50, -6),
      ratio,
      attackMs: 10,
      releaseMs: 120,
      makeupDb: makeup,
    }
    say(
      '压缩',
      metrics.dynamicRangeDb < 6
        ? `音量本来就比较平稳（起伏约 ${fmt(metrics.dynamicRangeDb)} dB），轻轻压：阈值 ${clamp(thr, -50, -6)} dB、比率 ${ratio}:1，补偿 ${makeup} dB。`
        : `大声和小声差约 ${fmt(metrics.dynamicRangeDb)} dB；阈值 ${clamp(thr, -50, -6)} dB、比率 ${ratio}:1，响的地方大约压下 4–6 dB，补偿 ${makeup} dB。`,
    )
  }

  // Sibilance.
  if (metrics.bands.sibilance > 0.06 && metrics.sibilanceHz) {
    const freq = clamp(Math.round(metrics.sibilanceHz / 100) * 100, 5000, 9000)
    const amount = metrics.bands.sibilance > 0.12 ? 6 : 4
    m.vocal.deEss = { on: true, freq, amountDb: amount, thresholdDb: -30 }
    say(
      '去齿音',
      `齿音集中在约 ${fmt(freq / 1000)} kHz（占人声 ${Math.round(metrics.bands.sibilance * 100)}%），出现时最多压 ${amount} dB。`,
    )
  } else {
    m.vocal.deEss = { ...m.vocal.deEss, on: false }
    say('去齿音', '齿音不明显，不用去齿音。')
  }

  // Space: the original's reverb, or the preset's.
  const room = useRef ? reverbFromTails(reference, sr) : null
  if (room && t > 0) {
    const wet = clamp((room.tailDb + 40) / 30, 0, 1) // −40 dB → dry, −10 dB → very wet
    const mix = lerp(m.vocal.reverb.mix, 0.08 + 0.32 * wet, t)
    const decay = lerp(m.vocal.reverb.decay, room.decayS, t)
    m.vocal.reverb = {
      ...m.vocal.reverb,
      on: true,
      mix: Math.round(mix * 100) / 100,
      decay: Math.round(decay * 10) / 10,
      type: decay > 2.4 ? 'hall' : decay < 1.1 ? 'room' : 'plate',
      size: clamp(decay / 3.5, 0.2, 0.95),
    }
    say(
      '混响',
      `原唱每句结尾的余音约 ${fmt(room.decayS)} 秒衰减完、尾巴比人声低 ${fmt(-room.tailDb, 0)} dB；混响设为${m.vocal.reverb.type === 'hall' ? '大厅' : m.vocal.reverb.type === 'room' ? '房间' : '板式'}，${fmt(m.vocal.reverb.decay)} 秒，比例 ${Math.round(m.vocal.reverb.mix * 100)}%。`,
    )
  } else
    say(
      '混响',
      `用预设的混响（${fmt(m.vocal.reverb.decay)} 秒，比例 ${Math.round(m.vocal.reverb.mix * 100)}%）。`,
    )

  // Echo in time with the song.
  m.vocal.delay = { ...m.vocal.delay, sync: true, division: bpm < 100 ? '1/8.' : '1/8' }
  if (m.vocal.delay.on)
    say(
      '延迟',
      `按歌曲速度同步（${Math.round(bpm)} BPM，${m.vocal.delay.division === '1/8.' ? '附点八分音符' : '八分音符'}）。`,
    )

  // Room for the voice in the backing.
  if (backing && metrics.masking > 0.3) {
    m.backing.pocket = { on: true, freq: 3000, amountDb: metrics.masking > 0.5 ? 4 : 3 }
    m.backing.duck = {
      ...m.backing.duck,
      on: metrics.masking > 0.45,
      amountDb: metrics.masking > 0.6 ? 4 : 2.5,
    }
    say(
      '伴奏让位',
      `1–5 kHz 里伴奏盖住了人声约 ${Math.round(metrics.masking * 100)}%：伴奏在 3 kHz 挖 ${m.backing.pocket.amountDb} dB${m.backing.duck.on ? `，唱的时候伴奏再让 ${m.backing.duck.amountDb} dB` : ''}。`,
    )
  } else if (backing) {
    m.backing.pocket = { ...m.backing.pocket, on: false }
    m.backing.duck = { ...m.backing.duck, on: false }
    say('伴奏让位', '伴奏没怎么挡住人声，不用让位。')
  }

  // Balance: the original's, or a little above the backing.
  let referenceBalanceDb: number | null = null
  const cleanTarget = 2
  let target = cleanTarget
  if (useRef && backing && reference) {
    referenceBalanceDb = activeDb(reference, sr) - activeDb(backing, sr)
    target = lerp(cleanTarget, clamp(referenceBalanceDb, -3, 6), t)
  }
  if (backing && Number.isFinite(metrics.backingDb)) {
    // Before the chain; the desk measures the processed result and corrects this (autoMixBalance).
    m.vocal.gainDb =
      Math.round(clamp(target - (metrics.voiceDb - metrics.backingDb), -18, 12) * 2) / 2
    m.backing.gainDb = 0
    say(
      '音量',
      referenceBalanceDb !== null
        ? `原唱里人声比伴奏${referenceBalanceDb >= 0 ? '大' : '小'} ${fmt(Math.abs(referenceBalanceDb))} dB；你的人声按 ${fmt(target)} dB 放（处理后会再量一次校准）。`
        : `人声比伴奏大约 ${fmt(target)} dB，最容易听清又不突兀（处理后会再量一次校准）。`,
    )
  }

  // Finish.
  m.master = { ...m.master, limiter: true, ceilingDb: -1, targetLufs: -14 }
  say('母带', '导出时整体响度对齐到 −14 LUFS（各大音乐平台的常用标准），峰值不超过 −1 dB。')
  return {
    mix: clampMix(m),
    decisions,
    base: base.id,
    metrics,
    referenceBalanceDb,
    targetBalanceDb: target,
  }
}

/**
 * After rendering the processed voice and backing separately: the vocal gain
 * that puts the voice `targetDb` above the backing (only the gain changes).
 */
export function autoMixBalance(
  mix: MixSettings,
  processedVoice: Float32Array,
  processedBacking: Float32Array,
  rate: number,
  targetDb: number,
): MixSettings {
  const v = activeDb(processedVoice, rate)
  const b = activeDb(processedBacking, rate)
  if (!Number.isFinite(v) || !Number.isFinite(b) || v < -100 || b < -100) return mix
  const m = cloneMix(mix)
  m.vocal.gainDb = Math.round(clamp(m.vocal.gainDb + targetDb - (v - b), -18, 12) * 2) / 2
  return clampMix(m)
}
