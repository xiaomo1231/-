/**
 * 鼓谱模板生成 (pure): builds a drum part for a song from the template library
 * and the rhythm guide's bar facts. Deterministic for the same seed:
 * - the style is picked from meter, tempo, triplet feel and busyness;
 * - each section gets one groove (chorus sections a chorus variant), repeated;
 * - a section start gets a crash on step 0, a section end a fill;
 * - intro sections are sparser in their first half;
 * - guide breaks (2+ bars without onsets) become empty bars.
 */
import { barSteps, type DrumBar, type DrumPiece, type DrumStyle, type DrumTemplateLibrary, type SongBarInfo } from './drumTypes'
import { emptyBar, normalizeBar, setHit } from './drumPart'

export interface GenerateOptions {
  /** Template style id; null = pick automatically. */
  style: string | null
  seed: number
  /** 0-based inclusive bar range to return; the whole song is still planned. */
  range?: [number, number]
}

export interface GenerateResult {
  bars: DrumBar[]
  first: number
  style: string
}

interface Weighted {
  bars: DrumBar[]
  weight: number
}

type Kind = 'intro' | 'verse' | 'chorus' | 'outro'

interface Segment {
  start: number
  end: number
  kind: Kind
}

/** Small seeded PRNG (mulberry32): returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 === 1 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2
}

function meterKey(num: number, den: number): string {
  return `${num}/${den}`
}

function meterMatches(bar: SongBarInfo, style: DrumStyle): boolean {
  return meterKey(bar.num, bar.den) === style.meter
}

function hasName(name: string | null): name is string {
  return typeof name === 'string' && name.trim() !== ''
}

function kindOf(name: string | null): Kind {
  if (!hasName(name)) return 'verse'
  if (/chorus|副歌|高潮|refrain/i.test(name)) return 'chorus'
  if (/intro|前奏/i.test(name)) return 'intro'
  if (/outro|尾奏|结尾/i.test(name)) return 'outro'
  return 'verse'
}

/** Sections: from the song's section markers, else fixed phrases (4 bars if the song is under 8). */
function segmentsOf(song: SongBarInfo[]): Segment[] {
  const n = song.length
  const marked = song.map(b => hasName(b.section))
  const starts: number[] = []
  if (marked.some(Boolean)) {
    marked.forEach((m, i) => {
      if (m || i === 0) starts.push(i)
    })
  } else {
    const len = n < 8 ? 4 : 8
    for (let s = 0; s < n; s += len) starts.push(s)
  }
  return starts.map((start, k) => ({
    start,
    end: (starts[k + 1] ?? n) - 1,
    kind: kindOf(song[start]?.section ?? null),
  }))
}

/** True for bars inside a run of 2+ bars without guide onsets (a rest / break). */
function breakFlags(song: SongBarInfo[]): boolean[] {
  const n = song.length
  const flags = song.map(() => false)
  let i = 0
  while (i < n) {
    if (song[i]?.onsets.length) {
      i++
      continue
    }
    let j = i
    while (j < n && song[j]?.onsets.length === 0) j++
    if (j - i >= 2) for (let k = i; k < j; k++) flags[k] = true
    i = j
  }
  return flags
}

function styleHits(style: DrumStyle): number {
  const bars = style.grooves.flatMap(g => g.bars)
  if (bars.length === 0) return 0
  return bars.reduce((t, b) => t + b.hits.length, 0) / bars.length
}

function styleIsTriplet(style: DrumStyle): boolean {
  return style.grooves.some(g => g.bars.some(b => b.stepsPerQuarter !== 4))
}

/** Pick the style by meter (strongest), tempo, triplet feel and busyness; ties keep library order. */
function chooseStyle(song: SongBarInfo[], styles: DrumStyle[], id: string | null): DrumStyle {
  if (id !== null) {
    const found = styles.find(s => s.id === id)
    if (!found) throw new Error(`找不到鼓型：${id}`)
    return found
  }
  const meters = new Map<string, number>()
  for (const b of song) {
    const key = meterKey(b.num, b.den)
    meters.set(key, (meters.get(key) ?? 0) + 1)
  }
  let dominant = '4/4'
  let most = 0
  for (const [key, count] of meters) {
    if (count > most) {
      dominant = key
      most = count
    }
  }
  const tempo = median(song.map(b => b.bpm))
  const tripletShare = song.length ? song.filter(b => b.triplet).length / song.length : 0
  const wantTriplet = tripletShare >= 0.3
  const busy = median(song.map(b => b.onsets.length)) >= 10

  let best = styles[0] as DrumStyle
  let bestScore = -Infinity
  for (const s of styles) {
    const score =
      (s.meter === dominant ? 8 : 0) +
      (tempo >= s.minBpm && tempo <= s.maxBpm ? 2 : 0) +
      (styleIsTriplet(s) === wantTriplet ? 2 : 0) +
      ((styleHits(s) >= 10) === busy ? 2 : 0)
    if (score > bestScore) {
      best = s
      bestScore = score
    }
  }
  return best
}

/** Weighted pick with the seeded PRNG; patterns with no bars are never picked. */
function pick(list: Weighted[], rng: () => number): Weighted | undefined {
  const usable = list.filter(p => p.bars.length > 0)
  if (usable.length === 0) return undefined
  const weightOf = (p: Weighted) => Math.max(0, p.weight)
  const total = usable.reduce((t, p) => t + weightOf(p), 0)
  if (total <= 0) return usable[Math.floor(rng() * usable.length)]
  let r = rng() * total
  for (const p of usable) {
    r -= weightOf(p)
    if (r < 0) return p
  }
  return usable[usable.length - 1]
}

function patternAt(p: Weighted, k: number): DrumBar | undefined {
  return p.bars[k % p.bars.length]
}

/** A template bar on the song bar's meter (grid copied from the template). */
function gridBar(tpl: DrumBar, bar: SongBarInfo): DrumBar {
  return normalizeBar({
    num: bar.num,
    den: bar.den,
    stepsPerQuarter: tpl.stepsPerQuarter,
    hits: tpl.hits,
  })
}

/**
 * Plain bar for a meter the style does not fit: hi-hat on every eighth, kick on
 * beat 1, snare on the last beat for odd meters and on beats 2 and last for even ones.
 */
function fitBar(bar: SongBarInfo): DrumBar {
  let b = emptyBar(bar.num, bar.den, 4)
  const steps = barSteps(b)
  for (let s = 0; s < steps; s += 2) b = setHit(b, s, 'hihatClosed', 2)
  b = setHit(b, 0, 'kick', 2)
  const beats = bar.num % 2 === 1 ? [bar.num - 1] : [1, bar.num - 1]
  for (const beat of new Set(beats)) {
    if (beat < 0 || beat >= bar.num) continue
    b = setHit(b, Math.round(((beat * 4) / bar.den) * 4), 'snare', 2)
  }
  return b
}

/** Sparser intro: kick, snare and closed hi-hat on quarter notes only. */
function sparse(bar: DrumBar): DrumBar {
  const keep = new Set<DrumPiece>(['kick', 'snare', 'hihatClosed'])
  return normalizeBar({
    ...bar,
    hits: bar.hits.filter(h => keep.has(h.piece) && h.step % bar.stepsPerQuarter === 0),
  })
}

/** Section start / first bar after a break: crash on step 0 in place of the hi-hat or ride there. */
function withCrash(bar: DrumBar): DrumBar {
  let b = bar
  for (const piece of ['hihatClosed', 'hihatOpen', 'ride'] as const) b = setHit(b, 0, piece, 0)
  return setHit(b, 0, 'crash', 3)
}

function emptyFor(bar: SongBarInfo, style: DrumStyle, styleGrid: DrumBar['stepsPerQuarter']): DrumBar {
  return emptyBar(bar.num, bar.den, meterMatches(bar, style) ? styleGrid : 4)
}

/**
 * Generate a drum part for the song. The whole song is planned (so sections, styles
 * and random picks do not depend on `range`); only the requested bars are returned.
 */
export function generateFromTemplates(song: SongBarInfo[], lib: DrumTemplateLibrary, opts: GenerateOptions): GenerateResult {
  if (lib.styles.length === 0) throw new Error('鼓型模板库是空的')
  const style = chooseStyle(song, lib.styles, opts.style)
  const n = song.length
  const rng = mulberry32(opts.seed)
  const breaks = breakFlags(song)
  const styleGrid: DrumBar['stepsPerQuarter'] = style.grooves[0]?.bars[0]?.stepsPerQuarter ?? 4
  const out: DrumBar[] = []

  for (const seg of segmentsOf(song)) {
    const len = seg.end - seg.start + 1
    const groove =
      (seg.kind === 'chorus' ? pick(style.chorus, rng) : undefined) ?? pick(style.grooves, rng)
    const fill = len >= 3 ? pick(style.fills, rng) : undefined
    for (let i = seg.start; i <= seg.end; i++) {
      const bar = song[i]
      if (!bar) continue
      const off = i - seg.start
      let b: DrumBar
      if (breaks[i]) {
        b = emptyFor(bar, style, styleGrid)
      } else if (!meterMatches(bar, style)) {
        b = fitBar(bar)
      } else if (fill && i === seg.end) {
        const fb = patternAt(fill, 0)
        b = fb ? gridBar(fb, bar) : fitBar(bar)
      } else {
        const g = groove ? patternAt(groove, off) : undefined
        if (g) {
          b = gridBar(g, bar)
          if (seg.kind === 'intro' && off < Math.ceil(len / 2)) b = sparse(b)
        } else {
          b = fitBar(bar)
        }
      }
      if (!breaks[i] && off === 0 && !(i === 0 && seg.kind === 'intro')) b = withCrash(b)
      out[i] = b
    }
  }

  // the first bar after a break gets a crash
  for (let i = 1; i < n; i++) {
    const cur = out[i]
    if (breaks[i - 1] && !breaks[i] && cur) out[i] = withCrash(cur)
  }

  const r0 = opts.range ? opts.range[0] : 0
  const r1 = opts.range ? opts.range[1] : n - 1
  const first = Math.max(0, Math.min(n - 1, Math.floor(r0)))
  const last = Math.max(0, Math.min(n - 1, Math.floor(r1)))
  const bars = first > last ? [] : out.slice(first, last + 1)
  return { bars, first, style: style.id }
}
