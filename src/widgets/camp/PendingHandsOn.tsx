import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ListChecks } from 'lucide-react'
import { CourseService } from '@/services/courseService'
import type { HandsOnStep } from '@/course/handsOn'
import type { Lesson } from '@/course/types'
import { buttonVariants } from '@/shared/ui/buttonVariants'

const MAX_ROWS = 5

interface PendingRow {
  lesson: Lesson
  steps: HandsOnStep[]
}

/** "待补的实操": hands-on steps that were skipped or not passed yet. Renders nothing when empty. */
export function PendingHandsOn() {
  const [rows, setRows] = useState<PendingRow[] | null>(null)

  useEffect(() => {
    let alive = true
    void CourseService.pendingHandsOn().then((list) => {
      if (alive) setRows(list)
    })
    return () => {
      alive = false
    }
  }, [])

  if (!rows || rows.length === 0) return null

  const shown = rows.slice(0, MAX_ROWS)
  const more = rows.length - shown.length

  return (
    <section className="rounded-3xl border border-border/80 bg-card p-6">
      <div className="flex items-center gap-2 text-sm text-cyan">
        <ListChecks className="h-4 w-4" aria-hidden /> 待补的实操
      </div>
      <p className="mt-1 text-xs text-muted-foreground">这些课后实操上次跳过了或还没通过，有空时补一下（不影响课程进度）。</p>
      <ul className="mt-4 divide-y divide-border/70">
        {shown.map(({ lesson, steps }) => (
          <li key={lesson.id} className="flex items-center gap-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">
                <span className="num text-muted-foreground">
                  {lesson.stage}.{lesson.index}
                </span>{' '}
                {lesson.title}
              </div>
              <div className="truncate text-xs text-muted-foreground">{steps.map((s) => s.title).join('、')}</div>
            </div>
            <Link to={`/course/${lesson.id}#handson`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
              去补练
            </Link>
          </li>
        ))}
      </ul>
      {more > 0 && <div className="mt-2 text-xs text-muted-foreground">还有 {more} 课</div>}
    </section>
  )
}
