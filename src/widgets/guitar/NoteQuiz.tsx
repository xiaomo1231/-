import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, History, Play, RotateCcw, SkipForward, X } from 'lucide-react'
import { usePitchDetector } from '@/features/audio/usePitchDetector'
import { useGuitarSetup } from '@/features/instrument/useGuitarSetup'
import { NATURAL_NAMES, noteQuiz, type NoteQuizItem } from '@/guitar/scales'
import { StableNoteTracker } from '@/guitar/checks'
import { midiToName } from '@/music/pitch'
import { Fretboard } from '@/widgets/instrument/Fretboard'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'
import { RunService } from '@/services/runService'
import { logger } from '@/infrastructure/logger/logger'
import type { ActiveRun } from '@/entities/types'

const STRING_NAME = ['6 弦', '5 弦', '4 弦', '3 弦', '2 弦', '1 弦']

export interface QuizResult {
  passed: boolean
  score: number
  summary: string
}

interface QuizProps {
  count: number
  strings?: number[] | undefined
  onDone: (r: QuizResult) => void
  /** Set to make the quiz resumable (a drill run keyed by this id). */
  runId?: string | undefined
  runTitle?: string | undefined
}

const newSeed = () => Date.now() % 100000
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** What a quiz body receives from the run gate. */
interface RunHandle<S> {
  seed: number
  /** Progress restored from a saved run, or null for a fresh start. */
  restored: S | null
  /** Save progress: questions finished, first-try/clean correct count, plain state. */
  save: (done: number, correct: number, state: S) => void
  /** The quiz finished: forget the saved run. */
  finish: () => void
  /** 再来一组: a new seed, a fresh body. */
  again: () => void
}

/**
 * Handles the saved run for a quiz: offers 继续 / 重新开始 when one is left
 * over, then mounts the quiz body keyed by attempt so every (re)start is fresh.
 */
function QuizRun<S extends object>({
  runId,
  runTitle,
  count,
  children,
}: {
  runId?: string | undefined
  runTitle?: string | undefined
  count: number
  children: (run: RunHandle<S>) => ReactNode
}) {
  const [phase, setPhase] = useState<'loading' | 'offer' | 'ready'>(runId ? 'loading' : 'ready')
  const [offer, setOffer] = useState<ActiveRun | null>(null)
  const [seed, setSeed] = useState(newSeed)
  const [restored, setRestored] = useState<S | null>(null)
  const [attempt, setAttempt] = useState(0)
  const chain = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    if (!runId) return
    let cancelled = false
    void (async () => {
      const saved = await RunService.get(runId)
      if (cancelled) return
      if (saved && saved.kind === 'guitar-quiz') {
        setOffer(saved)
        setPhase('offer')
      } else {
        setPhase('ready')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [runId])

  const begin = (s: number, r: S | null) => {
    setSeed(s)
    setRestored(r)
    setAttempt((a) => a + 1)
    setPhase('ready')
  }

  const resume = (saved: ActiveRun) => {
    const { seed: s, ...rest } = (saved.data ?? {}) as Record<string, unknown>
    if (typeof s !== 'number') {
      void restart()
      return
    }
    setOffer(null)
    begin(s, rest as unknown as S)
  }

  const restart = async () => {
    setOffer(null)
    if (runId) await RunService.discard(runId)
    begin(newSeed(), null)
  }

  const save = (done: number, correct: number, state: S) => {
    if (!runId) return
    const id = runId
    chain.current = chain.current
      .then(() =>
        RunService.save({
          id,
          kind: 'guitar-quiz',
          title: runTitle ?? '吉他工坊',
          link: window.location.pathname,
          done,
          total: count,
          correct,
          data: { seed, ...state },
        }),
      )
      .catch((err) => logger.warn('Saving guitar quiz progress failed', { error: err instanceof Error ? err.message : String(err) }))
  }

  const finish = () => {
    if (!runId) return
    const id = runId
    chain.current = chain.current.then(() => RunService.clear(id))
  }

  if (phase === 'loading') return <p className="text-sm text-muted-foreground">正在检查上次的进度…</p>

  if (phase === 'offer' && offer) {
    return (
      <div className="mx-auto max-w-lg rounded-3xl border border-cyan/40 bg-card p-7 text-center shadow-lift">
        <History className="mx-auto h-8 w-8 text-cyan" aria-hidden />
        <h2 className="mt-3 text-xl font-semibold">上次还没做完</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          做到第 <b className="num text-foreground">{offer.done}</b> / {offer.total} 题，答对 <b className="num text-foreground">{offer.correct}</b> 题。
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <Button onClick={() => resume(offer)} autoFocus>
            <Play /> 继续
          </Button>
          <Button variant="outline" onClick={() => void restart()}>
            <RotateCcw /> 重新开始
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Fragment key={attempt}>
      {children({ seed, restored, save, finish, again: () => begin(newSeed(), null) })}
    </Fragment>
  )
}

function useQuizItems(count: number, strings: number[] | undefined, seed: number) {
  const { played } = useGuitarSetup()
  const items = useMemo(() => noteQuiz(count, played.strings, seed, strings), [count, played.strings, seed, strings])
  return { items, played }
}

interface NameState {
  i: number
  firstTry: number
  missedThis: boolean
}

/** Name the marked fret. First-try answers count. */
export function NoteNameQuiz(props: QuizProps) {
  const { count, strings, onDone, runId, runTitle } = props
  return (
    <QuizRun<NameState> runId={runId} runTitle={runTitle} count={count}>
      {(run) => <NameBody count={count} strings={strings} onDone={onDone} run={run} />}
    </QuizRun>
  )
}

function NameBody({
  count,
  strings,
  onDone,
  run,
}: {
  count: number
  strings: number[] | undefined
  onDone: (r: QuizResult) => void
  run: RunHandle<NameState>
}) {
  const { items, played } = useQuizItems(count, strings, run.seed)
  const [i, setI] = useState(() => Math.min(Math.max(0, num(run.restored?.i, 0)), items.length))
  const [firstTry, setFirstTry] = useState(() => num(run.restored?.firstTry, 0))
  const [wrong, setWrong] = useState<string | null>(null)
  const [missedThis, setMissedThis] = useState(() => run.restored?.missedThis === true)
  const item = items[i]

  useEffect(() => {
    if (!item) return
    run.save(i, firstTry, { i, firstTry, missedThis })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, firstTry, missedThis])

  if (!item) {
    return (
      <div className="space-y-3" role="status">
        <p>
          一次答对 <b className="num">{firstTry}</b> / {items.length}
        </p>
        <Button variant="outline" onClick={run.again}>
          <RotateCcw /> 再来一组
        </Button>
      </div>
    )
  }

  const answer = (name: string) => {
    if (name === item.name) {
      const ft = firstTry + (missedThis ? 0 : 1)
      setFirstTry(ft)
      setWrong(null)
      setMissedThis(false)
      if (i + 1 >= items.length) {
        const score = ft / items.length
        run.finish()
        onDone({ passed: score >= 0.8, score, summary: `一次答对 ${ft}/${items.length}` })
      }
      setI(i + 1)
    } else {
      setWrong(name)
      setMissedThis(true)
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        第 {i + 1} / {items.length} 题 · 已一次答对 {firstTry}
      </div>
      <Fretboard tuning={played} markers={[{ string: item.string, fret: item.fret, midi: item.midi, tone: 'root' }]} />
      <p className="text-lg">
        {STRING_NAME[item.string]} {item.fret} 品是什么音？
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="选择音名">
        {NATURAL_NAMES.map((n) => (
          <Button key={n.name} variant={wrong === n.name ? 'destructive' : 'outline'} className="w-14" onClick={() => answer(n.name)}>
            {n.name}
          </Button>
        ))}
      </div>
      {wrong && (
        <p role="alert" className="text-sm text-amber">
          不是 {wrong}。从这根弦的空弦音往上数一数，记得 E–F、B–C 只差一品。
        </p>
      )}
    </div>
  )
}

interface FindState {
  i: number
  clean: number
  errors: number
  log: Array<{ item: NoteQuizItem; ok: boolean }>
}

/** Play the asked note on the asked string; the pitch decides. */
export function NoteFindQuiz(props: QuizProps) {
  const { count, strings, onDone, runId, runTitle } = props
  return (
    <QuizRun<FindState> runId={runId} runTitle={runTitle} count={count}>
      {(run) => <FindBody count={count} strings={strings} onDone={onDone} run={run} />}
    </QuizRun>
  )
}

function FindBody({
  count,
  strings,
  onDone,
  run,
}: {
  count: number
  strings: number[] | undefined
  onDone: (r: QuizResult) => void
  run: RunHandle<FindState>
}) {
  const { items, played } = useQuizItems(count, strings, run.seed)
  const mic = usePitchDetector('guitar', true)
  // The pitch tracker is transient: it is never saved.
  const tracker = useRef(new StableNoteTracker(4))
  const saved = run.restored
  const [i, setI] = useState(() => Math.min(Math.max(0, num(saved?.i, 0)), items.length))
  const [clean, setClean] = useState(() => num(saved?.clean, 0))
  const [heard, setHeard] = useState<number | null>(null)
  const [errors, setErrors] = useState(() => num(saved?.errors, 0))
  const [log, setLog] = useState<Array<{ item: NoteQuizItem; ok: boolean }>>(() => (Array.isArray(saved?.log) ? saved.log : []))
  const item = items[i]

  useEffect(() => {
    if (!item) return
    run.save(i, clean, { i, clean, errors, log })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, clean, errors, log])

  useEffect(() => {
    if (!mic.frame || !item) return
    const note = tracker.current.push(mic.frame)
    if (note === null) return
    if (note === item.midi) {
      const ok = errors === 0
      const c = clean + (ok ? 1 : 0)
      setClean(c)
      setLog((l) => [...l, { item, ok }])
      setHeard(null)
      setErrors(0)
      tracker.current.reset()
      if (i + 1 >= items.length) {
        const score = c / items.length
        run.finish()
        onDone({ passed: score >= 0.75, score, summary: `一次找对 ${c}/${items.length}` })
      }
      setI(i + 1)
    } else {
      setHeard(note)
      setErrors((e) => e + 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mic.frame])

  if (!item) {
    return (
      <div className="space-y-3" role="status">
        <p>
          一次找对 <b className="num">{clean}</b> / {items.length}
        </p>
        <ul className="flex flex-wrap gap-2 text-sm">
          {log.map((l, k) => (
            <li key={k} className="flex items-center gap-1">
              {l.ok ? <Check className="h-3.5 w-3.5 text-success" aria-label="一次找对" /> : <X className="h-3.5 w-3.5 text-amber" aria-label="找了几次" />}
              {STRING_NAME[l.item.string]} {l.item.name}
            </li>
          ))}
        </ul>
        <Button variant="outline" onClick={run.again}>
          <RotateCcw /> 再来一组
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        第 {i + 1} / {items.length} 题 · 已一次找对 {clean}
      </div>
      {mic.error && (
        <p role="alert" className="text-sm text-destructive">
          {mic.error}
        </p>
      )}
      <p className="text-2xl" aria-live="polite">
        在 <b>{STRING_NAME[item.string]}</b> 上弹 <b className="text-amber">{item.name}</b>
      </p>
      <Fretboard tuning={played} markers={[]} />
      {heard !== null && (
        <p role="alert" className={cn('text-sm', 'text-amber')}>
          听到的是 {midiToName(heard, { octave: true })}。在这根弦上再找一找。
        </p>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setLog((l) => [...l, { item, ok: false }])
          setErrors(0)
          setHeard(null)
          tracker.current.reset()
          if (i + 1 >= items.length) {
            const score = clean / items.length
            run.finish()
            onDone({ passed: score >= 0.75, score, summary: `一次找对 ${clean}/${items.length}` })
          }
          setI(i + 1)
        }}
      >
        <SkipForward /> 跳过（显示答案：{item.fret} 品）
      </Button>
    </div>
  )
}
