import { useEffect, useMemo, useState } from 'react'
import type { ScoreArtist } from '@/songs/scoreLibraryTypes'
import { api } from '../lib/api'
import { cx, LIST_PANEL, PAGE_SIZE, ROW } from '../lib/classes'
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

const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))

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
  const letters = useMemo(() => new Set(sorted.map(initialOf)), [sorted])
  // The longest string in the group: every artist's brass line is measured against it.
  const most = useMemo(() => Math.max(...sorted.map((a) => a.songs), 1), [sorted])
  // A–Z always shows all 26 letters; the ones with no artist are disabled.
  const jumpLetters = useMemo(() => {
    const extra = [...letters].filter((l) => !/^[A-Z]$/.test(l))
    return [...LETTERS, ...extra]
  }, [letters])

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
          <div className="min-w-0 flex-1 space-y-4">
            <div
              role="group"
              aria-label="排序"
              className="inline-flex rounded-full bg-muted p-1 text-sm"
            >
              {(
                [
                  ['name', '按名称'],
                  ['count', '按谱子数'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={sort === value}
                  onClick={() => setSort(value)}
                  className={cx(
                    'min-h-11 rounded-full px-4 transition-colors',
                    sort === value
                      ? 'bg-card font-medium text-foreground shadow-[var(--shadow-soft)]'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {sort === 'name' ? (
              groupByInitial(shown).map((section) => (
                <section key={section.letter} id={`sec-${section.letter}`} className="scroll-mt-28">
                  <h2 className="sticky top-[calc(env(safe-area-inset-top)+3.5rem)] z-10 flex items-center gap-3 bg-background/90 py-2 backdrop-blur-md">
                    <span className="mono text-sm font-medium text-primary">{section.letter}</span>
                    <span aria-hidden className="h-px flex-1 bg-border" />
                  </h2>
                  <ArtistRows artists={section.items} most={most} />
                </section>
              ))
            ) : (
              <ArtistRows artists={shown} most={most} />
            )}

            {sorted.length > limit && (
              <LoadMore
                remaining={sorted.length - limit}
                onMore={() => setLimit((n) => n + PAGE_SIZE)}
              />
            )}
          </div>

          {sort === 'name' && (
            <nav
              aria-label="按字母跳转"
              className="sticky top-[calc(env(safe-area-inset-top)+6rem)] flex shrink-0 flex-col items-center py-1"
            >
              {jumpLetters.map((letter) => {
                const present = letters.has(letter)
                return (
                  <button
                    key={letter}
                    type="button"
                    disabled={!present}
                    onClick={() => jumpTo(letter)}
                    aria-label={present ? `跳到 ${letter}` : `${letter}，没有歌手`}
                    className={cx(
                      'mono relative h-6 w-6 rounded-md text-[11px] font-medium before:absolute before:-inset-2 before:content-[""]',
                      present
                        ? 'text-primary hover:bg-accent'
                        : 'cursor-default text-muted-foreground/40',
                    )}
                  >
                    {letter}
                  </button>
                )
              })}
            </nav>
          )}
        </div>
      )}
    </>
  )
}

function ArtistRows({ artists, most }: { artists: ScoreArtist[]; most: number }) {
  return (
    <ul className={LIST_PANEL}>
      {artists.map((a) => (
        <li key={a.id}>
          <Link href={hrefArtist(a)} className={cx(ROW, 'justify-between')}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-medium">{a.name}</span>
              {a.aliases && a.aliases.length > 0 && (
                <span className="block truncate text-xs text-muted-foreground">
                  含：{a.aliases.join('、')}
                </span>
              )}
              {/* a quiet string length: the artist's files against the longest in the group */}
              <span
                aria-hidden
                className="mt-2 block h-[2px] rounded-full bg-primary/70"
                style={{ width: `${Math.max(4, (a.songs / most) * 100)}%` }}
              />
            </span>
            <span className="mono shrink-0 text-sm text-muted-foreground">{a.songs} 首</span>
            <span aria-hidden className="shrink-0 text-xl text-muted-foreground">
              ›
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
