import type { ScoreArtist } from '@/songs/scoreLibraryTypes'

export type ArtistSort = 'name' | 'count'

/** Pinyin collation for Chinese names, plain order for Latin ones. */
const collator = new Intl.Collator('zh-Hans-u-co-pinyin', { numeric: true })

/** The A–Z letter of an artist ('#' for everything else). */
export function initialOf(a: Pick<ScoreArtist, 'initial'>): string {
  return (a.initial || '#').toUpperCase()
}

function letterRank(letter: string): number {
  return /^[A-Z]$/.test(letter) ? letter.charCodeAt(0) : 1000
}

export function sortArtists(list: ScoreArtist[], mode: ArtistSort): ScoreArtist[] {
  const copy = [...list]
  if (mode === 'count') {
    return copy.sort((a, b) => b.songs - a.songs || collator.compare(a.name, b.name))
  }
  return copy.sort(
    (a, b) =>
      letterRank(initialOf(a)) - letterRank(initialOf(b)) || collator.compare(a.name, b.name),
  )
}

/** Consecutive runs of the same letter, in order. */
export function groupByInitial<T extends Pick<ScoreArtist, 'initial'>>(
  list: T[],
): Array<{ letter: string; items: T[] }> {
  const out: Array<{ letter: string; items: T[] }> = []
  for (const item of list) {
    const letter = initialOf(item)
    const last = out[out.length - 1]
    if (last && last.letter === letter) last.items.push(item)
    else out.push({ letter, items: [item] })
  }
  return out
}
