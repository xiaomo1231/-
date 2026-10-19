import { useEffect, useRef, useState } from 'react'
import type { EnsembleFile, TrackKind } from '@/songs/scoreServerTypes'
import { api, errorText } from '../lib/api'
import { addSong, useBand } from '../lib/band'
import { buttonClass, cx } from '../lib/classes'
import { fileBaseName } from '../lib/format'
import { hrefEnsembles, hrefViewer } from '../lib/route'
import { Link } from '../components/Link'
import { Notice } from '../components/ui'
import { useHistoryState, useRestoreScroll } from '../lib/scrollMemory'

const PAGE = 50
const POLL_MS = 5000

/** The filter chips, in the order they are written into the address. */
const NEEDS: ReadonlyArray<readonly [string, string]> = [
  ['band', '完整乐队'],
  ['guitar2', '两把吉他'],
  ['keys', '有键盘'],
  ['vocal', '有人声'],
]

const KIND_ORDER: TrackKind[] = ['guitar', 'bass', 'drums', 'keys', 'vocal', 'other']
const KIND_LABEL: Record<TrackKind, string> = {
  guitar: '吉他',
  bass: '贝斯',
  drums: '鼓',
  keys: '键盘',
  vocal: '人声',
  other: '其他',
}

/** need "guitar2,keys" → the chips on; nothing listed means no filter. */
function parseNeed(need: string): Set<string> {
  return new Set(
    need
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

/** "吉他×2 · 贝斯 · 鼓 · 键盘" */
function instrumentation(f: EnsembleFile): string {
  const parts = KIND_ORDER.flatMap((k) => {
    const n = f.counts[k] ?? 0
    if (n <= 0) return []
    return [n > 1 ? `${KIND_LABEL[k]}×${n}` : KIND_LABEL[k]]
  })
  return parts.length > 0 ? parts.join(' · ') : '未识别乐器'
}

interface Progress {
  indexed: number
  toIndex: number
  indexing: boolean
}

/** 找乐队谱: GP files that carry a full band, found from their track lists. */
export function EnsemblesPage({ q, need }: { q: string; need: string }) {
  const [text, setText] = useState(q)
  const [query, setQuery] = useState(q.trim())
  const [chips, setChips] = useState(() => parseNeed(need))

  // The route changed (a tab, back, a link): show that instead.
  useEffect(() => {
    setText(q)
    setQuery(q.trim())
  }, [q])
  useEffect(() => {
    setChips(parseNeed(need))
  }, [need])

  // Searching waits 250 ms after the last key, as the search page does.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(text.trim()), 250)
    return () => window.clearTimeout(t)
  }, [text])

  const needKey = NEEDS.filter(([k]) => chips.has(k))
    .map(([k]) => k)
    .join(',')

  // The address keeps the search and filters, replaced rather than pushed.
  useEffect(() => {
    const hash = hrefEnsembles(query, needKey)
    if (window.location.hash !== hash) window.history.replaceState(window.history.state, '', hash)
  }, [query, needKey])

  const [items, setItems] = useState<EnsembleFile[]>([])
  const [total, setTotal] = useState(0)
  /** Files whose title could not be read: hidden unless asked for. */
  const [untitled, setUntitled] = useHistoryState('untitled', false)
  /** Rows shown when this entry was left (再看 …), loaded again on the way back. */
  const [shownCount, setShownCount] = useHistoryState('count', PAGE)
  const [hidden, setHidden] = useState(0)
  const [progress, setProgress] = useState<Progress>({ indexed: 0, toIndex: 0, indexing: false })
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState('')
  const requestKey = useRef('')
  const shown = useRef(0)
  shown.current = items.length

  // A new search or filter starts again from the first page.
  useEffect(() => {
    const ac = new AbortController()
    requestKey.current = `${query}\n${needKey}\n${untitled}`
    setPhase('loading')
    setItems([])
    setTotal(0)
    setMoreError('')
    const first = Math.max(PAGE, Math.min(500, shownCount))
    api.ensembles({ q: query, need: needKey, offset: 0, limit: first, untitled }, ac.signal).then(
      (r) => {
        if (ac.signal.aborted) return
        setItems(r.items)
        setTotal(r.total)
        setHidden(r.hiddenUntitled)
        setProgress({ indexed: r.indexed, toIndex: r.toIndex, indexing: r.indexing })
        setPhase('ready')
      },
      (e: unknown) => {
        if (ac.signal.aborted) return
        setErrorMsg(errorText(e))
        setPhase('error')
      },
    )
    return () => ac.abort()
  }, [query, needKey, untitled]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (items.length) setShownCount(items.length)
  }, [items.length, setShownCount])
  useRestoreScroll(phase === 'ready')

  // While the background reader works, refresh the shown rows every 5 s.
  const indexing = progress.indexing
  useEffect(() => {
    if (phase !== 'ready' || !indexing) return
    let live = true
    const t = window.setInterval(() => {
      api
        .ensembles({
          q: query,
          need: needKey,
          offset: 0,
          limit: Math.max(PAGE, shown.current),
          untitled,
        })
        .then(
          (r) => {
            if (!live) return
            setItems(r.items)
            setTotal(r.total)
            setHidden(r.hiddenUntitled)
            setProgress({ indexed: r.indexed, toIndex: r.toIndex, indexing: r.indexing })
          },
          () => {
            // A failed poll keeps the rows on screen; the next tick tries again.
          },
        )
    }, POLL_MS)
    return () => {
      live = false
      window.clearInterval(t)
    }
  }, [phase, indexing, query, needKey, untitled])

  const loadMore = async () => {
    const key = requestKey.current
    setLoadingMore(true)
    setMoreError('')
    try {
      const r = await api.ensembles({
        q: query,
        need: needKey,
        offset: items.length,
        limit: PAGE,
        untitled,
      })
      if (requestKey.current !== key) return
      setItems((prev) => {
        const seen = new Set(prev.map((f) => f.path))
        return [...prev, ...r.items.filter((f) => !seen.has(f.path))]
      })
      setTotal(r.total)
      setProgress({ indexed: r.indexed, toIndex: r.toIndex, indexing: r.indexing })
    } catch (e) {
      if (requestKey.current === key) setMoreError(errorText(e))
    } finally {
      if (requestKey.current === key) setLoadingMore(false)
    }
  }

  const toggle = (key: string) =>
    setChips((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <>
      <header className="pb-2 pt-[22px] min-[861px]:pt-9">
        <h1 className="m-0 font-display text-[clamp(30px,5vw,44px)] font-black tracking-[0.02em]">
          找乐队谱
        </h1>
        <p className="pt-1.5 text-sm leading-relaxed text-muted-foreground">
          从谱库里找有多个乐器声部的 GP 谱。用下面的选项筛选，比如「完整乐队」= 同时有鼓、贝斯和吉他或键盘。
        </p>
      </header>

      <label className="relative block">
        <span className="sr-only">搜索歌名或歌手</span>
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
          id="ensemble-search"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="在这些乐队谱里搜歌名、歌手"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-14 w-full rounded-[14px] border-0 bg-card pl-[50px] pr-12 text-lg text-foreground outline-none ring-inset transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-primary [&::-webkit-search-cancel-button]:appearance-none"
        />
        {text && (
          <button
            type="button"
            aria-label="清空"
            onClick={() => {
              setText('')
              setQuery('')
            }}
            className="absolute right-2.5 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
          >
            <span aria-hidden>✕</span>
          </button>
        )}
      </label>

      <div role="group" aria-label="乐队要求" className="flex flex-wrap gap-2.5 pb-1.5 pt-4">
        {NEEDS.map(([key, label]) => {
          const on = chips.has(key)
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(key)}
              className={cx(
                'min-h-11 rounded-full border-[1.5px] px-4 text-[13px] transition-colors',
                on
                  ? 'border-primary text-primary'
                  : 'border-border text-foreground hover:border-foreground',
              )}
            >
              {on && (
                <span aria-hidden className="mr-1">
                  ✓
                </span>
              )}
              {label}
            </button>
          )
        })}
      </div>

      {progress.indexing && <IndexingBar progress={progress} />}

      {phase === 'loading' && (
        <p className="py-10 text-center text-sm text-muted-foreground">正在找…</p>
      )}
      {phase === 'error' && (
        <div className="py-4">
          <Notice tone="error">{errorMsg}</Notice>
        </div>
      )}
      {phase === 'ready' && (
        <Results
          items={items}
          total={total}
          hidden={hidden}
          untitled={untitled}
          onUntitled={setUntitled}
          progress={progress}
          loadingMore={loadingMore}
          moreError={moreError}
          onMore={loadMore}
        />
      )}
    </>
  )
}

/** The reader's progress: a slim bar and a line of text. */
function IndexingBar({ progress }: { progress: Progress }) {
  const { indexed, toIndex } = progress
  const pct = toIndex > 0 ? Math.min(100, Math.round((indexed / toIndex) * 100)) : 0
  return (
    <div className="pt-4">
      <div
        role="progressbar"
        aria-label="读取音轨进度"
        aria-valuemin={0}
        aria-valuemax={toIndex}
        aria-valuenow={indexed}
        className="h-1 overflow-hidden rounded-full bg-border"
      >
        <div
          className="h-full bg-primary transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="pt-1.5 text-xs leading-relaxed text-muted-foreground">
        正在读取谱子的音轨：已读 {indexed.toLocaleString('zh-CN')} /{' '}
        {toIndex.toLocaleString('zh-CN')}（第一次需要一段时间，期间可以照常使用）
      </p>
    </div>
  )
}

function Results({
  items,
  total,
  hidden,
  untitled,
  onUntitled,
  progress,
  loadingMore,
  moreError,
  onMore,
}: {
  items: EnsembleFile[]
  total: number
  hidden: number
  untitled: boolean
  onUntitled: (on: boolean) => void
  progress: Progress
  loadingMore: boolean
  moreError: string
  onMore: () => void
}) {
  if (items.length === 0) {
    let text = '没有符合条件的乐队谱。试试去掉一个筛选条件，或者换个歌名。'
    if (progress.indexing && progress.indexed === 0)
      text = '正在读取谱子的音轨，第一次需要一段时间。读完后这里会列出符合条件的乐队谱。'
    else if (progress.indexed === 0)
      text = '谱库里还没有读出音轨的 GP 谱，所以这里暂时没有内容。'
    return (
      <div className="py-6">
        <Notice>{text}</Notice>
      </div>
    )
  }

  return (
    <>
      <p className="flex flex-wrap items-center gap-x-3 px-1 pb-1 pt-3 text-xs text-muted-foreground">
        <span>
          共 <span className="mono">{total.toLocaleString('zh-CN')}</span> 首
        </span>
        {(hidden > 0 || untitled) && (
          <label className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={untitled}
              onChange={(e) => onUntitled(e.target.checked)}
            />
            {untitled
              ? '也显示读不出曲名的谱（排在最后）'
              : `也显示读不出曲名的谱（${hidden.toLocaleString('zh-CN')} 份，文件名只是数字或“未识别歌名”）`}
          </label>
        )}
      </p>
      <ol className="m-0 list-none p-0 pt-1">
        {items.map((f, i) => (
          <EnsembleRow key={f.path} file={f} index={i} />
        ))}
      </ol>

      {items.length < total && (
        <div className="flex flex-col gap-2 pb-24 pt-3">
          <button
            type="button"
            onClick={onMore}
            disabled={loadingMore}
            className={cx(buttonClass('outline'), 'w-full sm:w-auto')}
          >
            {loadingMore ? '正在加载…' : `再看 ${Math.min(PAGE, total - items.length)} 首`}
          </button>
          {moreError && <Notice tone="error">{moreError}</Notice>}
        </div>
      )}
    </>
  )
}

function EnsembleRow({ file: f, index }: { file: EnsembleFile; index: number }) {
  const band = useBand()
  const inSetlist = (band.state?.songs ?? []).some((s) => s.path === f.path)
  const [added, setAdded] = useState(false)
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')

  const title = f.title || fileBaseName(f.path)
  const onAdd = async () => {
    setAdding(true)
    setErr('')
    try {
      await addSong({ path: f.path, title, artist: f.artist })
      setAdded(true)
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setAdding(false)
    }
  }
  const listed = inSetlist || added
  const names = f.tracks
    .map((t) => t.name)
    .filter(Boolean)
    .join(' · ')

  return (
    <li className="border-t border-border py-3 first:border-t-0">
      <div className="grid grid-cols-[38px_minmax(0,1fr)] gap-2 min-[861px]:grid-cols-[52px_minmax(0,1fr)]">
        <span className="mono pr-3.5 text-right text-base font-semibold text-muted-foreground">
          {index + 1}.
        </span>
        <div className="min-w-0">
          <p className="m-0 flex flex-wrap items-baseline gap-x-2 break-words text-lg font-bold leading-snug">
            {f.title ? title : '曲名未识别'}
            {!f.title && (
              <span className="text-sm font-normal text-muted-foreground">{title}</span>
            )}
            {f.band && (
              <span className="inline-flex shrink-0 items-center rounded-full border border-primary px-1.5 text-[11px] leading-5 text-primary">
                完整乐队
              </span>
            )}
          </p>
          <p className="m-0 truncate text-[15px] text-muted-foreground">{f.artist || ' '}</p>
          <p className="pt-1 text-sm font-medium">{instrumentation(f)}</p>
          {names && (
            <p className="line-clamp-2 pt-0.5 text-xs leading-relaxed text-muted-foreground">
              {names}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-2.5">
            <Link
              href={hrefViewer({ path: f.path, format: 'score', title, artist: f.artist })}
              className={buttonClass('outline')}
            >
              看谱
            </Link>
            <button
              type="button"
              onClick={onAdd}
              disabled={listed || adding}
              className={buttonClass(listed ? 'ghost' : 'primary')}
            >
              {listed ? '已在歌单' : adding ? '正在加入…' : '加入歌单'}
            </button>
          </div>
          {err && (
            <p role="alert" className="pt-1.5 text-sm text-destructive">
              {err}
            </p>
          )}
        </div>
      </div>
    </li>
  )
}
