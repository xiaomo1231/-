import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Headphones, History, RotateCcw, SkipForward, Sparkles, Target, Volume2 } from 'lucide-react'
import type { DrillQuestion, DrillResponse, GradeResult } from '@/drills/types'
import { moduleInfo, type ModuleId } from '@/drills/types'
import { levelTitles } from '@/drills/levels'
import type { ActiveRun, PlacementResult, PlacementSectionResult } from '@/entities/types'
import {
  PLACEMENT_SECTIONS,
  PlacementService,
  advanceLadder,
  initialLadder,
  placementQuestion,
  type LadderState,
} from '@/services/placementService'
import { DailyPlanService } from '@/services/dailyPlanService'
import { RunService } from '@/services/runService'
import { useProfileStore } from '@/features/profile/profileStore'
import { ensureAudio, playChord, playSuccess } from '@/audio/engine'
import { BrandMark } from '@/widgets/brand/BrandMark'
import { QuestionView } from '@/widgets/drill/QuestionView'
import { MODULE_ICON } from '@/widgets/drill/moduleIcons'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

type Screen = 'intro' | 'section-intro' | 'question' | 'saving' | 'report'

const RUN_ID = 'placement'

/** What the placement test saves after every step, so leaving does not lose it. */
interface PlacementSnapshot {
  screen: 'section-intro' | 'question'
  sectionIdx: number
  ladder: LadderState
  question: DrillQuestion
  result: GradeResult | null
  response: DrillResponse | null
  results: PlacementSectionResult[]
  startedAt: number
}

const STAGE_NAMES = ['节奏与声音', '音高系统', '和声基础', '旋律与歌曲结构', '进阶和声', '编曲']

export function PlacementPage() {
  const navigate = useNavigate()
  const profile = useProfileStore((s) => s.profile)!
  const refresh = useProfileStore((s) => s.refresh)
  const [screen, setScreen] = useState<Screen>('intro')
  const [sectionIdx, setSectionIdx] = useState(0)
  const [ladder, setLadder] = useState<LadderState>(initialLadder())
  const [question, setQuestion] = useState<DrillQuestion | null>(null)
  const [result, setResult] = useState<GradeResult | null>(null)
  const [response, setResponse] = useState<DrillResponse | null>(null)
  const [report, setReport] = useState<PlacementResult | null>(null)
  const results = useRef<PlacementSectionResult[]>([])
  const startedAt = useRef(Date.now())
  const [saved, setSaved] = useState<ActiveRun | null>(null)
  const finishedRef = useRef(false)

  useEffect(() => {
    let live = true
    void RunService.get(RUN_ID).then((r) => live && r?.kind === 'placement' && setSaved(r))
    return () => {
      live = false
    }
  }, [])

  // Save after every step of the test.
  useEffect(() => {
    if ((screen !== 'section-intro' && screen !== 'question') || !question || finishedRef.current) return
    const data: PlacementSnapshot = { screen, sectionIdx, ladder, question, result, response, results: results.current, startedAt: startedAt.current }
    void RunService.save({ id: RUN_ID, kind: 'placement', title: '入门测试', link: '/placement', done: results.current.length, total: PLACEMENT_SECTIONS.length, correct: 0, data }).catch(() => undefined)
  }, [screen, sectionIdx, ladder, question, result, response])

  const resumeSaved = (run: ActiveRun) => {
    const d = run.data as PlacementSnapshot
    setSaved(null)
    results.current = d.results
    startedAt.current = d.startedAt
    setSectionIdx(d.sectionIdx)
    setLadder(d.ladder)
    setQuestion(d.question)
    setResult(d.result)
    setResponse(d.response)
    setScreen(d.screen)
  }

  const section = PLACEMENT_SECTIONS[sectionIdx]!

  const beginSection = useCallback((idx: number) => {
    const def = PLACEMENT_SECTIONS[idx]!
    setSectionIdx(idx)
    setLadder(initialLadder())
    setQuestion(placementQuestion(def, 1))
    setResult(null)
    setResponse(null)
    setScreen('section-intro')
  }, [])

  const finishAll = useCallback(async () => {
    finishedRef.current = true
    setScreen('saving')
    await RunService.clear(RUN_ID)
    const r = await PlacementService.finalize(results.current, startedAt.current)
    await DailyPlanService.rebuildToday()
    await refresh()
    setReport(r)
    setScreen('report')
    playSuccess()
  }, [refresh])

  const closeSection = useCallback(
    (state: LadderState, skipped: boolean) => {
      results.current.push({
        id: section.id,
        title: section.title,
        module: section.module,
        reachedLevel: skipped ? 0 : state.reachedLevel,
        attempts: state.attempts,
        correct: state.correct,
        skipped,
      })
      if (sectionIdx + 1 < PLACEMENT_SECTIONS.length) beginSection(sectionIdx + 1)
      else void finishAll()
    },
    [beginSection, finishAll, section, sectionIdx],
  )

  const onSubmit = useCallback(
    async (r: DrillResponse) => {
      if (!question || result) return
      setResponse(r)
      const grade = await PlacementService.gradeAndRecord(question, r)
      setResult(grade)
      if (grade.correct) playSuccess()
    },
    [question, result],
  )

  const onNext = useCallback(() => {
    if (!result || !question) return
    // Rhythm counts as passed with a solid (not perfect) take.
    const passed = result.correct || (question.module === 'R1' && result.credit >= 0.6)
    const next = advanceLadder(ladder, passed, section)
    setLadder(next)
    if (next.finished) {
      closeSection(next, false)
      return
    }
    const avoid = 'answer' in question && !Array.isArray(question.answer) ? String(question.answer) : undefined
    setQuestion(placementQuestion(section, next.level, avoid))
    setResult(null)
    setResponse(null)
  }, [closeSection, ladder, question, result, section])

  if (screen === 'intro') {
    return (
      <Frame>
        <div className="animate-rise">
          <Headphones className="h-10 w-10 text-cyan" />
          <h1 className="mt-6 text-4xl font-semibold">入门测试</h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-muted-foreground">
            {profile.displayName ? `${profile.displayName}，` : ''}这不是考试。{PLACEMENT_SECTIONS.length} 个小段落，每段从最简单开始，答对就加难，连错两题就进入下一段。大约 10 分钟，结果决定你从哪里起步。不会的段落可以直接跳过。
          </p>
          <div className="mt-10 grid max-w-2xl grid-cols-4 gap-2">
            {PLACEMENT_SECTIONS.map((s) => {
              const Icon = MODULE_ICON[s.module]
              return (
                <div key={s.id} className="rounded-xl border border-border/80 bg-card p-3 text-center">
                  <Icon className="mx-auto h-4 w-4 text-amber" />
                  <div className="mt-2 text-xs">{s.title}</div>
                </div>
              )
            })}
          </div>
          <div className="mt-10 rounded-2xl border border-border/80 bg-card p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">先调一下音量</div>
                <div className="text-sm text-muted-foreground">建议戴耳机。点击试听，调到舒适但清楚的音量。</div>
              </div>
              <Button
                variant="outline"
                onClick={async () => {
                  await ensureAudio()
                  playChord([60, 64, 67, 72])
                }}
              >
                <Volume2 /> 试听
              </Button>
            </div>
          </div>
          {saved && (
            <div className="mt-10 flex items-center justify-between gap-4 rounded-2xl border border-cyan/40 bg-card p-5">
              <div className="flex items-center gap-3">
                <History className="h-5 w-5 text-cyan" aria-hidden />
                <div>
                  <div className="font-medium">上次测到一半</div>
                  <div className="text-sm text-muted-foreground">
                    已完成 {saved.done} / {saved.total} 段，正在测「{PLACEMENT_SECTIONS[(saved.data as PlacementSnapshot).sectionIdx]?.title ?? ''}」。
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={async () => {
                    await ensureAudio()
                    resumeSaved(saved)
                  }}
                >
                  继续 <ArrowRight />
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    await RunService.clear(RUN_ID)
                    setSaved(null)
                  }}
                >
                  <RotateCcw /> 重新开始
                </Button>
              </div>
            </div>
          )}
          <div className="mt-10 flex items-center gap-4">
            <Button
              size="lg"
              onClick={async () => {
                await ensureAudio()
                if (saved) {
                  await RunService.clear(RUN_ID)
                  setSaved(null)
                }
                startedAt.current = Date.now()
                results.current = []
                beginSection(0)
              }}
            >
              开始 <ArrowRight />
            </Button>
            <Button variant="ghost" onClick={() => navigate('/camp')}>
              以后再测，先去训练营
            </Button>
          </div>
        </div>
      </Frame>
    )
  }

  if (screen === 'saving') {
    return (
      <Frame>
        <div className="py-32 text-center text-muted-foreground">正在分析你的起点…</div>
      </Frame>
    )
  }

  if (screen === 'report' && report) {
    return (
      <Frame>
        <PlacementReport report={report} onContinue={() => navigate('/camp')} />
      </Frame>
    )
  }

  const Icon = MODULE_ICON[section.module]

  return (
    <Frame>
      <div className="mb-10 flex items-center gap-2">
        {PLACEMENT_SECTIONS.map((s, i) => (
          <div key={s.id} className="flex-1">
            <div
              className={cn(
                'h-1.5 rounded-full transition-colors',
                i < sectionIdx ? 'bg-amber' : i === sectionIdx ? 'bg-cyan' : 'bg-muted',
              )}
            />
            <div className={cn('mt-2 text-[11px]', i === sectionIdx ? 'text-foreground' : 'text-muted-foreground')}>{s.title}</div>
          </div>
        ))}
      </div>

      {screen === 'section-intro' ? (
        <div className="animate-rise py-10">
          <Icon className="h-9 w-9 text-amber" />
          <div className="mt-6 font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
            第 {sectionIdx + 1} 段 / 共 {PLACEMENT_SECTIONS.length} 段
          </div>
          <h2 className="mt-2 text-3xl font-semibold">{section.title}</h2>
          <p className="mt-3 text-lg text-muted-foreground">{section.intro}</p>
          {section.mic && (
            <p className="mt-3 rounded-xl border border-cyan/30 bg-cyan-soft/20 px-4 py-3 text-sm text-muted-foreground">
              浏览器会请求麦克风权限。声音只在本机分析，不会被录下或上传。唱在高八度或低八度都算对。
            </p>
          )}
          <div className="mt-10 flex gap-3">
            <Button size="lg" onClick={() => setScreen('question')} autoFocus>
              开始这一段 <ArrowRight />
            </Button>
            <Button variant="ghost" onClick={() => closeSection(ladder, true)}>
              <SkipForward /> 跳过这一段
            </Button>
          </div>
        </div>
      ) : (
        question && (
          <div className="animate-fade">
            <div className="mb-6 flex items-center justify-between font-mono text-xs text-muted-foreground">
              <span>
                {section.title} · 难度 {ladder.level}
                {levelTitles(section.module)[ladder.level - 1] ? ` · ${levelTitles(section.module)[ladder.level - 1]!.title}` : ''}
              </span>
              <button type="button" className="focus-ring rounded hover:text-foreground" onClick={() => closeSection(ladder, ladder.attempts === 0)}>
                结束这一段 →
              </button>
            </div>
            <QuestionView
              key={question.id}
              question={question}
              result={result}
              response={response}
              onSubmit={(r) => void onSubmit(r)}
              onNext={onNext}
              deviceLatencyMs={profile.deviceLatencyMs}
              nextLabel="继续"
            />
          </div>
        )
      )}
    </Frame>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-full max-w-4xl px-8 py-10">
      <div className="mb-10 flex items-center gap-3">
        <BrandMark className="h-7 w-7" />
        <span className="font-display text-sm font-semibold">律动工坊 · 入门测试</span>
      </div>
      {children}
    </div>
  )
}

function PlacementReport({ report, onContinue }: { report: PlacementResult; onContinue: () => void }) {
  return (
    <div className="animate-rise space-y-10">
      <div>
        <Sparkles className="h-9 w-9 text-amber" />
        <h1 className="mt-5 text-4xl font-semibold">你的起点</h1>
        <p className="mt-3 text-muted-foreground">这是基于刚才几十道题的估计，不是对能力的定论。练得越多，系统越准。</p>
      </div>

      <div className="studio-noise rounded-3xl border border-amber/40 bg-amber-soft/30 p-8">
        <div className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">推荐起步阶段</div>
        <div className="mt-3 flex items-baseline gap-4">
          <span className="num text-6xl font-semibold text-amber glow-amber">{String(report.recommendedStage).padStart(2, '0')}</span>
          <span className="font-display text-2xl font-semibold">{STAGE_NAMES[report.recommendedStage]}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border/80 bg-card p-6">
          <div className="text-sm font-medium text-success">已经比较稳的</div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {report.strengths.length ? report.strengths.map((s) => <li key={s}>· {s}</li>) : <li className="text-muted-foreground">从头打基础，进步会很快。</li>}
          </ul>
        </div>
        <div className="rounded-2xl border border-border/80 bg-card p-6">
          <div className="flex items-center gap-2 text-sm font-medium text-amber">
            <Target className="h-4 w-4" /> 可能需要多练的部分
          </div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {report.gaps.length ? report.gaps.map((s) => <li key={s}>· {s}</li>) : <li className="text-muted-foreground">没有明显短板。</li>}
          </ul>
        </div>
      </div>

      <div>
        <div className="mb-3 text-sm font-medium">各模块起始级别</div>
        <div className="grid grid-cols-4 gap-3">
          {report.sections.map((s) => {
            const m = s.module as ModuleId
            const start = report.startingLevels[m]
            const Icon = MODULE_ICON[m]
            return (
              <div key={s.id} className="rounded-2xl border border-border/80 bg-card p-4">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <div className="mt-3 text-xs text-muted-foreground">{moduleInfo(m).name}</div>
                <div className="num mt-1 text-2xl font-semibold">{s.skipped ? '–' : `L${start ?? 1}`}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {s.skipped ? '已跳过' : `${s.correct}/${s.attempts} 正确`}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <Button size="lg" onClick={onContinue}>
        进入训练营，开始今天的训练 <ArrowRight />
      </Button>
    </div>
  )
}
