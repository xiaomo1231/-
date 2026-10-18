import type { ScoreCategory, ScoreGroup } from '@/songs/scoreLibraryTypes'
import { cn } from '@/shared/lib/utils'

const rowClass = (active: boolean) =>
  cn(
    'focus-ring flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted/60',
    active && 'bg-amber-soft/50 font-medium text-foreground',
  )

interface Props {
  categories: ScoreCategory[]
  activeGroupId: string
  /** Categories with several groups whose group list is folded. */
  collapsed: ReadonlySet<string>
  onPickGroup: (group: ScoreGroup) => void
  onToggle: (category: ScoreCategory) => void
}

/** Left column: the folder's categories; a category with several groups expands into them. */
export function ScoreCategoryList({
  categories,
  activeGroupId,
  collapsed,
  onPickGroup,
  onToggle,
}: Props) {
  return (
    <nav aria-label="分类" className="min-w-0 p-2 lg:max-h-[640px] lg:overflow-y-auto">
      <div className="px-2.5 pb-2 pt-1 text-xs tracking-[0.08em] text-muted-foreground">分类</div>
      <ul className="space-y-0.5">
        {categories.map((cat) => {
          const single = cat.groups.length === 1
          const open = !collapsed.has(cat.id)
          const single0 = cat.groups[0]
          return (
            <li key={cat.id}>
              {single && single0 ? (
                <button
                  type="button"
                  onClick={() => onPickGroup(single0)}
                  aria-current={single0.id === activeGroupId}
                  className={rowClass(single0.id === activeGroupId)}
                >
                  <span className="min-w-0 truncate">{cat.name}</span>
                  <span className="num shrink-0 text-xs text-muted-foreground">
                    {cat.files.toLocaleString()}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onToggle(cat)}
                  aria-expanded={open}
                  className={rowClass(cat.groups.some((g) => g.id === activeGroupId))}
                >
                  <span className="min-w-0 truncate">{cat.name}</span>
                  <span className="num shrink-0 text-xs text-muted-foreground">
                    {cat.files.toLocaleString()}
                  </span>
                </button>
              )}
              {!single && open && (
                <ul className="ml-3 space-y-0.5 border-l border-border/70 pl-2">
                  {cat.groups.map((g) => (
                    <li key={g.id}>
                      <button
                        type="button"
                        onClick={() => onPickGroup(g)}
                        aria-current={g.id === activeGroupId}
                        className={rowClass(g.id === activeGroupId)}
                      >
                        <span className="min-w-0 truncate">{g.name}</span>
                        <span className="num shrink-0 text-xs text-muted-foreground">
                          {g.artists.toLocaleString()}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
