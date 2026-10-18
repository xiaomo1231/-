import { useEffect, useState } from 'react'
import type { ScoreCategory } from '@/songs/scoreLibraryTypes'
import { cx, PANEL } from '../lib/classes'
import { isScoreFormat, libraryName } from '../lib/format'
import { hrefCategory, hrefGroup, hrefViewer } from '../lib/route'
import { useLibrary } from '../lib/libraryContext'
import { clearRecent, readRecent, type RecentItem } from '../lib/recent'
import { Link } from '../components/Link'
import { FormatBadge, Notice } from '../components/ui'
import { StringsArt } from '../components/Brand'
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

  const categories = info?.categories ?? []
  const artists = categories.reduce((n, c) => n + c.groups.reduce((m, g) => m + g.artists, 0), 0)

  return (
    <div className="space-y-8 pt-2">
      <section className="pt-2">
        <StringsArt className="mb-5 h-10 w-full opacity-80" />
        <p className="eyebrow">Guitar tab archive · 吉他谱库</p>
        <h1 className="mt-2 break-words font-display text-4xl font-black leading-tight sm:text-5xl">
          {info ? libraryName(info.root) : '谱库'}
        </h1>
        {info && (
          <p className="mono mt-2 text-xs text-muted-foreground">
            {info.files.toLocaleString('zh-CN')} 份谱 · {artists.toLocaleString('zh-CN')} 位歌手 ·{' '}
            {categories.length} 个分类
          </p>
        )}
        <SearchBox value={query} onChange={setQuery} />
      </section>

      {scanning && <Notice>正在扫描文件夹，已经扫到的谱子可以先看。</Notice>}
      {searched ? (
        <SearchResults q={searched} />
      ) : (
        <>
          <Recent />
          <CategoryGrid categories={categories} />
        </>
      )}
    </div>
  )
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="relative mt-5 block">
      <span className="sr-only">搜索谱库</span>
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-primary"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      >
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="M15.5 15.5 21 21" />
      </svg>
      <input
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="搜歌名、歌手（拼音也行）"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-14 w-full rounded-2xl border border-border bg-card/90 pl-11 pr-4 text-base text-foreground shadow-[var(--shadow-lift)] outline-none backdrop-blur transition-colors placeholder:text-muted-foreground focus:border-primary"
      />
    </label>
  )
}

/** The scores opened on this phone, newest first (a horizontal strip). */
function Recent() {
  const [items, setItems] = useState<RecentItem[]>(() => readRecent())
  if (items.length === 0) return null
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between px-1">
        <h2 className="font-display text-lg font-black">最近看过</h2>
        <button
          type="button"
          onClick={() => {
            clearRecent()
            setItems([])
          }}
          className="min-h-11 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          清空
        </button>
      </div>
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
        {items.map((r) => (
          <li key={r.path} className="snap-start">
            <Link
              href={hrefViewer({
                path: r.path,
                format: isScoreFormat(r.format) ? r.format : 'other',
                pages: r.pages,
                title: r.title,
                artist: r.artist,
              })}
              className={cx(
                PANEL,
                'pluck flex h-full w-40 flex-col gap-2 p-3 transition-colors hover:border-primary/40',
              )}
            >
              <FormatBadge format={isScoreFormat(r.format) ? r.format : 'other'} />
              <span className="line-clamp-2 font-display text-base font-black leading-snug">
                {r.title || '未识别的曲名'}
              </span>
              <span className="mt-auto truncate text-xs text-muted-foreground">
                {r.artist || ' '}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A category with one group opens that group directly; more than one shows the groups first. */
function categoryHref(c: ScoreCategory): string {
  const only = c.groups.length === 1 ? c.groups[0] : undefined
  return only ? hrefGroup(only) : hrefCategory(c.id)
}

/** Fret numbers of the inlays on a real neck: the category tiles take them in turn. */
const INLAY_FRETS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24]

function CategoryGrid({ categories }: { categories: ScoreCategory[] }) {
  if (categories.length === 0) {
    return (
      <Notice>谱库里还没有找到谱子。请确认电脑上的谱库文件夹，然后点右上角「重新扫描」。</Notice>
    )
  }
  const most = Math.max(...categories.map((c) => c.files), 1)
  return (
    <section>
      <h2 className="mb-3 px-1 font-display text-lg font-black">分类</h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {categories.map((c, i) => {
          const fret = INLAY_FRETS[i % INLAY_FRETS.length]!
          return (
            <li key={c.id}>
              <Link
                href={categoryHref(c)}
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
                    {c.name}
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {c.groups.length > 1
                      ? c.groups
                          .slice(0, 3)
                          .map((g) => g.name)
                          .join(' · ') + (c.groups.length > 3 ? ' …' : '')
                      : `${c.groups[0]?.artists.toLocaleString('zh-CN') ?? 0} 位${c.groups[0]?.noun ?? '歌手'}`}
                  </span>
                </span>
                <span className="block">
                  <span className="mono text-xs text-foreground/80">
                    {c.files.toLocaleString('zh-CN')}
                  </span>
                  <span className="ml-1 text-[11px] text-muted-foreground">份</span>
                  {/* how big the category is, as a string's length */}
                  <span
                    aria-hidden
                    className="mt-2 block h-[2px] rounded-full bg-primary/70"
                    style={{ width: `${Math.max(6, (c.files / most) * 100)}%` }}
                  />
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
