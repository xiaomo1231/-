import { useEffect, useMemo, useState } from 'react'
import type { ScoreArtist } from '@/songs/scoreLibraryTypes'
import { api } from '../lib/api'
import { cx, PAGE_SIZE } from '../lib/classes'
import { hrefArtist, hrefCategory } from '../lib/route'
import { useLibrary } from '../lib/libraryContext'
import { groupByInitial, initialOf, sortArtists, type ArtistSort } from '../lib/sort'
import { useLoad } from '../lib/useLoad'
import { useHistoryState, useRestoreScroll } from '../lib/scrollMemory'
import { Link } from '../components/Link'
import { LoadMore, Notice, PageBar, Seg } from '../components/ui'

export interface GroupRoute {
  id: string
  name: string
  noun: string
}

const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))

/** 索引: a group's artists as a back-of-book index, with an A–Z jump row above. */
export function ArtistsPage({ group }: { group: GroupRoute }) {
  const { info, version } = useLibrary()
  const [sort, setSort] = useHistoryState<ArtistSort>('sort', 'name')
  const [limit, setLimit] = useHistoryState('limit', PAGE_SIZE)
  const [jump, setJump] = useState<string | null>(null)
  const state = useLoad(
    (signal) => api.artists(group.id, signal),
    `artists\n${group.id}\n${version}`,
  )
  useRestoreScroll(state.status === 'ready')

  const sorted = useMemo(
    () => (state.status === 'ready' ? sortArtists(state.data, sort) : []),
    [state, sort],
  )
  const shown = sorted.slice(0, limit)
  const letters = useMemo(() => new Set(sorted.map(initialOf)), [sorted])
  // A–Z always shows all 26 letters; the ones with no artist are dimmed and disabled.
  const jumpLetters = useMemo(() => {
    const extra = [...letters].filter((l) => !/^[A-Z]$/.test(l))
    return [...LETTERS, ...extra]
  }, [letters])
  const files = sorted.reduce((n, a) => n + a.files, 0)

  // The category above this group: a multi-group category is a page of its own.
  const categoryId = group.id.split('/')[0] ?? ''
  const category = info?.categories.find((c) => c.id === categoryId)
  const back = category ? `← 目录 · ${category.name}` : '← 目录'
  const backTo = category && category.groups.length > 1 ? hrefCategory(category.id) : '#/'

  // An old link: this folder used to be a group (e.g. 动漫音乐/BanG Dream!) and is now an
  // artist / work of its category. Go to that page instead of an empty one.
  const known = info?.categories.some((c) => c.groups.some((g) => g.id === group.id)) ?? true
  useEffect(() => {
    if (known || state.status !== 'ready' || state.data.length > 0) return
    const ac = new AbortController()
    const parent = info?.categories.find((c) => c.id === categoryId)?.groups ?? []
    void Promise.all(parent.map((g) => api.artists(g.id, ac.signal)))
      .then((lists) => {
        const hit = lists.flat().find((x) => x.id === group.id)
        if (hit) window.location.replace(hrefArtist(hit))
      })
      .catch(() => undefined)
    return () => ac.abort()
  }, [known, state, info, categoryId, group.id])

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

  const ready = state.status === 'ready'

  return (
    <>
      <PageBar
        title={group.name}
        back={back}
        fallback={backTo}
        subtitle={
          ready
            ? `${sorted.length} 位${group.noun} · ${files.toLocaleString('zh-CN')} 份`
            : undefined
        }
      >
        <Seg<ArtistSort>
          label="排序"
          value={sort}
          onChange={setSort}
          options={[
            ['name', '按拼音'],
            ['count', '按数量'],
          ]}
        />
      </PageBar>

      {state.status === 'loading' && (
        <p className="py-10 text-center text-sm text-muted-foreground">正在读取…</p>
      )}
      {state.status === 'error' && (
        <div className="py-6">
          <Notice tone="error">{state.message}</Notice>
        </div>
      )}
      {ready && sorted.length === 0 && (
        <div className="py-6">
          <Notice>这个分组里还没有{group.noun}。</Notice>
        </div>
      )}

      {sorted.length > 0 && (
        <>
          {sort === 'name' && (
            <nav aria-label="按字母跳转" className="flex flex-wrap gap-0.5 pb-[18px] pt-1.5">
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
                      'mono grid h-11 w-[30px] place-items-center rounded text-[13px] transition-colors',
                      present
                        ? 'text-foreground hover:bg-primary/10 hover:text-primary'
                        : 'cursor-default text-border',
                    )}
                  >
                    {letter}
                  </button>
                )
              })}
            </nav>
          )}

          {sort === 'name' ? (
            <div className="[column-gap:48px] [columns:3_260px]">
              {groupByInitial(shown).map((section) => (
                <section key={section.letter} id={`sec-${section.letter}`} className="scroll-mt-28">
                  <h2 className="mono mb-1 mt-[18px] flex items-center gap-2.5 text-[22px] font-semibold text-primary [break-after:avoid]">
                    {section.letter}
                    <span aria-hidden className="h-px flex-1 bg-border" />
                  </h2>
                  <ul className="m-0 list-none p-0">
                    {section.items.map((a) => (
                      <ArtistEntry key={a.id} artist={a} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <ul className="m-0 list-none p-0 pt-2 [column-gap:48px] [columns:3_260px]">
              {shown.map((a) => (
                <ArtistEntry key={a.id} artist={a} />
              ))}
            </ul>
          )}

          <div className="mb-20">
            {sorted.length > limit && (
              <LoadMore
                remaining={sorted.length - limit}
                onMore={() => setLimit((n) => n + PAGE_SIZE)}
              />
            )}
          </div>
        </>
      )}
    </>
  )
}

/** One line of the index: name, a dotted leader, the count in mono. */
function ArtistEntry({ artist: a }: { artist: ScoreArtist }) {
  return (
    <li className="[break-inside:avoid]">
      <Link
        href={hrefArtist(a)}
        className="group flex min-h-11 items-baseline gap-2 py-1.5 text-base"
      >
        <span className="min-w-0 break-words transition-colors group-hover:text-primary">
          {a.name}
          {a.aliases && a.aliases.length > 0 && (
            <span className="ml-1.5 text-xs text-muted-foreground">
              也叫 {a.aliases.join('、')}
            </span>
          )}
        </span>
        <span aria-hidden className="leader" />
        <span className="mono shrink-0 text-xs text-muted-foreground">{a.songs}</span>
      </Link>
    </li>
  )
}
