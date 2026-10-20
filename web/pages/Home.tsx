import { useState } from 'react'
import { useRestoreScroll } from '../lib/scrollMemory'
import type { ScoreCategory } from '@/songs/scoreLibraryTypes'
import { dailyStaffNotes } from '@/songs/dailyStaff'
import { useFavorites } from '../lib/favorites'
import { usePractice } from '../lib/practice'
import { libraryName } from '../lib/format'
import { hrefCategory, hrefGroup, hrefViewer, HREF_DAILY, HREF_FAVORITES, HREF_MINE } from '../lib/route'
import { MINE_KIND_LABEL, mineRows, useMine } from '../lib/mine'
import { useLibrary } from '../lib/libraryContext'
import { readRecent, type RecentItem } from '../lib/recent'
import { buildContinueList } from '../lib/continueList'
import { doneCount, todayNumber, useDaily } from '../lib/daily'
import { Link } from '../components/Link'
import { Notice, Staff } from '../components/ui'
import { DailyStaff } from '../viewer/DailyStaff'

/** A category with one group opens that group directly; more than one shows the groups first. */
function categoryHref(c: ScoreCategory): string {
  const only = c.groups.length === 1 ? c.groups[0] : undefined
  return only ? hrefGroup(only) : hrefCategory(c.id)
}

/** Unsorted or unidentified folders go to the appendix below the contents. */
function isAppendix(c: ScoreCategory): boolean {
  return /未识别|待整理/.test(c.name)
}

/** 目录: the library's name as a heavy title, the categories as contents rows, 继续练 and 每日一练 beside them. */
export function Home() {
  const { info, scanning } = useLibrary()
  const categories = info?.categories ?? []
  useRestoreScroll(info !== null && info !== undefined)
  const main = categories.filter((c) => !isAppendix(c))
  const appendix = categories.filter(isAppendix)

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
            <>
              <ol className="m-0 list-none p-0">
                {main.map((c, i) => (
                  <CategoryRow key={c.id} c={c} label={String(i + 1).padStart(2, '0')} />
                ))}
              </ol>
              {appendix.length > 0 && (
                <>
                  <p className="label mb-2.5 mt-10">附 录 · 待 整 理</p>
                  <ol className="m-0 list-none p-0">
                    {appendix.map((c, i) => (
                      <CategoryRow key={c.id} c={c} label={`附${i + 1}`} appendix />
                    ))}
                  </ol>
                </>
              )}
            </>
          )}
        </section>

        <aside className="min-w-0">
          <ContinueSection />
          <MineSection />
          <DailySection />
        </aside>
      </div>
    </>
  )
}

/** One row of the 目录: number, name with leader dots, file count; sub-groups under it when there are several. */
function CategoryRow({
  c,
  label,
  appendix = false,
}: {
  c: ScoreCategory
  label: string
  appendix?: boolean
}) {
  const grouped = c.groups.length > 1
  return (
    <li className="border-t border-border last:border-b">
      <Link
        href={categoryHref(c)}
        className={`group grid min-h-11 grid-cols-[44px_minmax(0,auto)_minmax(1rem,1fr)_auto] items-baseline gap-2.5 pt-3.5 ${grouped ? '' : 'pb-3.5'}`}
      >
        <span className="mono text-[13px] text-muted-foreground">{label}</span>
        <span
          className={
            appendix
              ? 'font-display text-[19px] font-bold text-muted-foreground transition-colors group-hover:text-primary'
              : 'font-display text-[26px] font-black tracking-[0.01em] transition-colors group-hover:text-primary max-[860px]:text-[22px]'
          }
        >
          {c.name}
        </span>
        <span aria-hidden className="leader" />
        <span className="mono text-[15px]">{c.files.toLocaleString('zh-CN')}</span>
      </Link>
      {grouped && (
        <div className="-mt-1.5 flex flex-wrap gap-x-[22px] gap-y-0.5 pb-3.5 pl-[54px]">
          {c.groups.map((g) => (
            <Link
              key={g.id}
              href={hrefGroup(g)}
              className="inline-flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-primary"
            >
              {g.name}
              <span className="mono ml-1 text-[11px]">{g.files.toLocaleString('zh-CN')}</span>
            </Link>
          ))}
        </div>
      )}
    </li>
  )
}

/** 继续练: one row per song practised or opened on this device, latest first, with a link to the favourites. */
function ContinueSection() {
  const practice = usePractice()
  const { items: favorites } = useFavorites()
  const [recent] = useState<RecentItem[]>(() => readRecent())
  const [now] = useState(() => Date.now())
  const rows = buildContinueList({ practice: practice.items, recent, favorites, now })

  return (
    <section className="scroll-mt-16">
      <p className="label mb-2.5">继 续 练</p>
      {rows.length === 0 ? (
        <p className="py-2.5 text-sm text-muted-foreground">打开或练习过的谱会出现在这里。</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {rows.map((r) => (
            <li key={r.key} className="border-t border-border last:border-b">
              <Link
                href={hrefViewer({
                  path: r.path,
                  format: r.format,
                  pages: r.pages,
                  title: r.title,
                  artist: r.artist,
                })}
                className="group block py-2.5"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-bold transition-colors group-hover:text-primary">
                    {r.title}
                  </span>
                  <span className="mono shrink-0 text-[11px] text-muted-foreground">{r.when}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {r.artist ? `${r.artist} · ${r.line}` : r.line}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link
        href={HREF_FAVORITES}
        className="mt-2.5 inline-flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-primary"
      >
        我的收藏 →
      </Link>
    </section>
  )
}

/** 我的谱子: the latest 改编谱, uploaded songs and 组合乐队谱; the whole list on its own page. */
function MineSection() {
  const { data } = useMine()
  const rows = data ? mineRows(data) : []
  return (
    <section className="mt-10 scroll-mt-16">
      <p className="label mb-2.5">我 的 谱 子</p>
      {rows.length === 0 ? (
        <p className="py-2.5 text-sm text-muted-foreground">
          {data ? '在看谱页「音轨」里换乐器后可以保存成改编谱，会出现在这里。' : '正在读取…'}
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {rows.slice(0, 5).map((r) => (
            <li key={r.key} className="border-t border-border last:border-b">
              <Link href={r.href} className="group block py-2.5">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-bold transition-colors group-hover:text-primary">
                    {r.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{MINE_KIND_LABEL[r.kind]}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{r.line}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link
        href={HREF_MINE}
        className="mt-2.5 inline-flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-primary"
      >
        {rows.length > 5 ? `全部 ${rows.length} 个 →` : '我的谱子 →'}
      </Link>
    </section>
  )
}

/** 每日一练: this quarter's days as a small staff, and today's step. Hidden when the library has none or the read fails. */
function DailySection() {
  const daily = useDaily()
  const [now] = useState(() => Date.now())
  const s = daily.state
  if (!s || !s.available || daily.error) return null

  const started = s.startedAt !== null
  const today = todayNumber(s.startedAt, now)
  const staff = dailyStaffNotes({
    today,
    done: s.done,
    bpm: s.bpm,
    days: s.days.map((d) => ({ day: d.day, tempos: d.tempos })),
  })
  const todayDay = s.days.find((d) => d.day === today)
  const doneToday = typeof s.done[String(today)] === 'number'

  return (
    <section className="mt-10 scroll-mt-16">
      <p className="label mb-2.5">每 日 一 练</p>
      {started ? (
        <>
          <DailyStaff
            data={staff}
            techniqueOf={(day) => s.days.find((d) => d.day === day)?.technique}
          />
          <div className="mt-1.5 flex items-center justify-between gap-3 text-sm">
            <p className="min-w-0 truncate">
              <span className="mono">第 {today} 天</span>
              {todayDay && (
                <>
                  {' · '}
                  <strong className="font-bold">{todayDay.technique}</strong>
                </>
              )}
              <span className="ml-2.5">
                {doneToday ? (
                  <span className="text-primary">今天已练完</span>
                ) : (
                  <span className="text-muted-foreground">今天还没练</span>
                )}
              </span>
            </p>
            <Link
              href={HREF_DAILY}
              className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-border px-3 transition-colors hover:border-foreground"
            >
              {doneToday ? '看看 →' : '去练 →'}
            </Link>
          </div>
          <p className="mono mt-1 text-[11px] text-muted-foreground">
            已练 {doneCount(s.done)} 天 · 越高 = 那天练到的速度越快
          </p>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="py-2.5 text-sm text-muted-foreground">
            每天十几分钟的技巧练习，从第 1 天开始。
          </p>
          <Link
            href={HREF_DAILY}
            className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm transition-colors hover:border-foreground"
          >
            开始 →
          </Link>
        </div>
      )}
    </section>
  )
}
