import { useState } from 'react'
import type { ScoreCategory } from '@/songs/scoreLibraryTypes'
import { useFavorites } from '../lib/favorites'
import { isScoreFormat, libraryName } from '../lib/format'
import { hrefCategory, hrefGroup, hrefViewer, HREF_FAVORITES } from '../lib/route'
import { useLibrary } from '../lib/libraryContext'
import { readRecent, type RecentItem } from '../lib/recent'
import { Link } from '../components/Link'
import { Notice, ScoreLine, Staff } from '../components/ui'

/** A category with one group opens that group directly; more than one shows the groups first. */
function categoryHref(c: ScoreCategory): string {
  const only = c.groups.length === 1 ? c.groups[0] : undefined
  return only ? hrefGroup(only) : hrefCategory(c.id)
}

/** The number a folder carries in front: 「1-华语」 → 01. */
function contentsNumber(id: string, index: number): string {
  const m = /^(\d+)/.exec(id)
  return (m ? m[1]! : String(index + 1)).padStart(2, '0')
}

/** 目录: the library's name as a heavy title, the categories as contents rows, favourites and recent beside them. */
export function Home() {
  const { info, scanning } = useLibrary()
  const categories = info?.categories ?? []

  return (
    <>
      <div className="pb-5 pt-12">
        <h1 className="m-0 break-words font-display text-[clamp(44px,9vw,96px)] font-black leading-[0.95] tracking-[-0.02em] [text-wrap:balance]">
          {info ? libraryName(info.root) : '谱库'}
        </h1>
        {scanning && (
          <p className="mono mt-3 text-xs text-muted-foreground">
            正在扫描文件夹，已经扫到的谱子可以先看。
          </p>
        )}
      </div>
      <Staff />

      <div className="grid gap-10 pb-20 pt-7 min-[861px]:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] min-[861px]:gap-14">
        <section aria-label="目录" className="min-w-0">
          <p className="label mb-2.5">目 录</p>
          {categories.length === 0 ? (
            <Notice>
              谱库里还没有找到谱子。请确认电脑上的谱库文件夹，然后点右上角「重新扫描」。
            </Notice>
          ) : (
            <ol className="m-0 list-none p-0">
              {categories.map((c, i) => (
                <li key={c.id} className="border-t border-border last:border-b">
                  <Link
                    href={categoryHref(c)}
                    className="group grid min-h-11 grid-cols-[44px_minmax(0,auto)_minmax(1rem,1fr)_auto] items-baseline gap-2.5 py-3.5"
                  >
                    <span className="mono text-[13px] text-muted-foreground">
                      {contentsNumber(c.id, i)}
                    </span>
                    <span className="font-display text-[26px] font-black tracking-[0.01em] transition-colors group-hover:text-primary max-[860px]:text-[22px]">
                      {c.name}
                    </span>
                    <span aria-hidden className="leader" />
                    <span className="mono text-[15px]">{c.files.toLocaleString('zh-CN')}</span>
                  </Link>
                  {c.groups.length > 1 && (
                    <div className="-mt-1.5 flex flex-wrap gap-x-[22px] gap-y-0.5 pb-3.5 pl-[54px]">
                      {c.groups.map((g) => (
                        <Link
                          key={g.id}
                          href={hrefGroup(g)}
                          className="inline-flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-primary"
                        >
                          {g.name}
                          <span className="mono ml-1 text-[11px]">
                            {g.files.toLocaleString('zh-CN')}
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="min-w-0">
          <Favorites />
          <Recent />
        </aside>
      </div>
    </>
  )
}

/** ★ 我的收藏: the first five starred scores, then the link to all of them. */
function Favorites() {
  const { items, loaded } = useFavorites()
  return (
    <section>
      <p className="label mb-2.5">★ 我的收藏</p>
      {items.length === 0 ? (
        <p className="py-2.5 text-sm text-muted-foreground">
          {loaded ? '还没有收藏。打开任意歌手，点谱子旁边的 ☆ 试试。' : '正在读取…'}
        </p>
      ) : (
        <>
          <ul className="m-0 list-none p-0">
            {items.slice(0, 5).map((f) => (
              <li key={f.path}>
                <ScoreLine
                  title={f.title}
                  artist={f.artist}
                  format={f.format}
                  href={hrefViewer({
                    path: f.path,
                    format: f.format,
                    pages: f.pages,
                    title: f.title,
                    artist: f.artist,
                  })}
                />
              </li>
            ))}
          </ul>
          {items.length > 5 && (
            <Link
              href={HREF_FAVORITES}
              className="mt-2.5 inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm transition-colors hover:border-foreground"
            >
              全部 {items.length} 个 →
            </Link>
          )}
        </>
      )}
    </section>
  )
}

/** 最 近 看 过: the scores opened on this device. */
function Recent() {
  const [items] = useState<RecentItem[]>(() => readRecent())
  return (
    <section id="recent" className="mt-10 scroll-mt-16">
      <p className="label mb-2.5">最 近 看 过</p>
      {items.length === 0 ? (
        <p className="py-2.5 text-sm text-muted-foreground">还没有看过的谱。</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {items.slice(0, 5).map((r) => {
            const format = isScoreFormat(r.format) ? r.format : 'other'
            return (
              <li key={r.path}>
                <ScoreLine
                  title={r.title}
                  artist={r.artist}
                  format={format}
                  href={hrefViewer({
                    path: r.path,
                    format,
                    pages: r.pages,
                    title: r.title,
                    artist: r.artist,
                  })}
                />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
