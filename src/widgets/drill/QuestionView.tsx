import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Delete, RotateCcw, Volume2, X } from 'lucide-react'
import type { DrillQuestion, DrillResponse, GradeResult } from '@/drills/types'
import { useQuestionPlayer } from '@/features/audio/useAudio'
import { useProfileStore } from '@/features/profile/profileStore'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'
import { MelodyStaff } from '@/widgets/notation/MelodyStaff'
import { RhythmStaff } from '@/widgets/notation/RhythmStaff'
import { InstrumentView } from '@/widgets/instrument/InstrumentView'
import { PerformPad } from '@/widgets/pitch/PerformPad'
import { REVEAL_STEP_MS, correctValues, isListeningQuestion, isRhythmQuestion, optionsFor, revealLabels, revealNote, revealOrder, revealNotes, revealSchedule, sequenceInfo } from './options'
import { RhythmPad } from './RhythmPad'
import { Oscilloscope } from './Oscilloscope'
import { DictationInput } from './DictationInput'

export interface QuestionViewProps {
  question: DrillQuestion
  result: GradeResult | null
  /** Submitted response (to mark the chosen option after grading). */
  response: DrillResponse | null
  onSubmit: (response: DrillResponse, responseMs: number) => void
  onNext: () => void
  deviceLatencyMs: number
  nextLabel?: string
  busy?: boolean
}

/**
 * One drill question. Listening questions auto-play on arrival; number keys
 * pick an option, R replays, Enter / → moves on after grading.
 */
export function QuestionView({ question: q, result, response, onSubmit, onNext, deviceLatencyMs, nextLabel = '下一题', busy }: QuestionViewProps) {
  const instrument = useProfileStore((s) => s.profile?.instrument ?? 'none')
  const { play, playNotes, isPlaying } = useQuestionPlayer()
  const startedAt = useRef(performance.now())
  const [sequence, setSequence] = useState<string[]>([])
  const listening = isListeningQuestion(q)
  const seq = sequenceInfo(q)
  const options = optionsFor(q)
  const answered = result !== null
  const choiceUi = options.length > 0 && q.kind !== 'rhythm_choice'

  useEffect(() => {
    startedAt.current = performance.now()
    setSequence([])
    if (isListeningQuestion(q)) void play(q)
  }, [q, play])

  const elapsed = () => performance.now() - startedAt.current

  // Highlight the reveal note currently sounding ("逐个播放" / single-note click).
  const [activeIdx, setActiveIdx] = useState<number | undefined>(undefined)
  const flashTimers = useRef<number[]>([])
  const clearFlash = useCallback(() => {
    flashTimers.current.forEach((t) => window.clearTimeout(t))
    flashTimers.current = []
  }, [])
  useEffect(() => {
    clearFlash()
    setActiveIdx(undefined)
  }, [q, clearFlash])
  useEffect(() => clearFlash, [clearFlash])

  const playInOrder = useCallback(() => {
    const notes = revealNotes(q)
    clearFlash()
    void playNotes(notes)
    const { steps, endMs } = revealSchedule(notes.length)
    for (const s of steps) flashTimers.current.push(window.setTimeout(() => setActiveIdx(s.index), s.atMs))
    flashTimers.current.push(window.setTimeout(() => setActiveIdx(undefined), endMs))
  }, [q, playNotes, clearFlash])

  const playOne = useCallback(
    (midi: number) => {
      const idx = revealNotes(q).indexOf(midi)
      clearFlash()
      void playNotes([midi])
      if (idx >= 0) {
        setActiveIdx(idx)
        flashTimers.current.push(window.setTimeout(() => setActiveIdx(undefined), REVEAL_STEP_MS + 150))
      }
    },
    [q, playNotes, clearFlash],
  )

  const submitChoice = useCallback(
    (value: string) => {
      if (answered || busy) return
      if (seq) {
        const next = [...sequence, value]
        setSequence(next)
        if (next.length === seq.needed) onSubmit({ kind: 'choices', values: next }, elapsed())
        return
      }
      onSubmit({ kind: 'choice', value }, elapsed())
    },
    [answered, busy, seq, sequence, onSubmit],
  )

  const submitDirect = useCallback((r: DrillResponse) => onSubmit(r, elapsed()), [onSubmit])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (answered) {
        if (e.key === 'Enter' || e.key === 'ArrowRight') {
          e.preventDefault()
          onNext()
        }
        return
      }
      if (listening && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault()
        void play(q)
        return
      }
      if (!choiceUi && q.kind !== 'rhythm_choice') return
      if (e.key === 'Backspace' && sequence.length > 0) {
        setSequence((s) => s.slice(0, -1))
        return
      }
      const n = Number(e.key)
      const count = q.kind === 'rhythm_choice' ? q.options.length : options.length
      if (Number.isInteger(n) && n >= 1 && n <= count) {
        e.preventDefault()
        submitChoice(q.kind === 'rhythm_choice' ? q.options[n - 1]!.id : options[n - 1]!.value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [answered, onNext, options, play, q, listening, choiceUi, sequence.length, submitChoice])

  const chosen = new Set<string>(response?.kind === 'choice' ? [response.value] : response?.kind === 'choices' ? response.values : sequence)
  const correct = new Set(correctValues(q))
  const reveal = revealNotes(q)
  const revealText = revealNote(q)

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-6">
        <h2 className="text-xl font-medium leading-relaxed text-foreground/95">{q.prompt}</h2>
        {listening && (
          <Button variant="outline" size="sm" onClick={() => void play(q)} disabled={busy} className="shrink-0">
            {isPlaying ? <Volume2 className="animate-pulse text-cyan" /> : <RotateCcw />}
            重听 <kbd className="ml-1 font-mono text-[10px] text-muted-foreground">R</kbd>
          </Button>
        )}
      </div>

      {listening && q.kind !== 'dictation' && <Oscilloscope active={isPlaying} />}

      {q.kind === 'note_name' && (
        <div className="rounded-2xl border border-border/70 bg-background/50 px-4 py-4">
          <MelodyStaff notes={[{ midi: q.note.midi, beats: 4, spelled: q.note }]} clef={q.clef} showKeySignature={false} timeSignature={null} scale={1.8} />
        </div>
      )}
      {q.kind === 'theory' && q.staff && (
        <div className="rounded-2xl border border-border/70 bg-background/50 px-4 py-2">
          <MelodyStaff
            notes={q.staff.notes.map((n) => ({ midi: n.midi, beats: 1, spelled: n }))}
            clef={q.staff.clef}
            showKeySignature={false}
            timeSignature={null}
          />
          <div className="pb-2 text-center">
            <button type="button" className="focus-ring rounded text-xs text-cyan hover:underline" onClick={() => void playNotes(q.staff!.notes.map((n) => n.midi))}>
              播放这些音
            </button>
          </div>
        </div>
      )}

      {isRhythmQuestion(q) ? (
        <RhythmPad question={q} deviceLatencyMs={deviceLatencyMs} disabled={answered || busy} onSubmit={submitDirect} />
      ) : q.kind === 'perform' ? (
        <PerformPad
          question={q}
          disabled={answered || busy}
          graded={answered}
          measures={response?.kind === 'performance' ? response.notes : null}
          onSubmit={submitDirect}
        />
      ) : q.kind === 'dictation' ? (
        <DictationInput
          question={q}
          instrument={instrument}
          disabled={busy}
          graded={answered}
          submitted={response?.kind === 'notes' ? response.midis : null}
          onSubmit={submitDirect}
        />
      ) : q.kind === 'rhythm_choice' ? (
        <div className="grid grid-cols-2 gap-3">
          {q.options.map((o, i) => {
            const isCorrect = answered && o.id === q.answer
            const isWrongPick = answered && chosen.has(o.id) && o.id !== q.answer
            return (
              <button
                key={o.id}
                type="button"
                disabled={answered || busy}
                onClick={() => submitChoice(o.id)}
                className={cn(
                  'focus-ring relative rounded-2xl border px-3 pb-2 pt-6 text-left transition-all',
                  'border-border/80 bg-card hover:border-cyan/50 hover:shadow-glow disabled:hover:shadow-none',
                  isCorrect && 'border-success/70 bg-success/10',
                  isWrongPick && 'animate-shake border-destructive/70 bg-destructive/10',
                  answered && !isCorrect && !isWrongPick && 'opacity-45',
                )}
              >
                <span className="absolute left-3 top-2 font-mono text-[10px] text-muted-foreground">{i + 1}</span>
                {o.bars.map((bar, b) => (
                  <RhythmStaff key={b} onsets={bar} beats={q.beatsPerBar} width={340} />
                ))}
              </button>
            )
          })}
        </div>
      ) : (
        <>
          {seq && (
            <div className="flex flex-wrap items-center gap-2">
              {seq.givenLabels.map((l, i) => (
                <span key={`g${i}`} className="flex h-11 min-w-14 items-center justify-center rounded-xl border border-border bg-muted/40 px-2 font-mono text-lg text-muted-foreground">
                  {l}
                </span>
              ))}
              {Array.from({ length: seq.needed }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    'flex h-11 min-w-14 items-center justify-center rounded-xl border px-2 font-mono text-lg',
                    sequence[i] ? 'border-cyan/60 bg-cyan-soft/40 text-foreground' : 'border-dashed border-border text-muted-foreground',
                  )}
                >
                  {sequence[i] ? (options.find((o) => o.value === sequence[i])?.label ?? sequence[i]) : seq.givenLabels.length + i + 1}
                </span>
              ))}
              {sequence.length > 0 && !answered && (
                <Button variant="ghost" size="sm" onClick={() => setSequence((s) => s.slice(0, -1))}>
                  <Delete /> 退格
                </Button>
              )}
            </div>
          )}
          <div
            className={cn(
              'grid gap-3',
              options.length === 2 ? 'grid-cols-2' : options.length <= 3 ? 'grid-cols-3' : options.length <= 8 ? 'grid-cols-4' : 'grid-cols-5',
            )}
          >
            {options.map((o, i) => {
              const isCorrect = answered && correct.has(o.value)
              const isWrongPick = answered && chosen.has(o.value) && !correct.has(o.value)
              return (
                <button
                  key={o.value}
                  type="button"
                  disabled={answered || busy}
                  onClick={() => submitChoice(o.value)}
                  className={cn(
                    'focus-ring group relative flex min-h-[76px] flex-col items-start justify-between rounded-2xl border px-4 py-3 text-left transition-all duration-200',
                    'border-border/80 bg-card hover:-translate-y-0.5 hover:border-cyan/50 hover:shadow-glow disabled:hover:translate-y-0 disabled:hover:shadow-none',
                    isCorrect && 'border-success/70 bg-success/15 hover:border-success/70',
                    isWrongPick && 'animate-shake border-destructive/70 bg-destructive/10',
                    answered && !isCorrect && !isWrongPick && 'opacity-45',
                  )}
                >
                  <span className="font-mono text-[10px] text-muted-foreground">{i + 1}</span>
                  <span className="mt-1 text-base font-medium">{o.label}</span>
                  {o.sub && <span className="font-mono text-xs text-muted-foreground">{o.sub}</span>}
                  {isCorrect && <Check className="absolute right-3 top-3 h-4 w-4 text-success" />}
                  {isWrongPick && <X className="absolute right-3 top-3 h-4 w-4 text-destructive" />}
                </button>
              )
            })}
          </div>
        </>
      )}

      {answered && result && (
        <div className={cn('animate-rise rounded-2xl border p-5', result.correct ? 'border-success/40 bg-success/10' : 'border-border bg-card')} role="status">
          <div className="flex items-start justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2 font-display text-lg font-semibold">
                {result.correct ? (
                  <>
                    <Check className="h-5 w-5 text-success" /> 正确
                  </>
                ) : result.timing ? (
                  <span className={result.credit >= 0.5 ? 'text-amber' : ''}>节奏得分 {Math.round(result.credit * 100)}%</span>
                ) : result.credit > 0 ? (
                  <span className="text-amber">部分正确 · {Math.round(result.credit * 100)}%</span>
                ) : q.kind === 'perform' ? (
                  <span>没有达到容差</span>
                ) : (
                  <span>答案：{result.expectedLabel}</span>
                )}
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{result.feedback}</p>
              {result.timing && (
                <div className="flex gap-6 pt-1 font-mono text-xs text-muted-foreground">
                  <span>
                    平均偏差 <b className="text-foreground">{result.timing.meanAbsDeviationMs}ms</b>
                  </span>
                  <span>
                    倾向{' '}
                    <b className="text-foreground">
                      {result.timing.meanSignedDeviationMs > 0 ? '+' : ''}
                      {result.timing.meanSignedDeviationMs}ms
                    </b>
                  </span>
                  <span>
                    对上{' '}
                    <b className="text-foreground">
                      {result.timing.matched}/{result.timing.expected}
                    </b>
                  </span>
                </div>
              )}
            </div>
            <Button onClick={onNext} className="shrink-0" autoFocus>
              {nextLabel} <ArrowRight />
            </Button>
          </div>
          {reveal.length > 0 && (
            <div className="mt-5 border-t border-border/60 pt-4">
              <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>{instrument === 'guitar' || instrument === 'bass' ? '在指板上的位置（点击可试听）' : '在键盘上的位置（点击琴键可试听）'}</span>
                <button type="button" className="focus-ring rounded text-cyan hover:underline" onClick={playInOrder}>
                  逐个播放
                </button>
              </div>
              {revealText && <p className="mb-2 text-xs text-muted-foreground">{revealText}</p>}
              <InstrumentView instrument={instrument} notes={reveal} labels={revealLabels(q)} badges={revealOrder(q)} activeIndex={activeIdx} onNote={playOne} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
