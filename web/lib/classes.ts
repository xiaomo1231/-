/** How many rows a long list shows before 「再显示 200 个」. */
export const PAGE_SIZE = 200

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

const BUTTON_BASE =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'

const BUTTON_KIND = {
  primary: 'bg-primary-strong text-primary-foreground hover:opacity-90',
  outline: 'border border-border bg-card text-foreground hover:bg-accent',
  ghost: 'text-foreground hover:bg-accent',
} as const

export function buttonClass(kind: keyof typeof BUTTON_KIND = 'outline'): string {
  return cx(BUTTON_BASE, BUTTON_KIND[kind])
}

export const PANEL = 'rounded-2xl border border-border/80 bg-card'

export const SELECT = 'h-11 rounded-xl border border-border bg-card px-3 text-sm text-foreground'
