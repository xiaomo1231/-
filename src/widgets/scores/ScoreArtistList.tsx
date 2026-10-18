import { useMemo, useRef } from 'react'
import type { ScoreArtist, ScoreGroup } from '@/songs/scoreLibraryTypes'
import { cn } from '@/shared/lib/utils'

export type ArtistSort = 'count' | 'name'

const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#']

interface Props {
  group: ScoreGroup
  /** Already sorted by the page. */
  artists: ScoreArtist[] | null
  sort: ArtistSort
  onSort: (sort: ArtistSort) => void
  activeArtistId: string | undefined
  onPick: (artist: ScoreArtist) => void
}

/**
 * Middle column: the group's artists or works. The A–Z bar jumps to the first
 * artist with that initial; letters with no artist are dimmed.
 */
export function ScoreArtistList({ group, artists, sort, onSort, activeArtistId, onPick }: Props) {
  // First row index for each initial, so the letter bar can find its target.
  const firstIndex = useMemo(() => {
    const map = new Map<string, number>()
    artists?.forEach((a, i) => {
      if (!map.has(a.initial)) map.set(a.initial, i)
    })
    return map
  }, [artists])

  const jump = (letter: string, list: HTMLElement | null) => {
    const el = list?.querySelector<HTMLElement>(`[data-first="${letter}"]`)
    if (list && el) list.scrollTo({ top: el.offsetTop, behavior: 'smooth' })
  }

  // The list scrolls inside its own box, so it is the positioned offset parent.
  const listRef = useRef<HTMLDivElement>(null)

  return (
    <section aria-label={`${group.name}的${group.noun}`} className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2 pt-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{group.name}</h2>
          <p className="num text-xs text-muted-foreground">
            {group.artists.toLocaleString()} 个{group.noun}
          </p>
        </div>
        <div className="flex gap-1 text-xs" role="group" aria-label="排序">
          {(
            [
              ['count', '按谱子数量'],
              ['name', '按名称'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={sort === key}
              onClick={() => onSort(key)}
              className={cn(
                'focus-ring rounded-full border px-2.5 py-1',
                sort === key
                  ? 'border-amber/70 bg-amber-soft/40 text-foreground'
                  : 'border-border text-muted-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-0.5 px-3 pb-2" aria-label="按首字母跳转">
        {LETTERS.map((letter) => {
          const present = firstIndex.has(letter)
          return (
            <button
              key={letter}
              type="button"
              disabled={!present}
              onClick={() => jump(letter, listRef.current)}
              aria-label={`跳到 ${letter}`}
              className={cn(
                'focus-ring h-5 w-5 rounded text-[11px] leading-5',
                present ? 'text-foreground hover:bg-muted' : 'text-muted-foreground/40',
              )}
            >
              {letter}
            </button>
          )
        })}
      </div>

      {artists === null ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">正在读取…</p>
      ) : artists.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">这里还没有内容。</p>
      ) : (
        <div
          ref={listRef}
          className="relative max-h-[50vh] overflow-y-auto px-2 pb-2 lg:max-h-[600px]"
        >
          <ul>
            {artists.map((a, i) => {
              const active = a.id === activeArtistId
              const first = firstIndex.get(a.initial) === i
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => onPick(a)}
                    aria-current={active}
                    data-first={first ? a.initial : undefined}
                    className={cn(
                      'focus-ring flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted/60',
                      active && 'bg-amber-soft/50 font-medium text-foreground',
                    )}
                  >
                    <span className="min-w-0 truncate">{a.name}</span>
                    <span className="num shrink-0 text-xs text-muted-foreground">
                      {a.files.toLocaleString()}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
