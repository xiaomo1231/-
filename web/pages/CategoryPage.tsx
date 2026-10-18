import { cx, PANEL } from '../lib/classes'
import { hrefGroup } from '../lib/route'
import { useLibrary } from '../lib/libraryContext'
import { Link } from '../components/Link'
import { Notice, PageBar } from '../components/ui'

/** Fret numbers of the inlays on a real neck: the group tiles take them in turn. */
const INLAY_FRETS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24]

/** A category with several groups (分组): tap one to see its artists. */
export function CategoryPage({ id }: { id: string }) {
  const { info } = useLibrary()
  const category = info?.categories.find((c) => c.id === id)

  if (!category) {
    return (
      <>
        <PageBar title="分类" fallback="#/" />
        <Notice>找不到这个分类。文件夹可能已经改过名字，回到首页重新看一下。</Notice>
      </>
    )
  }

  const most = Math.max(...category.groups.map((g) => g.files), 1)

  return (
    <>
      <PageBar
        title={category.name}
        subtitle={`${category.groups.length} 个分组 · ${category.files.toLocaleString('zh-CN')} 个文件`}
        fallback="#/"
      />
      {category.groups.length === 0 ? (
        <Notice>这个分类里还没有内容。</Notice>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {category.groups.map((g, i) => {
            const fret = INLAY_FRETS[i % INLAY_FRETS.length]!
            return (
              <li key={g.id}>
                <Link
                  href={hrefGroup(g)}
                  className={cx(
                    PANEL,
                    'pluck group flex h-full min-h-32 flex-col justify-between gap-3 p-4 transition-colors hover:border-primary/40',
                  )}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="mono text-[11px] text-muted-foreground">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="inlay" aria-hidden>
                      <i />
                      {fret % 12 === 0 && <i />}
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="block break-words font-display text-xl font-black leading-tight">
                      {g.name}
                    </span>
                    <span className="mono mt-1 block truncate text-xs text-muted-foreground">
                      {g.artists.toLocaleString('zh-CN')} 位{g.noun}
                    </span>
                  </span>
                  <span className="block">
                    <span className="mono text-xs text-foreground/80">
                      {g.files.toLocaleString('zh-CN')}
                    </span>
                    <span className="ml-1 text-[11px] text-muted-foreground">份</span>
                    {/* how big the group is, as a string's length */}
                    <span
                      aria-hidden
                      className="mt-2 block h-[2px] rounded-full bg-primary/70"
                      style={{ width: `${Math.max(6, (g.files / most) * 100)}%` }}
                    />
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
