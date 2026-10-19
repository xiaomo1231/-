import { useEffect, useRef, useState } from 'react'
import { errorText, fileUrl, type DailyBacking, type DailyDay, type DailyState } from '../lib/api'
import { cx } from '../lib/classes'
import {
  clampDay,
  DAY_COUNT,
  doneCount,
  ensureStarted,
  markBpm,
  markDone,
  nextTempo,
  pickBacking,
  readReps,
  REPS_PER_TEMPO,
  startTempo,
  streak,
  todayNumber,
  useDaily,
  writeReps,
} from '../lib/daily'
import { hrefViewer } from '../lib/route'
import { Link } from '../components/Link'
import { Notice, PageBar, Seg, Staff } from '../components/ui'

const LANG_OPTIONS: ReadonlyArray<readonly ['zh' | 'en', string]> = [
  ['zh', '中文'],
  ['en', 'English'],
]

const SPEED_OPTIONS: ReadonlyArray<readonly ['0.5' | '0.75' | '1', string]> = [
  ['0.5', '0.5×'],
  ['0.75', '0.75×'],
  ['1', '1×'],
]

const dayHref = (n: number) => `#/daily?d=${n}`

const isAudio = (path: string) => /\.(mp3|m4a|wav|ogg|aac)$/i.test(path)
const isPdf = (path: string) => /\.pdf$/i.test(path)

/** 每日一练: today's exercise (or any day), its demo and backing, the done mark and the 52-week calendar. */
export function DailyPage({ day }: { day: number | null }) {
  const { state, error, reload } = useDaily()
  useEffect(() => {
    void ensureStarted()
  }, [])
  usePauseOtherAudio()

  if (!state) {
    return (
      <>
        <PageBar title="每日一练" fallback="#/" back="← 目录" />
        <Staff />
        <div className="max-w-[760px] py-6">
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

  if (!state.available) {
    return (
      <>
        <PageBar title="每日一练" fallback="#/" back="← 目录" />
        <Staff />
        <div className="max-w-[760px] py-6">
          <Notice>谱库里没有找到「每日一练」文件夹。</Notice>
        </div>
      </>
    )
  }

  const today = todayNumber(state.startedAt, Date.now())
  const shown = clampDay(day ?? today)
  const info = state.days.find((d) => d.day === shown)
  const done = state.done
  const isDone = typeof done[String(shown)] === 'number'
  const future = shown > today
  const current = streak(done, today)

  return (
    <>
      <PageBar
        title="每日一练"
        fallback="#/"
        back="← 目录"
        subtitle={
          info
            ? `第 ${shown} 天 · 第 ${info.week} 周 ${info.weekday} · 技巧：${info.technique}`
            : `第 ${shown} 天`
        }
      />
      <Staff />

      <div className="mono flex flex-wrap gap-x-5 gap-y-1 pt-3 text-xs text-muted-foreground">
        <span>已连续 {current} 天</span>
        <span>已完成 {doneCount(done)} / {DAY_COUNT}</span>
        {state.startedAt === null && <span>今天开始第 1 天</span>}
      </div>

      <div className="max-w-[760px] pt-5">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
          <DayNav shown={shown} />
          {future && <span className="mono text-xs text-muted-foreground">还没到</span>}
        </div>

        {info ? (
          <DayBody key={shown} day={info} state={state} shownDone={isDone} shownNumber={shown} future={future} />
        ) : (
          <div className="pt-5">
            <Notice>找不到第 {shown} 天的内容。</Notice>
          </div>
        )}

        <div className="pt-8">
          <p className="label mb-2.5">日历</p>
          <Calendar days={state.days} done={done} bpm={state.bpm} today={today} shown={shown} />
        </div>

        <Extras extras={state.extras} />
      </div>
    </>
  )
}

/** Only one <audio> plays at a time: starting one pauses the rest on the page. */
function usePauseOtherAudio() {
  useEffect(() => {
    const onPlay = (e: Event) => {
      document.querySelectorAll('audio').forEach((a) => {
        if (a !== e.target) a.pause()
      })
    }
    // play does not bubble, so listen in the capture phase on the document.
    document.addEventListener('play', onPlay, true)
    return () => document.removeEventListener('play', onPlay, true)
  }, [])
}

function DayNav({ shown }: { shown: number }) {
  const navClass =
    'inline-flex min-h-11 items-center rounded-lg border border-border px-3.5 text-sm transition-colors hover:border-foreground'
  return (
    <div className="flex items-center gap-2">
      {shown > 1 ? (
        <Link href={dayHref(shown - 1)} className={navClass} ariaLabel="前一天">
          ← 前一天
        </Link>
      ) : (
        <span className={cx(navClass, 'opacity-40')}>← 前一天</span>
      )}
      {shown < DAY_COUNT ? (
        <Link href={dayHref(shown + 1)} className={navClass} ariaLabel="后一天">
          后一天 →
        </Link>
      ) : (
        <span className={cx(navClass, 'opacity-40')}>后一天 →</span>
      )}
    </div>
  )
}

function DayBody({
  day,
  state,
  shownDone,
  shownNumber,
  future,
}: {
  day: DailyDay
  state: DailyState
  shownDone: boolean
  shownNumber: number
  future: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [markError, setMarkError] = useState<string | null>(null)

  const toggle = async () => {
    if (busy) return
    setBusy(true)
    setMarkError(null)
    try {
      await markDone(shownNumber, !shownDone)
    } catch (e) {
      setMarkError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const blocked = future && !shownDone
  const label = shownDone
    ? '标记为未完成'
    : blocked
      ? '还没到，不能提前标记'
      : shownNumber === todayNumber(state.startedAt, Date.now())
        ? '今天练完了 ✓'
        : `第 ${shownNumber} 天练完了 ✓`

  const book = bookText(day.bookPage)

  return (
    <div className="pt-5">
      <PracticeImage day={day} />

      {(day.method || book) && (
        <div className="pt-5 text-sm">
          {day.method && (
            <p className="m-0 leading-relaxed">
              <span className="label mr-2">练法</span>
              {day.method}
            </p>
          )}
          {book && <p className="mono m-0 pt-2 text-xs text-muted-foreground">{book}</p>}
        </div>
      )}

      <section aria-label="示范" className="pt-7">
        <p className="label mb-2.5">1 · 听示范</p>
        {day.demo ? (
          <DemoPlayer key={day.demo} path={day.demo} />
        ) : (
          <Notice>这一天没有示范音频。</Notice>
        )}
      </section>

      <section aria-label="跟伴奏练" className="pt-7">
        <p className="label mb-2.5">
          2 · 跟伴奏练{day.backingStyle ? `（${day.backingStyle}）` : ''}
        </p>
        <PracticePanel
          day={day}
          backing={state.backing}
          shown={shownNumber}
          recordedMax={state.bpm[String(shownNumber)] ?? null}
        />
      </section>

      <div className="pt-8">
        <button
          type="button"
          onClick={toggle}
          disabled={busy || blocked}
          aria-pressed={shownDone}
          className={cx(
            'flex min-h-14 w-full items-center justify-center rounded-lg text-lg font-bold transition-colors disabled:opacity-50',
            shownDone
              ? 'border border-border text-muted-foreground hover:border-foreground hover:text-foreground'
              : 'bg-primary text-primary-foreground hover:bg-primary-strong',
          )}
        >
          {busy ? '正在保存…' : label}
        </button>
        {markError && (
          <div className="pt-3">
            <Notice tone="error">{markError}</Notice>
          </div>
        )}
      </div>
    </div>
  )
}

/** 「书页：中文版第 8 页 / 英文版第 8 页」, or null when neither page is given. */
function bookText(page: DailyDay['bookPage']): string | null {
  if (!page) return null
  const parts = [
    page.zh !== null ? `中文版第 ${page.zh} 页` : null,
    page.en !== null ? `英文版第 ${page.en} 页` : null,
  ].filter((x): x is string => x !== null)
  return parts.length > 0 ? `书页：${parts.join(' / ')}` : null
}

function PracticeImage({ day }: { day: DailyDay }) {
  const hasZh = day.imageZh !== null
  const hasEn = day.imageEn !== null
  const [lang, setLang] = useState<'zh' | 'en'>(hasZh ? 'zh' : 'en')
  if (!hasZh && !hasEn) return <Notice>这一天没有练习图片。</Notice>

  const path = lang === 'zh' ? (day.imageZh ?? day.imageEn) : (day.imageEn ?? day.imageZh)
  if (!path) return <Notice>这一天没有练习图片。</Notice>
  const src = fileUrl(path)

  return (
    <section aria-label="练习图">
      {hasZh && hasEn && (
        <div className="pb-3">
          <Seg<'zh' | 'en'> label="图片语言" value={lang} onChange={setLang} options={LANG_OPTIONS} />
        </div>
      )}
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="打开大图"
        className="block overflow-hidden rounded-lg border border-border bg-card"
      >
        <img
          src={src}
          alt={`第 ${day.day} 天练习图`}
          loading="lazy"
          className="block h-auto w-full"
        />
      </a>
    </section>
  )
}

function DemoPlayer({ path }: { path: string }) {
  const ref = useRef<HTMLAudioElement>(null)
  const [loop, setLoop] = useState(false)
  const [speed, setSpeed] = useState<'0.5' | '0.75' | '1'>('1')

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = Number(speed)
  }, [speed])

  return (
    <div>
      <audio
        ref={ref}
        controls
        preload="none"
        src={fileUrl(path)}
        loop={loop}
        onLoadedMetadata={() => {
          if (ref.current) ref.current.playbackRate = Number(speed)
        }}
        className="w-full"
      />
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <Seg<'0.5' | '0.75' | '1'> label="播放速度" value={speed} onChange={setSpeed} options={SPEED_OPTIONS} />
        <button
          type="button"
          aria-pressed={loop}
          onClick={() => setLoop((v) => !v)}
          className={cx(
            'inline-flex min-h-11 items-center rounded-lg border px-3.5 text-[13px] transition-colors',
            loop ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          循环 {loop ? '开' : '关'}
        </button>
      </div>
    </div>
  )
}

/** One tempo of the day and the backing file that plays it (playsBpm differs when the nearest one is used). */
interface Rung {
  bpm: number
  path: string | null
  playsBpm: number | null
}

/** The day's own backing list (练习信息.json) or, when that is empty, the old style-and-tempo match. */
function ladderOf(day: DailyDay, backing: DailyBacking[]): Rung[] {
  if (day.backingList.length > 0)
    return day.backingList.map((b) => ({ bpm: b.bpm, path: b.path, playsBpm: b.bpm }))
  return day.tempos.map((t) => {
    const track = pickBacking(backing, day.backingStyle, t)
    return { bpm: t, path: track?.path ?? null, playsBpm: track?.bpm ?? null }
  })
}

/**
 * Step 2: the student starts on the slowest tempo not yet completed, counts 10 passes with
 * a tap (or Space), and then steps up by hand. Reaching 10 records the tempo for the day.
 */
function PracticePanel({
  day,
  backing,
  shown,
  recordedMax,
}: {
  day: DailyDay
  backing: DailyBacking[]
  shown: number
  recordedMax: number | null
}) {
  const ladder = ladderOf(day, backing)
  const startBpm = startTempo(ladder, recordedMax)?.bpm ?? null
  const [cur, setCur] = useState<number | null>(startBpm)
  const [reps, setReps] = useState(() => (startBpm === null ? 0 : readReps(shown, startBpm)))
  const [play, setPlay] = useState(false)
  const [loop, setLoop] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const rung = ladder.find((r) => r.bpm === cur) ?? null
  const next = cur === null ? null : nextTempo(ladder, cur)
  const finished = reps >= REPS_PER_TEMPO

  const select = (bpm: number) => {
    setCur(bpm)
    setReps(readReps(shown, bpm))
    setPlay(true)
    setSaveError(null)
  }

  const save = async (bpm: number) => {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await markBpm(shown, bpm)
    } catch (e) {
      setSaveError(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  const setRep = (n: number) => {
    if (cur === null) return
    setReps(n)
    writeReps(shown, cur, n)
  }

  const addRep = () => {
    if (cur === null || finished || saving) return
    const n = reps + 1
    setRep(n)
    if (n === REPS_PER_TEMPO) void save(cur)
  }

  // Space counts a pass while the page is open and nothing is being typed into.
  const addRepRef = useRef(addRep)
  useEffect(() => {
    addRepRef.current = addRep
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
      e.preventDefault()
      // Blur a focused button or player first, so the key release does not press it again.
      if (t && t !== document.body && typeof t.blur === 'function') t.blur()
      addRepRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (ladder.length === 0) return <Notice>这一天没有给出速度。</Notice>

  const recorded = cur !== null && recordedMax !== null && recordedMax >= cur

  return (
    <div>
      <p className="mono m-0 pb-2 text-xs text-muted-foreground">
        {recordedMax !== null ? `今天完成到 ${recordedMax} bpm` : '今天还没有完成的速度'}
      </p>

      <div role="group" aria-label="速度" className="flex flex-wrap gap-2">
        {ladder.map((r, i) => {
          const completed = recordedMax !== null && r.bpm <= recordedMax
          const active = r.bpm === cur
          return (
            <button
              key={`${i}-${r.bpm}`}
              type="button"
              aria-pressed={active}
              aria-label={`${r.bpm} bpm${completed ? '，已完成' : ''}`}
              onClick={() => select(r.bpm)}
              className={cx(
                'mono inline-flex min-h-11 min-w-[64px] items-center justify-center gap-1 rounded-full border px-3.5 text-sm transition-colors',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : completed
                    ? 'border-primary text-primary hover:border-foreground'
                    : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground',
              )}
            >
              {r.bpm}
              {completed && <span aria-hidden>✓</span>}
            </button>
          )
        })}
      </div>

      <div className="pt-4">
        {!rung || !rung.path ? (
          <Notice>没有找到「{day.backingStyle}」风格 {cur} bpm 的伴奏。</Notice>
        ) : (
          <>
            {rung.playsBpm !== null && rung.playsBpm !== rung.bpm && (
              <p className="pb-2 text-xs text-muted-foreground">
                没有 {rung.bpm} bpm 的伴奏，播放最接近的 {rung.playsBpm} bpm。
              </p>
            )}
            <audio
              key={rung.path}
              controls
              preload="auto"
              autoPlay={play}
              loop={loop}
              src={fileUrl(rung.path)}
              className="w-full"
            />
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <span className="mono text-xs text-muted-foreground">{cur} bpm 伴奏</span>
              <button
                type="button"
                aria-pressed={loop}
                onClick={() => setLoop((v) => !v)}
                className={cx(
                  'ml-auto inline-flex min-h-11 items-center rounded-lg border px-3.5 text-[13px] transition-colors',
                  loop ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                循环 {loop ? '开' : '关'}
              </button>
            </div>
          </>
        )}
      </div>

      {cur !== null && (
        <div className="pt-5">
          <p aria-live="polite" className="mono m-0 text-3xl font-bold">
            第 {reps} / {REPS_PER_TEMPO} 遍
          </p>
          <div
            role="progressbar"
            aria-label="这个速度的遍数"
            aria-valuemin={0}
            aria-valuemax={REPS_PER_TEMPO}
            aria-valuenow={reps}
            className="flex gap-1 pt-3"
          >
            {Array.from({ length: REPS_PER_TEMPO }, (_, i) => (
              <span
                key={i}
                className={cx('h-2.5 flex-1 rounded-full', i < reps ? 'bg-primary' : 'bg-border')}
              />
            ))}
          </div>

          <div className="flex items-stretch gap-2 pt-4">
            <button
              type="button"
              onClick={addRep}
              disabled={finished || saving}
              className="flex min-h-14 flex-1 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground transition-colors hover:bg-primary-strong disabled:opacity-40"
            >
              +1 遍
            </button>
            <button
              type="button"
              onClick={() => setRep(Math.max(0, reps - 1))}
              disabled={reps <= 0}
              aria-label="少算一遍"
              className="inline-flex min-h-14 min-w-14 items-center justify-center rounded-lg border border-border px-4 text-sm transition-colors hover:border-foreground disabled:opacity-40"
            >
              −1
            </button>
          </div>

          {finished && (
            <div className="flex flex-col gap-3 pt-5">
              <p className="m-0 text-base font-bold">这个速度练完了 ✓</p>
              {saving && <p className="m-0 text-xs text-muted-foreground">正在记录…</p>}
              {saveError && <Notice tone="error">{saveError}</Notice>}
              {!saving && !recorded && (
                <button
                  type="button"
                  onClick={() => void save(cur)}
                  className="inline-flex min-h-11 items-center justify-center self-start rounded-lg border border-border px-4 text-sm transition-colors hover:border-foreground"
                >
                  {saveError ? '重试记录' : '记录这个速度'}
                </button>
              )}
              {next ? (
                <button
                  type="button"
                  onClick={() => select(next.bpm)}
                  disabled={saving}
                  className="flex min-h-14 w-full items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground transition-colors hover:bg-primary-strong disabled:opacity-40"
                >
                  升到 {next.bpm} bpm →
                </button>
              ) : (
                <p className="m-0 text-base font-bold">
                  最快速度也练完了！今天练完了的话，点下面的「今天练完了 ✓」。
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 52 weeks as columns, the seven weekdays as rows. Done = filled, today = bordered, the viewed day = ringed. The recorded top tempo shows under the number. */
function Calendar({
  days,
  done,
  bpm,
  today,
  shown,
}: {
  days: DailyDay[]
  done: Record<string, number>
  bpm: Record<string, number>
  today: number
  shown: number
}) {
  const weeks = Math.ceil(DAY_COUNT / 7)
  const rowLabel = (row: number) => {
    const w = days.find((d) => d.day === row + 1)?.weekday ?? ''
    return w.slice(-1)
  }

  return (
    <div className="flex items-start gap-1.5">
      <div
        aria-hidden
        className="mono grid shrink-0 text-[11px] leading-9 text-muted-foreground"
        style={{ gridTemplateRows: 'repeat(7, 36px)' }}
      >
        {Array.from({ length: 7 }, (_, row) => (
          <span key={row} className="block h-9">
            {rowLabel(row)}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto pb-2">
        <div
          className="grid grid-flow-col gap-1"
          style={{
            gridTemplateRows: 'repeat(7, 36px)',
            gridTemplateColumns: `repeat(${weeks}, 36px)`,
          }}
        >
          {Array.from({ length: DAY_COUNT }, (_, i) => i + 1).map((d) => {
            const isDone = typeof done[String(d)] === 'number'
            const isFuture = d > today
            const isToday = d === today
            const isShown = d === shown
            const top = bpm[String(d)]
            return (
              <Link
                key={d}
                href={dayHref(d)}
                ariaLabel={`第 ${d} 天${isDone ? '，已完成' : ''}${isFuture ? '，还没到' : ''}${typeof top === 'number' ? `，练到 ${top} bpm` : ''}`}
                className={cx(
                  'mono flex h-9 w-9 flex-col items-center justify-center rounded-md border text-[12px] leading-none transition-colors',
                  isDone
                    ? 'border-primary bg-primary text-primary-foreground'
                    : isFuture
                      ? 'border-transparent text-muted-foreground opacity-40'
                      : 'border-border text-foreground hover:border-foreground',
                  isToday && !isDone && 'border-2 border-primary',
                  isShown && 'ring-2 ring-foreground ring-offset-2 ring-offset-background',
                )}
              >
                <span>{d}</span>
                {typeof top === 'number' && <span className="text-[8px] leading-none opacity-80">{top}</span>}
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Extras({ extras }: { extras: DailyState['extras'] }) {
  if (extras.length === 0) return null
  return (
    <details className="pt-8">
      <summary className="label flex min-h-11 cursor-pointer select-none items-center">
        全书与音频（{extras.length}）
      </summary>
      <ul className="m-0 list-none p-0 pt-2">
        {extras.map((x) => (
          <li key={x.path} className="border-t border-border py-3 first:border-t-0">
            <p className="m-0 break-words text-sm">{x.label}</p>
            {isAudio(x.path) ? (
              <audio controls preload="none" src={fileUrl(x.path)} className="mt-2 w-full" />
            ) : isPdf(x.path) ? (
              <Link
                href={hrefViewer({ path: x.path, format: 'pdf', title: x.label, artist: '' })}
                className="inline-flex min-h-11 items-center text-sm text-primary hover:underline"
              >
                在线查看 →
              </Link>
            ) : (
              <a
                href={fileUrl(x.path)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center text-sm text-primary hover:underline"
              >
                打开文件 →
              </a>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}
