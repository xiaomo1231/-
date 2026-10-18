import { useEffect, useMemo, useState } from 'react'
import type { ScoreArtist } from '@/songs/scoreLibraryTypes'
import { api } from '../lib/api'
import { PAGE_SIZE, PANEL, cx } from '../lib/classes'
import { hrefArtist } from '../lib/route'
import { useLibrary } from '../lib/libraryContext'
import { groupByInitial, initialOf, sortArtists, type ArtistSort } from '../lib/sort'
import { useLoad } from '../lib/useLoad'
import { Link } from '../components/Link'
import { LoadMore, Notice, PageBar } from '../components/ui'

export interface GroupRoute {
  id: string
  name: string
  noun: string
}

/** The artists of one group (歌手 / 乐队…), with an A–Z jump on the right. */
export function ArtistsPage({ group }: { group: GroupRoute }) {
  const { version } = useLibrary()
  const [sort, setSort] = useState<ArtistSort>('name')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [jump, setJump] = useState<string | null>(null)
  const state = useLoad(
    (signal) => api.artists(group.id, signal),
    `artists\n${group.id}\n${version}`,
  )

  const sorted = useMemo(
    () => (state.status === 'ready' ? sortArtists(state.data, sort) : []),
    [state, sort],
  )
  const shown = sorted.slice(0, limit)
  const letters = useMemo(() => [...new Set(sorted.map(initialOf))], [sorted])

  // After a letter tap, scroll to its section once it is on screen.
  useEffect(() => {
    if (!jump) return
    document.getElementById(`sec-${jump}`)?.scrollIntoView({ block: 'start' })
    setJump(null)
  }, [jump, limit])

  const jumpTo = (letter: string) => {
    const index = sorted.findIndex((a) => initialOf(a) === letter)
    if (index < 0) return
    if (index >= limit) setLimit(Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE)
    setJump(letter)
  }

  const count = state.status === 'ready' ? `${state.data.length} 位${group.noun}` : undefined

  return (
    <>
      <PageBar title={group.name} subtitle={count} fallback="#/" />

      {state.status === 'loading' && (
        <p className="py-10 text-center text-sm text-muted-foreground">正在读取…</p>
      )}
      {state.status === 'error' && <Notice tone="error">{state.message}</Notice>}

      {state.status === 'ready' && sorted.length === 0 && (
        <Notice>这个分组里还没有{group.noun}。</Notice>
      )}

      {sorted.length > 0 && (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex justify-end">
              <div
                role="group"
                aria-label="排序"
                className="inline-flex rounded-xl border border-border p-0.5 text-sm"
              >
                {(
                  [
                    ['name', '按名字'],
                    ['count', '按谱子数'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={sort === value}
                    onClick={() => setSort(value)}
                    className={cx(
                      'min-h-9 rounded-lg px-3 transition-colors',
                      sort === value
                        ? 'bg-primary-strong text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {sort === 'name' ? (
              groupByInitial(shown).map((section) => (
                <section key={section.letter} id={`sec-${section.letter}`}>
                  <h2 className="px-1 pb-1 text-xs font-semibold text-muted-foreground">
                    {section.letter}
                  </h2>
                  <ArtistRows artists={section.items} />
                </section>
              ))
            ) : (
              <ArtistRows artists={shown} />
            )}

            {sorted.length > limit && (
              <LoadMore
                remaining={sorted.length - limit}
                onMore={() => setLimit((n) => n + PAGE_SIZE)}
              />
            )}
          </div>

          {sort === 'name' && letters.length > 0 && (
            <nav
              aria-label="按字母跳转"
              className="sticky top-28 flex shrink-0 flex-col items-center py-1"
            >
              {letters.map((letter) => (
                <button
                  key={letter}
                  type="button"
                  onClick={() => jumpTo(letter)}
                  className="relative h-7 w-7 rounded-md text-xs font-semibold text-primary before:absolute before:-inset-2 before:content-[''] hover:bg-accent"
                >
                  {letter}
                </button>
              ))}
            </nav>
          )}
        </div>
      )}
    </>
  )
}

function ArtistRows({ artists }: { artists: ScoreArtist[] }) {
  return (
    <ul className={cx(PANEL, 'divide-y divide-border/60 overflow-hidden')}>
      {artists.map((a) => (
        <li key={a.id}>
          <Link
            href={hrefArtist(a)}
            className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 transition-colors hover:bg-accent"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{a.name}</span>
              {a.aliases && a.aliases.length > 0 && (
                <span className="block truncate text-xs text-muted-foreground">
                  含：{a.aliases.join('、')}
                </span>
              )}
            </span>
            <span className="shrink-0 text-sm text-muted-foreground">{a.songs} 首</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
