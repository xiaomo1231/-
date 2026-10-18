import type * as AlphaTabNs from '@coderline/alphatab'
import type { AlphaTabApi, model } from '@coderline/alphatab'
import { stripSiteAds } from '../lib/format'

export type AlphaTab = typeof AlphaTabNs
export type Score = model.Score

declare global {
  interface Window {
    alphaTab?: AlphaTab
    ALPHATAB_ROOT?: string
    ALPHATAB_FONT?: string
  }
}

/** Absolute URLs alphaTab needs (it starts its workers from the script file). */
export function alphaTabUrls(): { script: string; fonts: string; soundFont: string } {
  const abs = (p: string) => new URL(p, window.location.href).href
  return {
    script: abs('/alphatab/alphaTab.min.js'),
    fonts: abs('/alphatab/font/'),
    soundFont: abs('/alphatab/soundfont/sonivox.sf2'),
  }
}

let loading: Promise<AlphaTab> | null = null

/** Loads the alphaTab script once, as a classic script (its workers start from the same file). */
export function loadAlphaTab(): Promise<AlphaTab> {
  if (window.alphaTab) return Promise.resolve(window.alphaTab)
  if (loading) return loading
  loading = new Promise<AlphaTab>((resolve, reject) => {
    const urls = alphaTabUrls()
    window.ALPHATAB_ROOT = urls.script
    window.ALPHATAB_FONT = urls.fonts
    const el = document.createElement('script')
    el.src = urls.script
    el.async = true
    el.onload = () => {
      if (window.alphaTab) resolve(window.alphaTab)
      else reject(new Error('乐谱组件加载后没有就绪。请刷新页面再试。'))
    }
    el.onerror = () => reject(new Error('乐谱组件没能加载。请刷新页面再试。'))
    document.head.appendChild(el)
  }).catch((e: unknown) => {
    loading = null
    throw e
  })
  return loading
}

const CJK = /[㐀-鿿]/
const BAD = /�/g
const LATIN_HIGH = /[\u0080-ÿ]/g

/** The texts a wrong encoding would garble. */
function scoreTexts(score: Score): string[] {
  const out = [
    score.title,
    score.subTitle,
    score.artist,
    score.album,
    score.words,
    score.music,
    score.copyright,
    score.tab,
    score.instructions,
    score.notices,
  ]
  for (const t of score.tracks) out.push(t.name, t.shortName)
  for (const mb of score.masterBars.slice(0, 400))
    if (mb.section) out.push(mb.section.text, mb.section.marker)
  for (const t of score.tracks.slice(0, 4))
    for (const s of t.staves)
      for (const bar of s.bars.slice(0, 200))
        for (const v of bar.voices) for (const b of v.beats) if (b.text) out.push(b.text)
  return out.filter((x): x is string => typeof x === 'string' && x.length > 0)
}

/** How broken the texts look: replacement characters, or Latin-1 letters where no Chinese is left. */
function garbleScore(texts: readonly string[]): number {
  let bad = 0
  for (const t of texts) {
    bad += (t.match(BAD) ?? []).length * 2
    if (!CJK.test(t)) bad += (t.match(LATIN_HIGH) ?? []).length
  }
  return bad
}

function loadWith(at: AlphaTab, bytes: Uint8Array, encoding: string): Score | null {
  try {
    const settings = new at.Settings()
    settings.importer.encoding = encoding
    return at.importer.ScoreLoader.loadScoreFromBytes(bytes, settings)
  } catch {
    return null
  }
}

/**
 * Guitar Pro 3–5 files from Chinese writers keep their texts in GBK: read with
 * UTF-8 first, and when the texts come out garbled try GBK and Big5.
 */
export function chooseEncoding(at: AlphaTab, bytes: Uint8Array): string {
  const first = loadWith(at, bytes, 'utf-8')
  if (!first) return 'utf-8'
  let best = { encoding: 'utf-8', bad: garbleScore(scoreTexts(first)) }
  if (best.bad === 0) return best.encoding
  for (const encoding of ['gbk', 'big5']) {
    const s = loadWith(at, bytes, encoding)
    if (!s) continue
    const bad = garbleScore(scoreTexts(s))
    if (bad < best.bad) best = { encoding, bad }
  }
  return best.encoding
}

/** Site adverts out of the header texts. */
export function cleanHeader(score: Score): void {
  score.title = stripSiteAds(score.title ?? '')
  score.subTitle = stripSiteAds(score.subTitle ?? '')
  score.artist = stripSiteAds(score.artist ?? '')
  score.album = stripSiteAds(score.album ?? '')
  score.words = stripSiteAds(score.words ?? '')
  score.music = stripSiteAds(score.music ?? '')
  score.tab = stripSiteAds(score.tab ?? '')
  score.copyright = stripSiteAds(score.copyright ?? '')
}

/**
 * Tempo marks that would print on top of each other (several changes inside half a bar,
 * as tab sites often write a ritardando) keep only the last one of each cluster, and a
 * mark that repeats the tempo already shown is hidden. Playback still follows every change.
 */
export function tidyTempoMarks(score: Score): void {
  const marks = score.masterBars.flatMap((mb, i) =>
    mb.tempoAutomations.map((a) => ({ a, at: i + (a.ratioPosition || 0) })),
  )
  let shown: number | null = null
  marks.forEach(({ a, at }, k) => {
    const next = marks[k + 1]
    const crowded = next !== undefined && next.at - at < 0.5
    const same = shown !== null && Math.abs(a.value - shown) < 0.5
    a.isVisible = a.isVisible && !crowded && !same
    if (a.isVisible) shown = a.value
  })
}

/** A staff's own transposition from the file, remembered before 变调 changes it. */
const fileTransposition = new WeakMap<object, number>()

/**
 * 变调 for one loaded score: the staves are offset, and the file's own
 * transposition is kept aside so that 0 restores it. Playback follows.
 */
export function applyTranspose(a: AlphaTabApi, score: Score, transpose: number): void {
  a.settings.notation.transpositionPitches = score.tracks.map((t) => {
    const st = t.staves[0]
    if (!st || st.isPercussion) return 0
    if (!fileTransposition.has(st)) fileTransposition.set(st, st.transpositionPitch)
    const own = fileTransposition.get(st) ?? 0
    for (const x of t.staves) x.transpositionPitch = own - transpose
    return transpose - own
  })
}

/**
 * Notation colours for the printed paper. The score is always drawn on the
 * light paper (the `.paper` surface), so these stay fixed in every theme.
 */
export function paperResources() {
  const ink = 'rgb(35, 27, 19)' // #231b13
  const staff = 'rgb(138, 125, 107)' // #8a7d6b
  const bar = 'rgb(154, 106, 31)' // #9a6a1f
  return {
    mainGlyphColor: ink,
    secondaryGlyphColor: ink,
    scoreInfoColor: ink,
    barNumberColor: bar,
    staffLineColor: staff,
    barSeparatorColor: staff,
  }
}
