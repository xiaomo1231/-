import { useMemo, useState } from 'react'
import { Check, Hand, Play, RotateCcw, SkipForward } from 'lucide-react'
import type { Lesson } from '@/course/types'
import type { LessonProgress } from '@/entities/types'
import type { DrillResponse, GradeResult } from '@/drills/types'
import { chordStepSymbol, handsOnFor, stepQuestion, strumSpec, type HandsOnStatus, type HandsOnStep } from '@/course/handsOn'
import { gradeQuestion } from '@/drills/grading'
import { parseChordSymbol } from '@/guitar/units'
import { CourseService } from '@/services/courseService'
import { ProfileService } from '@/services/profileService'
import { BadgeService } from '@/services/badgeService'
import { useProfileStore } from '@/features/profile/profileStore'
import { useChordShapes } from '@/features/instrument/useGuitarSetup'
import { useTimbreOverride } from '@/features/audio/useTimbreOverride'
import { trainingTimbre } from '@/audio/engine'
import { QuestionView } from '@/widgets/drill/QuestionView'
import { ChordCheck } from '@/widgets/guitar/ChordCheck'
import { StrumPractice } from '@/widgets/guitar/StrumPractice'
import { RangeCalibration } from '@/widgets/pitch/RangeCalibration'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

/** A question-based step passes with a correct answer or ≥ 70 % credit. */
const PASS = 0.7

const STATUS_LABEL: Record<HandsOnStatus, string> = { passed: '已通过', failed: '待补', skipped: '已跳过' }

/**
 * 课后实操: the lesson's material played and sung on the student's own
 * instrument. Optional for completion — a skipped or missed step goes to the
 * "待补的实操" list in the training camp.
 */
export function HandsOnSection({ lesson, progress, onProgress }: { lesson: Lesson; progress: LessonProgress | null; onProgress: (p: LessonProgress) => void }) {
  const steps = useMemo(() => handsOnFor(lesson), [lesson])
  const [open, setOpen] = useState<string | null>(null)
  const [runKey, setRunKey] = useState(0)
  if (!steps.length) return null
  const statusOf = (s: HandsOnStep) => progress?.handsOn?.[s.id]?.status
  const passed = steps.filter((s) => statusOf(s) === 'passed').length

  const record = async (step: HandsOnStep, status: HandsOnStatus, score = 0) => {
    onProgress(await CourseService.markHandsOn(lesson.id, step.id, status, score))
    if (status === 'passed') {
      const i = steps.findIndex((s) => s.id === step.id)
      const next = steps.slice(i + 1).find((s) => statusOf(s) !== 'passed')
      setOpen(next?.id ?? null)
      setRunKey((k) => k + 1)
    }
  }

  return (
    <section id="handson" className="scroll-mt-6 rounded-3xl border border-cyan/40 bg-card p-7 surface-gradient" aria-labelledby="handson-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="handson-title" className="flex items-center gap-2 text-xl font-semibold">
            <Hand className="h-5 w-5 text-cyan" aria-hidden /> 课后实操
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">学完马上在乐器上弹一弹、唱一唱，印象最深。可以跳过，跳过的会出现在训练营的「待补的实操」里，不影响完成这节课。</p>
        </div>
        <span className="num text-sm text-muted-foreground">
          {passed} / {steps.length}
        </span>
      </div>
      <ol className="mt-5 space-y-3">
        {steps.map((step, i) => {
          const status = statusOf(step)
          const isOpen = open === step.id
          return (
            <li key={step.id} className={cn('rounded-2xl border p-4', status === 'passed' ? 'border-success/40 bg-success/5' : isOpen ? 'border-cyan/50' : 'border-border/80')}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="num text-xs text-muted-foreground">{i + 1}</span>
                  <span className="font-medium">{step.title}</span>
                  {status && <span className={cn('rounded-full px-2 py-0.5 text-[11px]', status === 'passed' ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground')}>{STATUS_LABEL[status]}</span>}
                </div>
                <div className="flex gap-2">
                  {!isOpen && (
                    <Button size="sm" variant={status === 'passed' ? 'ghost' : 'default'} onClick={() => setOpen(step.id)}>
                      {status ? <RotateCcw /> : <Play />} {status === 'passed' ? '再练一次' : status ? '补练' : '开始'}
                    </Button>
                  )}
                  {status !== 'passed' && status !== 'skipped' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void record(step, 'skipped')
                        if (isOpen) setOpen(null)
                      }}
                    >
                      <SkipForward /> 跳过
                    </Button>
                  )}
                </div>
              </div>
              {isOpen && (
                <div className="mt-4 rounded-xl border border-border/60 bg-background/60 p-5">
                  <StepRunner key={`${step.id}-${runKey}`} step={step} onResult={(ok, score) => void record(step, ok ? 'passed' : 'failed', score)} />
                </div>
              )}
            </li>
          )
        })}
      </ol>
      {passed === steps.length && (
        <p className="mt-4 flex items-center gap-1.5 text-sm text-success">
          <Check className="h-4 w-4" /> 这节课的实操全部通过了。
        </p>
      )}
    </section>
  )
}

/** One step: guitar widgets for chords / progressions, otherwise a perform or rhythm question graded locally. */
function StepRunner({ step, onResult }: { step: HandsOnStep; onResult: (passed: boolean, score: number) => void }) {
  const profile = useProfileStore((s) => s.profile)!
  const setProfile = useProfileStore((s) => s.set)
  const shapeFor = useChordShapes()
  const guitar = profile.instrument === 'guitar'
  const symbol = step.kind === 'chord' ? chordStepSymbol(step) : null
  const hasShape = useMemo(() => {
    if (!symbol) return false
    try {
      const { rootPc, suffix, rootName } = parseChordSymbol(symbol)
      return shapeFor(rootPc, suffix, rootName) !== null
    } catch {
      return false
    }
  }, [symbol, shapeFor])
  const strum = step.kind === 'progression' ? strumSpec(step) : null
  const useChordWidget = guitar && step.kind === 'chord' && hasShape
  const useStrumWidget = guitar && step.kind === 'progression' && strum !== null
  const question = useMemo(() => (useChordWidget || useStrumWidget ? null : stepQuestion(step, profile, { notesOnly: true })), [step, profile, useChordWidget, useStrumWidget])
  const [result, setResult] = useState<GradeResult | null>(null)
  const [response, setResponse] = useState<DrillResponse | null>(null)
  const [attempt, setAttempt] = useState(0)
  // Guitar players hear guitar while playing it; others keep the training timbre.
  useTimbreOverride(guitar ? 'guitar' : trainingTimbre(profile))

  if (useChordWidget) return <ChordCheck chords={[symbol!]} onDone={(r) => onResult(r.passed, r.score)} />
  if (useStrumWidget) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">用四分音符下扫，每个和弦一小节。先跟着伴奏慢慢来。</p>
        <StrumPractice segments={[{ pattern: 'quarters', romans: strum!.romans, bars: strum!.romans.length }]} tonic={strum!.tonic} bpm={72} pass={PASS} onTake={(t) => t.passed && onResult(true, t.score)} />
      </div>
    )
  }
  if (!question) return <p className="text-sm text-muted-foreground">这一步暂时没法在你的乐器上检测，可以先跳过。</p>

  const needsRange = question.kind === 'perform' && question.source === 'voice' && !profile.vocalRange
  if (needsRange) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">唱之前先测一下你的舒适音域，只需要一次。</p>
        <RangeCalibration
          onSave={async (range) => {
            const next = await ProfileService.update({ vocalRange: range })
            await BadgeService.award('range-set')
            setProfile(next)
          }}
        />
      </div>
    )
  }

  return (
    <QuestionView
      key={attempt}
      question={question}
      result={result}
      response={response}
      deviceLatencyMs={profile.deviceLatencyMs}
      nextLabel={result && (result.correct || result.credit >= PASS) ? '完成这一步' : '再试一次'}
      onSubmit={(r) => {
        const g = gradeQuestion(question, r)
        setResponse(r)
        setResult(g)
      }}
      onNext={() => {
        if (!result) return
        const ok = result.correct || result.credit >= PASS
        if (ok) onResult(true, result.credit)
        else {
          onResult(false, result.credit)
          setResult(null)
          setResponse(null)
          setAttempt((a) => a + 1)
        }
      }}
    />
  )
}
