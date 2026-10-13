import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Cable, Check, Guitar, Lock, Mic, SlidersHorizontal, Sparkles, Timer, Wrench } from 'lucide-react'
import { GuitarService, type UnitStatus } from '@/services/guitarService'
import { useGuitarAudio } from '@/features/guitar/guitarAudioStore'
import { deviceDisplayName } from '@/audio/input/devices'
import { useAsync } from '@/shared/lib/useAsync'
import { MonitorToggle } from '@/widgets/guitar/MonitorToggle'
import { buttonVariants } from '@/shared/ui/buttonVariants'
import { cn } from '@/shared/lib/utils'

export function GuitarPage() {
  const { data } = useAsync(() => GuitarService.unitStatus(), [])
  const { refreshDevices, current, inputs, judge } = useGuitarAudio()
  useEffect(() => void refreshDevices(), [refreshDevices])
  const lat = judge()
  const preferred = inputs.find((d) => d.kind === 'cable')
  const rhythm = data?.filter((s) => s.unit.line === 'rhythm') ?? []
  const lead = data?.filter((s) => s.unit.line === 'lead') ?? []

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">Guitar workshop</div>
          <h1 className="mt-2 flex items-center gap-3 text-4xl font-semibold">
            <Guitar className="h-9 w-9 text-amber" aria-hidden /> 吉他工坊
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            以电吉他为主，分节奏吉他和主音吉他两条线。可以用吉他线（例如摇滚史密斯的线）直接接电脑，也可以用麦克风收音。程序会听你的扫弦和每根弦的音高，并给出判定。
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/guitar/setup" className={buttonVariants({ variant: 'outline' })}>
            <Wrench /> 设备检查
          </Link>
          <Link to="/guitar/tone" className={buttonVariants({ variant: 'outline' })}>
            <SlidersHorizontal /> 音色
          </Link>
          <Link to="/guitar/ai" className={buttonVariants({ variant: 'outline' })}>
            <Sparkles /> AI 专项
          </Link>
        </div>
      </header>

      <section className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-border/80 bg-card px-5 py-4 text-sm">
        <span className="flex items-center gap-2">
          {(current?.kind ?? preferred?.kind) === 'cable' ? <Cable className="h-4 w-4 text-amber" aria-hidden /> : <Mic className="h-4 w-4 text-cyan" aria-hidden />}
          输入：{current ? deviceDisplayName(current.label) : preferred ? `${deviceDisplayName(preferred.label)}（已插入）` : '还没检测，进入练习时会请求权限'}
        </span>
        <span className="flex items-center gap-2">
          <Timer className="h-4 w-4 text-muted-foreground" aria-hidden />
          延迟：{lat.calibrated ? `${Math.round(lat.seconds * 1000)} ms（已校准）` : '未校准'}
          {!lat.calibrated && (
            <Link to="/guitar/setup" className="text-cyan hover:underline">
              去校准
            </Link>
          )}
        </span>
        <MonitorToggle compact className="ml-auto" />
      </section>

      <Line title="节奏吉他" subtitle="和弦、换和弦、扫弦节奏型，最后跟完整伴奏弹一首歌。" units={rhythm} />
      <Line title="主音吉他" subtitle="指板、五声音阶、推弦揉弦、连奏，最后跟伴奏即兴。" units={lead} />
      <p className="text-sm text-muted-foreground">指弹会作为单独的板块推出。</p>
    </div>
  )
}

function Line({ title, subtitle, units }: { title: string; subtitle: string; units: UnitStatus[] }) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="text-2xl font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <ol className="grid grid-cols-4 gap-4">
        {units.map(({ unit, passed, total, complete }) => {
          const body = (
            <>
              <div className="flex items-center justify-between">
                <span className="num text-xs text-muted-foreground">{String(unit.index).padStart(2, '0')}</span>
                {unit.comingIn ? <Lock className="h-4 w-4 text-muted-foreground" aria-label="未开放" /> : complete ? <Check className="h-4 w-4 text-success" aria-label="已完成" /> : null}
              </div>
              <div className="mt-3 font-display text-lg font-semibold">{unit.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">{unit.summary}</div>
              <div className="mt-4 text-xs">
                {unit.comingIn ? <span className="text-muted-foreground">{unit.comingIn} 开放</span> : <span className="num">{passed}/{total} 个练习</span>}
              </div>
              {!unit.comingIn && (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-amber" style={{ width: `${total ? (passed / total) * 100 : 0}%` }} />
                </div>
              )}
            </>
          )
          return (
            <li key={unit.id}>
              {unit.comingIn ? (
                <div className="h-full rounded-2xl border border-dashed border-border/70 bg-card/50 p-5 opacity-70">{body}</div>
              ) : (
                <Link to={`/guitar/${unit.id}`} className={cn('focus-ring block h-full rounded-2xl border bg-card p-5 transition-all hover:-translate-y-1 hover:shadow-lift', complete ? 'border-success/40' : 'border-border/80 hover:border-cyan/40')}>
                  {body}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
