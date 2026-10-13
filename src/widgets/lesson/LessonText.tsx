import { Fragment, type ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

/** Inline **bold** only; everything is rendered as text (no HTML injection). */
function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? (
      <strong key={i} className="font-semibold text-foreground">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    ),
  )
}

/**
 * Minimal lesson markdown: blank-line paragraphs, `- ` bullets, `1. `
 * numbered lists and **bold**. Kept deliberately small and safe.
 */
export function LessonText({ md, className }: { md: string; className?: string }) {
  const blocks = md.split(/\n\s*\n/)
  return (
    <div className={cn('space-y-3 text-[15px] leading-7 text-foreground/85', className)}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n')
        if (lines.every((l) => l.startsWith('> ') || l === '>')) {
          return (
            <aside key={bi} className="rounded-xl border-l-2 border-amber bg-amber-soft/20 px-4 py-2.5 text-foreground/90">
              {inline(lines.map((l) => l.replace(/^>\s?/, '')).join(''))}
            </aside>
          )
        }
        if (lines.every((l) => l.startsWith('- '))) {
          return (
            <ul key={bi} className="space-y-1.5 pl-1">
              {lines.map((l, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
                  <span>{inline(l.slice(2))}</span>
                </li>
              ))}
            </ul>
          )
        }
        if (lines.every((l) => /^\d+\. /.test(l))) {
          return (
            <ol key={bi} className="space-y-1.5">
              {lines.map((l, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="num w-5 shrink-0 text-amber">{i + 1}.</span>
                  <span>{inline(l.replace(/^\d+\. /, ''))}</span>
                </li>
              ))}
            </ol>
          )
        }
        // Mixed: a lead line followed by bullets.
        const firstBullet = lines.findIndex((l) => l.startsWith('- ') || /^\d+\. /.test(l))
        if (firstBullet > 0) {
          return (
            <div key={bi} className="space-y-2">
              <p>{inline(lines.slice(0, firstBullet).join(''))}</p>
              <LessonText md={lines.slice(firstBullet).join('\n')} />
            </div>
          )
        }
        return <p key={bi}>{inline(lines.join(''))}</p>
      })}
    </div>
  )
}
