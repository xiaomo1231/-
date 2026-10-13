import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, Loader2, Play, Square, X } from 'lucide-react'
import { DRILL_INFO, DRILL_KINDS, MAX_LEVEL, makeDrill, type DrillQuestion } from '@/mixing/drills'
import type { EarDrillKind } from '@/mixing/types'
import type { EarDrillStats } from '@/entities/types'
import { MixCourseService } from '@/services/mixCourseService'
import { applyPatch } from '@/mixing/base'
import { loadMaterial } from '@/mixing/material'
import { ensureLessonVoice } from '@/features/mixing/useLessonVoice'
import { prepareVoice } from '@/audio/fx/voicePrep'
import { matchGains, playExcerpt, renderExcerpt, stopExcerpt, type Excerpt } from '@/widgets/mixing/excerpts'
import { useProfileStore } from '@/features/profile/profileStore'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

const EXCERPT_SECONDS = 5

interface Prepared {
  /** What "播放" plays, in order, with labels. */
  sequence: Array<{ label: string; x: Excerpt; gain: number }>
}

/** Two-segment drills compare the options themselves. */
const isPair = (q: DrillQuestion) => q.kind === 'distortion' || q.kind === 'loudness'

async function prepare(q: DrillQuestion): Promise<Prepared> {
  await ensureLessonVoice()
  const audio = await loadMaterial(q.material)
  const start = q.material === 'voice' && audio.phrases[0] ? Math.max(0, audio.phrases[0].startMs / 1000 - 0.2) : 0
  const region = { start, end: Math.min(audio.duration, start + EXCERPT_SECONDS) }
  const render = async (patch: DrillQuestion['target']) => {
    const mix = applyPatch(patch)
    const voice = audio.voice ? await prepareVoice(audio.voice, mix, audio.phrases) : null
    return renderExcerpt({ ...audio, voice }, mix, region)
  }
  if (isPair(q)) {
    const xs = await Promise.all(q.options.map((o) => render(o.patch)))
    const gains = q.noLevelMatch ? xs.map(() => 1) : matchGains(xs)
    return { sequence: xs.map((x, i) => ({ label: q.options[i]!.label, x, gain: gains[i]! })) }
  }
  if (q.reference) {
    const [ref, target] = await Promise.all([render(q.reference), render(q.target)])
    const gains = q.noLevelMatch || q.kind === 'eqFreq' || q.kind === 'eqBoostCut' || q.kind === 'lowCut' ? [1, 1] : matchGains([ref, target])
    return { sequence: [{ label: '原声', x: ref, gain: gains[0]! }, { label: '处理后', x: target, gain: gains[1]! }] }
  }
  return { sequence: [{ label: '这一段', x: await render(q.target), gain: 1 }] }
}

/** 后期课堂 · 听辨练习: ten kinds, four levels each, level follows the recent answers. */
export function EarTrainingPage() {
  const [params, setParams] = useSearchParams()
  const kind = (DRILL_KINDS as string[]).includes(params.get('kind') ?? '') ? (params.get('kind') as EarDrillKind) : null
  const [stats, setStats] = useState<Record<string, EarDrillStats>>({})
  const refresh = useProfileStore((s) => s.refresh)
  useEffect(() => {
    void MixCourseService.earStats().then((rows) => setStats(Object.fromEntries(rows.map((r) => [r.kind, r]))))
  }, [])
  useEffect(() => () => stopExcerpt(), [])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/mixing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> 后期课堂
      </Link>
      <header>
        <h1 className="text-3xl font-semibold">听辨练习</h1>
        <p className="mt-1 text-sm text-muted-foreground">最好戴耳机。连续答对会升级（差别更小、选项更多），连续答错会降一级。</p>
      </header>
      <div className="flex flex-wrap gap-2">
        {DRILL_KINDS.map((k) => {
          const s = stats[k]
          return (
            <button key={k} type="button" onClick={() => setParams({ kind: k })} className={cn('focus-ring rounded-xl border px-3 py-2 text-left text-sm', k === kind ? 'border-amber/70 bg-amber-soft/40' : 'border-border/80 hover:border-cyan/50')}>
              <div className="font-medium">{DRILL_INFO[k].title}</div>
              <div className="num text-[11px] text-muted-foreground">{s ? `第 ${s.level} 级 · 正确 ${Math.round((s.correct / Math.max(1, s.attempts)) * 100)}%` : '未练'}</div>
            </button>
          )
        })}
      </div>
      {kind ? (
        <Drill key={kind} kind={kind} level={stats[kind]?.level ?? 1} onAnswer={(s) => (setStats((m) => ({ ...m, [kind]: s })), refresh())} />
      ) : (
        <p className="text-sm text-muted-foreground">选一种开始。</p>
      )}
    </div>
  )
}

function Drill({ kind, level, onAnswer }: { kind: EarDrillKind; level: number; onAnswer: (s: EarDrillStats) => void }) {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9))
  const [lvl, setLvl] = useState(level)
  const q = useMemo(() => makeDrill(kind, lvl, seed), [kind, lvl, seed])
  const [prep, setPrep] = useState<Prepared | null>(null)
  const [playing, setPlaying] = useState<number | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [levelNote, setLevelNote] = useState<string | null>(null)

  useEffect(() => {
    let dead = false
    setPrep(null)
    setPicked(null)
    void prepare(q).then((p) => !dead && setPrep(p))
    return () => {
      dead = true
      stopExcerpt()
    }
  }, [q])

  const playAll = useCallback(async () => {
    if (!prep) return
    for (let i = 0; i < prep.sequence.length; i++) {
      setPlaying(i)
      const s = prep.sequence[i]!
      if (!(await playExcerpt(s.x, s.gain))) break
      if (i < prep.sequence.length - 1) await new Promise((r) => setTimeout(r, 400))
    }
    setPlaying(null)
  }, [prep])

  const answer = async (i: number) => {
    if (picked !== null) return
    setPicked(i)
    const s = await MixCourseService.recordAnswer(kind, i === q.answer)
    if (s.level !== lvl) setLevelNote(s.level > lvl ? `升到第 ${s.level} 级！` : `降到第 ${s.level} 级，先巩固一下。`)
    else setLevelNote(null)
    onAnswer(s)
  }

  const next = async () => {
    stopExcerpt()
    const s = (await MixCourseService.earStats()).find((x) => x.kind === kind)
    setLvl(s?.level ?? lvl)
    setSeed((x) => x + 1)
    setLevelNote(null)
  }

  return (
    <section className="space-y-4 rounded-3xl border border-border/80 bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">
          {DRILL_INFO[kind].title} · 第 {lvl} / {MAX_LEVEL} 级
        </h2>
        <select value={lvl} onChange={(e) => (void MixCourseService.setDrillLevel(kind, Number(e.target.value)), setLvl(Number(e.target.value)), setSeed((x) => x + 1))} className="focus-ring h-8 rounded-lg border border-border bg-background px-2 text-xs" aria-label="选择级别">
          {Array.from({ length: MAX_LEVEL }, (_, i) => (
            <option key={i} value={i + 1}>
              第 {i + 1} 级
            </option>
          ))}
        </select>
      </div>
      <p className="text-sm">{q.prompt}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void playAll()} disabled={!prep || playing !== null}>
          {prep ? <Play /> : <Loader2 className="animate-spin" />} 播放{prep && prep.sequence.length > 1 ? `（${prep.sequence.map((s) => s.label).join(' → ')}）` : ''}
        </Button>
        {prep?.sequence.length !== undefined && prep.sequence.length > 1 &&
          prep.sequence.map((s, i) => (
            <Button key={s.label} size="sm" variant="ghost" onClick={() => (setPlaying(i), void playExcerpt(s.x, s.gain).then(() => setPlaying(null)))}>
              只听{s.label}
            </Button>
          ))}
        {playing !== null && (
          <Button size="sm" variant="ghost" onClick={() => (stopExcerpt(), setPlaying(null))}>
            <Square /> 停止
          </Button>
        )}
        {playing !== null && prep && <span className="text-xs text-muted-foreground">正在播放：{prep.sequence[playing]?.label}</span>}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {q.options.map((o, i) => (
          <button
            key={o.label}
            type="button"
            onClick={() => void answer(i)}
            disabled={!prep}
            className={cn(
              'focus-ring flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm',
              picked === null ? 'border-border/80 hover:border-cyan/50' : i === q.answer ? 'border-success bg-success/10' : i === picked ? 'border-destructive bg-destructive/10' : 'border-border/60 opacity-60',
            )}
          >
            {o.label}
            {picked !== null && i === q.answer && <Check className="h-4 w-4 text-success" />}
            {picked === i && i !== q.answer && <X className="h-4 w-4 text-destructive" />}
          </button>
        ))}
      </div>
      {picked !== null && (
        <div className="space-y-2">
          <p className="text-sm">
            {picked === q.answer ? '答对了。' : '这次没听出来。'}
            {q.explain}
          </p>
          {levelNote && <p className="text-sm text-amber">{levelNote}</p>}
          <Button onClick={() => void next()}>下一题</Button>
        </div>
      )}
    </section>
  )
}
