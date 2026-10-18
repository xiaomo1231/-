import { PANEL, cx } from '../lib/classes'
import { hrefGroup } from '../lib/route'
import { useLibrary } from '../lib/libraryContext'
import { Link } from '../components/Link'
import { Notice, PageBar } from '../components/ui'

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
        <ul className="space-y-2">
          {category.groups.map((g) => (
            <li key={g.id}>
              <Link
                href={hrefGroup(g)}
                className={cx(
                  PANEL,
                  'flex min-h-14 items-center justify-between gap-3 p-4 transition-colors hover:bg-accent',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-lg font-semibold">{g.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {g.artists} 个{g.noun} · {g.files.toLocaleString('zh-CN')} 个文件
                  </span>
                </span>
                <span aria-hidden className="text-xl text-muted-foreground">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
