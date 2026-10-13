import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, CircleDot, Ear, Loader2, Mic, Square, Trash2, Wand2 } from 'lucide-react'
import { MIX_LESSONS, MIX_UNITS, lessonsOf } from '@/mixing/lessons'
import { useLessonVoice } from '@/features/mixing/useLessonVoice'
import { MixCourseService } from '@/services/mixCourseService'
import { getDb } from '@/infrastructure/db/database'
import type { MixLessonProgress } from '@/entities/types'
import { detector } from '@/audio/pitch/detector'
import { VoiceRecorder } from '@/audio/sing/voiceRecorder'
import { rawTime } from '@/audio/engine'
import { toast } from '@/features/toast/toastStore'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

const RECORD_SECONDS = 20

/**
 * 后期课堂: seven units of mixing lessons (each with a listening demo and,
 * mostly, a hands-on task), ear drills, and the student's own voice as
 * lesson material.
 */
export function MixingPage() {
  const [progress, setProgress] = useState<Record<string, MixLessonProgress>>({})
  useEffect(() => {
    void MixCourseService.progress().then((rows) => setProgress(Object.fromEntries(rows.map((r) => [r.lessonId, r]))))
  }, [])
  const read = MIX_LESSONS.filter((l) => progress[l.id]?.readAt).length
  const tasks = MIX_LESSONS.filter((l) => l.task)
  const passed = tasks.filter((l) => progress[l.id]?.taskPassedAt).length
  const nextLesson = MIX_LESSONS.find((l) => !progress[l.id]?.readAt) ?? MIX_LESSONS[0]!

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-semibold">后期课堂</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            从电平、EQ、压缩到混响、母带：每课先讲清楚原理，再用耳朵对比，最后自己动手调一次。学到的东西直接用在跟唱的「后期」里。
          </p>
        </div>
        <div className="text-right text-sm">
          <div>
            已读 <span className="num font-semibold">{read}</span> / {MIX_LESSONS.length} 课 · 动手完成 <span className="num font-semibold">{passed}</span> / {tasks.length}
          </div>
          <Button size="sm" className="mt-2" asChild>
            <Link to={`/mixing/${nextLesson.id}`}>继续：{nextLesson.title}</Link>
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <VoiceCard />
        <Link to="/mixing/ear" className="focus-ring flex items-start gap-3 rounded-3xl border border-border/80 bg-card p-5 hover:border-cyan/50">
          <Ear className="mt-1 h-6 w-6 text-cyan" aria-hidden />
          <div>
            <h2 className="font-semibold">听辨练习</h2>
            <p className="text-sm text-muted-foreground">EQ 频率、压缩多少、混响长短、声像、失真、响度差……十种练习，每种四级，答对会自动升级。</p>
          </div>
        </Link>
      </div>

      {MIX_UNITS.map((u, ui) => (
        <section key={u.id} className="rounded-3xl border border-border/80 bg-card p-5">
          <h2 className="text-lg font-semibold">
            <span className="num mr-2 text-amber">{String(ui + 1).padStart(2, '0')}</span>
            {u.title}
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">{u.summary}</p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {lessonsOf(u.id).map((l) => {
              const p = progress[l.id]
              return (
                <li key={l.id}>
                  <Link to={`/mixing/${l.id}`} className="focus-ring flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                    {p?.taskPassedAt ? <Check className="h-4 w-4 text-success" /> : p?.readAt ? <CircleDot className="h-4 w-4 text-cyan" /> : <span className="h-4 w-4 rounded-full border border-border" />}
                    <span className="min-w-0 flex-1 truncate">{l.title}</span>
                    {l.task && <Wand2 className={cn('h-3.5 w-3.5', p?.taskPassedAt ? 'text-success' : 'text-muted-foreground')} aria-label="有动手任务" />}
                    <span className="num text-xs text-muted-foreground">{l.minutes} 分</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** The student's own voice for the lessons: record 20 s, or use recent 跟唱 recordings. */
function VoiceCard() {
  const { voice, save, remove, loading } = useLessonVoice()
  const [recording, setRecording] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const stopRef = useRef<(() => void) | null>(null)
  useEffect(() => () => stopRef.current?.(), [])

  const record = async () => {
    setBusy(true)
    try {
      await detector.start('voice')
      const rec = new VoiceRecorder(60)
      if (!(await rec.start())) throw new Error('这个浏览器不能录音。')
      const t0 = rawTime()
      let cancelled = false
      stopRef.current = () => {
        cancelled = true
      }
      setBusy(false)
      for (let s = 0; s < RECORD_SECONDS && !cancelled; s++) {
        setRecording(RECORD_SECONDS - s)
        await new Promise((r) => setTimeout(r, 1000))
      }
      const samples = rec.clip(t0, rawTime())
      rec.stop()
      detector.stop()
      setRecording(null)
      if (cancelled && samples.length < rec.sampleRate * 5) return
      await save(samples, rec.sampleRate, 'recorded')
      toast({ title: '录好了', description: '之后的示范和动手任务都会用你的声音。', variant: 'success' })
    } catch (e) {
      setRecording(null)
      detector.stop()
      toast({ title: '没能录音', description: e instanceof Error ? e.message : String(e), variant: 'error' })
    } finally {
      setBusy(false)
      stopRef.current = null
    }
  }

  const fromTakes = async () => {
    setBusy(true)
    try {
      const takes = (await getDb().singTakes.toArray()).filter((t) => t.audio).sort((a, b) => b.createdAt - a.createdAt)
      if (!takes.length) throw new Error('跟唱里还没有带录音的演唱。')
      const ctx = new OfflineAudioContext(1, 1, 44100)
      const parts: Float32Array[] = []
      let total = 0
      for (const t of takes) {
        const buf = await ctx.decodeAudioData(await t.audio!.arrayBuffer())
        const x = new Float32Array(buf.getChannelData(0))
        parts.push(x, new Float32Array(Math.round(0.5 * 44100)))
        total += x.length / 44100 + 0.5
        if (total >= RECORD_SECONDS) break
      }
      const samples = new Float32Array(parts.reduce((t, p) => t + p.length, 0))
      let o = 0
      for (const p of parts) {
        samples.set(p, o)
        o += p.length
      }
      await save(samples.subarray(0, Math.min(samples.length, 30 * 44100)), 44100, 'take')
      toast({ title: '已用跟唱的录音', variant: 'success' })
    } catch (e) {
      toast({ title: '没能取用录音', description: e instanceof Error ? e.message : String(e), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3 rounded-3xl border border-border/80 bg-card p-5">
      <div className="flex items-start gap-3">
        <Mic className="mt-1 h-6 w-6 text-amber" aria-hidden />
        <div>
          <h2 className="font-semibold">用你自己的声音上课</h2>
          <p className="text-sm text-muted-foreground">
            {loading
              ? '读取中…'
              : voice
                ? `已有一段 ${Math.round(voice.durationMs / 1000)} 秒的${voice.source === 'recorded' ? '录音' : '跟唱录音'}，示范和动手任务里的人声都是它。`
                : `随便唱 ${RECORD_SECONDS} 秒（几句就行，戴耳机或在安静的地方）。没录之前，课里用的是合成的示范人声。`}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {recording !== null ? (
          <Button variant="secondary" onClick={() => stopRef.current?.()}>
            <Square /> 停止（还剩 {recording} 秒）
          </Button>
        ) : (
          <Button onClick={() => void record()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Mic />} {voice ? '重新录一段' : `录 ${RECORD_SECONDS} 秒`}
          </Button>
        )}
        <Button variant="outline" onClick={() => void fromTakes()} disabled={busy || recording !== null}>
          用跟唱里的录音
        </Button>
        {voice && (
          <Button variant="ghost" onClick={() => void remove()} disabled={busy || recording !== null}>
            <Trash2 /> 改回示范人声
          </Button>
        )}
      </div>
    </section>
  )
}
