import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Ear, Headphones, Loader2, Pause, Play, RotateCcw, Square, Wand2 } from 'lucide-react'
import { MIX_LESSONS, MIX_UNITS, lessonById } from '@/mixing/lessons'
import { applyPatch } from '@/mixing/base'
import { loadMaterial, type LessonAudio } from '@/mixing/material'
import { checkMeasure, checkSetting, type CheckResult, type Rendered } from '@/mixing/checks'
import type { DemoSpec, TaskSpec } from '@/mixing/types'
import { DRILL_INFO } from '@/mixing/drills'
import { renderMix } from '@/audio/sing/mixChain'
import { prepareVoice } from '@/audio/fx/voicePrep'
import type { MixSettings } from '@/songs/singTypes'
import { MixCourseService } from '@/services/mixCourseService'
import { MixPlayer } from '@/widgets/mix/mixPlayer'
import { LessonFigure } from '@/widgets/mixing/Figures'
import { ControlField } from '@/widgets/mixing/ControlField'
import { matchGains, playExcerpt, renderExcerpt, stopExcerpt, type Excerpt } from '@/widgets/mixing/excerpts'
import { BPM, MATERIAL_RATE } from '@/mixing/material'
import { useProfileStore } from '@/features/profile/profileStore'
import { toast } from '@/features/toast/toastStore'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

const DEMO_SECONDS = 9

/** 后期课堂: one lesson — text, figure, A/B demo, hands-on task. */
export function MixLessonPage() {
  const { lessonId = '' } = useParams()
  const lesson = lessonById(lessonId)
  const refresh = useProfileStore((s) => s.refresh)
  useEffect(() => {
    if (lesson) void MixCourseService.markRead(lesson.id).then(refresh)
    return () => stopExcerpt()
  }, [lesson, refresh])
  if (!lesson) return <Navigate to="/mixing" replace />
  const unit = MIX_UNITS.find((u) => u.id === lesson.unit)
  const i = MIX_LESSONS.indexOf(lesson)
  const prev = MIX_LESSONS[i - 1]
  const next = MIX_LESSONS[i + 1]

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/mixing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> 后期课堂
      </Link>
      <header>
        <p className="text-xs text-muted-foreground">
          {unit?.title} · 约 {lesson.minutes} 分钟
        </p>
        <h1 className="mt-1 text-3xl font-semibold">{lesson.title}</h1>
      </header>
      {lesson.figure && <LessonFigure id={lesson.figure} />}
      <section className="space-y-3 text-[15px] leading-7">
        {lesson.body.map((p, k) => (
          <p key={k}>{p}</p>
        ))}
      </section>
      <section className="rounded-2xl border border-amber/40 bg-amber-soft/20 p-4">
        <h2 className="mb-2 text-sm font-semibold">要点</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {lesson.keyPoints.map((k) => (
            <li key={k}>{k}</li>
          ))}
        </ul>
      </section>
      {lesson.demo && <DemoPanel key={`demo-${lesson.id}`} demo={lesson.demo} />}
      {lesson.task && <TaskPanel key={`task-${lesson.id}`} lessonId={lesson.id} task={lesson.task} onPassed={refresh} />}
      <div className="flex flex-wrap gap-2">
        {lesson.drill && (
          <Button variant="outline" asChild>
            <Link to={`/mixing/ear?kind=${lesson.drill}`}>
              <Ear /> 听辨练习：{DRILL_INFO[lesson.drill].title}
            </Link>
          </Button>
        )}
        {lesson.deskModule && (
          <Button variant="ghost" asChild>
            <Link to="/sing">
              <Headphones /> 去跟唱的「后期」里用一用
            </Link>
          </Button>
        )}
      </div>
      <nav className="flex justify-between border-t border-border/60 pt-4 text-sm">
        {prev ? (
          <Link to={`/mixing/${prev.id}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link to={`/mixing/${next.id}`} className="inline-flex items-center gap-1 text-cyan hover:underline">
            {next.title} <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </nav>
    </div>
  )
}

/** Render the material through two settings and play them at matched loudness. */
function DemoPanel({ demo }: { demo: DemoSpec }) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready'>('idle')
  const [playing, setPlaying] = useState<'a' | 'b' | null>(null)
  const excerpts = useRef<{ a: Excerpt; b: Excerpt; gains: number[] } | null>(null)

  const prepare = async () => {
    if (excerpts.current) return excerpts.current
    setState('loading')
    try {
      const audio = await loadMaterial(demo.material, demo.problems ?? [])
      const region = { start: 0, end: Math.min(DEMO_SECONDS, audio.duration) }
      const render = async (patch: DemoSpec['a']) => {
        const mix = applyPatch(patch)
        const voice = audio.voice ? await prepareVoice(audio.voice, mix, audio.phrases) : null
        return renderExcerpt({ ...audio, voice }, mix, region)
      }
      const [a, b] = await Promise.all([render(demo.a), render(demo.b)])
      const gains = demo.noLevelMatch ? [1, 1] : matchGains([a, b])
      excerpts.current = { a, b, gains }
      setState('ready')
      return excerpts.current
    } catch (e) {
      setState('idle')
      toast({ title: '示范没能准备好', description: e instanceof Error ? e.message : String(e), variant: 'error' })
      return null
    }
  }

  const play = async (which: 'a' | 'b' | 'ab') => {
    const x = await prepare()
    if (!x) return
    if (which === 'ab') {
      setPlaying('a')
      if (await playExcerpt(x.a, x.gains[0])) {
        setPlaying('b')
        await playExcerpt(x.b, x.gains[1])
      }
    } else {
      setPlaying(which)
      await playExcerpt(which === 'a' ? x.a : x.b, which === 'a' ? x.gains[0] : x.gains[1])
    }
    setPlaying(null)
  }

  return (
    <section className="space-y-3 rounded-3xl border border-border/80 bg-card p-5">
      <h2 className="font-semibold">听一听</h2>
      <p className="text-sm text-muted-foreground">{demo.listenFor}</p>
      <div className="flex flex-wrap gap-2">
        {(['a', 'b'] as const).map((k) => (
          <Button key={k} variant={playing === k ? 'secondary' : 'outline'} onClick={() => void play(k)} disabled={state === 'loading'}>
            {playing === k ? <Square /> : <Play />} {k.toUpperCase()}：{k === 'a' ? demo.aLabel : demo.bLabel}
          </Button>
        ))}
        <Button variant="ghost" onClick={() => void play('ab')} disabled={state === 'loading'}>
          A → B 连着听
        </Button>
        {playing && (
          <Button variant="ghost" onClick={() => (stopExcerpt(), setPlaying(null))}>
            停止
          </Button>
        )}
        {state === 'loading' && <Loader2 className="h-5 w-5 animate-spin self-center text-muted-foreground" />}
      </div>
      <p className="text-xs text-muted-foreground">{demo.noLevelMatch ? '这一组故意保留了音量差。' : '两段已经调到一样响，只比较效果本身。'}</p>
    </section>
  )
}

/** Gain reduction of the main compressor in a render: loud-part level with the compressor (no makeup) vs. without. */
async function measureReduction(audio: LessonAudio, mix: MixSettings): Promise<number> {
  if (!mix.vocal.comp.on) return 0
  const region = { start: 0, end: Math.min(12, audio.duration) }
  const off = { ...mix, vocal: { ...mix.vocal, comp: { ...mix.vocal.comp, on: false } } }
  const on = { ...mix, vocal: { ...mix.vocal, comp: { ...mix.vocal.comp, makeupDb: 0 } } }
  const [a, b] = await Promise.all([off, on].map((m) => renderMix({ voice: audio.voice, backing: [], mix: m, bpm: BPM, region, part: 'voice', sampleRate: MATERIAL_RATE })))
  const loud = (ch: Float32Array[]) => {
    const x = ch[0]!
    const win = Math.round(MATERIAL_RATE * 0.05)
    const ls: number[] = []
    for (let i = 0; i + win <= x.length; i += win) {
      let s = 0
      for (let j = i; j < i + win; j++) s += x[j]! * x[j]!
      ls.push(10 * Math.log10(s / win + 1e-12))
    }
    ls.sort((p, q) => p - q)
    return ls[Math.floor(ls.length * 0.97)] ?? -120
  }
  return Math.max(0, loud(a!) - loud(b!))
}

function TaskPanel({ lessonId, task, onPassed }: { lessonId: string; task: TaskSpec; onPassed: () => void }) {
  const start = useMemo(() => applyPatch(task.start), [task])
  const [mix, setMix] = useState<MixSettings>(start)
  const [audio, setAudio] = useState<LessonAudio | null>(null)
  const [playing, setPlaying] = useState(false)
  const [checking, setChecking] = useState(false)
  const [results, setResults] = useState<CheckResult[] | null>(null)
  const player = useRef<MixPlayer | null>(null)
  if (!player.current) player.current = new MixPlayer()
  const p = player.current

  useEffect(() => {
    let dead = false
    void loadMaterial(task.material, task.problems ?? []).then((a) => !dead && setAudio(a))
    return () => {
      dead = true
      p.dispose()
    }
  }, [task, p])

  // The voice the chain hears (level riding / tuning applied when the lesson uses them).
  useEffect(() => {
    if (!audio) return
    let dead = false
    void (audio.voice ? prepareVoice(audio.voice, mix, audio.phrases) : Promise.resolve(null)).then((v) => !dead && p.setBuffers(v, audio.backing, audio.backingNames))
    return () => {
      dead = true
    }
  }, [audio, mix, p])
  useEffect(() => {
    p.setMix(mix)
    p.setBpm(BPM)
  }, [mix, p])
  useEffect(() => {
    const t = setInterval(() => setPlaying(p.isPlaying()), 200)
    return () => clearInterval(t)
  }, [p])

  const toggle = async () => {
    stopExcerpt()
    if (p.isPlaying()) p.pause()
    else await p.play(0, { start: 0, end: p.total() })
    setPlaying(p.isPlaying())
  }

  const check = async () => {
    if (!audio) return
    setChecking(true)
    try {
      const out: CheckResult[] = task.checks.map((c) => checkSetting(mix, c))
      if (task.measures?.length) {
        const render = async (m: MixSettings) => renderMix({ voice: audio.voice ? await prepareVoice(audio.voice, m, audio.phrases) : null, backing: audio.backing, backingNames: audio.backingNames, mix: m, bpm: BPM, sampleRate: MATERIAL_RATE })
        const [after, before] = await Promise.all([render(mix), render(start)])
        const r: Rendered = { after, before, rate: MATERIAL_RATE, phrases: audio.phrases }
        if (task.measures.some((m) => m.kind === 'gainReduction')) r.gainReductionDb = await measureReduction(audio, mix)
        for (const m of task.measures) out.push(checkMeasure(r, m))
      }
      setResults(out)
      if (out.every((x) => x.ok)) {
        const first = await MixCourseService.markTaskPassed(lessonId)
        onPassed()
        toast({ title: first ? '完成了！+15 经验' : '又一次完成了', description: task.success, variant: 'success' })
      }
    } catch (e) {
      toast({ title: '检查时出错了', description: e instanceof Error ? e.message : String(e), variant: 'error' })
    } finally {
      setChecking(false)
    }
  }

  const passed = results?.every((x) => x.ok)
  return (
    <section className="space-y-4 rounded-3xl border border-cyan/40 bg-card p-5">
      <div className="flex items-start gap-2">
        <Wand2 className="mt-0.5 h-5 w-5 text-cyan" aria-hidden />
        <div>
          <h2 className="font-semibold">动手做</h2>
          <p className="text-sm">{task.goal}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void toggle()} disabled={!audio}>
          {playing ? <Pause /> : <Play />} {playing ? '暂停' : '播放（边听边调）'}
        </Button>
        <Button variant="ghost" onClick={() => (setMix(start), setResults(null))}>
          <RotateCcw /> 重来
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {task.controls.map((path) => (
          <ControlField key={path} path={path} mix={mix} onChange={(m) => (setMix(m), setResults(null))} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => void check()} disabled={!audio || checking}>
          {checking ? <Loader2 className="animate-spin" /> : <Check />} 检查
        </Button>
        {passed && <span className="text-sm text-success">{task.success}</span>}
      </div>
      {results && !passed && (
        <div className="space-y-1 rounded-xl border border-amber/40 bg-amber-soft/20 p-3 text-sm">
          {results
            .filter((x) => !x.ok)
            .map((x, k) => (
              <p key={k}>{x.message}</p>
            ))}
          <p className={cn('text-muted-foreground')}>{task.hint}</p>
        </div>
      )}
    </section>
  )
}
