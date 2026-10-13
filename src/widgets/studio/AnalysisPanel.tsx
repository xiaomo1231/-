import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import type { Analysis, Severity } from '@/analysis/ruleEngine'
import { cn } from '@/shared/lib/utils'

const ICON: Record<Severity, typeof Info> = { warn: AlertTriangle, info: Info, good: CheckCircle2 }
const TONE: Record<Severity, string> = { warn: 'text-amber', info: 'text-cyan', good: 'text-success' }

/** Rule-engine findings, warnings first. Local and deterministic — not a judgement of taste. */
export function AnalysisPanel({ analysis, onFocusBar, className }: { analysis: Analysis; onFocusBar?: (bar: number) => void; className?: string }) {
  const counts = { warn: 0, info: 0, good: 0 }
  for (const f of analysis.findings) counts[f.severity]++
  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="text-amber">需要注意 {counts.warn}</span>
        <span className="text-cyan">建议 {counts.info}</span>
        <span className="text-success">做得好 {counts.good}</span>
        {analysis.key && <span className="ml-auto">听起来像 {analysis.key.label}</span>}
      </div>
      {analysis.findings.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">写几个音、配几个和弦，这里会自动检查。</p>
      ) : (
        <ul className="space-y-1.5">
          {analysis.findings.map((f) => {
            const Icon = ICON[f.severity]
            return (
              <li key={f.id}>
                <button
                  type="button"
                  disabled={f.bar === undefined || !onFocusBar}
                  onClick={() => f.bar !== undefined && onFocusBar?.(f.bar)}
                  className="focus-ring flex w-full gap-2.5 rounded-xl border border-border/60 bg-card px-3 py-2 text-left text-sm leading-6 transition-colors enabled:hover:border-cyan/40"
                >
                  <Icon className={cn('mt-1 h-4 w-4 shrink-0', TONE[f.severity])} />
                  <span>{f.message}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">这些是可以测量的规则检查，不代表好不好听。规则可以打破，只要你是有意为之。</p>
    </div>
  )
}
