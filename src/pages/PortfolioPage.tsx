import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Disc3, Mic, Play, Square, Trash2 } from 'lucide-react'
import * as engine from '@/audio/engine'
import type { Composition } from '@/entities/types'
import { CompositionService } from '@/services/courseService'
import { STAGES, lessonById } from '@/course/stages'
import { rhythmOnsets } from '@/course/rules'
import { scoreFromCells, type Score } from '@/music/score'
import { useAsync } from '@/shared/lib/useAsync'
import { ScoreNotation } from '@/widgets/notation/ScoreNotation'
import { RhythmStaff } from '@/widgets/notation/RhythmStaff'
import { Button } from '@/shared/ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/Dialog'
import { buttonVariants } from '@/shared/ui/buttonVariants'
import { formatDateShort } from '@/shared/lib/format'
import { VersionHistoryButton } from '@/widgets/studio/VersionHistory'
import { SingService } from '@/services/singService'
import { CoverList } from '@/widgets/portfolio/CoverList'

const MINOR_SCALES = ['natural_minor', 'harmonic_minor', 'melodic_minor', 'pentatonic_minor', 'blues', 'dorian', 'phrygian']

/** Any melody-bearing work as a Score, so it renders in the student's notation. */
function workScore(c: Composition): Score {
  if (c.score) return c.score
  return scoreFromCells(c.cells, { tonic: c.tonic ?? 60, mode: MINOR_SCALES.includes(c.scale ?? '') ? 'minor' : 'major', bpm: c.bpm })
}

export function PortfolioPage() {
  const { data, reload } = useAsync(() => CompositionService.list(), [])
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Composition | null>(null)
  const covers = useAsync(() => SingService.covers(), [])

  const play = async (c: Composition) => {
    await engine.ensureAudio()
    engine.stopAll()
    engine.stopArrangement()
    if (playingId === c.id) {
      setPlayingId(null)
      return
    }
    setPlayingId(c.id)
    const beat = 60 / c.bpm
    let end: number
    if (c.kind === 'song' && c.score) {
      end = (await engine.playScore(c.score)).endAt
    } else if (c.kind === 'rhythm') {
      const sched = engine.scheduleClicks(c.bpm, c.steps / 2, { accentEvery: 4 })
      engine.scheduleRhythmHits(rhythmOnsets(c).map((o) => sched.startAt + o * beat))
      end = sched.endAt
    } else {
      end = engine.playSequence(
        c.cells.map((m, i) => (typeof m === 'number' && m >= 0 ? { midi: m, duration: beat * 0.92, at: i * beat } : null)).filter((e): e is engine.NoteEvent => e !== null),
      ).endAt
    }
    engine.onAudioTime(end, () => setPlayingId((id) => (id === c.id ? null : id)))
  }

  const byStage = STAGES.map((s) => ({ stage: s, works: (data ?? []).filter((c) => c.stage === s.stage) })).filter((g) => g.works.length > 0)

  return (
    <div className="space-y-12">
      <header>
        <div className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">Discography</div>
        <h1 className="mt-2 text-4xl font-semibold">作品集</h1>
        <p className="mt-3 text-muted-foreground">每节课的微创作都会收进这里，按阶段装成一张张“专辑”。</p>
      </header>

      {data && data.length === 0 && (
        <div className="rounded-3xl border border-dashed border-border p-12 text-center">
          <Disc3 className="mx-auto h-10 w-10 animate-spin-slow text-muted-foreground" />
          <p className="mt-4 text-muted-foreground">还没有作品。每节课最后都有一段微创作。</p>
          <Link to="/course" className={buttonVariants({ className: 'mt-6' })}>
            去上第一课
          </Link>
        </div>
      )}

      {byStage.map(({ stage, works }) => (
        <section key={stage.stage}>
          <div className="mb-5 flex items-center gap-5">
            <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl border border-border/80 bg-gradient-to-br from-amber/30 via-card to-cyan/20 shadow-lift">
              <Disc3 className="h-10 w-10 text-foreground/70" />
              <span className="num absolute bottom-1 right-2 text-xs text-amber">{String(stage.stage).padStart(2, '0')}</span>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">专辑 · 阶段 {stage.stage}</div>
              <h2 className="text-2xl font-semibold">{stage.title}</h2>
              <div className="text-sm text-muted-foreground">{works.length} 首</div>
            </div>
          </div>
          <ol className="grid grid-cols-2 gap-4">
            {works.map((c, i) => (
              <li key={c.id} className="rounded-2xl border border-border/80 bg-card p-5 surface-gradient">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="num text-xs text-muted-foreground">
                      Track {String(i + 1).padStart(2, '0')} · {c.kind === 'rhythm' ? '节奏' : c.kind === 'song' ? `歌曲 · ${c.score?.bars ?? 0} 小节` : '旋律'} · {c.bpm} BPM
                    </div>
                    <div className="mt-1 font-display text-lg font-semibold">{c.title}</div>
                    {c.lessonId && <div className="text-xs text-muted-foreground">来自 {lessonById(c.lessonId)?.title ?? c.lessonId} · {formatDateShort(c.updatedAt)}</div>}
                  </div>
                  <div className="flex gap-1">
                    {c.kind === 'song' && c.score && <VersionHistoryButton composition={c} onRestored={() => reload()} />}
                    <Button size="icon" variant="outline" onClick={() => void play(c)} aria-label={playingId === c.id ? `停止「${c.title}」` : `播放「${c.title}」`}>
                      {playingId === c.id ? <Square /> : <Play />}
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setDeleting(c)} aria-label={`删除「${c.title}」`}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                <div className="mt-3 rounded-xl bg-background/50 px-2">
                  {c.kind === 'rhythm' ? (
                    Array.from({ length: Math.ceil(c.steps / 8) }, (_, bar) => (
                      <RhythmStaff key={bar} onsets={rhythmOnsets({ cells: c.cells.slice(bar * 8, bar * 8 + 8) })} beats={4} width={380} />
                    ))
                  ) : (
                    <ScoreNotation score={workScore(c)} chordLabels="symbol" />
                  )}
                </div>
                <div className="mt-2 flex gap-4 text-xs">
                  {c.lessonId && (
                    <Link to={`/course/${c.lessonId}`} className="text-cyan hover:underline">
                      回到这一课修改
                    </Link>
                  )}
                  {c.kind === 'song' && !c.lessonId && (
                    <Link to={c.project === 'graduation' ? '/graduation' : `/studio?id=${c.id}`} className="text-cyan hover:underline">
                      {c.project === 'graduation' ? '打开毕业项目' : '在作曲台打开'}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}

      {covers.data && covers.data.length > 0 && (
        <section>
          <div className="mb-5 flex items-center gap-5">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-border/80 bg-gradient-to-br from-cyan/20 via-card to-amber/20 shadow-lift">
              <Mic className="h-10 w-10 text-foreground/70" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">跟唱 · 翻唱</div>
              <h2 className="text-2xl font-semibold">翻唱</h2>
              <div className="text-sm text-muted-foreground">{covers.data.length} 首</div>
            </div>
          </div>
          <CoverList covers={covers.data} onChanged={() => covers.reload()} />
        </section>
      )}

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除「{deleting?.title}」？</DialogTitle>
            <DialogDescription>删除后无法恢复。已经完成的课不受影响；还没完成的课需要重新保存一份微创作。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (deleting) await CompositionService.remove(deleting.id)
                setDeleting(null)
                reload()
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
