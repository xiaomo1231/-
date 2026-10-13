/**
 * Guitar Pro 3–5 files store their texts (title, track names, sections,
 * notes, lyrics) in the writer's local code page — for Chinese tabs usually
 * GBK — but alphaTab decodes them as UTF-8 by default, which turns them into
 * "����". Here the file is read with UTF-8 first; when its texts look broken
 * it is read again with GBK and Big5 and the cleanest result wins.
 */
import type * as AlphaTabNs from '@coderline/alphatab'
import type { model } from '@coderline/alphatab'

type AlphaTabGlobal = typeof AlphaTabNs

const CJK = /[㐀-鿿]/
const BAD = /[�]/g
const LATIN_HIGH = /[\u0080-ÿ]/g

/** The texts of a score that a wrong encoding would garble. */
export function scoreTexts(score: model.Score): string[] {
  const out = [score.title, score.subTitle, score.artist, score.album, score.words, score.music, score.copyright, score.tab, score.instructions, score.notices]
  for (const t of score.tracks) out.push(t.name, t.shortName)
  for (const mb of score.masterBars.slice(0, 400)) if (mb.section) out.push(mb.section.text, mb.section.marker)
  for (const t of score.tracks.slice(0, 4))
    for (const s of t.staves)
      for (const bar of s.bars.slice(0, 200))
        for (const v of bar.voices) for (const b of v.beats) if (b.text) out.push(b.text)
  return out.filter((x): x is string => typeof x === 'string' && x.length > 0)
}

/** How broken the texts look: replacement characters, or Latin-1 letters where no Chinese is left. */
export function garbleScore(texts: readonly string[]): number {
  let bad = 0
  for (const t of texts) {
    bad += (t.match(BAD) ?? []).length * 2
    if (!CJK.test(t)) bad += (t.match(LATIN_HIGH) ?? []).length
  }
  return bad
}

function loadWith(at: AlphaTabGlobal, bytes: Uint8Array, encoding: string): model.Score | null {
  try {
    const settings = new at.Settings()
    settings.importer.encoding = encoding
    return at.importer.ScoreLoader.loadScoreFromBytes(bytes, settings)
  } catch {
    return null
  }
}

/** Read a score with the text encoding that gives the cleanest texts. Throws when the file cannot be read at all. */
export function loadScoreDecoded(at: AlphaTabGlobal, bytes: Uint8Array): { score: model.Score; encoding: string } {
  const first = loadWith(at, bytes, 'utf-8')
  if (!first) throw new Error('cannot read score')
  let best = { score: first, encoding: 'utf-8', bad: garbleScore(scoreTexts(first)) }
  if (best.bad === 0) return best
  for (const encoding of ['gbk', 'big5']) {
    const s = loadWith(at, bytes, encoding)
    if (!s) continue
    const bad = garbleScore(scoreTexts(s))
    if (bad < best.bad) best = { score: s, encoding, bad }
  }
  return best
}
