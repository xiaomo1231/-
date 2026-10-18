/** How many rows a long list shows before 「再显示 200 个」. */
export const PAGE_SIZE = 200

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

const BUTTON_BASE =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-[background-color,border-color,color,transform] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'

const BUTTON_KIND = {
  primary: 'bg-primary text-primary-foreground shadow-[var(--shadow-soft)] hover:bg-primary-strong',
  outline: 'border border-border bg-card/70 text-foreground hover:border-primary/50 hover:bg-accent',
  ghost: 'text-muted-foreground hover:bg-accent hover:text-foreground',
} as const

export function buttonClass(kind: keyof typeof BUTTON_KIND = 'outline'): string {
  return cx(BUTTON_BASE, BUTTON_KIND[kind])
}

export const PANEL = 'rounded-2xl border border-border/70 bg-card shadow-[var(--shadow-soft)]'

/** A list on one card: rows split by string-thin hairlines instead of a card per row. */
export const LIST_PANEL =
  'overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[var(--shadow-soft)] divide-y divide-border/60'

/** A row inside LIST_PANEL that opens something (brass pluck mark on press). */
export const ROW =
  'pluck flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/60 active:bg-accent'

export const SELECT =
  'h-11 rounded-xl border border-border bg-card px-3 text-sm text-foreground focus:border-primary'
