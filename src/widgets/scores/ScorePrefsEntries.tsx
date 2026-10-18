import { cn } from '@/shared/lib/utils'

/** The library's left column shows the categories, or one of these two lists. */
export type LibraryView = 'library' | 'favorites' | 'recent'

const rowClass = (active: boolean) =>
  cn(
    'focus-ring flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted/60',
    active && 'bg-amber-soft/50 font-medium text-foreground',
  )

interface Props {
  view: LibraryView
  favoriteCount: number
  onPick: (view: LibraryView) => void
}

/** Above the categories: the starred scores and the recently opened ones. */
export function ScorePrefsEntries({ view, favoriteCount, onPick }: Props) {
  return (
    <nav aria-label="收藏和最近打开" className="border-b border-border/70 p-2">
      <ul className="space-y-0.5">
        <li>
          <button
            type="button"
            aria-current={view === 'favorites'}
            onClick={() => onPick('favorites')}
            className={rowClass(view === 'favorites')}
          >
            <span className="min-w-0 truncate">★ 收藏</span>
            <span className="num shrink-0 text-xs text-muted-foreground">{favoriteCount}</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            aria-current={view === 'recent'}
            onClick={() => onPick('recent')}
            className={rowClass(view === 'recent')}
          >
            <span className="min-w-0 truncate">最近打开</span>
          </button>
        </li>
      </ul>
    </nav>
  )
}
