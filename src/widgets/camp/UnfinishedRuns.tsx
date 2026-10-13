import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { History, X } from 'lucide-react'
import { RunService } from '@/services/runService'
import type { ActiveRun } from '@/entities/types'
import { Button } from '@/shared/ui/Button'
import { buttonVariants } from '@/shared/ui/buttonVariants'

/** "刚刚 / N 分钟前 / N 小时前 / N 天前". */
function timeAgo(t: number, now = Date.now()): string {
  const min = Math.floor((now - t) / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

/** Progress line: placement counts sections, every other run counts questions. */
function progressLine(run: ActiveRun): string {
  if (run.kind === 'placement') return `第 ${run.done} / ${run.total} 段`
  return `第 ${run.done} / ${run.total} 题 · 答对 ${run.correct}`
}

export function UnfinishedRuns() {
  const [runs, setRuns] = useState<ActiveRun[]>([])

  const load = useCallback(async () => {
    setRuns(await RunService.list())
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (runs.length === 0) return null

  const discard = async (run: ActiveRun) => {
    await RunService.discard(run.id)
    await load()
  }

  return (
    <section className="rounded-3xl border border-amber/40 bg-card p-6">
      <div className="flex items-center gap-2 text-sm text-amber">
        <History className="h-4 w-4" aria-hidden /> 未完成的训练
      </div>
      <ul className="mt-4 divide-y divide-border/70">
        {runs.map((run) => (
          <li key={run.id} className="flex items-center gap-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{run.title}</div>
              <div className="text-xs text-muted-foreground">
                <span className="num">{progressLine(run)}</span> · {timeAgo(run.updatedAt)}
              </div>
            </div>
            <Link to={run.link} className={buttonVariants({ size: 'sm' })}>
              继续
            </Link>
            <Button variant="ghost" size="icon" aria-label={`放弃「${run.title}」`} onClick={() => void discard(run)}>
              <X />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
