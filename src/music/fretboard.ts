/**
 * Fretboard model shared by guitar and bass. A position is (string, fret);
 * strings are numbered from the lowest-pitched string (0) upward, which is
 * how tab is read bottom-to-top on screen.
 */
export interface Tuning {
  id: string
  name: string
  /** Open-string MIDI notes, lowest string first. */
  strings: readonly number[]
}

export const GUITAR_STANDARD: Tuning = { id: 'guitar-standard', name: '吉他标准调弦', strings: [40, 45, 50, 55, 59, 64] }
export const BASS_STANDARD: Tuning = { id: 'bass-standard', name: '贝斯标准调弦', strings: [28, 33, 38, 43] }

export interface FretPosition {
  string: number
  fret: number
  midi: number
}

export const MAX_FRET = 15

/** Every position that sounds `midi` (exact octave). */
export function positionsFor(midi: number, tuning: Tuning, maxFret = MAX_FRET): FretPosition[] {
  const out: FretPosition[] = []
  tuning.strings.forEach((open, s) => {
    const fret = midi - open
    if (fret >= 0 && fret <= maxFret) out.push({ string: s, fret, midi })
  })
  return out
}

/** All positions whose pitch class is in `pcs`, inside a fret window. */
export function positionsForPitchClasses(pcs: readonly number[], tuning: Tuning, minFret = 0, maxFret = 12): FretPosition[] {
  const set = new Set(pcs.map((p) => ((p % 12) + 12) % 12))
  const out: FretPosition[] = []
  tuning.strings.forEach((open, s) => {
    for (let f = minFret; f <= maxFret; f++) {
      const midi = open + f
      if (set.has(midi % 12)) out.push({ string: s, fret: f, midi })
    }
  })
  return out
}

/**
 * Pick one position per note for a melody with the lowest total hand
 * movement (dynamic programming over every candidate position). Moves of more
 * than four frets are penalised so the hand stays in one box; lower
 * positions win ties. Notes outside the instrument range come back null.
 */
export function fingerMelody(midis: readonly number[], tuning: Tuning, maxFret = 12): Array<FretPosition | null> {
  // First try "box" fingering: one hand position covering frets w..w+4 (plus
  // open strings). Pick the lowest box with the fewest string jumps.
  let bestBox: Array<FretPosition | null> | null = null
  let bestCost = Infinity
  for (let w = 0; w <= maxFret - 4; w++) {
    const chosen: Array<FretPosition | null> = []
    let cost = w * 0.4
    let prev: FretPosition | null = null
    let ok = true
    for (const m of midis) {
      const inBox = positionsFor(m, tuning, maxFret).filter((p) => p.fret === 0 || (p.fret >= w && p.fret <= w + 4))
      if (inBox.length === 0) {
        if (positionsFor(m, tuning, maxFret).length === 0) {
          chosen.push(null)
          continue
        }
        ok = false
        break
      }
      const pick: FretPosition = prev
        ? inBox.reduce((a, b) => (Math.abs(b.string - prev!.string) < Math.abs(a.string - prev!.string) ? b : a))
        : inBox.reduce((a, b) => (b.fret > a.fret && a.fret === 0 ? a : b.string < a.string ? b : a))
      if (prev) cost += Math.abs(pick.string - prev.string) + 0.1 * Math.abs(pick.fret - prev.fret)
      chosen.push(pick)
      prev = pick
    }
    if (ok && cost < bestCost) {
      bestCost = cost
      bestBox = chosen
    }
  }
  if (bestBox) return bestBox
  return fingerMelodyDp(midis, tuning, maxFret)
}

/** Fallback for melodies wider than one hand position. */
function fingerMelodyDp(midis: readonly number[], tuning: Tuning, maxFret: number): Array<FretPosition | null> {
  const options = midis.map((m) => positionsFor(m, tuning, maxFret))
  const step = (a: FretPosition, b: FretPosition): number => {
    const df = Math.abs(a.fret - b.fret)
    return df + 0.5 * Math.abs(a.string - b.string) + (df > 4 ? 3 : 0) + 0.05 * b.fret
  }
  // cost[i][k] = best cost ending at options[i][k]; back pointers to rebuild.
  const cost: number[][] = []
  const back: number[][] = []
  let prevIdx = -1
  options.forEach((opts, i) => {
    cost[i] = []
    back[i] = []
    opts.forEach((o, k) => {
      if (prevIdx < 0) {
        cost[i]![k] = 0.3 * o.fret
        back[i]![k] = -1
        return
      }
      let best = Infinity
      let arg = -1
      options[prevIdx]!.forEach((p, j) => {
        const c = cost[prevIdx]![j]! + step(p, o)
        if (c < best) {
          best = c
          arg = j
        }
      })
      cost[i]![k] = best
      back[i]![k] = arg
    })
    if (opts.length) prevIdx = i
  })
  const out: Array<FretPosition | null> = midis.map(() => null)
  // Walk back from the cheapest final position.
  let i = options.length - 1
  while (i >= 0 && options[i]!.length === 0) i--
  if (i < 0) return out
  let k = cost[i]!.indexOf(Math.min(...cost[i]!))
  while (i >= 0 && k >= 0) {
    out[i] = options[i]![k]!
    const prevK = back[i]![k]!
    i--
    while (i >= 0 && options[i]!.length === 0) i--
    k = prevK
  }
  return out
}

/** Lowest and highest MIDI notes playable on the instrument. */
export function tuningRange(tuning: Tuning, maxFret = MAX_FRET): { low: number; high: number } {
  return { low: Math.min(...tuning.strings), high: Math.max(...tuning.strings) + maxFret }
}

/** Fret numbers that carry inlay dots. */
export const INLAY_FRETS = [3, 5, 7, 9, 12, 15]

/**
 * Guitar chord shape. `frets` lists one entry per string, lowest first:
 * a fret number, 0 for open, or null for a muted string.
 */
export interface ChordShape {
  id: string
  symbol: string
  frets: ReadonlyArray<number | null>
  /** Barre: fret and the string range it covers (lowest..highest). */
  barre?: { fret: number; from: number; to: number }
}

export const OPEN_CHORDS: readonly ChordShape[] = [
  { id: 'C', symbol: 'C', frets: [null, 3, 2, 0, 1, 0] },
  { id: 'A', symbol: 'A', frets: [null, 0, 2, 2, 2, 0] },
  { id: 'G', symbol: 'G', frets: [3, 2, 0, 0, 0, 3] },
  { id: 'E', symbol: 'E', frets: [0, 2, 2, 1, 0, 0] },
  { id: 'D', symbol: 'D', frets: [null, null, 0, 2, 3, 2] },
  { id: 'Am', symbol: 'Am', frets: [null, 0, 2, 2, 1, 0] },
  { id: 'Em', symbol: 'Em', frets: [0, 2, 2, 0, 0, 0] },
  { id: 'Dm', symbol: 'Dm', frets: [null, null, 0, 2, 3, 1] },
  { id: 'F', symbol: 'F', frets: [1, 3, 3, 2, 1, 1], barre: { fret: 1, from: 0, to: 5 } },
  { id: 'E7', symbol: 'E7', frets: [0, 2, 0, 1, 0, 0] },
  { id: 'A7', symbol: 'A7', frets: [null, 0, 2, 0, 2, 0] },
  { id: 'D7', symbol: 'D7', frets: [null, null, 0, 2, 1, 2] },
  { id: 'G7', symbol: 'G7', frets: [3, 2, 0, 0, 0, 1] },
  { id: 'C7', symbol: 'C7', frets: [null, 3, 2, 3, 1, 0] },
  { id: 'B7', symbol: 'B7', frets: [null, 2, 1, 2, 0, 2] },
  { id: 'Am7', symbol: 'Am7', frets: [null, 0, 2, 0, 1, 0] },
  { id: 'Em7', symbol: 'Em7', frets: [0, 2, 0, 0, 0, 0] },
  { id: 'Dm7', symbol: 'Dm7', frets: [null, null, 0, 2, 1, 1] },
  { id: 'Cmaj7', symbol: 'Cmaj7', frets: [null, 3, 2, 0, 0, 0] },
  { id: 'Fmaj7', symbol: 'Fmaj7', frets: [null, null, 3, 2, 1, 0] },
  { id: 'Amaj7', symbol: 'Amaj7', frets: [null, 0, 2, 1, 2, 0] },
  { id: 'Asus2', symbol: 'Asus2', frets: [null, 0, 2, 2, 0, 0] },
  { id: 'Asus4', symbol: 'Asus4', frets: [null, 0, 2, 2, 3, 0] },
  { id: 'Dsus2', symbol: 'Dsus2', frets: [null, null, 0, 2, 3, 0] },
  { id: 'Dsus4', symbol: 'Dsus4', frets: [null, null, 0, 2, 3, 3] },
]

/** Movable shape offsets relative to the root fret, for E-shape and A-shape barre chords. */
const MOVABLE: Record<string, { eShape: Array<number | null>; aShape: Array<number | null> }> = {
  '': { eShape: [0, 2, 2, 1, 0, 0], aShape: [null, 0, 2, 2, 2, 0] },
  m: { eShape: [0, 2, 2, 0, 0, 0], aShape: [null, 0, 2, 2, 1, 0] },
  '7': { eShape: [0, 2, 0, 1, 0, 0], aShape: [null, 0, 2, 0, 2, 0] },
  m7: { eShape: [0, 2, 0, 0, 0, 0], aShape: [null, 0, 2, 0, 1, 0] },
  maj7: { eShape: [0, null, 1, 1, 0, null], aShape: [null, 0, 2, 1, 2, 0] },
  '5': { eShape: [0, 2, 2, null, null, null], aShape: [null, 0, 2, 2, null, null] },
}

/**
 * A playable shape for `rootPc` + quality suffix (`''`, `m`, `7`, `m7`,
 * `maj7`, `5`). Open shapes win when they exist; otherwise the lower of the
 * E-shape / A-shape barre positions.
 */
export function guitarChordShape(rootPc: number, suffix: string, rootName: string): ChordShape | null {
  const symbol = `${rootName}${suffix}`
  const open = OPEN_CHORDS.find((c) => c.symbol === symbol)
  if (open && suffix !== '5') return open
  const movable = MOVABLE[suffix]
  if (!movable) return null
  const pc = ((rootPc % 12) + 12) % 12
  const eRoot = (pc - 4 + 12) % 12 // fret of the root on the low E string
  const aRoot = (pc - 9 + 12) % 12 // fret of the root on the A string
  const useE = eRoot <= aRoot || eRoot === 0
  const rootFret = useE ? (eRoot === 0 ? 12 : eRoot) : aRoot === 0 ? 12 : aRoot
  const pattern = useE ? movable.eShape : movable.aShape
  // Power chords and open-position roots (fret 0) need no barre.
  const frets = pattern.map((p) => (p === null ? null : p + (useE ? eRoot : aRoot)))
  if ((useE ? eRoot : aRoot) === 0) {
    return { id: symbol, symbol, frets }
  }
  const played = frets.map((f, i) => (f === null ? -1 : i)).filter((i) => i >= 0)
  return {
    id: symbol,
    symbol,
    frets,
    ...(suffix === '5' ? {} : { barre: { fret: rootFret, from: played[0]!, to: played[played.length - 1]! } }),
  }
}

/** MIDI notes sounded by a shape (muted strings skipped). */
export function shapeNotes(shape: ChordShape, tuning: Tuning = GUITAR_STANDARD): number[] {
  const out: number[] = []
  shape.frets.forEach((f, s) => {
    if (f !== null) out.push(tuning.strings[s]! + f)
  })
  return out
}

/** Standard tuning for a fretted instrument, or null for keyboard / none. */
export function tuningForInstrument(instrument: string): Tuning | null {
  if (instrument === 'guitar') return GUITAR_STANDARD
  if (instrument === 'bass') return BASS_STANDARD
  return null
}

export type GuitarTuningId = 'standard' | 'dropD' | 'halfDown'

export const GUITAR_TUNINGS: Record<GuitarTuningId, Tuning> = {
  standard: GUITAR_STANDARD,
  dropD: { id: 'guitar-drop-d', name: 'Drop D（六弦降到 D）', strings: [38, 45, 50, 55, 59, 64] },
  halfDown: { id: 'guitar-half-down', name: '全弦降半音（E♭ 调弦）', strings: [39, 44, 49, 54, 58, 63] },
}

/**
 * A capo raises every open string; frets are then counted from the capo.
 * The returned tuning's open strings are the capoed pitches.
 */
export function withCapo(t: Tuning, capo: number): Tuning {
  if (!capo) return t
  return { id: `${t.id}-capo${capo}`, name: `${t.name} · 变调夹 ${capo} 品`, strings: t.strings.map((m) => m + capo) }
}

const SHAPE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

export interface SetupShape {
  shape: ChordShape
  /** e.g. "按 G 型" when the fingered shape differs from the sounding chord. */
  playedAs: string | null
}

/**
 * The chord shape to finger for a sounding chord. A capo (or tuning down a
 * half step) changes which shape you play; Drop D moves the sixth string up
 * two frets.
 */
export function shapeForSetup(rootPc: number, suffix: string, rootName: string, setup: { tuning: GuitarTuningId; capo: number }): SetupShape | null {
  const offset = setup.capo - (setup.tuning === 'halfDown' ? 1 : 0)
  if (!offset && setup.tuning !== 'dropD') {
    const shape = guitarChordShape(rootPc, suffix, rootName)
    return shape ? { shape, playedAs: null } : null
  }
  const shapePc = (((rootPc - offset) % 12) + 12) % 12
  const name = offset ? SHAPE_NAMES[shapePc]! : rootName
  const base = guitarChordShape(shapePc, suffix, name)
  if (!base) return null
  let shape = base
  if (setup.tuning === 'dropD' && base.frets[0] !== null && base.frets[0] !== undefined) {
    const frets = [...base.frets]
    frets[0] = frets[0]! + 2
    shape = { ...base, frets, ...(base.barre && base.barre.from === 0 ? { barre: { ...base.barre, from: 1 } } : {}) }
  }
  const pretty = name.replace('#', '♯').replace(/^([A-G])b/, '$1♭')
  return { shape, playedAs: offset ? `按 ${pretty}${suffix} 型` : null }
}
