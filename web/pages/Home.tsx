import { useEffect, useState } from 'react'
import type { ScoreCategory } from '@/songs/scoreLibraryTypes'
import { cx, PANEL } from '../lib/classes'
import { hrefCategory, hrefGroup } from '../lib/route'
import { useLibrary } from '../lib/libraryContext'
import { Link } from '../components/Link'
import { Notice } from '../components/ui'
import { SearchResults } from './SearchResults'

export function Home() {
  const { info, scanning } = useLibrary()
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState('')

  // Searching waits 200 ms after the last key, so typing does not fetch every letter.
  useEffect(() => {
    const t = window.setTimeout(() => setSearched(query.trim()), 200)
    return () => window.clearTimeout(t)
  }, [query])

  return (
    <div className="space-y-6">
      <SearchBox value={query} onChange={setQuery} />
      {scanning && <Notice>正在扫描文件夹，已经扫到的谱子可以先看。</Notice>}
      {searched ? (
        <SearchResults q={searched} />
      ) : (
        <CategoryList categories={info?.categories ?? []} />
      )}
    </div>
  )
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="sr-only">搜索谱库</span>
      <input
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="搜歌名、歌手，支持拼音、首字母、繁体"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 w-full rounded-2xl border border-border bg-card px-4 text-base text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
      />
    </label>
  )
}

/** A category with one group opens that group directly; more than one shows the groups first. */
function categoryHref(c: ScoreCategory): string {
  const only = c.groups.length === 1 ? c.groups[0] : undefined
  return only ? hrefGroup(only) : hrefCategory(c.id)
}

function CategoryList({ categories }: { categories: ScoreCategory[] }) {
  if (categories.length === 0) {
    return (
      <Notice>谱库里还没有找到谱子。请确认电脑上的谱库文件夹，然后点右上角「重新扫描」。</Notice>
    )
  }
  return (
    <section>
      <h2 className="mb-2 px-1 text-sm font-medium text-muted-foreground">分类</h2>
      <ul className="space-y-2">
        {categories.map((c) => (
          <li key={c.id}>
            <Link
              href={categoryHref(c)}
              className={cx(
                PANEL,
                'flex min-h-14 items-center justify-between gap-3 p-4 transition-colors hover:bg-accent',
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-lg font-semibold">{c.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {c.groups.length > 1 ? `${c.groups.length} 个分组 · ` : ''}
                  {c.files.toLocaleString('zh-CN')} 个文件
                </span>
              </span>
              <span aria-hidden className="text-xl text-muted-foreground">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
