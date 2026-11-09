import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

/** 音准矫正里每个练习的外框：标题、说明、第几题。 */
export function TaskFrame({
  title,
  why,
  index,
  total,
  children,
  className,
}: {
  title: string
  why?: string
  /** 从 0 开始的当前题号。 */
  index?: number
  total?: number
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-3xl border border-border/80 bg-card p-7', className)}>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold">{title}</h2>
          {why && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{why}</p>}
        </div>
        {total !== undefined && index !== undefined && (
          <div className="num shrink-0 text-2xl font-semibold text-amber">
            {Math.min(index + 1, total)}
            <span className="text-base text-muted-foreground">/{total}</span>
          </div>
        )}
      </header>
      {children}
    </section>
  )
}

/** 一题结束后的提示条。 */
export function ResultLine({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        'rounded-2xl border px-4 py-3 text-sm',
        ok === true && 'border-success/50 bg-success/10',
        ok === false && 'border-destructive/50 bg-destructive/10',
        ok === null && 'border-border/70 bg-background/50',
      )}
    >
      {children}
    </div>
  )
}
