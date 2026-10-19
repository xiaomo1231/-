import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  ScoreFormat,
  ScoreSearchResult,
  ScoreSong,
  ScoreVersion,
} from '@/songs/scoreLibraryTypes'
import { api, errorText, type SearchOptions } from '../lib/api'
import { toggleFavorite, useFavorites } from '../lib/favorites'
import { useHistoryState, useRestoreScroll } from '../lib/scrollMemory'
import { VersionList } from '../components/SongCard'
import { cx } from '../lib/classes'
import { hrefArtist, hrefSearch, hrefViewer } from '../lib/route'
import { useLibrary } from '../lib/libraryContext'
import { useLoad } from '../lib/useLoad'
import { Link } from '../components/Link'
import { MatchTag, Notice } from '../components/ui'

type Sort = NonNullable<SearchOptions['sort']>

const ROW =
  'grid min-h-11 grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-1 py-3 transition-colors hover:bg-card active:bg-card min-[861px]:grid-cols-[52px_minmax(0,1fr)_auto]'

const FORMATS: ReadonlyArray<readonly [ScoreFormat | '', string]> = [
  ['', '全部格式'],
  ['score', 'GP 谱'],
  ['image', '图片谱'],
  ['pdf', 'PDF'],
  ['text', '文本谱'],
]

const SORTS: ReadonlyArray<readonly [Sort, string]> = [
  ['rel', '最相关'],
  ['ver', '版本最多'],
  ['name', '按歌名'],
]

const FILTER =
  'h-11 min-[861px]:h-[38px] appearance-none rounded-full border-[1.5px] border-border bg-transparent pl-3.5 pr-9 text-[13px] text-foreground transition-colors focus:border-primary'

/** 搜索谱: one wide field, three pill filters, and the results as a numbered list. */
export function SearchPage({ q }: { q: string }) {
  const { info, version } = useLibrary()
  const [text, setText] = useState(q)
  const [query, setQuery] = useState(q.trim())
  const [fmt, setFmt] = useHistoryState<ScoreFormat | ''>('fmt', '')
  const [cat, setCat] = useHistoryState('cat', '')
  const [sort, setSort] = useHistoryState<Sort>('sort', 'rel')
  const field = useRef<HTMLInputElement>(null)

  // The route's q changed (a tab, Ctrl K, back): show that instead.
  useEffect(() => {
    setText(q)
    setQuery(q.trim())
  }, [q])

  // Searching waits 200 ms after the last key, so typing does not fetch every letter.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(text.trim()), 200)
    return () => window.clearTimeout(t)
  }, [text])

  // The address keeps the query, replaced rather than pushed per keystroke.
  useEffect(() => {
    const hash = hrefSearch(query)
    if (window.location.hash !== hash) window.history.replaceState(window.history.state, '', hash)
  }, [query])

  const opts: SearchOptions = { fmt, cat, sort }
  const state = useLoad(
    (signal) => (query ? api.search(query, opts, signal) : api.top(opts, signal)),
    `search\n${query}\n${fmt}\n${cat}\n${sort}\n${version}`,
  )
  useRestoreScroll(state.status === 'ready')

  const files = info?.files ?? 0
  const placeholder = info
    ? `搜索 ${files.toLocaleString('zh-CN')} 份谱：歌名、歌手、拼音、首字母`
    : '搜索歌名、歌手、拼音、首字母'

  return (
    <>
      <div className="grid grid-cols-1 items-center gap-3.5 pb-2 pt-[22px] min-[861px]:grid-cols-[auto_minmax(0,1fr)] min-[861px]:gap-7 min-[861px]:pt-9">
        <h1 className="m-0 whitespace-nowrap font-display text-[26px] font-black leading-tight min-[861px]:text-[30px]">
          搜索谱
        </h1>
        <label className="relative block">
          <span className="sr-only">搜索谱</span>
          <svg
            aria-hidden
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            className="pointer-events-none absolute left-[18px] top-1/2 -translate-y-1/2 text-muted-foreground"
          >
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="M15.5 15.5 21 21" />
          </svg>
          <input
            id="song-search"
            ref={field}
            type="search"
            autoFocus
            enterKeyHint="search"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="h-[58px] w-full rounded-[14px] border-0 bg-card pl-[50px] pr-12 text-lg text-foreground outline-none ring-inset transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-primary [&::-webkit-search-cancel-button]:appearance-none"
          />
          {text && (
            <button
              type="button"
              aria-label="清空"
              onClick={() => {
                setText('')
                setQuery('')
                field.current?.focus()
              }}
              className="absolute right-2.5 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
            >
              <span aria-hidden>✕</span>
            </button>
          )}
        </label>
      </div>

      <div className="flex flex-wrap gap-2.5 pb-1.5 pt-4">
        <Pill
          label="格式"
          value={fmt}
          on={fmt !== ''}
          onChange={(v) => setFmt(v as ScoreFormat | '')}
        >
          {FORMATS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Pill>
        <Pill label="分类" value={cat} on={cat !== ''} onChange={setCat}>
          <option value="">全部分类</option>
          {(info?.categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Pill>
        <Pill label="排序" value={sort} on={sort !== 'rel'} onChange={(v) => setSort(v as Sort)}>
          {SORTS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Pill>
      </div>

      {state.status === 'loading' && (
        <p className="py-10 text-center text-sm text-muted-foreground">正在搜索…</p>
      )}
      {state.status === 'error' && (
        <div className="py-4">
          <Notice tone="error">{state.message}</Notice>
        </div>
      )}

      {state.status === 'ready' && <Results query={query} data={state.data} />}
    </>
  )
}

/** A native select drawn as a pill; pen-blue when it is not at the default. */
function Pill({
  label,
  value,
  on,
  onChange,
  children,
}: {
  label: string
  value: string
  on: boolean
  onChange: (v: string) => void
  children: ReactNode
}) {
  return (
    <label className="relative inline-flex">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cx(FILTER, on && 'border-primary text-primary')}
      >
        {children}
      </select>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-muted-foreground"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </span>
    </label>
  )
}

/**
 * Artist chips, then the numbered song results: a song with one score opens it, one
 * with several opens its versions in place (each with ☆, 预览 and 看谱 →).
 */
function Results({ query, data }: { query: string; data: ScoreSearchResult }) {
  const { artists, songs, moreSongs } = data
  const [openIds, setOpenIds] = useHistoryState<string[]>('open', [])
  const open = useMemo(() => new Set(openIds), [openIds])
  const toggle = (id: string) =>
    setOpenIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
  const { items: favorites } = useFavorites()
  const starred = useMemo(() => new Set(favorites.map((f) => f.path)), [favorites])
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const star = async (song: ScoreSong, v: ScoreVersion, artist: string) => {
    if (busyPath) return
    setBusyPath(v.file.path)
    setError(null)
    try {
      await toggleFavorite({
        path: v.file.path,
        format: v.file.format,
        pages: v.pages?.map((p) => p.path) ?? [],
        title: song.unknownTitle ? v.label : song.title,
        artist,
      })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusyPath(null)
    }
  }

  if (artists.length === 0 && songs.length === 0) {
    return (
      <div className="py-6">
        <Notice>没找到。试试拼音首字母（例如 zjl），或者少打几个字。</Notice>
      </div>
    )
  }

  return (
    <>
      {artists.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pb-1 pt-3">
          <span className="pr-1 text-xs text-muted-foreground">歌手</span>
          {artists.map((a) => (
            <Link
              key={a.id}
              href={hrefArtist(a)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border px-3.5 text-sm transition-colors hover:border-primary hover:text-primary"
            >
              {a.name}
              <span className="mono text-[11px] text-muted-foreground">{a.files}</span>
            </Link>
          ))}
        </div>
      )}

      {!query && <p className="px-1 pb-1 pt-3 text-xs text-muted-foreground">版本最多的谱</p>}

      <ol className="m-0 list-none p-0 pb-28 pt-2">
        {songs.map(({ song, artistName, match }, i) => {
          const best = song.versions[0]
          if (!best) return null
          const title = song.unknownTitle ? best.label : song.title
          const count = song.versions.length
          const filled = Math.min(8, Math.ceil(count / 4))
          const body = (
            <>
              <span className="mono pr-3.5 text-right text-base font-semibold text-muted-foreground">
                {i + 1}.
              </span>
              <span className="min-w-0">
                <span className="block break-words text-lg font-bold leading-snug">
                  {title}
                  {match !== 'name' && <MatchTag match={match} />}
                </span>
                <span className="block truncate text-[15px] text-muted-foreground">
                  {artistName}
                </span>
              </span>
              <span className="flex items-center gap-2 pr-2">
                {count > 1 && (
                  <span className="mono text-xs text-muted-foreground">{count} 个谱</span>
                )}
                <span
                  className="flex gap-1"
                  role="img"
                  aria-label={`${count} 个版本`}
                  title={`${count} 个版本`}
                >
                  {Array.from({ length: 8 }, (_, k) => (
                    <i
                      key={k}
                      aria-hidden
                      className={cx(
                        'h-1 w-1 rounded-full min-[861px]:h-[5px] min-[861px]:w-[5px]',
                        k < filled ? 'bg-primary' : 'bg-border',
                      )}
                    />
                  ))}
                </span>
                {count > 1 && (
                  <span
                    aria-hidden
                    className={cx(
                      'text-lg text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
                      open.has(song.id) && 'rotate-90',
                    )}
                  >
                    ›
                  </span>
                )}
              </span>
            </>
          )
          return (
            <li key={song.id}>
              {count > 1 ? (
                <button
                  type="button"
                  aria-expanded={open.has(song.id)}
                  onClick={() => toggle(song.id)}
                  className={cx(ROW, 'w-full text-left')}
                >
                  {body}
                </button>
              ) : (
                <Link
                  href={hrefViewer({
                    path: best.file.path,
                    format: best.file.format,
                    pages: best.pages?.map((p) => p.path),
                    title,
                    artist: artistName,
                  })}
                  className={ROW}
                >
                  {body}
                </Link>
              )}
              {count > 1 && open.has(song.id) && (
                <div className="pb-2 pl-[38px] min-[861px]:pl-[52px]">
                  <VersionList
                    song={song}
                    artistName={artistName}
                    isStarred={(path) => starred.has(path)}
                    busyPath={busyPath}
                    onStar={(sg, v) => void star(sg, v, artistName)}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {error && (
        <p role="alert" className="px-1 pb-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {moreSongs && (
        <p className="px-1 pb-24 text-xs text-muted-foreground">
          结果较多，只显示前 200 个。输入更完整的歌名可以缩小范围。
        </p>
      )}
    </>
  )
}
