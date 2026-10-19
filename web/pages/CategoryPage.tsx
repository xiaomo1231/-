import { hrefGroup } from '../lib/route'
import { useLibrary } from '../lib/libraryContext'
import { useRestoreScroll } from '../lib/scrollMemory'
import { Link } from '../components/Link'
import { Notice, PageBar, Staff } from '../components/ui'

/** A category with several groups (分组): the groups as contents rows; tap one for its artists. */
export function CategoryPage({ id }: { id: string }) {
  const { info } = useLibrary()
  const category = info?.categories.find((c) => c.id === id)
  useRestoreScroll(category !== undefined)

  if (!category) {
    return (
      <>
        <PageBar title="分类" back="← 目录" fallback="#/" />
        <Staff />
        <div className="py-6">
          <Notice>找不到这个分类。文件夹可能已经改过名字，回到目录重新看一下。</Notice>
        </div>
      </>
    )
  }

  return (
    <>
      <PageBar
        title={category.name}
        back="← 目录"
        fallback="#/"
        subtitle={`${category.groups.length} 个分组 · ${category.files.toLocaleString('zh-CN')} 份`}
      />
      <Staff />
      {category.groups.length === 0 ? (
        <div className="py-6">
          <Notice>这个分类里还没有内容。</Notice>
        </div>
      ) : (
        <ol className="m-0 mb-20 list-none p-0 pt-2">
          {category.groups.map((g, i) => (
            <li key={g.id} className="border-t border-border last:border-b">
              <Link
                href={hrefGroup(g)}
                className="group grid min-h-11 grid-cols-[44px_minmax(0,auto)_minmax(1rem,1fr)_auto] items-baseline gap-2.5 py-3.5"
              >
                <span className="mono text-[13px] text-muted-foreground">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="font-display text-[26px] font-black tracking-[0.01em] transition-colors group-hover:text-primary max-[860px]:text-[22px]">
                  {g.name}
                </span>
                <span aria-hidden className="leader" />
                <span className="mono text-[15px]">
                  <span className="mr-2 text-xs text-muted-foreground">
                    {g.artists.toLocaleString('zh-CN')} {g.noun}
                  </span>
                  {g.files.toLocaleString('zh-CN')}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}
