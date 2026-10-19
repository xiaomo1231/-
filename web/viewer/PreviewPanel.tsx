import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { AlphaTabApi, model } from '@coderline/alphatab'
import type { ScoreFormat } from '@/songs/scoreLibraryTypes'
import { fetchBytes, fileUrl } from '../lib/api'
import { buttonClass, cx } from '../lib/classes'
import { fileBaseName } from '../lib/format'
import { toggleFavorite, useFavorites } from '../lib/favorites'
import { closePreview, markSeen, openPreview, usePreview, type PreviewItem } from '../lib/preview'
import { hrefViewer, navigate } from '../lib/route'
import { Notice } from '../components/ui'
import { TextViewer } from './TextViewer'
import { alphaTabUrls, chooseEncoding, cleanHeader, loadAlphaTab, tidyTempoMarks } from './alphaTab'
import { soundFontUrl } from './soundFonts'
import { loadPrefs, sheetResources } from './scorePrefs'
import { trackLabels } from './trackNames'

const PREVIEW_MSG = '这个文件没能预览，可以打开完整页面试试。'
const DESKTOP_QUERY = '(min-width: 861px)'

/** Exit lengths: the panel is unmounted only after its exit transition. */
const EXIT_DESK_MS = 180
const EXIT_PHONE_MS = 240
/** A flick this fast (px per ms) closes the sheet however short the drag. */
const FLICK_SPEED = 0.11

// Transitions (not keyframes), so opening / closing / dragging retarget mid-motion.
const PREVIEW_CSS = `
.gl-preview-desk {
  transform: translateX(16px); opacity: 0;
  transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1), opacity 200ms cubic-bezier(0.23, 1, 0.32, 1);
}
.gl-preview-desk[data-state="open"] { transform: none; opacity: 1; }
.gl-preview-desk[data-state="leaving"] { transition-duration: ${EXIT_DESK_MS}ms; }
.gl-preview-phone {
  transform: translateY(100%);
  transition: transform 280ms cubic-bezier(0.32, 0.72, 0, 1);
}
.gl-preview-phone[data-state="open"] { transform: translateY(var(--drag, 0px)); }
.gl-preview-phone[data-state="leaving"] { transition-duration: ${EXIT_PHONE_MS}ms; }
.gl-preview-phone[data-dragging] { transition: none; }
.gl-preview-back { opacity: 0; transition: opacity 150ms ease-out; }
.gl-preview-back[data-state="open"] { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .gl-preview-desk, .gl-preview-phone { transform: none; transition: opacity 150ms ease; opacity: 0; }
  .gl-preview-desk[data-state="open"], .gl-preview-phone[data-state="open"] { transform: none; opacity: 1; }
}
`

type Kind = '吉他' | '贝斯' | '键盘' | '人声' | '鼓'
const KIND_ORDER: Kind[] = ['吉他', '贝斯', '键盘', '人声', '鼓']

/** What a track is, from its drum flag, General MIDI program and name. */
function kindOf(t: model.Track): Kind {
  const name = t.name ?? ''
  const program = t.playbackInfo.program
  if (t.isPercussion || t.staves[0]?.isPercussion) return '鼓'
  if ((program >= 32 && program <= 39) || /贝斯|bass/i.test(name)) return '贝斯'
  if (/键盘|钢琴|piano|keys|keyboard/i.test(name) || (program >= 0 && program <= 7)) return '键盘'
  if ((program >= 52 && program <= 54) || /人声|vocal|voice/i.test(name)) return '人声'
  return '吉他'
}

/** "吉他×2 · 贝斯 · 鼓" for a loaded score. */
function kindSummary(tracks: ReadonlyArray<model.Track>): string {
  const counts = new Map<Kind, number>()
  for (const t of tracks) {
    const k = kindOf(t)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return KIND_ORDER.filter((k) => counts.has(k))
    .map((k) => {
      const n = counts.get(k) ?? 0
      return n > 1 ? `${k}×${n}` : k
    })
    .join(' · ')
}

/** m:ss from milliseconds. */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function useIsDesktop(): boolean {
  const [desk, setDesk] = useState(() => window.matchMedia(DESKTOP_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY)
    const on = () => setDesk(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return desk
}

/**
 * 快速预览 host: a side panel on wide screens, a bottom sheet on phones. Renders
 * nothing while no preview is open.
 */
export function PreviewHost() {
  const { item, siblings, index } = usePreview()
  if (!item) return null
  // One sheet for the whole visit: switching versions swaps the body, not the panel (no re-entry).
  return <PreviewSheet item={item} siblings={siblings} index={index} />
}

function PreviewSheet({
  item,
  siblings,
  index,
}: {
  item: PreviewItem
  siblings: PreviewItem[]
  index: number
}) {
  const desktop = useIsDesktop()
  const [headerH, setHeaderH] = useState(0)
  const [kinds, setKinds] = useState('')
  const [dragY, setDragY] = useState(0)
  const drag = useRef<{ y: number; t: number } | null>(null)
  // Entering: rendered closed, then opened on the next frame so the transition runs.
  const [state, setState] = useState<'closed' | 'open' | 'leaving'>('closed')
  useEffect(() => {
    const open = () => setState((st) => (st === 'closed' ? 'open' : st))
    // Next frame; a timer too, because a background tab runs no frames.
    const raf = requestAnimationFrame(open)
    const timer = window.setTimeout(open, 50)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }
  }, [])
  const leaveTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(leaveTimer.current), [])

  useEffect(() => {
    markSeen(item.path)
    setKinds('')
    // Another preview opened while this one was leaving: stay open.
    window.clearTimeout(leaveTimer.current)
    setState((s) => (s === 'leaving' ? 'open' : s))
  }, [item.path])

  // The desktop panel starts just below the site header (as the score viewer measures it).
  useEffect(() => {
    const header = document.querySelector('header')
    if (!header) return
    const measure = () => setHeaderH(header.getBoundingClientRect().height)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(header)
    return () => ro.disconnect()
  }, [])

  // Escape closes; ArrowUp / ArrowDown move to the neighbouring version.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeRef.current()
        return
      }
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      const next = siblings[index + (e.key === 'ArrowDown' ? 1 : -1)]
      if (!next) return
      e.preventDefault()
      openPreview(next, siblings)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [siblings, index])

  /** Plays the exit, then unmounts (a new preview opened meanwhile cancels it). */
  const close = () => {
    if (state === 'leaving') return
    setState('leaving')
    setDragY(0)
    window.clearTimeout(leaveTimer.current)
    leaveTimer.current = window.setTimeout(closePreview, desktop ? EXIT_DESK_MS : EXIT_PHONE_MS)
  }
  const closeRef = useRef(close)
  closeRef.current = close
  const openFull = () => {
    navigate(
      hrefViewer({
        path: item.path,
        format: item.format,
        pages: item.pages,
        title: item.title,
        artist: item.artist,
      }),
    )
    closePreview()
  }

  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { y: e.clientY, t: performance.now() }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onHandleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current === null) return
    setDragY(Math.max(0, e.clientY - drag.current.y))
  }
  // Far enough or fast enough closes it (sliding on from where the finger left it);
  // otherwise it springs back.
  const onHandleUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current === null) return
    const moved = Math.max(0, e.clientY - drag.current.y)
    const speed = moved / Math.max(1, performance.now() - drag.current.t)
    drag.current = null
    if (moved > 80 || speed > FLICK_SPEED) close()
    else setDragY(0)
  }

  let body
  switch (item.format) {
    case 'score':
      body = <ScoreBody key={item.path} path={item.path} onSummary={setKinds} />
      break
    case 'pdf':
      body = (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <iframe
            title="PDF 谱子"
            src={fileUrl(item.path)}
            className="min-h-0 w-full flex-1 rounded-lg border border-border bg-white"
          />
          <a
            href={fileUrl(item.path)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline"
          >
            在新窗口打开 PDF
          </a>
        </div>
      )
      break
    case 'image': {
      const pages = item.pages.length > 0 ? item.pages : [item.path]
      body = (
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
          <ol className="space-y-4 p-4">
            {pages.map((p, i) => (
              <li key={p} className="space-y-2">
                <p className="mono text-[11px] text-muted-foreground">
                  第 {i + 1} / {pages.length} 页
                </p>
                <img
                  src={fileUrl(p)}
                  alt={`第 ${i + 1} 页`}
                  loading="lazy"
                  decoding="async"
                  className="block h-auto w-full"
                />
              </li>
            ))}
          </ol>
        </div>
      )
      break
    }
    case 'text':
      body = (
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-4">
          <TextViewer key={item.path} path={item.path} />
        </div>
      )
      break
    default:
      body = (
        <div className="min-h-0 flex-1 p-6 text-center text-sm text-muted-foreground">
          这种文件不能预览。可以打开完整页面，或下载后用电脑上的程序打开。
        </div>
      )
  }

  const header = (
    <header className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-lg font-black leading-snug">{item.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {[item.artist, item.label || fileBaseName(item.path)].filter(Boolean).join(' · ')}
        </p>
        {kinds && <p className="mono truncate text-[11px] text-primary">{kinds}</p>}
      </div>
      <button
        type="button"
        onClick={close}
        aria-label="关闭预览"
        title="关闭预览 (Esc)"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-lg text-muted-foreground hover:bg-card hover:text-foreground min-[861px]:h-9 min-[861px]:w-9"
      >
        <span aria-hidden>✕</span>
      </button>
    </header>
  )

  const footer = (
    <PreviewFooter item={item} siblings={siblings} index={index} onOpenFull={openFull} />
  )

  if (desktop) {
    return (
      <>
        <style>{PREVIEW_CSS}</style>
        <aside
          aria-label="快速预览"
          data-state={state}
          style={{ top: headerH }}
          className="gl-preview-desk fixed bottom-0 right-0 z-40 flex w-[min(46vw,720px)] flex-col border-l border-border bg-background shadow-[-12px_0_32px_-16px_rgba(0,0,0,0.45)]"
        >
          {header}
          <div className="flex min-h-0 flex-1 flex-col">{body}</div>
          {footer}
        </aside>
      </>
    )
  }

  return (
    <>
      <style>{PREVIEW_CSS}</style>
      <div
        className="gl-preview-back fixed inset-0 z-[55] bg-black/25"
        data-state={state}
        onClick={close}
        aria-hidden
      />
      <section
        role="dialog"
        aria-label="快速预览"
        data-state={state}
        data-dragging={drag.current !== null && dragY > 0 ? '' : undefined}
        style={{ height: '72dvh', ['--drag' as string]: `${dragY}px` }}
        className="gl-preview-phone fixed inset-x-0 bottom-0 z-[60] flex flex-col rounded-t-2xl border-t border-border bg-background shadow-[0_-12px_32px_-12px_rgba(0,0,0,0.45)]"
      >
        <div
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          title="向下拖动可关闭"
          className="grid h-7 shrink-0 cursor-grab touch-none place-items-center"
        >
          <span className="h-1 w-10 rounded-full bg-muted-foreground/50" />
        </div>
        {header}
        <div className="flex min-h-0 flex-1 flex-col">{body}</div>
        {footer}
      </section>
    </>
  )
}

function PreviewFooter({
  item,
  siblings,
  index,
  onOpenFull,
}: {
  item: PreviewItem
  siblings: PreviewItem[]
  index: number
  onOpenFull: () => void
}) {
  const { items } = useFavorites()
  const starred = items.some((f) => f.path === item.path)
  const [note, setNote] = useState('')
  const prev = index > 0 ? siblings[index - 1] : undefined
  const next = index < siblings.length - 1 ? siblings[index + 1] : undefined

  const toggle = async () => {
    try {
      const now = await toggleFavorite({
        path: item.path,
        format: item.format as ScoreFormat,
        pages: item.pages.length > 0 ? item.pages : [item.path],
        title: item.title,
        artist: item.artist,
      })
      setNote(now ? '已收藏' : '已取消收藏')
    } catch (e) {
      setNote(e instanceof Error ? e.message : '没能保存收藏。')
    }
    window.setTimeout(() => setNote(''), 2200)
  }

  const navBtn =
    'h-11 rounded-lg border border-border px-3 text-sm disabled:opacity-40 min-[861px]:h-9'

  return (
    <footer
      className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-4 py-2.5"
      style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}
    >
      <button
        type="button"
        aria-pressed={starred}
        onClick={() => void toggle()}
        className={cx(
          'inline-flex h-11 items-center gap-1.5 rounded-lg px-2.5 text-sm min-[861px]:h-9',
          starred ? 'text-primary' : 'text-muted-foreground hover:text-primary',
        )}
      >
        <span aria-hidden className="text-base">
          {starred ? '★' : '☆'}
        </span>
        {starred ? '已收藏' : '收藏'}
      </button>
      {note && (
        <span role="status" className="text-xs text-muted-foreground">
          {note}
        </span>
      )}
      <span className="flex-1" />
      <button
        type="button"
        disabled={!prev}
        onClick={() => {
          if (prev) openPreview(prev, siblings)
        }}
        className={navBtn}
      >
        上一个
      </button>
      <button
        type="button"
        disabled={!next}
        onClick={() => {
          if (next) openPreview(next, siblings)
        }}
        className={navBtn}
      >
        下一个
      </button>
      <button
        type="button"
        onClick={onOpenFull}
        className={buttonClass('primary') + ' h-11 min-[861px]:h-9'}
      >
        打开完整页面 →
      </button>
    </footer>
  )
}

/** The score player: 播放 / 停止, a track picker, volume and time; the notation scrolls below. */
function ScoreBody({ path, onSummary }: { path: string; onSummary: (summary: string) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const apiRef = useRef<AlphaTabApi | null>(null)
  const summaryRef = useRef(onSummary)
  summaryRef.current = onSummary
  const [score, setScore] = useState<model.Score | null>(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [track, setTrack] = useState(0)
  const [volume, setVolume] = useState(1)
  const [time, setTime] = useState({ now: 0, end: 0 })

  useEffect(() => {
    const el = host.current
    if (!el) return
    let disposed = false
    let api: AlphaTabApi | null = null
    const ac = new AbortController()
    const fail = () => {
      if (!disposed) setError(PREVIEW_MSG)
    }

    const run = async () => {
      try {
        const [bytes, at] = await Promise.all([
          fetchBytes(fileUrl(path), ac.signal),
          loadAlphaTab(),
        ])
        if (disposed) return
        const urls = alphaTabUrls()
        const a = new at.AlphaTabApi(el, {
          core: { scriptFile: urls.script, fontDirectory: urls.fonts, useWorkers: true },
          importer: { encoding: chooseEncoding(at, bytes) },
          display: {
            layoutMode: at.LayoutMode.Page,
            scale: 0.8,
            staveProfile: at.StaveProfile.Default,
            resources: sheetResources(loadPrefs().sheet),
          },
          player: {
            playerMode: at.PlayerMode.EnabledSynthesizer,
            soundFont: soundFontUrl('basic'),
            scrollElement: scroll.current ?? undefined,
            enableCursor: true,
            enableUserInteraction: true,
          },
        } as never)
        api = a
        apiRef.current = a
        a.scoreLoaded.on((s) => {
          if (disposed) return
          cleanHeader(s)
          tidyTempoMarks(s)
          setScore(s)
          summaryRef.current(kindSummary(s.tracks))
        })
        a.playerReady.on(() => {
          if (!disposed) setReady(true)
        })
        a.playerStateChanged.on((e) => {
          if (!disposed) setPlaying(e.state === 1)
        })
        a.playerPositionChanged.on((e) => {
          if (!disposed) setTime({ now: e.currentTime, end: e.endTime })
        })
        if (!a.load(bytes, [0])) fail()
      } catch {
        fail()
      }
    }
    void run()

    return () => {
      disposed = true
      ac.abort()
      apiRef.current = null
      if (api) {
        api.stop()
        api.destroy()
      }
    }
  }, [path])

  useEffect(() => {
    if (apiRef.current) apiRef.current.masterVolume = volume
  }, [volume, ready])

  const labels = score ? trackLabels(score.tracks) : []

  const pickTrack = (i: number) => {
    setTrack(i)
    const t = score?.tracks[i]
    if (t) apiRef.current?.renderTracks([t])
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-sm">
        <button
          type="button"
          onClick={() => apiRef.current?.playPause()}
          disabled={!ready}
          aria-label={playing ? '暂停' : '播放'}
          className="grid h-11 w-11 place-items-center rounded-lg border border-border disabled:opacity-40 min-[861px]:h-9 min-[861px]:w-9"
        >
          <span aria-hidden>{playing ? '❚❚' : '▶'}</span>
        </button>
        <button
          type="button"
          onClick={() => apiRef.current?.stop()}
          disabled={!ready}
          aria-label="回到开头"
          className="grid h-11 w-11 place-items-center rounded-lg border border-border disabled:opacity-40 min-[861px]:h-9 min-[861px]:w-9"
        >
          <span aria-hidden>■</span>
        </button>
        {labels.length > 1 && (
          <select
            aria-label="音轨"
            value={track}
            onChange={(e) => pickTrack(Number(e.target.value))}
            className="h-11 min-w-0 max-w-[11rem] truncate rounded-lg border border-border bg-background px-2 min-[861px]:h-9"
          >
            {labels.map((l, i) => (
              <option key={i} value={i}>
                {l.zh}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-muted-foreground">
          <span aria-hidden className="text-xs">
            音量
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label="音量"
            className="w-24 accent-[hsl(var(--primary))]"
          />
        </label>
        <span className="mono ml-auto text-xs text-muted-foreground">
          {clock(time.now)} / {clock(time.end)}
        </span>
      </div>

      <div ref={scroll} className="min-h-0 flex-1 overflow-auto overscroll-contain">
        {error ? (
          <div className="p-4">
            <Notice tone="error">{error}</Notice>
          </div>
        ) : (
          !score && <p className="py-10 text-center text-sm text-muted-foreground">正在载入…</p>
        )}
        <div ref={host} className="sheet" />
      </div>
    </div>
  )
}
