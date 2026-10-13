import { Link } from 'react-router-dom'
import { ArrowRight, AudioLines, Ear, Mic, PenLine, Layers, Drum } from 'lucide-react'
import { useProfileStore } from '@/features/profile/profileStore'
import { BrandMark } from '@/widgets/brand/BrandMark'
import { Oscilloscope } from '@/widgets/drill/Oscilloscope'
import { buttonVariants } from '@/shared/ui/buttonVariants'
import { cn } from '@/shared/lib/utils'

const STAGES = [
  { n: '00', title: '节奏与声音', body: '拍号、时值、切分、后拍，五线谱识谱入门。' },
  { n: '01', title: '音高系统', body: '大小调、五声与布鲁斯、调号与五度圈。' },
  { n: '02', title: '和声基础', body: '三和弦、七和弦、级数与流行套路库。' },
  { n: '03', title: '旋律与歌曲结构', body: '动机、Hook、主歌副歌、歌词与旋律。' },
  { n: '04', title: '进阶和声', body: '借用和弦、副属、转调、摇滚里的 ♭VII。' },
  { n: '05', title: '编曲', body: '鼓贝斯锁定、吉他与键盘声部、段落能量。' },
]

const PILLARS = [
  { icon: Ear, title: '听', body: '9 个听辨模块，题目无限、按你的弱项出题。' },
  { icon: Mic, title: '唱', body: '麦克风实时音准表，唱准每一个级数。' },
  { icon: Drum, title: '打', body: '毫秒级节奏判定，练出稳定的内心节拍。' },
  { icon: PenLine, title: '写', body: '每课一段微创作，最终写出自己的歌。' },
]

export function LandingPage() {
  const profile = useProfileStore((s) => s.profile)
  const ready = profile?.setupDone
  const primaryTo = !ready ? '/start' : profile?.placementDone ? '/camp' : '/placement'
  const primaryLabel = !ready ? '开始测试我的耳朵' : profile?.placementDone ? '进入训练营' : '继续入门测试'

  return (
    <div className="relative min-h-full overflow-hidden">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-amber/10 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -right-40 top-40 h-[480px] w-[480px] rounded-full bg-cyan/10 blur-3xl" aria-hidden="true" />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-10 py-8">
        <div className="flex items-center gap-3">
          <BrandMark className="h-9 w-9" />
          <span className="font-display text-lg font-semibold">律动工坊</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">GrooveLab</span>
        </div>
        {ready && (
          <Link to="/camp" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            训练营 <ArrowRight />
          </Link>
        )}
      </header>

      <section className="relative mx-auto grid max-w-6xl grid-cols-12 gap-10 px-10 pb-20 pt-12">
        <div className="col-span-7 animate-rise">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/70 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber" /> Pop · Rock · Ear first
          </div>
          <h1 className="text-[64px] font-semibold leading-[1.02]">
            先练耳朵，
            <br />
            再写<span className="text-amber glow-amber">自己的歌</span>。
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            从辨音、音准、节奏这些基本功开始，一路走到和声、歌曲结构与编曲。每一步都先听、再唱、再写，最后独立完成一首 4–6 轨的流行 / 摇滚作品。
          </p>
          <div className="mt-10 flex items-center gap-4">
            <Link to={primaryTo} className={cn(buttonVariants({ size: 'lg' }), 'px-8 text-base')}>
              {primaryLabel} <ArrowRight />
            </Link>
            <span className="text-sm text-muted-foreground">约 8 分钟 · 只需要耳机</span>
          </div>
        </div>

        <div className="col-span-5 animate-rise [animation-delay:120ms]">
          <div className="studio-noise rounded-3xl border border-border/80 bg-card/80 p-6 shadow-lift">
            <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              <span>CH-01 · 音程听辨</span>
              <span className="flex items-center gap-1.5 text-cyan">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan" /> live
              </span>
            </div>
            <Oscilloscope active className="mt-4" />
            <div className="mt-5 grid grid-cols-3 gap-2">
              {['纯四度', '纯五度', '大六度'].map((l, i) => (
                <div
                  key={l}
                  className={cn(
                    'rounded-xl border px-3 py-3 text-sm',
                    i === 1 ? 'border-success/60 bg-success/15' : 'border-border/80 bg-background/60 text-muted-foreground',
                  )}
                >
                  <div className="font-mono text-[10px] opacity-70">{i + 1}</div>
                  {l}
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between rounded-xl bg-background/70 px-4 py-3">
              <div>
                <div className="text-xs text-muted-foreground">连对</div>
                <div className="num text-2xl font-semibold text-amber">07</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">平均偏差</div>
                <div className="num text-2xl font-semibold">
                  18<span className="text-sm text-muted-foreground">ms</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">段位</div>
                <div className="font-display text-base font-semibold">地下 Livehouse</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative mx-auto max-w-6xl px-10 pb-20">
        <div className="grid grid-cols-4 gap-4">
          {PILLARS.map(({ icon: Icon, title, body }, i) => (
            <div
              key={title}
              className="animate-rise rounded-2xl border border-border/70 bg-card/70 p-6 surface-gradient"
              style={{ animationDelay: `${200 + i * 70}ms` }}
            >
              <Icon className="h-5 w-5 text-amber" />
              <div className="mt-4 font-display text-2xl font-semibold">{title}</div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative mx-auto max-w-6xl px-10 pb-28">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Setlist</div>
            <h2 className="mt-2 text-3xl font-semibold">从练习室到巡演的六个阶段</h2>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Layers className="h-4 w-4" /> 训练营达标后解锁下一阶段
          </div>
        </div>
        <ol className="grid grid-cols-3 gap-px overflow-hidden rounded-3xl border border-border/70 bg-border/70">
          {STAGES.map((s) => (
            <li key={s.n} className="group bg-card p-7 transition-colors hover:bg-accent/60">
              <div className="flex items-center justify-between">
                <span className="num text-3xl font-semibold text-muted-foreground/60 transition-colors group-hover:text-amber">{s.n}</span>
                <AudioLines className="h-4 w-4 text-muted-foreground/40" />
              </div>
              <div className="mt-6 font-display text-lg font-semibold">{s.title}</div>
              <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="relative border-t border-border/60 py-8 text-center text-xs text-muted-foreground">
        所有练习数据只保存在这台电脑的浏览器里 · 推荐使用电脑版 Chrome 并佩戴耳机
      </footer>
    </div>
  )
}
