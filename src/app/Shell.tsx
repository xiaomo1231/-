import { NavLink, Outlet } from 'react-router-dom'
import { isAdmin } from '@/services/adminMode'
import { Activity, BookOpen, Library, Disc3, FileMusic, Flame, Guitar, ListMusic, Mic, PenLine, Settings, SlidersHorizontal, Sparkles, WifiOff } from 'lucide-react'
import { useOnline } from '@/features/pwa/useOnline'
import { useProfileStore } from '@/features/profile/profileStore'
import { INSTRUMENT_LABEL } from '@/entities/types'
import { nextRank, rankFor, rankProgress, streakAlive, localDateKey } from '@/services/progressRules'
import { BrandMark } from '@/widgets/brand/BrandMark'
import { cn } from '@/shared/lib/utils'
import { VuBar } from '@/widgets/meter/VuBar'

const NAV = [
  { to: '/camp', label: '训练营', icon: Activity },
  { to: '/course', label: '课程', icon: BookOpen },
  { to: '/guitar', label: '吉他工坊', icon: Guitar },
  { to: '/studio', label: '作曲台', icon: PenLine },
  { to: '/songs', label: '曲库', icon: ListMusic },
  { to: '/sheets', label: '我的谱子', icon: FileMusic },
  { to: '/library', label: '歌曲库', icon: Library },
  { to: '/sing', label: '跟唱', icon: Mic },
  { to: '/portfolio', label: '作品集', icon: Disc3 },
  { to: '/skills', label: '技能地图', icon: Sparkles },
  { to: '/tuner', label: '调音器与音域', icon: SlidersHorizontal },
  { to: '/settings', label: '设置', icon: Settings },
]

export function Shell() {
  const profile = useProfileStore((s) => s.profile)!
  const rank = rankFor(profile.xp)
  const next = nextRank(profile.xp)
  const alive = streakAlive(profile.streak, localDateKey())
  const online = useOnline()

  return (
    <div className="flex min-h-full">
      <a href="#main" className="focus-ring sr-only z-50 rounded-xl bg-amber px-4 py-2 font-medium text-background focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        跳到主要内容
      </a>
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-border/70 bg-card/60 px-4 py-6 backdrop-blur">
        <NavLink to="/" className="focus-ring mb-8 flex items-center gap-3 rounded-xl px-2">
          <BrandMark className="h-9 w-9" />
          <div>
            <div className="font-display text-lg font-semibold leading-none">律动工坊</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">GrooveLab</div>
          </div>
        </NavLink>

        <nav className="flex flex-col gap-1" aria-label="主导航">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'focus-ring group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
                  isActive ? 'bg-accent text-foreground shadow-soft' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn('h-4 w-4', isActive ? 'text-amber' : 'text-muted-foreground group-hover:text-foreground')} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto space-y-4">
          <div className="rounded-2xl border border-border/70 bg-background/60 p-4 surface-gradient">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">当前段位</span>
              <span className="num text-xs text-amber">{profile.xp} XP</span>
            </div>
            <div className="mt-1 font-display text-base font-semibold">{rank.name}</div>
            <VuBar value={rankProgress(profile.xp)} className="mt-3" />
            <div className="mt-2 text-[11px] text-muted-foreground">
              {next ? `距「${next.name}」还差 ${next.minXp - profile.xp} XP` : '已到最高段位'}
            </div>
          </div>
          <div className="flex items-center justify-between px-1 text-xs">
            <span className="text-muted-foreground">
              {profile.displayName || '乐手'} · {INSTRUMENT_LABEL[profile.instrument]}
              {isAdmin(profile) && <span className="ml-1.5 rounded border border-amber/60 px-1 text-[10px] text-amber">管理员模式</span>}
            </span>
            <span
              className={cn('flex items-center gap-1 num', alive && profile.streak.current > 0 ? 'text-amber' : 'text-muted-foreground')}
              title="连续完成每日训练的天数"
            >
              <Flame className="h-3.5 w-3.5" />
              {alive ? profile.streak.current : 0}
            </span>
          </div>
        </div>
      </aside>

      <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none">
        {!online && (
          <div role="status" className="flex items-center justify-center gap-2 border-b border-border/70 bg-muted/60 px-4 py-2 text-sm text-muted-foreground">
            <WifiOff className="h-4 w-4" aria-hidden /> 现在离线：训练、课程、作曲和导出都能正常用；AI 功能和采样钢琴需要联网。
          </div>
        )}
        <div className="mx-auto max-w-6xl px-10 py-10">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

