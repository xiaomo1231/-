import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import type { NoteMeasure } from '@/audio/pitch/analysis'
import type { DrillResponse, GradeResult, PerformQuestion } from '@/drills/types'
import { DrillService } from '@/services/drillService'
import { useProfileStore } from '@/features/profile/profileStore'
import { logger } from '@/infrastructure/logger/logger'
import { Button } from '@/shared/ui/Button'
import type { FeedbackMode } from '@/pitchcamp/plan'
import { PerformPad } from '@/widgets/pitch/PerformPad'
import { ResultLine, TaskFrame } from './TaskFrame'

/** 一道唱的题；三步法里同一句旋律会出现三次（跟琴唱 / 听完唱 / 只给第一个音）。 */
export interface SeriesItem {
  question: PerformQuestion
  /** 唱的时候琴一起弹。 */
  accompany?: boolean
  /** 题目上方的小标题，例如「第 1 步：跟着琴唱」。 */
  caption?: string
}

export interface SeriesResult {
  question: PerformQuestion
  notes: NoteMeasure[]
  grade: GradeResult
}

/**
 * 依次唱一组题：用现有的唱歌面板和判分，作答照常记进掌握度和经验值，但不影响训练营的级别。
 * 每题唱完显示结果，点「下一题」继续；全部唱完把每题的读数交给调用方算指标。
 */
export function PerformSeries({
  title,
  why,
  items,
  feedback,
  onDone,
}: {
  title: string
  why?: string
  items: SeriesItem[]
  feedback: FeedbackMode
  onDone: (results: SeriesResult[], seconds: number) => void
}) {
  const profile = useProfileStore((s) => s.profile)
  const [index, setIndex] = useState(0)
  const [graded, setGraded] = useState<SeriesResult | null>(null)
  const results = useRef<SeriesResult[]>([])
  const session = useRef<string | null>(null)
  const began = useRef(Date.now())
  const askedAt = useRef(Date.now())

  useEffect(() => {
    let alive = true
    const modules = Array.from(new Set(items.map((i) => i.question.module)))
    DrillService.startSession('daily', modules).then(
      (s) => {
        if (alive) session.current = s.id
      },
      (e: unknown) => logger.error('音准矫正：开不了练习记录', { error: String(e) }),
    )
    return () => {
      alive = false
      if (session.current) void DrillService.endSession(session.current)
    }
    // 一组题只开一次记录。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const item = items[index]

  const submit = useCallback(
    async (r: DrillResponse) => {
      if (!item) return
      const notes = r.kind === 'performance' ? r.notes : []
      let grade: GradeResult
      if (session.current) {
        const res = await DrillService.submit(session.current, item.question, r, Date.now() - askedAt.current, {
          countsTowardLevel: false,
        })
        grade = res.grade
      } else {
        const { gradeQuestion } = await import('@/drills/grading')
        grade = gradeQuestion(item.question, r)
      }
      const result = { question: item.question, notes, grade }
      results.current.push(result)
      setGraded(result)
    },
    [item],
  )

  const next = () => {
    setGraded(null)
    askedAt.current = Date.now()
    if (index + 1 >= items.length) onDone(results.current, (Date.now() - began.current) / 1000)
    else setIndex((i) => i + 1)
  }

  if (!item || !profile) return null
  return (
    <TaskFrame title={title} why={why} index={index} total={items.length}>
      {item.caption && <div className="mb-2 text-sm font-medium text-amber">{item.caption}</div>}
      <p className="mb-5 text-sm text-muted-foreground">{item.question.prompt}</p>
      <PerformPad
        key={item.question.id}
        question={item.question}
        disabled={graded !== null}
        graded={graded !== null}
        measures={graded?.notes ?? null}
        feedback={feedback}
        accompany={item.accompany ?? false}
        onSubmit={(r) => void submit(r)}
      />
      {graded && (
        <div className="mt-5 flex items-center gap-4">
          <div className="flex-1">
            <ResultLine ok={graded.grade.correct}>{feedback === 'score' ? (graded.grade.correct ? '唱对了。' : `这次没唱准（对了 ${Math.round(graded.grade.credit * 100)}%）。`) : graded.grade.feedback}</ResultLine>
          </div>
          <Button size="lg" onClick={next}>
            {index + 1 >= items.length ? '完成这一组' : '下一题'} <ArrowRight />
          </Button>
        </div>
      )}
    </TaskFrame>
  )
}
