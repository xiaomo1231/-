import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ListMusic } from 'lucide-react'
import { LIBRARY } from '@/songs/library'
import { cn } from '@/shared/lib/utils'

export function SongsPage() {
  const [filter, setFilter] = useState<string | null>(null)

  const tags = Array.from(new Set(LIBRARY.flatMap((s) => s.tags)))
  const songs = filter ? LIBRARY.filter((s) => s.tags.includes(filter)) : LIBRARY

  return (
    <div className="space-y-12">
      <header>
        <div className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">Songbook</div>
        <h1 className="mt-2 flex items-center gap-3 text-4xl font-semibold">
          <ListMusic className="h-9 w-9 text-amber" aria-hidden /> 曲库
        </h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          内置的公有领域曲目和原创练习曲。每首都能看谱、播放、练扫弦、弹旋律，或者在作曲台里继续改编。
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          想练自己的谱子？到<Link to="/sheets" className="focus-ring rounded text-amber underline-offset-4 hover:underline">「我的谱子」</Link>导入 Guitar Pro、MusicXML 或 MIDI。
        </p>
      </header>

      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold">内置曲目</h2>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="按标签筛选">
            <button type="button" onClick={() => setFilter(null)} aria-pressed={filter === null} className={cn('focus-ring rounded-full border px-3 py-1 text-xs', filter === null ? 'border-amber/70 bg-amber-soft/40' : 'border-border')}>
              全部
            </button>
            {tags.map((t) => (
              <button key={t} type="button" onClick={() => setFilter(t)} aria-pressed={filter === t} className={cn('focus-ring rounded-full border px-3 py-1 text-xs', filter === t ? 'border-amber/70 bg-amber-soft/40' : 'border-border')}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <ul className="grid grid-cols-3 gap-4">
          {songs.map((s) => (
            <li key={s.id}>
              <Link to={`/songs/lib/${s.id}`} className="focus-ring block h-full rounded-2xl border border-border/80 bg-card p-5 transition-all hover:-translate-y-1 hover:border-cyan/40 hover:shadow-lift">
                <div className="font-display text-lg font-semibold">{s.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{s.origin}</div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {s.tags.map((t) => (
                    <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      {t}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{s.note}</p>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted-foreground">内置曲目都是公有领域作品或本站原创。受版权保护的歌曲不内置，你可以把自己手上的谱子导入到「我的谱子」里练习。</p>
      </section>
    </div>
  )
}
