import { Link } from 'react-router-dom'
import { KeyRound, Sparkles } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { buttonVariants } from '@/shared/ui/buttonVariants'

/** Marks content written by the AI, so it is never mistaken for lesson content or rule-engine results. */
export function AILabel({ className, children = 'AI 建议' }: { className?: string; children?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border border-cyan/40 bg-cyan-soft/40 px-2 py-0.5 text-[11px] font-medium text-cyan', className)}>
      <Sparkles className="h-3 w-3" aria-hidden /> {children}
    </span>
  )
}

/** Shown in place of an AI feature when no AI is configured. Everything else keeps working. */
export function AISetupHint({ what, className }: { what: string; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground', className)}>
      <span>
        配置 AI 后，{what}。不配置也不影响其他功能。
      </span>
      <Link to="/settings#ai" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        <KeyRound /> 去设置 AI
      </Link>
    </div>
  )
}

/** Error text for a failed AI call, announced to screen readers. */
export function AIError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  )
}
