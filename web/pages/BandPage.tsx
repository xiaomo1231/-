import { useEffect, useMemo, useState } from 'react'
import type { ScoreSearchResult, ScoreVersion } from '@/songs/scoreLibraryTypes'
import {
  api,
  errorText,
  type BandSong,
  type DailyMemberProgress,
  type MemberProgress,
  type SongStatus,
  type UserInfo,
} from '../lib/api'
import { addSong, rename, reorder, STATUS_LABELS, updateSong, useBand } from '../lib/band'
import { cx } from '../lib/classes'
import { todayNumber } from '../lib/daily'
import { canBrowseLibrary, INSTRUMENT_LABELS, useMe } from '../lib/session'
import { fmtDuration } from '../lib/practice'
import { hrefBandSong, hrefEnsembles } from '../lib/route'
import { FormatBadge, Notice, PageBar, Seg, Staff } from '../components/ui'
import { Link } from '../components/Link'

type Filter = 'all' | SongStatus

const FILTERS: ReadonlyArray<readonly [Filter, string]> = [
  ['all', '全部'],
  ['learning', STATUS_LABELS.learning],
  ['ready', STATUS_LABELS.ready],
  ['maybe', STATUS_LABELS.maybe],
]

/** Tap order of the status chip. */
const NEXT_STATUS: Record<SongStatus, SongStatus> = {
  learning: 'ready',
  ready: 'maybe',
  maybe: 'learning',
}

const STATUS_CLASS: Record<SongStatus, string> = {
  learning: 'border-primary text-primary',
  ready: 'border-foreground text-foreground',
  maybe: 'border-muted-foreground text-muted-foreground',
}

const ICON_BUTTON =
  'grid h-11 w-11 place-items-center rounded-lg border border-border text-base text-muted-foreground transition-colors hover:border-foreground hover:text-foreground disabled:opacity-40'

/** 乐队 page: the band's name and members, the ordered setlist, and adding songs from the library. */
export function BandPage() {
  const { state, error, reload } = useBand()
  const me = useMe()
  const browse = me !== null && canBrowseLibrary(me)
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  // Each member's 每日一练 progress; a failed read just leaves the lines out.
  const [daily, setDaily] = useState<Map<string, DailyMemberProgress> | null>(null)

  useEffect(() => {
    let alive = true
    api.dailyMembers().then(
      (list) => {
        if (alive) setDaily(new Map(list.map((p) => [p.userId, p])))
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [])

  const run = async (key: string, job: () => Promise<void>) => {
    if (busy) return
    setBusy(key)
    setNotice(null)
    try {
      await job()
    } catch (e) {
      setNotice(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  if (!state) {
    return (
      <>
        <PageBar title="乐队" fallback="#/" back="← 目录" />
        <Staff />
        <div className="max-w-[640px] py-6">
          {error ? <Notice tone="error">{error}</Notice> : <p className="text-sm text-muted-foreground">正在读取…</p>}
          {error && (
            <button
              type="button"
              onClick={reload}
              className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm hover:border-foreground"
            >
              重试
            </button>
          )}
        </div>
      </>
    )
  }

  const memberById = new Map<string, UserInfo>(state.members.map((m) => [m.id, m]))
  const nameOf = (id: string) => memberById.get(id)?.displayName ?? '已离开的成员'
  const shown = filter === 'all' ? state.songs : state.songs.filter((s) => s.status === filter)

  const move = (index: number, dir: -1 | 1) => {
    const ids = state.songs.map((s) => s.id)
    void run('move', () => reorder(swapped(ids, index, index + dir)))
  }

  const cycleStatus = (song: BandSong) =>
    void run(song.id, () => updateSong({ id: song.id, status: NEXT_STATUS[song.status] }))

  const startRename = () => {
    setNameDraft(state.name)
    setRenaming(true)
  }

  const saveName = () => {
    const name = nameDraft.trim()
    if (!name) return
    void run('name', async () => {
      await rename(name)
      setRenaming(false)
    })
  }

  return (
    <>
      <PageBar
        title={state.name || '乐队'}
        back={browse ? '← 目录' : ''}
        fallback="#/"
        subtitle={`${state.songs.length} 首歌 · ${state.members.length} 位成员`}
      >
        {!renaming && (
          <button
            type="button"
            onClick={startRename}
            className="inline-flex min-h-11 items-center rounded-lg border border-border px-3.5 text-sm text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
          >
            改名
          </button>
        )}
      </PageBar>
      <Staff />

      {renaming && (
        <form
          className="flex max-w-[640px] flex-wrap items-center gap-2 pt-4"
          onSubmit={(e) => {
            e.preventDefault()
            saveName()
          }}
        >
          <label className="sr-only" htmlFor="band-name">
            乐队名称
          </label>
          <input
            id="band-name"
            value={nameDraft}
            maxLength={40}
            autoFocus
            onChange={(e) => setNameDraft(e.target.value)}
            className="h-11 min-w-0 flex-1 basis-48 rounded-lg border border-border bg-transparent px-3 text-base text-foreground focus:border-primary"
          />
          <button
            type="submit"
            disabled={!nameDraft.trim() || busy === 'name'}
            className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-strong disabled:opacity-50"
          >
            保存
          </button>
          <button
            type="button"
            onClick={() => setRenaming(false)}
            className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm text-muted-foreground hover:text-foreground"
          >
            取消
          </button>
        </form>
      )}

      {/* members */}
      <section aria-labelledby="band-members" className="max-w-[640px] pt-6">
        <h2 id="band-members" className="label m-0">
          成员
        </h2>
        <ul className="m-0 mt-2.5 flex list-none flex-wrap gap-2 p-0">
          {state.members.map((m) => (
            <li
              key={m.id}
              className="inline-flex min-h-11 flex-col justify-center gap-0.5 rounded-2xl border border-border px-3.5 py-1.5 text-sm"
            >
              <span className="flex items-center gap-2">
                <span className="font-medium">
                  {m.displayName}
                  {me?.id === m.id && <span className="text-muted-foreground">（我）</span>}
                </span>
                <span className="mono text-xs text-muted-foreground">
                  {m.instrument ? INSTRUMENT_LABELS[m.instrument] : '未设乐器'}
                </span>
              </span>
              {daily && (
                <span className="mono text-[11px] text-muted-foreground">
                  {dailyLine(daily.get(m.id))}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* setlist */}
      <section aria-labelledby="band-setlist" className="max-w-[640px] pt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="band-setlist" className="label m-0">
            排练歌单
          </h2>
          {state.songs.length > 0 && (
            <Seg<Filter> label="状态筛选" value={filter} onChange={setFilter} options={FILTERS} />
          )}
        </div>

        {notice && (
          <div className="pt-3">
            <Notice tone="error">{notice}</Notice>
          </div>
        )}

        {state.songs.length === 0 ? (
          <div className="pt-3">
            <Notice>
              {browse
                ? '歌单还是空的。在下面「添加歌曲」里搜索谱子，选一个版本加入，乐队成员就能一起排练它。每首歌可以记录状态、分配声部、设定排练速度和备注。'
                : '歌单还是空的。等管理员或能看谱库的成员把歌加进来，这里就会出现。'}
            </Notice>
          </div>
        ) : shown.length === 0 ? (
          <div className="pt-3">
            <Notice>这个状态下还没有歌。</Notice>
          </div>
        ) : (
          <ol className="m-0 list-none p-0 pt-2">
            {shown.map((song) => {
              const index = state.songs.indexOf(song)
              return (
                <SetlistRow
                  key={song.id}
                  index={index}
                  total={state.songs.length}
                  song={song}
                  progress={state.progress[song.id] ?? []}
                  nameOf={nameOf}
                  busy={busy !== null}
                  onStatus={() => cycleStatus(song)}
                  onMove={(dir) => move(index, dir)}
                />
              )
            })}
          </ol>
        )}
      </section>

      {/* Picking songs needs the library; members who only see the band cannot search it. */}
      {browse && (
        <AddSongs
          inSetlist={new Set(state.songs.map((s) => s.path))}
          busy={busy}
          run={run}
        />
      )}
    </>
  )
}

function SetlistRow({
  song,
  index,
  total,
  progress,
  nameOf,
  busy,
  onStatus,
  onMove,
}: {
  song: BandSong
  index: number
  total: number
  progress: MemberProgress[]
  nameOf: (id: string) => string
  busy: boolean
  onStatus: () => void
  onMove: (dir: -1 | 1) => void
}) {
  const practice =
    progress.length === 0
      ? '还没有练习记录'
      : progress
          .map(
            (p) =>
              `${nameOf(p.userId)} ${fmtDuration(p.totalSeconds)}${p.maxSpeedPct ? ` · ${p.maxSpeedPct}%` : ''}`,
          )
          .join(' · ')

  const counts = new Map<string, number>()
  for (const userId of Object.values(song.parts)) counts.set(userId, (counts.get(userId) ?? 0) + 1)
  const parts =
    counts.size === 0
      ? '声部未分配'
      : [...counts].map(([userId, n]) => `${nameOf(userId)} ${n} 轨`).join(' · ')

  return (
    <li className="flex items-start gap-2.5 border-t border-border py-3 first:border-t-0">
      <span className="mono w-7 shrink-0 pt-1 text-right text-base font-semibold text-muted-foreground">
        {index + 1}.
      </span>
      <div className="min-w-0 flex-1">
        <Link
          href={hrefBandSong(song.id)}
          className="block break-words text-lg font-bold leading-snug transition-colors hover:text-primary"
        >
          {song.title || '未识别的曲名'}
        </Link>
        <p className="truncate text-sm text-muted-foreground">{song.artist || ' '}</p>
        <p className="mono mt-1 break-words text-[11px] leading-relaxed text-muted-foreground">
          {practice}
        </p>
        <p className="mono break-words text-[11px] leading-relaxed text-muted-foreground">
          声部：{parts}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <button
          type="button"
          onClick={onStatus}
          disabled={busy}
          aria-label={`状态：${STATUS_LABELS[song.status]}，点按切换`}
          className={cx(
            'inline-flex min-h-11 items-center rounded-full border px-3 text-[13px] transition-colors disabled:opacity-50',
            STATUS_CLASS[song.status],
          )}
        >
          {STATUS_LABELS[song.status]}
        </button>
        <div className="flex gap-1.5">
          <button
            type="button"
            aria-label="上移"
            title="上移"
            disabled={busy || index <= 0}
            onClick={() => onMove(-1)}
            className={ICON_BUTTON}
          >
            <span aria-hidden>↑</span>
          </button>
          <button
            type="button"
            aria-label="下移"
            title="下移"
            disabled={busy || index >= total - 1}
            onClick={() => onMove(1)}
            className={ICON_BUTTON}
          >
            <span aria-hidden>↓</span>
          </button>
        </div>
      </div>
    </li>
  )
}

/** Search the library for score files and add one version of a song to the setlist. */
function AddSongs({
  inSetlist,
  busy,
  run,
}: {
  inSetlist: Set<string>
  busy: string | null
  run: (key: string, job: () => Promise<void>) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<ScoreSearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  // Waits a moment after the last key, so typing does not search every letter.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(text.trim()), 250)
    return () => window.clearTimeout(t)
  }, [text])

  useEffect(() => {
    if (!query) {
      setFound(null)
      setSearchError(null)
      setSearching(false)
      return
    }
    const ac = new AbortController()
    setSearching(true)
    setSearchError(null)
    api.search(query, {}, ac.signal).then(
      (r) => {
        if (!ac.signal.aborted) setFound(r)
      },
      (e: unknown) => {
        if (!ac.signal.aborted) setSearchError(errorText(e))
      },
    ).finally(() => {
      if (!ac.signal.aborted) setSearching(false)
    })
    return () => ac.abort()
  }, [query])

  // Only songs with at least one score-format file (GP / MusicXML) can be rehearsed.
  const songs = useMemo(
    () =>
      (found?.songs ?? [])
        .map(({ song, artistName }) => ({
          song,
          artistName,
          versions: song.versions.filter((v) => v.file.format === 'score'),
        }))
        .filter((x) => x.versions.length > 0),
    [found],
  )

  const add = (title: string, artist: string, v: ScoreVersion) =>
    void run(`add:${v.file.path}`, () => addSong({ path: v.file.path, title, artist }))

  return (
    <section aria-labelledby="band-add" className="max-w-[640px] pb-24 pt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="band-add" className="label m-0">
          添加歌曲
        </h2>
        <Link
          href={hrefEnsembles()}
          className="inline-flex min-h-11 items-center text-sm text-primary hover:underline"
        >
          找乐队谱 →
        </Link>
      </div>

      <label className="relative mt-3 block">
        <span className="sr-only">搜索谱库</span>
        <input
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="搜索歌名或歌手，选一个版本加入歌单"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-12 w-full rounded-[14px] border-0 bg-card px-4 text-base text-foreground outline-none ring-inset transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-primary [&::-webkit-search-cancel-button]:appearance-none"
        />
      </label>

      {!query && <p className="pt-3 text-xs text-muted-foreground">输入歌名、歌手或拼音首字母开始搜索。</p>}
      {searching && <p className="pt-3 text-sm text-muted-foreground">正在搜索…</p>}
      {searchError && (
        <div className="pt-3">
          <Notice tone="error">{searchError}</Notice>
        </div>
      )}
      {query && !searching && found && songs.length === 0 && !searchError && (
        <div className="pt-3">
          <Notice>没有找到带乐谱文件（GP / MusicXML）的歌曲。</Notice>
        </div>
      )}

      {songs.length > 0 && (
        <ul className="m-0 list-none p-0 pt-3">
          {songs.map(({ song, artistName, versions }) => {
            const title = song.unknownTitle ? (versions[0]?.label ?? song.title) : song.title
            return (
              <li key={song.id} className="border-t border-border py-3 first:border-t-0">
                <p className="m-0 break-words text-base font-bold">
                  {title || '未识别的曲名'}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">{artistName}</span>
                </p>
                <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
                  {versions.map((v) => {
                    const added = inSetlist.has(v.file.path)
                    const key = `add:${v.file.path}`
                    return (
                      <li key={v.file.path}>
                        <div className="flex items-center gap-2">
                          <FormatBadge format={v.file.format} />
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {v.label}
                            {v.tags.length > 0 && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {v.tags.join(' · ')}
                              </span>
                            )}
                          </span>
                          {added ? (
                            <span className="shrink-0 text-xs text-muted-foreground">已在歌单</span>
                          ) : (
                            <button
                              type="button"
                              disabled={busy !== null}
                              onClick={() => add(title, artistName, v)}
                              className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-border px-3 text-sm transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                              aria-label={busy === key ? '正在加入' : `加入歌单：${v.label}`}
                            >
                              {busy === key ? '加入中…' : '加入'}
                            </button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** A member's 每日一练 position and count, as one muted line. */
function dailyLine(p: DailyMemberProgress | undefined): string {
  if (!p || p.startedAt === null) return '还没开始每日一练'
  return `每日一练 第 ${todayNumber(p.startedAt, Date.now())} 天 · 完成 ${p.doneCount}`
}

/** The order with the entries at i and j swapped; the same list when either index is out of range. */
function swapped(ids: string[], i: number, j: number): string[] {
  const next = [...ids]
  const a = next[i]
  const b = next[j]
  if (a === undefined || b === undefined) return ids
  next[i] = b
  next[j] = a
  return next
}
