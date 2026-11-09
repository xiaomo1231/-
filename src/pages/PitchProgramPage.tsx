import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, Headphones, Play, RotateCcw, Target } from 'lucide-react'
import { useProfileStore } from '@/features/profile/profileStore'
import { toast } from '@/features/toast/toastStore'
import { ProfileService } from '@/services/profileService'
import { PitchProgramService } from '@/services/pitchProgramService'
import { localDateKey } from '@/services/progressRules'
import {
  BLOCK_TITLE,
  FEEDBACK_TEXT,
  MINUTE_CHOICES,
  PROBLEM_TEXT,
  PROGRAM_SESSIONS,
  RETEST_SESSIONS,
  feedbackFor,
  weekOf,
  type PitchMetrics,
  type ProgramMinutes,
  type SessionBlock,
} from '@/pitchcamp/plan'
import type { PitchLog, PitchProgram, PitchSessionProgress } from '@/pitchcamp/types'
import type { VoiceOpts } from '@/pitchcamp/questions'
import { midiToName } from '@/music/pitch'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'
import { RangeCalibration } from '@/widgets/pitch/RangeCalibration'
import { BlockRunner } from '@/widgets/pitchcamp/BlockRunner'
import { ProgressPanel } from '@/widgets/pitchcamp/ProgressPanel'
import { TestRunner } from '@/widgets/pitchcamp/TestRunner'

const WEEK_TITLE: Record<number, string> = {
  1: '第 1 周 · 听准、站稳',
  2: '第 2 周 · 音程和音阶',
  3: '第 3 周 · 短旋律',
  4: '第 4 周 · 用到歌里',
}

interface Loaded {
  program: PitchProgram | undefined
  logs: PitchLog[]
}

/** 30 天音准矫正：开始 → 诊断 → 每天一组（15–30 分钟）→ 第 8、15、22、30 次复测。 */
export function PitchProgramPage() {
  const [data, setData] = useState<Loaded | null>(null)
  const reload = useCallback(async () => {
    const [program, logs] = await Promise.all([PitchProgramService.get(), PitchProgramService.logs()])
    setData({ program, logs })
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])

  if (!data) return <p className="text-sm text-muted-foreground">正在读取…</p>
  const { program, logs } = data

  return (
    <div className="space-y-8">
      <header>
        <div className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">Pitch Camp · 30 天</div>
        <h1 className="mt-2 flex items-center gap-3 text-4xl font-semibold">
          <Target className="h-8 w-8 text-amber" /> 音准矫正
        </h1>
      </header>
      {!program ? (
        <StartView hasHistory={logs.length > 0} onStart={reload} />
      ) : !program.diagnosis ? (
        <DiagnosisView onDone={reload} />
      ) : program.finishedAt ? (
        <FinishedView program={program} onRestart={reload} />
      ) : (
        <SessionView program={program} onChanged={reload} />
      )}
      <ProgressPanel logs={logs} />
    </div>
  )
}

function StartView({ hasHistory, onStart }: { hasHistory: boolean; onStart: () => void }) {
  const [minutes, setMinutes] = useState<ProgramMinutes>(20)
  return (
    <section className="rounded-3xl border border-border/80 bg-card p-8 surface-gradient">
      <h2 className="font-display text-2xl font-semibold">一个月纠正跑调</h2>
      <ol className="mt-4 space-y-2 text-sm text-muted-foreground">
        <li>1. 先做 10 分钟诊断，看你的跑调是「听不准」「嗓子找不准」还是「连成旋律就跑」。</li>
        <li>2. 之后每天一组，按诊断结果安排：第 1 周听准站稳，第 2 周音程音阶，第 3 周短旋律，第 4 周用到你自己的歌里。</li>
        <li>3. 第 8、15、22、30 次用同一套题复测，看得到进步曲线。漏一天不要紧，接着上次练。</li>
        <li>4. 计划进行期间，训练营的「每日训练」由它代替，练完照样算连续天数。</li>
      </ol>
      <div className="mt-6 flex items-center gap-2 rounded-2xl border border-amber/40 bg-amber-soft/20 px-4 py-3 text-sm">
        <Headphones className="h-4 w-4 shrink-0 text-amber" /> 请戴耳机练：外放的参考音和持续音会被麦克风收进去，影响判断。
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">每天练</span>
        {MINUTE_CHOICES.map((m) => (
          <Button key={m} variant={minutes === m ? 'default' : 'outline'} onClick={() => setMinutes(m)}>
            {m} 分钟
          </Button>
        ))}
        <Button
          size="lg"
          className="ml-auto"
          onClick={async () => {
            await PitchProgramService.start(minutes)
            onStart()
          }}
        >
          {hasHistory ? '开始新一轮' : '开始'}（先做诊断） <ArrowRight />
        </Button>
      </div>
    </section>
  )
}

function useVoice(): VoiceOpts {
  const profile = useProfileStore((s) => s.profile)!
  const low = profile.vocalRange?.low
  const high = profile.vocalRange?.high
  return useMemo(
    () => ({
      ...(low !== undefined && high !== undefined ? { vocalRange: { low, high } } : {}),
      octaveEquivalence: profile.octaveEquivalence,
    }),
    [low, high, profile.octaveEquivalence],
  )
}

function DiagnosisView({ onDone }: { onDone: () => void }) {
  const profile = useProfileStore((s) => s.profile)!
  const setProfile = useProfileStore((s) => s.set)
  const voice = useVoice()
  const [phase, setPhase] = useState<'range' | 'intro' | 'test' | 'result'>(profile.vocalRange ? 'intro' : 'range')
  const [result, setResult] = useState<PitchMetrics | null>(null)

  if (phase === 'range')
    return (
      <section className="space-y-4">
        <p className="text-sm text-muted-foreground">先测一下你的音域：所有练习的音都会放在你唱得舒服的范围里。</p>
        <RangeCalibration
          onSave={async (range) => {
            setProfile(await ProfileService.update({ vocalRange: range }))
            setPhase('intro')
          }}
        />
      </section>
    )

  if (phase === 'intro')
    return (
      <section className="rounded-3xl border border-border/80 bg-card p-8">
        <h2 className="font-display text-2xl font-semibold">诊断（约 10 分钟）</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          五小段：分辨音高、单音、长音、音程、短旋律。测试时不看音准表，量的是你现在真实的水平，唱错了也没关系。
          {profile.vocalRange && (
            <>
              {' '}
              你的音域：{midiToName(profile.vocalRange.low, { octave: true })} – {midiToName(profile.vocalRange.high, { octave: true })}。
              <Button variant="link" size="sm" onClick={() => setPhase('range')}>
                重新测音域
              </Button>
            </>
          )}
        </p>
        <Button size="lg" className="mt-6" onClick={() => setPhase('test')}>
          <Play /> 开始诊断
        </Button>
      </section>
    )

  if (phase === 'test')
    return (
      <TestRunner
        voice={voice}
        onDone={async (metrics, seconds) => {
          await PitchProgramService.saveDiagnosis(metrics, seconds)
          setResult(metrics)
          setPhase('result')
        }}
      />
    )

  return <DiagnosisResult metrics={result} onNext={onDone} />
}

function DiagnosisResult({ metrics, onNext }: { metrics: PitchMetrics | null; onNext: () => void }) {
  const [problem, setProblem] = useState<keyof typeof PROBLEM_TEXT | null>(null)
  useEffect(() => {
    void PitchProgramService.get().then((p) => setProblem(p?.diagnosis?.problem ?? null))
  }, [])
  const text = problem ? PROBLEM_TEXT[problem] : null
  return (
    <section className="rounded-3xl border border-border/80 bg-card p-8 surface-gradient">
      <div className="text-sm text-muted-foreground">诊断结果</div>
      <h2 className="mt-1 font-display text-3xl font-semibold">{text?.title ?? '…'}</h2>
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{text?.detail}</p>
      {metrics && (
        <div className="mt-6 grid grid-cols-3 gap-3 text-sm">
          <Stat label="能分辨的最小音差" value={metrics.discCents} unit="音分" />
          <Stat label="单音平均偏差" value={metrics.matchCents} unit="音分" />
          <Stat label="单音唱准" value={metrics.hitRate === null ? null : Math.round(metrics.hitRate * 100)} unit="%" />
        </div>
      )}
      <Button size="lg" className="mt-6" onClick={onNext}>
        开始第 1 天 <ArrowRight />
      </Button>
    </section>
  )
}

function Stat({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/50 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="num mt-1 text-2xl font-semibold">
        {value ?? '—'}
        <span className="ml-1 text-xs text-muted-foreground">{unit}</span>
      </div>
    </div>
  )
}

function SessionView({ program, onChanged }: { program: PitchProgram; onChanged: () => void }) {
  const voice = useVoice()
  const [plan, setPlan] = useState<{ session: number; blocks: SessionBlock[] } | null>(null)
  const [progress, setProgress] = useState<PitchSessionProgress | null>(null)
  const [latestDisc, setLatestDisc] = useState<number | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [summary, setSummary] = useState<{ bonusXp: number; finished: boolean } | null>(null)
  const runnerRef = useRef<HTMLDivElement>(null)
  // 打开一项练习时滚到它那里（列表在上面，练习在下面）。
  useEffect(() => {
    if (running) runnerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [running])

  const load = useCallback(async () => {
    const [p, prog, latest] = await Promise.all([
      PitchProgramService.sessionPlan(),
      PitchProgramService.progress(),
      PitchProgramService.latestTest(),
    ])
    setPlan({ session: p.session, blocks: p.blocks })
    setProgress(prog)
    setLatestDisc(latest.discCents)
  }, [])
  useEffect(() => {
    void load()
  }, [load, program.minutes, program.sessionsDone])

  if (summary)
    return (
      <section className="rounded-3xl border border-success/50 bg-success/10 p-8">
        <h2 className="flex items-center gap-2 font-display text-2xl font-semibold">
          <Check className="h-6 w-6 text-success" /> {summary.finished ? '30 次全部练完了！' : '今天的练完了'}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {summary.bonusXp > 0 ? `+${summary.bonusXp} 经验值，连续天数已记上。` : '今天已经打过卡了，多练一次也记进进步里。'}
          {!summary.finished && ' 明天接着练下一次。'}
        </p>
        <Button
          className="mt-5"
          onClick={() => {
            setSummary(null)
            onChanged()
          }}
        >
          {summary.finished ? '看总结' : '好的'}
        </Button>
      </section>
    )

  if (!plan || !progress) return <p className="text-sm text-muted-foreground">正在排今天的练习…</p>

  const week = weekOf(plan.session)
  const feedback = feedbackFor(week)
  const done = new Set(progress.done)
  const next = plan.blocks.find((b) => !done.has(b.id))
  const active = plan.blocks.find((b) => b.id === running)
  const totalMinutes = Math.round(plan.blocks.reduce((s, b) => s + b.minutes, 0))
  const practicedToday = program.lastSessionDate === localDateKey()
  const isRetest = RETEST_SESSIONS.includes(plan.session)

  const finishBlock = async (block: SessionBlock, seconds: number, metrics?: Partial<PitchMetrics>) => {
    const prog = await PitchProgramService.completeBlock(block.id, seconds, metrics)
    setProgress(prog)
    setRunning(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    if (plan.blocks.every((b) => prog.done.includes(b.id))) {
      const r = await PitchProgramService.finishSession()
      setSummary({ bonusXp: r.bonusXp, finished: r.finished })
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-border/80 bg-card p-8 surface-gradient">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-sm text-muted-foreground">{WEEK_TITLE[week]}</div>
            <div className="mt-1 font-display text-3xl font-semibold">
              第 {plan.session} 次 <span className="text-lg text-muted-foreground">/ {PROGRAM_SESSIONS}</span>
              {isRetest && <span className="ml-3 rounded-full bg-amber-soft/60 px-3 py-1 align-middle text-sm text-amber">今天复测</span>}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              约 {totalMinutes} 分钟 · {FEEDBACK_TEXT[feedback]}
            </p>
            {practicedToday && <p className="mt-1 text-xs text-muted-foreground">今天已经练过一次了，可以明天再来；想多练也可以接着练下一次。</p>}
          </div>
          <div className="num text-right text-3xl font-semibold text-amber">
            {progress.done.length}
            <span className="text-lg text-muted-foreground">/{plan.blocks.length}</span>
          </div>
        </div>
        <ol className="mt-6 space-y-2">
          {plan.blocks.map((b, i) => {
            const isDone = done.has(b.id)
            const isNext = b.id === next?.id
            return (
              <li key={b.id}>
                <button
                  type="button"
                  disabled={isDone || running !== null}
                  onClick={() => setRunning(b.id)}
                  className={cn(
                    'focus-ring group flex w-full items-center gap-4 rounded-2xl border px-4 py-3 text-left transition-all',
                    isDone ? 'border-transparent bg-background/40 opacity-60' : isNext ? 'border-cyan/50 bg-cyan-soft/20' : 'border-border/70 bg-background/50',
                    b.id === running && 'border-amber bg-amber-soft/30',
                  )}
                >
                  <span className="num w-6 text-xs text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {BLOCK_TITLE[b.kind]}
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        约 {Math.max(1, Math.round(b.minutes))} 分钟
                        {b.kind !== 'warmup' && b.kind !== 'song' && b.kind !== 'test' ? ` · ${b.count} ${b.kind === 'discrimination' ? '次' : b.kind === 'echo3' ? '句' : '题'}` : ''}
                      </span>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{b.why}</div>
                  </div>
                  {isDone ? <Check className="h-5 w-5 text-success" /> : <Play className="h-4 w-4 text-muted-foreground group-hover:text-cyan" />}
                </button>
              </li>
            )
          })}
        </ol>
        {next && running === null && (
          <Button size="lg" className="mt-6" onClick={() => setRunning(next.id)}>
            {progress.done.length === 0 ? '开始今天的练习' : '继续下一项'} <ArrowRight />
          </Button>
        )}
      </section>

      {active && (
        <div ref={runnerRef} className="scroll-mt-6">
          <BlockRunner key={active.id} block={active} voice={voice} feedback={feedback} latestDisc={latestDisc} onDone={(s, m) => void finishBlock(active, s, m)} />
          <Button variant="ghost" className="mt-3" onClick={() => setRunning(null)}>
            先不练这一项
          </Button>
        </div>
      )}

      <SettingsRow program={program} canChangeMinutes={progress.done.length === 0} onChanged={onChanged} />
    </div>
  )
}

function SettingsRow({ program, canChangeMinutes, onChanged }: { program: PitchProgram; canChangeMinutes: boolean; onChanged: () => void }) {
  const [confirmStop, setConfirmStop] = useState(false)
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 px-5 py-4 text-sm">
      <span className="text-muted-foreground">每天练</span>
      {MINUTE_CHOICES.map((m) => (
        <Button
          key={m}
          size="sm"
          variant={program.minutes === m ? 'default' : 'outline'}
          disabled={!canChangeMinutes}
          onClick={async () => {
            await PitchProgramService.setMinutes(m)
            onChanged()
          }}
        >
          {m} 分钟
        </Button>
      ))}
      {!canChangeMinutes && <span className="text-xs text-muted-foreground">这一次已经开始了，练完后可以改。</span>}
      <div className="ml-auto">
        {confirmStop ? (
          <span className="flex items-center gap-2">
            放弃这个计划？进步记录会保留。
            <Button
              size="sm"
              variant="destructive"
              onClick={async () => {
                await PitchProgramService.stop()
                toast({ title: '已放弃音准矫正计划', description: '训练营恢复原来的每日训练。' })
                onChanged()
              }}
            >
              放弃
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmStop(false)}>
              取消
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmStop(true)}>
            放弃计划
          </Button>
        )}
      </div>
    </section>
  )
}

function FinishedView({ program, onRestart }: { program: PitchProgram; onRestart: () => void }) {
  return (
    <section className="rounded-3xl border border-success/50 bg-success/10 p-8">
      <h2 className="font-display text-2xl font-semibold">30 次练完了</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        对比下面诊断和最后一次复测，看看各项变化。在歌里稳住音准通常要更久：建议之后每天保留 10 分钟，练单音跟唱、长音和「高了还是低了」。训练营已恢复原来的每日训练。
      </p>
      <Button
        className="mt-5"
        variant="outline"
        onClick={async () => {
          await PitchProgramService.start(program.minutes)
          onRestart()
        }}
      >
        <RotateCcw /> 再来一轮（重新诊断）
      </Button>
    </section>
  )
}
