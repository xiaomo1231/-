/**
 * Lead-guitar technique analysis on a pitch track (pure): how far a bend
 * reached and how long it was held, and the depth / rate of vibrato.
 */

export interface PitchPoint {
  /** Seconds. */
  t: number
  /** Fractional MIDI note, null when unvoiced. */
  midi: number | null
}

export interface BendResult {
  started: boolean
  reached: number | null
  /** Signed cents from the target (+ = over-bent). */
  errorCents: number | null
  /** Longest time held within ±30 cents of the target, ms. */
  heldMs: number
  ok: boolean
}

export const BEND_TOLERANCE = 25
export const BEND_HOLD_MS = 300

const percentile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]!
}

/** Longest run (ms) of consecutive voiced points satisfying `pred`. */
function longestRun(points: readonly PitchPoint[], pred: (m: number) => boolean): number {
  let best = 0
  let start: number | null = null
  let last = 0
  for (const p of points) {
    if (p.midi !== null && pred(p.midi)) {
      if (start === null) start = p.t
      last = p.t
      best = Math.max(best, last - start)
    } else start = null
  }
  return Math.round(best * 1000)
}

export function analyzeBend(points: readonly PitchPoint[], fromMidi: number, targetMidi: number): BendResult {
  const voiced = points.filter((p) => p.midi !== null && p.midi > fromMidi - 1 && p.midi < targetMidi + 1)
  const startIdx = voiced.findIndex((p) => Math.abs(p.midi! - fromMidi) <= 0.5)
  if (startIdx < 0) return { started: false, reached: null, errorCents: null, heldMs: 0, ok: false }
  const half = fromMidi + 0.5 * (targetMidi - fromMidi)
  const up = voiced.slice(startIdx).filter((p) => p.midi! >= half)
  if (up.length < 2) return { started: true, reached: null, errorCents: null, heldMs: 0, ok: false }
  const reached = percentile(
    up.map((p) => p.midi!),
    0.7,
  )
  const errorCents = Math.round((reached - targetMidi) * 100)
  const heldMs = longestRun(voiced.slice(startIdx), (m) => Math.abs(m - targetMidi) * 100 <= 30)
  return { started: true, reached, errorCents, heldMs, ok: Math.abs(errorCents) <= BEND_TOLERANCE && heldMs >= BEND_HOLD_MS }
}

export interface VibratoResult {
  /** Peak-to-peak width (10th–90th percentile), cents. */
  depthCents: number
  rateHz: number
  /** Seconds of usable sustained note. */
  seconds: number
  ok: boolean
}

export const VIBRATO_DEPTH: [number, number] = [15, 90]
export const VIBRATO_RATE: [number, number] = [3.5, 8]

export function analyzeVibrato(points: readonly PitchPoint[], centerMidi: number): VibratoResult {
  const v = points.filter((p): p is { t: number; midi: number } => p.midi !== null && Math.abs(p.midi - centerMidi) <= 1.5)
  if (v.length < 8) return { depthCents: 0, rateHz: 0, seconds: 0, ok: false }
  const seconds = v[v.length - 1]!.t - v[0]!.t
  // Remove slow drift with a centred moving average over 0.4 s.
  const dev = v.map((p) => {
    const win = v.filter((q) => Math.abs(q.t - p.t) <= 0.2)
    const base = win.reduce((s, q) => s + q.midi, 0) / win.length
    return (p.midi - base) * 100
  })
  const depthCents = Math.round(percentile(dev, 0.9) - percentile(dev, 0.1))
  // Count sign changes with a little hysteresis.
  let sign = 0
  let crossings = 0
  for (const d of dev) {
    const s = d > 3 ? 1 : d < -3 ? -1 : 0
    if (s !== 0 && sign !== 0 && s !== sign) crossings++
    if (s !== 0) sign = s
  }
  const rateHz = seconds > 0 ? Math.round((crossings / 2 / seconds) * 10) / 10 : 0
  return {
    depthCents,
    rateHz,
    seconds: Math.round(seconds * 10) / 10,
    ok: seconds >= 1 && depthCents >= VIBRATO_DEPTH[0] && depthCents <= VIBRATO_DEPTH[1] && rateHz >= VIBRATO_RATE[0] && rateHz <= VIBRATO_RATE[1],
  }
}

export function bendFeedback(r: BendResult, semitones: number): string {
  if (!r.started) return '没有听到起始音。先按好那一品，拨响后再推。'
  if (r.reached === null) return `音高没有升上去。用无名指推，中指、食指在后面一起帮忙，把弦往上推${semitones === 2 ? '一个全音' : '半个音'}。`
  if (r.errorCents! < -BEND_TOLERANCE) return `推得不够，还差 ${-r.errorCents!} 音分。推之前先在心里唱出目标音。`
  if (r.errorCents! > BEND_TOLERANCE) return `推过头了 ${r.errorCents} 音分。推到目标音就停住。`
  if (r.heldMs < BEND_HOLD_MS) return '音高推准了，但停留太短。推到位后保持住，让它唱一会儿。'
  return '推得很准，保持得也稳。'
}

export function vibratoFeedback(r: VibratoResult): string {
  if (r.seconds < 1) return '音持续得不够长。拨响后至少保持一秒，再加揉弦。'
  if (r.depthCents < VIBRATO_DEPTH[0]) return '揉弦幅度太小，几乎听不出来。手腕转动大一点，像拧门把手。'
  if (r.depthCents > VIBRATO_DEPTH[1]) return '幅度太大，听起来像跑调。收小一点，保持均匀。'
  if (r.rateHz < VIBRATO_RATE[0]) return '速度偏慢。试着跟着节拍器，每拍揉两下。'
  if (r.rateHz > VIBRATO_RATE[1]) return '速度太快，像在发抖。放松手腕，慢一点、宽一点。'
  return '幅度和速度都在常用范围里，揉得很有歌唱感。'
}
