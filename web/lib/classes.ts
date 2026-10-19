/** How many rows a long list shows before 「再显示 200 个」. */
export const PAGE_SIZE = 200

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/** Flat buttons: no shadows, the pen (primary) for the one main action. */
const BUTTON_BASE =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-[color,background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100'

const BUTTON_KIND = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary-strong',
  outline: 'border border-border text-foreground hover:border-foreground',
  ghost: 'text-muted-foreground hover:bg-card hover:text-foreground',
} as const

export function buttonClass(kind: keyof typeof BUTTON_KIND = 'outline'): string {
  return cx(BUTTON_BASE, BUTTON_KIND[kind])
}

/** A plain bordered block (the viewer's panels). */
export const PANEL = 'rounded-lg border border-border bg-card'

/** A select in the songbook look: a hairline box, no shadow. */
export const SELECT =
  'h-11 rounded-lg border border-border bg-transparent px-3 text-sm text-foreground focus:border-primary'
