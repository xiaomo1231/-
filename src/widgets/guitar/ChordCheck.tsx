import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, RotateCcw, SkipForward, X } from 'lucide-react'
import { usePitchDetector } from '@/features/audio/usePitchDetector'
import { useChordTargets } from '@/features/guitar/useChordTargets'
import { StableNoteTracker, chordCheckDone, chordCheckNote, chordCheckPassed, chordCheckSkip, startChordCheck, type ChordCheckState } from '@/guitar/checks'
import { midiToName } from '@/music/pitch'
import { ChordDiagram } from '@/widgets/instrument/ChordDiagram'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

const STRING_NAME = ['6 弦', '5 弦', '4 弦', '3 弦', '2 弦', '1 弦']

export interface ChordCheckProps {
  chords: string[]
  /** Called once every chord has been checked. */
  onDone: (result: { passed: boolean; score: number; summary: string }) => void
}

/**
 * Pluck each string of the chord, low to high. Each string's pitch is
 * compared with the shape (tuning and capo applied); a wrong note marks the
 * string for a retry, so the student finds the finger that is off.
 */
export function ChordCheck({ chords, onDone }: ChordCheckProps) {
  const all = useChordTargets(chords)
  const [chordIndex, setChordIndex] = useState(0)
  const [results, setResults] = useState<ChordCheckState[]>([])
  const current = all[chordIndex]
  const [state, setState] = useState<ChordCheckState | null>(null)
  const tracker = useRef(new StableNoteTracker(4))
  const mic = usePitchDetector('guitar', true)

  useEffect(() => {
    if (current) setState(startChordCheck(current.targets))
    tracker.current.reset()
  }, [current])

  // Each pitch frame is processed exactly once.
  useEffect(() => {
    if (!mic.frame) return
    const note = tracker.current.push(mic.frame)
    if (note !== null) setState((s) => (s && !chordCheckDone(s) ? chordCheckNote(s, note) : s))
  }, [mic.frame])

  useEffect(() => {
    if (!state || !chordCheckDone(state)) return
    const t = setTimeout(() => {
      const next = [...results, state]
      if (chordIndex + 1 < all.length) {
        setResults(next)
        setChordIndex(chordIndex + 1)
      } else {
        const total = next.reduce((s, r) => s + r.targets.length, 0)
        const first = next.reduce((s, r) => s + r.firstTry, 0)
        const passed = next.every(chordCheckPassed)
        onDone({ passed, score: total ? first / total : 0, summary: `一次按准 ${first}/${total} 根弦` })
        setResults(next)
        setChordIndex(all.length)
      }
    }, 700)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const listening = mic.state === 'live'
  const doneAll = chordIndex >= all.length

  const summary = useMemo(
    () =>
      results.map((r, i) => ({
        symbol: all[i]?.symbol,
        ok: chordCheckPassed(r),
        first: r.firstTry,
        total: r.targets.length,
      })),
    [results, all],
  )

  if (doneAll) {
    return (
      <div className="space-y-3" role="status">
        {summary.map((s) => (
          <div key={s.symbol} className="flex items-center gap-2 text-sm">
            {s.ok ? <Check className="h-4 w-4 text-success" aria-hidden /> : <X className="h-4 w-4 text-amber" aria-hidden />}
            {s.symbol}：一次按准 {s.first}/{s.total} 根弦{s.ok ? '' : '，有弦被跳过'}
          </div>
        ))}
        <Button
          variant="outline"
          onClick={() => {
            setResults([])
            setChordIndex(0)
          }}
        >
          <RotateCcw /> 再检查一遍
        </Button>
      </div>
    )
  }

  if (!current || !state) return null
  if (!current.shape) return <p className="text-sm text-muted-foreground">在当前调弦下找不到 {current.symbol} 的指型。</p>

  const target = state.targets[state.index]
  const wrongNow = state.wrong[state.index]

  return (
    <div className="grid grid-cols-[auto,1fr] gap-6">
      <div className="flex flex-col items-center">
        <div className="font-display text-3xl font-semibold">{current.symbol}</div>
        <ChordDiagram shape={current.shape} className="mt-2" />
        {current.playedAs && <div className="text-xs text-muted-foreground">{current.playedAs}</div>}
        <div className="mt-2 text-xs text-muted-foreground">
          第 {chordIndex + 1} / {all.length} 个和弦
        </div>
      </div>
      <div className="space-y-3">
        {mic.error && (
          <p role="alert" className="text-sm text-destructive">
            {mic.error}
          </p>
        )}
        {!listening && !mic.error && <p className="text-sm text-muted-foreground">正在打开输入设备…</p>}
        {listening && target && (
          <p className="text-lg" aria-live="polite">
            拨 <b>{STRING_NAME[target.string]}</b>，应该是 <b className="num">{midiToName(target.midi, { octave: true })}</b>
          </p>
        )}
        {wrongNow != null && (
          <p className="text-sm text-amber" role="alert">
            听到的是 {midiToName(wrongNow, { octave: true })}。检查这根弦的手指是否按在品丝旁、有没有被别的手指碰到，再拨一次。
          </p>
        )}
        <ol className="flex gap-2">
          {state.targets.map((t, i) => (
            <li
              key={t.string}
              className={cn(
                'flex w-14 flex-col items-center rounded-xl border px-2 py-1.5 text-xs',
                i === state.index && 'border-amber/70 bg-amber-soft/30',
                state.states[i] === 'ok' && 'border-success/50 bg-success/10',
                state.states[i] === 'retry' && i !== state.index && 'border-amber/50',
                state.states[i] === 'skipped' && 'border-destructive/40 opacity-60',
              )}
            >
              <span className="text-muted-foreground">{STRING_NAME[t.string]}</span>
              <span className="num font-medium">{midiToName(t.midi)}</span>
              <span aria-hidden>{state.states[i] === 'ok' ? '✓' : state.states[i] === 'skipped' ? '—' : state.states[i] === 'retry' ? '!' : ' '}</span>
            </li>
          ))}
        </ol>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setState((s) => (s ? chordCheckSkip(s) : s))}>
            <SkipForward /> 跳过这根弦
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              tracker.current.reset()
              setState(startChordCheck(current.targets))
            }}
          >
            <RotateCcw /> 这个和弦重来
          </Button>
        </div>
      </div>
    </div>
  )
}
