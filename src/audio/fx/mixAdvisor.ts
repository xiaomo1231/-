/**
 * Mix advisor for the 跟唱 post-production desk (pure, no Web Audio).
 *
 * `measureVoice` analyses the raw recorded voice (and optionally the backing)
 * into a handful of numbers; `suggest` turns them into one-click, encouraging
 * suggestions that only appear when the current mix does not already handle
 * the issue. Every `apply` returns a new, range-clamped MixSettings.
 */
import { clampMix, cloneMix, DEFAULT_MIX } from '@/songs/mixPresets'
import type { EqBand, MixSettings } from '@/songs/singTypes'

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** Measured properties of a recorded voice (and its relation to the backing). */
export interface VoiceMetrics {
  /**
   * Loudness of the voice: dB RMS (power mean) over the voiced 50 ms frames.
   * Backing: dB RMS over its active 50 ms frames, or -Infinity when there is no backing.
   */
  voiceDb: number
  backingDb: number
  /** Energy share by band of the voice over voiced frames (fractions summing ~1). */
  bands: { sub: number; lowMid: number; mid: number; presence: number; sibilance: number; air: number }
  /** dB difference between loud and quiet sung passages (95th − 10th percentile of 50 ms RMS over voiced frames). */
  dynamicRangeDb: number
  /** Noise floor between phrases, dBFS (10th percentile of 50 ms RMS, floored at −120). */
  noiseFloorDb: number
  /** Share of the noise floor's energy below 120 Hz (hum / rumble), 0–1. */
  noiseHum: number
  /** Sample peak of the raw voice, dBFS, and fraction of clipped samples (|x| ≥ 0.999). */
  peakDb: number
  clipped: number
  /**
   * How much the backing covers the voice in 1–5 kHz (0–1): Σ V·B/(V+B) / Σ V over
   * FFT bins, i.e. 0 without backing, 0.5 when equally loud, → 1 when the backing dominates.
   */
  masking: number
  /** Frequency (Hz) of the strongest voice energy between 5 and 10 kHz (0 if none). */
  sibilanceHz: number
}

const FFT_SIZE = 2048
const FFT_HOP = FFT_SIZE / 2
/** Upper bound on analysed FFT frames; long inputs use every n-th frame. */
const MAX_FFT_FRAMES = 600
/** dB floor for silent frames, so percentiles stay finite. */
const MIN_DB = -120
/** Frames this far below the loud passages (p95) are not singing. */
const VOICED_BELOW_P95_DB = 30
/** Frames must also be this far above the noise floor to count as singing. */
const VOICED_ABOVE_FLOOR_DB = 6
/** Frames within this margin of the floor are used for the gap (noise) spectrum. */
const GAP_ABOVE_FLOOR_DB = 3
const CLIP_LEVEL = 0.999

const BAND_EDGES = [120, 500, 2000, 5000, 10000] as const

function toDb(power: number): number {
  return power > 0 ? Math.max(MIN_DB, 10 * Math.log10(power)) : MIN_DB
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return MIN_DB
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))
  return sorted[i] ?? MIN_DB
}

/** Mean-square per 50 ms frame. */
function frameMeanSquares(x: Float32Array, frame: number): Float64Array {
  const n = Math.floor(x.length / frame)
  const out = new Float64Array(n)
  for (let f = 0; f < n; f++) {
    let s = 0
    const o = f * frame
    for (let i = 0; i < frame; i++) {
      const v = x[o + i] ?? 0
      s += v * v
    }
    out[f] = s / frame
  }
  return out
}

// --- radix-2 FFT ------------------------------------------------------------

interface FftPlan {
  n: number
  cos: Float64Array
  sin: Float64Array
  rev: Uint32Array
  window: Float64Array
}

let plan: FftPlan | null = null

function getPlan(): FftPlan {
  if (plan) return plan
  const n = FFT_SIZE
  const cos = new Float64Array(n / 2)
  const sin = new Float64Array(n / 2)
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / n)
    sin[i] = Math.sin((-2 * Math.PI * i) / n)
  }
  const bits = Math.log2(n)
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
    rev[i] = r
  }
  const window = new Float64Array(n)
  for (let i = 0; i < n; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
  plan = { n, cos, sin, rev, window }
  return plan
}

const re = new Float64Array(FFT_SIZE)
const im = new Float64Array(FFT_SIZE)

/** Adds the Hann-windowed power spectrum (bins 0..n/2) of x[offset..offset+n) to `acc`. */
function accumulateSpectrum(x: Float32Array, offset: number, acc: Float64Array): void {
  const { n, cos, sin, rev, window } = getPlan()
  for (let i = 0; i < n; i++) {
    const j = rev[i] ?? 0
    re[j] = (x[offset + i] ?? 0) * (window[i] ?? 0)
    im[j] = 0
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1
    const step = n / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step] ?? 1
        const wi = sin[k * step] ?? 0
        const a = start + k
        const b = a + half
        const br = re[b] ?? 0
        const bi = im[b] ?? 0
        const tr = br * wr - bi * wi
        const ti = br * wi + bi * wr
        const ar = re[a] ?? 0
        const ai = im[a] ?? 0
        re[b] = ar - tr
        im[b] = ai - ti
        re[a] = ar + tr
        im[a] = ai + ti
      }
    }
  }
  for (let k = 0; k <= n / 2; k++) {
    const r = re[k] ?? 0
    const q = im[k] ?? 0
    acc[k] = (acc[k] ?? 0) + r * r + q * q
  }
}

function frameMeanSquare(x: Float32Array, offset: number, len: number): number {
  let s = 0
  for (let i = 0; i < len; i++) {
    const v = x[offset + i] ?? 0
    s += v * v
  }
  return s / len
}

/** Active loudness (dB RMS over 50 ms frames within 30 dB of the loud passages). */
function activeLevelDb(ms: Float64Array): { db: number; floor: number; voicedMin: number; sortedVoiced: number[] } {
  const dbs = Array.from(ms, toDb).sort((a, b) => a - b)
  const floor = percentile(dbs, 0.1)
  const p95 = percentile(dbs, 0.95)
  let voicedMin = Math.max(p95 - VOICED_BELOW_P95_DB, floor + VOICED_ABOVE_FLOOR_DB)
  if (voicedMin > p95) voicedMin = p95 - VOICED_BELOW_P95_DB // nearly constant level: everything above the p95 window counts
  let sum = 0
  let count = 0
  const sortedVoiced: number[] = []
  for (let i = 0; i < ms.length; i++) {
    const p = ms[i] ?? 0
    if (toDb(p) >= voicedMin) {
      sum += p
      count++
    }
  }
  for (const d of dbs) if (d >= voicedMin) sortedVoiced.push(d)
  return { db: count > 0 ? toDb(sum / count) : MIN_DB, floor, voicedMin, sortedVoiced }
}

/**
 * Analyses the raw recorded voice (and the backing, if given) at `sampleRate`.
 * Long inputs are analysed on a decimated subset of FFT frames (≤ 600), so a
 * 4-minute take takes well under a second.
 */
export function measureVoice(voice: Float32Array, backing: Float32Array | null, sampleRate: number): VoiceMetrics {
  const frame50 = Math.max(1, Math.round(sampleRate * 0.05))
  const vMs = frameMeanSquares(voice, frame50)
  const v = activeLevelDb(vMs)
  const dynamicRangeDb = v.sortedVoiced.length > 0 ? percentile(v.sortedVoiced, 0.95) - percentile(v.sortedVoiced, 0.1) : 0

  let backingDb = -Infinity
  if (backing && backing.length >= frame50) backingDb = activeLevelDb(frameMeanSquares(backing, frame50)).db

  // Peak and clipping.
  let peak = 0
  let clippedCount = 0
  for (let i = 0; i < voice.length; i++) {
    const a = Math.abs(voice[i] ?? 0)
    if (a > peak) peak = a
    if (a >= CLIP_LEVEL) clippedCount++
  }

  // Averaged power spectra over voiced frames (voice and backing) and gap frames.
  const bins = FFT_SIZE / 2 + 1
  const vSpec = new Float64Array(bins)
  const bSpec = new Float64Array(bins)
  const gSpec = new Float64Array(bins)
  const nFrames = voice.length >= FFT_SIZE ? Math.floor((voice.length - FFT_SIZE) / FFT_HOP) + 1 : 0
  const stride = Math.max(1, Math.ceil(nFrames / MAX_FFT_FRAMES))
  const gapMax = v.floor + GAP_ABOVE_FLOOR_DB
  const useBacking = backing !== null && Number.isFinite(backingDb)
  let voicedFrames = 0
  let gapFrames = 0
  for (let f = 0; f < nFrames; f += stride) {
    const off = f * FFT_HOP
    const d = toDb(frameMeanSquare(voice, off, FFT_SIZE))
    if (d >= v.voicedMin) {
      accumulateSpectrum(voice, off, vSpec)
      if (useBacking && backing && off + FFT_SIZE <= backing.length) accumulateSpectrum(backing, off, bSpec)
      voicedFrames++
    } else if (d <= gapMax && d > MIN_DB) {
      if (gapFrames < MAX_FFT_FRAMES / 4) accumulateSpectrum(voice, off, gSpec)
      gapFrames++
    }
  }

  const binHz = sampleRate / FFT_SIZE
  const bandSum = [0, 0, 0, 0, 0, 0]
  let total = 0
  let sibPeak = 0
  let sibilanceHz = 0
  let maskNum = 0
  let maskDen = 0
  for (let k = 1; k < bins; k++) {
    const hz = k * binHz
    const p = vSpec[k] ?? 0
    let band = 0
    while (band < BAND_EDGES.length && hz >= (BAND_EDGES[band] ?? Infinity)) band++
    bandSum[band] = (bandSum[band] ?? 0) + p
    total += p
    if (hz >= 5000 && hz < 10000) {
      // Smooth over ±2 bins so a noise band beats a single stray harmonic.
      let s = 0
      for (let j = -2; j <= 2; j++) s += vSpec[k + j] ?? 0
      if (s > sibPeak) {
        sibPeak = s
        sibilanceHz = Math.round(hz)
      }
    }
    if (hz >= 1000 && hz <= 5000) {
      const b = bSpec[k] ?? 0
      maskDen += p
      if (p + b > 0) maskNum += (p * b) / (p + b)
    }
  }
  const share = (i: number) => (total > 0 ? (bandSum[i] ?? 0) / total : 0)

  let gTotal = 0
  let gHum = 0
  for (let k = 1; k < bins; k++) {
    const p = gSpec[k] ?? 0
    gTotal += p
    if (k * binHz < 120) gHum += p
  }

  return {
    voiceDb: v.db,
    backingDb,
    bands: { sub: share(0), lowMid: share(1), mid: share(2), presence: share(3), sibilance: share(4), air: share(5) },
    dynamicRangeDb: Math.max(0, dynamicRangeDb),
    noiseFloorDb: v.floor,
    noiseHum: gTotal > 0 ? gHum / gTotal : 0,
    peakDb: peak > 0 ? Math.max(MIN_DB, 20 * Math.log10(peak)) : MIN_DB,
    clipped: voice.length > 0 ? clippedCount / voice.length : 0,
    masking: useBacking && maskDen > 0 && voicedFrames > 0 ? maskNum / maskDen : 0,
    sibilanceHz: sibPeak > 0 ? sibilanceHz : 0,
  }
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

/** One advice item for the desk, with a one-click change. */
export interface Suggestion {
  id: string
  /** Short title, e.g. "低频有嗡嗡声". */
  title: string
  /** One or two sentences: what was found (with the number) and what the change does. */
  detail: string
  /** The desk panel: 'lowcut' | 'eq' | 'comp' | 'deess' | 'gate' | 'dynEq' | 'balance' | 'duck' | 'pocket' | 'autoLevel' | 'master'. */
  module: string
  /** Settings change to apply with one click (pure; returns a new object). */
  apply: (m: MixSettings) => MixSettings
  /** Higher = more important; the list is sorted by this. */
  priority: number
}

/** Energy below 120 Hz above this share means rumble/hum (sung fundamentals rarely sit there). */
const SUB_SHARE_MAX = 0.12
/** Gap noise this hum-heavy (and audible) also calls for a low cut. */
const NOISE_HUM_SHARE = 0.5
const NOISE_HUM_AUDIBLE_DB = -70
/** A low cut at or above this frequency already removes rumble. */
const LOWCUT_HANDLED_HZ = 80
/** 120–500 Hz above this share sounds boxy/muddy (fundamentals usually leave ~30–50 %). */
const LOWMID_SHARE_MAX = 0.6
/** Presence + air below this share sounds dull / muffled. */
const BRIGHT_SHARE_MIN = 0.03
/** 2–5 kHz above this share tends to sound harsh/piercing on loud notes. */
const PRESENCE_SHARE_MAX = 0.25
/** 5–10 kHz above this share means strong "s/sh" sounds. */
const SIBILANCE_SHARE_MAX = 0.08
/** Loud vs quiet passages differing by more than this need compression. */
const DYNAMICS_MAX_DB = 12
/** …and by more than this, phrase-level riding (autoLevel) too. */
const DYNAMICS_AUTOLEVEL_DB = 18
/** Gap noise above this is audible between phrases. */
const NOISE_FLOOR_MAX_DB = -55
/** Gate threshold placed this far above the measured floor. */
const GATE_ABOVE_FLOOR_DB = 10
/** More clipped samples than this fraction is audible distortion. */
const CLIPPED_MAX = 1e-5
/** Target: voice this much above the backing (window `BALANCE_MIN..MAX` is left alone). */
const BALANCE_TARGET_DB = 2
const BALANCE_MIN_DB = 0
const BALANCE_MAX_DB = 4
/** Backing covering more than this share of the voice's 1–5 kHz needs a pocket / ducking. */
const MASKING_MAX = 0.5
const MASKING_DUCK = 0.7
/** Overall mix RMS (≈ LUFS for music) below this sounds quiet next to streaming songs. */
const MIX_QUIET_DB = -20

const fmt = (x: number) => (Math.round(x * 10) / 10).toString()
const pct = (x: number) => `${Math.round(x * 100)}%`

/** Clone, edit and clamp, so every apply returns a fresh, valid object. */
function edit(fn: (m: MixSettings) => void): (m: MixSettings) => MixSettings {
  return (input) => {
    const m = cloneMix(input)
    fn(m)
    return clampMix(m)
  }
}

/** Makes sure EQ band `i` exists (fills from the default mix). */
function eqBand(m: MixSettings, i: number): EqBand {
  const bands = m.vocal.eq.bands
  while (bands.length <= i) {
    const d = DEFAULT_MIX.vocal.eq.bands[bands.length]
    bands.push(d ? { ...d, gainDb: 0 } : { type: 'peaking', freq: 1000, gainDb: 0, q: 1 })
  }
  return bands[i] as EqBand
}

function powerSumDb(a: number, b: number): number {
  const p = (Number.isFinite(a) ? 10 ** (a / 10) : 0) + (Number.isFinite(b) ? 10 ** (b / 10) : 0)
  return p > 0 ? 10 * Math.log10(p) : MIN_DB
}

/**
 * Turns measured metrics into suggestions for the current mix, most important
 * first. Issues the mix already handles are left out.
 */
export function suggest(metrics: VoiceMetrics, mix: MixSettings): Suggestion[] {
  const out: Suggestion[] = []
  const v = mix.vocal
  const b = metrics.bands
  const hasVoice = metrics.voiceDb > MIN_DB + 1

  // Clipping cannot be undone by any setting.
  if (metrics.clipped > CLIPPED_MAX) {
    out.push({
      id: 'clipping',
      title: '录音有削波失真',
      detail: `这次录音有 ${fmt(metrics.clipped * 100)}% 的采样达到满幅（峰值 ${fmt(metrics.peakDb)} dBFS），这种破音无法在后期修复。建议把输入音量调小一些，重录破音的那几句。`,
      module: 'master',
      apply: (m) => cloneMix(m),
      priority: 100,
    })
  }

  // Balance voice vs backing (levels before the desk's own processing).
  if (hasVoice && Number.isFinite(metrics.backingDb)) {
    const delta = metrics.voiceDb + v.gainDb - (metrics.backingDb + mix.backing.gainDb)
    if (delta < BALANCE_MIN_DB || delta > BALANCE_MAX_DB) {
      const change = BALANCE_TARGET_DB - delta
      const up = change > 0
      out.push({
        id: 'balance',
        title: up ? '人声偏小' : '人声偏大',
        detail: `人声现在比伴奏${delta >= 0 ? '大' : '小'} ${fmt(Math.abs(delta))} dB，一般比伴奏大 1–3 dB 听起来最舒服。点一下把人声音量${up ? '提高' : '降低'} ${fmt(Math.abs(change))} dB。`,
        module: 'balance',
        apply: edit((m) => {
          m.vocal.gainDb = Math.round((m.vocal.gainDb + change) * 10) / 10
        }),
        priority: 85,
      })
    }
  }

  // Rumble / hum.
  const humInGaps = metrics.noiseHum > NOISE_HUM_SHARE && metrics.noiseFloorDb > NOISE_HUM_AUDIBLE_DB
  if ((b.sub > SUB_SHARE_MAX || humInGaps) && !(v.lowCut.on && v.lowCut.freq >= LOWCUT_HANDLED_HZ)) {
    const freq = b.sub > 2 * SUB_SHARE_MAX || humInGaps ? 120 : 100
    out.push({
      id: 'rumble',
      title: '低频有嗡嗡声',
      detail: humInGaps
        ? `这次录音在句子之间有低频嗡嗡声（底噪中 ${pct(metrics.noiseHum)} 在 120 Hz 以下），可能来自电源或空调。打开 ${freq} Hz 低切可以去掉它，几乎不影响歌声。`
        : `人声里有 ${pct(b.sub)} 的能量在 120 Hz 以下，多半是喷麦、桌面震动或环境低频。打开 ${freq} Hz 低切能让声音更干净。`,
      module: 'lowcut',
      apply: edit((m) => {
        m.vocal.lowCut = { on: true, freq: Math.max(freq, m.vocal.lowCut.on ? m.vocal.lowCut.freq : 0) }
      }),
      priority: 70,
    })
  }

  // Noisy gaps → gate.
  if (metrics.noiseFloorDb > NOISE_FLOOR_MAX_DB && hasVoice && metrics.voiceDb - metrics.noiseFloorDb > 12) {
    const threshold = Math.round(Math.min(metrics.noiseFloorDb + GATE_ABOVE_FLOOR_DB, metrics.voiceDb - 10))
    if (!(v.gate.on && v.gate.thresholdDb > metrics.noiseFloorDb)) {
      out.push({
        id: 'gate',
        title: '句子之间有底噪',
        detail: `不唱的时候底噪约 ${fmt(metrics.noiseFloorDb)} dBFS，在安静段落能听到。打开噪声门（阈值 ${threshold} dB），没唱的时候会自动把它压下去。`,
        module: 'gate',
        apply: edit((m) => {
          m.vocal.gate = { ...m.vocal.gate, on: true, thresholdDb: threshold, rangeDb: Math.max(m.vocal.gate.rangeDb, 15) }
        }),
        priority: 65,
      })
    }
  }

  // Sibilance → de-esser.
  if (b.sibilance > SIBILANCE_SHARE_MAX && !(v.deEss.on && v.deEss.amountDb >= 3)) {
    const freq = Math.min(8000, Math.max(6000, Math.round((metrics.sibilanceHz || 6500) / 100) * 100))
    const amount = b.sibilance > 2 * SIBILANCE_SHARE_MAX ? 6 : 4
    out.push({
      id: 'deess',
      title: '"s"、"sh"音偏刺',
      detail: `5–10 kHz 占人声能量的 ${pct(b.sibilance)}，齿音比较明显，最强处约 ${fmt(freq / 1000)} kHz。打开去齿音（${fmt(freq / 1000)} kHz，最多压 ${amount} dB），只在齿音出现时起作用。`,
      module: 'deess',
      apply: edit((m) => {
        m.vocal.deEss = { on: true, freq, amountDb: Math.max(amount, m.vocal.deEss.amountDb), thresholdDb: Math.min(m.vocal.deEss.thresholdDb, -30) }
      }),
      priority: 60,
    })
  }

  // Harsh presence → dynamic EQ around 3 kHz.
  if (b.presence > PRESENCE_SHARE_MAX && !(v.dynEq.on && v.dynEq.freq >= 2000 && v.dynEq.freq <= 5000)) {
    out.push({
      id: 'harsh',
      title: '高音处有点刺耳',
      detail: `2–5 kHz 占人声能量的 ${pct(b.presence)}，唱得响时容易发尖。动态 EQ 只在 3 kHz 一带变响时轻轻压下，平时不影响清晰度。`,
      module: 'dynEq',
      apply: edit((m) => {
        m.vocal.dynEq = { on: true, freq: 3000, q: 1.4, thresholdDb: -26, ratio: 3, maxCutDb: 6 }
      }),
      priority: 55,
    })
  }

  // Wide dynamics → compressor and/or auto level.
  if (metrics.dynamicRangeDb > DYNAMICS_MAX_DB) {
    const needComp = !(v.comp.on && v.comp.ratio >= 3)
    const needAuto = metrics.dynamicRangeDb > DYNAMICS_AUTOLEVEL_DB && !v.autoLevel.on
    if (needComp || needAuto) {
      const ratio = metrics.dynamicRangeDb > DYNAMICS_AUTOLEVEL_DB ? 4 : 3
      out.push({
        id: 'dynamics',
        title: '响的地方和轻的地方差别大',
        detail: `这次录音大声和小声的句子相差约 ${fmt(metrics.dynamicRangeDb)} dB，轻的句子容易被伴奏盖住。${needComp ? `压缩器（${ratio}:1）会把音量收得更平稳` : ''}${needComp && needAuto ? '，' : ''}${needAuto ? '逐句自动音量会把轻的句子托起来' : ''}。`,
        module: needComp ? 'comp' : 'autoLevel',
        apply: edit((m) => {
          if (needComp) {
            const c = m.vocal.comp
            m.vocal.comp = { ...c, on: true, ratio: Math.max(c.on ? c.ratio : 0, ratio), thresholdDb: Math.min(c.thresholdDb, -20), makeupDb: Math.max(c.makeupDb, 3) }
          }
          if (needAuto) m.vocal.autoLevel = { ...m.vocal.autoLevel, on: true }
        }),
        priority: 50,
      })
    }
  }

  // Masking → vocal pocket and/or ducking.
  if (metrics.masking > MASKING_MAX) {
    const needPocket = !mix.backing.pocket.on
    const needDuck = metrics.masking > MASKING_DUCK && !mix.backing.duck.on
    if (needPocket || needDuck) {
      out.push({
        id: 'masking',
        title: '伴奏挡住了人声',
        detail: `在决定清晰度的 1–5 kHz，伴奏覆盖了人声约 ${pct(metrics.masking)}。${needPocket ? '人声口袋会在伴奏的 3 kHz 一带让出空间' : ''}${needPocket && needDuck ? '，' : ''}${needDuck ? '闪避会在唱的时候让伴奏稍微退后' : ''}。`,
        module: needPocket ? 'pocket' : 'duck',
        apply: edit((m) => {
          if (needPocket) m.backing.pocket = { on: true, freq: 3000, amountDb: Math.max(3, m.backing.pocket.amountDb) }
          if (needDuck) m.backing.duck = { ...m.backing.duck, on: true, amountDb: Math.max(2, m.backing.duck.amountDb) }
        }),
        priority: 45,
      })
    }
  }

  // Muddy low mids → EQ band 1 cut.
  const b1 = v.eq.bands[1]
  const mudHandled = v.eq.on && b1 !== undefined && b1.type === 'peaking' && b1.freq >= 200 && b1.freq <= 400 && b1.gainDb <= -2
  if (b.lowMid > LOWMID_SHARE_MAX && !mudHandled) {
    const cut = b.lowMid > 0.75 ? 4 : 3
    out.push({
      id: 'muddy',
      title: '声音有点闷、发浑',
      detail: `120–500 Hz 占人声能量的 ${pct(b.lowMid)}，声音容易显得浑、像在盒子里。在 300 Hz 处减 ${cut} dB 能让人声更清爽。`,
      module: 'eq',
      apply: edit((m) => {
        m.vocal.eq.on = true
        const band = eqBand(m, 1)
        band.type = 'peaking'
        band.freq = 300
        band.q = 1.2
        band.gainDb = Math.min(band.gainDb, -cut)
      }),
      priority: 40,
    })
  }

  // Dull → presence / air boost.
  const bright = b.presence + b.air
  const b2 = v.eq.bands[2]
  const b3 = v.eq.bands[3]
  const brightHandled = v.eq.on && ((b2?.gainDb ?? 0) >= 2 || (b3?.gainDb ?? 0) >= 2)
  if (hasVoice && bright < BRIGHT_SHARE_MIN && !brightHandled) {
    out.push({
      id: 'dull',
      title: '声音不够亮',
      detail: `2 kHz 以上只占人声能量的 ${pct(bright)}，听起来有点闷。稍微提升 3 kHz 的临场感和 10 kHz 的空气感，字会更清楚。`,
      module: 'eq',
      apply: edit((m) => {
        m.vocal.eq.on = true
        const p = eqBand(m, 2)
        p.type = 'peaking'
        p.freq = 3000
        p.q = 1
        p.gainDb = Math.max(p.gainDb, 2)
        const a = eqBand(m, 3)
        a.type = 'highshelf'
        a.freq = 10000
        a.q = 0.7
        a.gainDb = Math.max(a.gainDb, 2.5)
      }),
      priority: 35,
    })
  }

  // Quiet overall mix → master loudness target.
  if (hasVoice && mix.master.targetLufs === null) {
    const mixDb = powerSumDb(metrics.voiceDb + v.gainDb, Number.isFinite(metrics.backingDb) ? metrics.backingDb + mix.backing.gainDb : -Infinity) + mix.master.gainDb
    if (mixDb < MIX_QUIET_DB) {
      out.push({
        id: 'loudness',
        title: '整体音量偏小',
        detail: `混音整体大约只有 ${fmt(mixDb)} dB，比常见歌曲小不少。把总输出设到 −14 LUFS（各大音乐平台的常用响度），听起来会和其它歌一样响。`,
        module: 'master',
        apply: edit((m) => {
          m.master.targetLufs = -14
        }),
        priority: 30,
      })
    }
  }

  return out.sort((x, y) => y.priority - x.priority)
}
