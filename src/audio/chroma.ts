/**
 * Chord recognition hint (pure). The spectrum of a strum is folded into the
 * 12 pitch classes (a chroma vector) and compared with chord templates.
 * It is shown as a hint only, never scored: distortion, open-string
 * resonance and room noise all blur the chroma.
 */

export type HintQuality = 'maj' | 'min' | '5' | '7' | 'm7'

const TEMPLATES: Record<HintQuality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  '5': [0, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
}

const SUFFIX: Record<HintQuality, string> = { maj: '', min: 'm', '5': '5', '7': '7', m7: 'm7' }
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

export interface ChordHint {
  rootPc: number
  quality: HintQuality
  label: string
  /** Cosine similarity of the best template, 0–1. */
  score: number
  /** Margin over the best template with a different root or family, 0–1. */
  confidence: number
}

/**
 * Fold an analyser spectrum (dB per bin, from getFloatFrequencyData) into a
 * normalised 12-bin chroma. Bins below `floorDb` are ignored.
 */
export function chromaFromSpectrum(db: ArrayLike<number>, sampleRate: number, fftSize: number, opts: { minHz?: number; maxHz?: number; floorDb?: number } = {}): number[] {
  const { minHz = 70, maxHz = 1600, floorDb = -85 } = opts
  const chroma = new Array<number>(12).fill(0)
  const binHz = sampleRate / fftSize
  const lo = Math.max(1, Math.floor(minHz / binHz))
  const hi = Math.min(db.length - 1, Math.ceil(maxHz / binHz))
  for (let k = lo; k <= hi; k++) {
    const d = db[k]!
    if (!(d > floorDb)) continue
    // Only spectral peaks count: they are the partials, not their skirts.
    if (!(d >= db[k - 1]! && d >= db[k + 1]!)) continue
    const f = k * binHz
    const midi = 69 + 12 * Math.log2(f / 440)
    const pc = ((Math.round(midi) % 12) + 12) % 12
    // Lower partials carry the harmony; weight them more.
    chroma[pc]! += Math.pow(10, d / 20) * (1 / Math.sqrt(f / minHz))
  }
  const max = Math.max(...chroma)
  return max > 0 ? chroma.map((c) => c / max) : chroma
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < 12; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

const family = (q: HintQuality) => (q === 'min' || q === 'm7' ? 'minor' : q === '5' ? 'power' : 'major')

/** Best matching chord, or null for silence. */
export function matchChord(chroma: readonly number[]): ChordHint | null {
  if (chroma.every((c) => c === 0)) return null
  const scored: Array<{ rootPc: number; quality: HintQuality; score: number }> = []
  for (let r = 0; r < 12; r++) {
    for (const q of Object.keys(TEMPLATES) as HintQuality[]) {
      const t = new Array<number>(12).fill(0)
      TEMPLATES[q].forEach((iv, i) => (t[(r + iv) % 12] = i === 0 ? 1.2 : 1))
      // Simpler chords win ties: a small penalty per extra tone.
      scored.push({ rootPc: r, quality: q, score: cosine(chroma, t) - 0.015 * (TEMPLATES[q].length - 3) })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]!
  const rival = scored.find((s) => s.rootPc !== best.rootPc || family(s.quality) !== family(best.quality))
  return {
    rootPc: best.rootPc,
    quality: best.quality,
    label: NAMES[best.rootPc]! + SUFFIX[best.quality],
    score: Math.max(0, best.score),
    confidence: Math.max(0, best.score - (rival?.score ?? 0)),
  }
}

/** Does the hint agree with an expected chord symbol (same root and family; power chords match either family)? */
export function hintAgrees(hint: Pick<ChordHint, 'rootPc' | 'quality'>, expected: { rootPc: number; suffix: string }): boolean {
  if (hint.rootPc !== expected.rootPc) return false
  const exp: HintQuality = expected.suffix.startsWith('m7') ? 'm7' : expected.suffix.startsWith('m') ? 'min' : expected.suffix === '5' ? '5' : expected.suffix === '7' ? '7' : 'maj'
  if (exp === '5' || hint.quality === '5') return true
  return family(exp) === family(hint.quality)
}
