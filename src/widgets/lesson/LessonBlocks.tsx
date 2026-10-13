import { useEffect, useState } from 'react'
import { Check, Lightbulb, Play, RotateCcw, Square } from 'lucide-react'
import * as engine from '@/audio/engine'
import type { LessonBlock } from '@/course/types'
import { useProfileStore } from '@/features/profile/profileStore'
import { ProfileService } from '@/services/profileService'
import { BadgeService } from '@/services/badgeService'
import { RunService } from '@/services/runService'
import { moduleInfo } from '@/drills/types'
import { degreeFromSemitone, degreeLabel, scaleById, scaleNotes } from '@/music/scales'
import { MelodyStaff } from '@/widgets/notation/MelodyStaff'
import { RhythmStaff } from '@/widgets/notation/RhythmStaff'
import { InstrumentView } from '@/widgets/instrument/InstrumentView'
import { DrillRunner, type DrillSummary } from '@/widgets/drill/DrillRunner'
import { RangeCalibration } from '@/widgets/pitch/RangeCalibration'
import { signatureTonic } from '@/course/rules'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'
import { LessonText } from './LessonText'
import { ScoreNotation } from '@/widgets/notation/ScoreNotation'
import { scoreFromNotes } from '@/music/score'
import { ChordBlock, ProgressionBlock, SongBlock } from './HarmonyBlocks'

function usePlayback() {
  const [playing, setPlaying] = useState(false)
  const play = async (events: engine.NoteEvent[]) => {
    await engine.ensureAudio()
    engine.stopAll()
    setPlaying(true)
    const { endAt } = engine.playSequence(events)
    engine.onAudioTime(endAt, () => setPlaying(false))
  }
  return { playing, play }
}

function Frame({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <figure className="rounded-2xl border border-border/80 bg-card p-5 surface-gradient">
      <figcaption className="mb-3 flex items-center justify-between gap-4">
        <span className="font-medium">{title}</span>
        {action}
      </figcaption>
      {children}
    </figure>
  )
}

function PlayButton({ playing, onClick }: { playing: boolean; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      {playing ? <Square /> : <Play />} {playing ? '播放中' : '播放'}
    </Button>
  )
}

export function LessonBlockView({ block, done, onDrillPassed, lessonId }: { block: LessonBlock; done?: boolean; onDrillPassed?: (id: string) => void; lessonId?: string }) {
  const instrument = useProfileStore((s) => s.profile?.instrument ?? 'none')
  const { playing, play } = usePlayback()

  switch (block.type) {
    case 'text':
      return <LessonText md={block.md} />
    case 'tip':
      return (
        <div className="flex gap-3 rounded-2xl border border-cyan/30 bg-cyan-soft/20 p-4">
          <Lightbulb className="mt-1 h-4 w-4 shrink-0 text-cyan" />
          <LessonText md={block.md} className="text-sm leading-6" />
        </div>
      )
    case 'listen': {
      const beat = 60 / (block.bpm ?? 90)
      const events: engine.NoteEvent[] = []
      let t = 0
      for (const chord of block.chords ?? []) {
        chord.forEach((m) => events.push({ midi: m, duration: 1.1, at: t, velocity: 0.7 }))
        t += 1.2
      }
      for (const n of block.notes ?? []) {
        events.push({ midi: n.midi, duration: n.beats * beat * 0.92, at: t })
        t += n.beats * beat
      }
      return (
        <Frame title={block.title} action={<PlayButton playing={playing} onClick={() => void play(events)} />}>
          {block.staff && block.notes && <ScoreNotation score={scoreFromNotes(block.notes, { tonic: block.keyTonic ?? 60 })} chordLabels="none" />}
          {block.caption && <p className="mt-2 text-sm text-muted-foreground">{block.caption}</p>}
        </Frame>
      )
    }
    case 'rhythm': {
      const beat = 60 / (block.bpm ?? 90)
      const beats = block.beats ?? 4
      const playRhythm = async () => {
        await engine.ensureAudio()
        const sched = engine.scheduleClicks(block.bpm ?? 90, beats * 2, { accentEvery: beats })
        engine.scheduleRhythmHits([...block.onsets, ...block.onsets.map((o) => o + beats)].map((o) => sched.startAt + o * beat))
      }
      return (
        <Frame title={block.title} action={<PlayButton playing={false} onClick={() => void playRhythm()} />}>
          <RhythmStaff onsets={block.onsets} beats={beats} />
          {block.caption && <p className="mt-1 text-sm text-muted-foreground">{block.caption}</p>}
        </Frame>
      )
    }
    case 'instrument':
      return (
        <Frame
          title={block.title}
          action={<PlayButton playing={playing} onClick={() => void play(block.notes.map((m, i) => ({ midi: m, duration: 0.5, at: i * 0.45 })))} />}
        >
          <InstrumentView
            instrument={instrument}
            notes={block.notes}
            {...(block.labels ? { labels: block.labels } : {})}
            {...(block.rootPc !== undefined ? { rootPc: block.rootPc } : {})}
            {...(block.mode ? { mode: block.mode } : {})}
            onNote={(m) => void play([{ midi: m, duration: 0.6, at: 0 }])}
          />
          {block.caption && <p className="mt-2 text-sm text-muted-foreground">{block.caption}</p>}
        </Frame>
      )
    case 'scale': {
      const notes = scaleNotes(block.tonic, block.scale, true)
      const labels = notes.map((m) => degreeLabel(degreeFromSemitone(m - block.tonic)))
      return (
        <Frame
          title={block.title}
          action={<PlayButton playing={playing} onClick={() => void play([...notes, ...notes.slice(0, -1).reverse()].map((m, i) => ({ midi: m, duration: 0.4, at: i * 0.33 })))} />}
        >
          <MelodyStaff notes={notes.map((m) => ({ midi: m, beats: 1 }))} keyTonic={signatureTonic(block.tonic, block.scale)} timeSignature={null} />
          <div className="mt-3">
            <InstrumentView instrument={instrument} notes={notes.slice(0, -1)} labels={labels} rootPc={block.tonic % 12} mode={instrument === 'guitar' || instrument === 'bass' ? 'all' : 'positions'} />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {scaleById(block.scale).flavor}
            {block.caption ? ` ${block.caption}` : ''}
          </p>
        </Frame>
      )
    }
    case 'chord':
      return (
        <ChordBlock
          title={block.title}
          root={block.root}
          quality={block.quality}
          {...(block.inversion !== undefined ? { inversion: block.inversion } : {})}
          {...(block.caption ? { caption: block.caption } : {})}
        />
      )
    case 'progression':
      return (
        <ProgressionBlock
          title={block.title}
          tonic={block.tonic}
          mode={block.mode}
          romans={block.romans}
          {...(block.beatsEach ? { beatsEach: block.beatsEach } : {})}
          {...(block.caption ? { caption: block.caption } : {})}
        />
      )
    case 'song':
      return <SongBlock title={block.title} score={block.score} {...(block.caption ? { caption: block.caption } : {})} />
    case 'drill':
      return <LessonDrill block={block} done={Boolean(done)} onPassed={() => onDrillPassed?.(block.id)} {...(lessonId ? { runId: `lesson:${lessonId}:${block.id}` } : {})} />
  }
}

function LessonDrill({ block, done, onPassed, runId }: { block: Extract<LessonBlock, { type: 'drill' }>; done: boolean; onPassed: () => void; runId?: string }) {
  const profile = useProfileStore((s) => s.profile)!
  const [unfinished, setUnfinished] = useState(false)
  useEffect(() => {
    if (!runId) return
    let live = true
    void RunService.get(runId).then((r) => live && setUnfinished(Boolean(r)))
    return () => {
      live = false
    }
  }, [runId])
  const setProfile = useProfileStore((s) => s.set)
  const [running, setRunning] = useState(false)
  const [last, setLast] = useState<{ ratio: number; passed: boolean } | null>(null)
  const [runKey, setRunKey] = useState(0)
  const useFallback = block.module.startsWith('I') && profile.instrument === 'none' && block.noInstrument
  const module = useFallback ? block.noInstrument!.module : block.module
  const level = useFallback ? block.noInstrument!.level : block.level
  const info = moduleInfo(module)
  const pass = block.pass ?? 0.7
  const needsRange = info.kind === 'sing' && !profile.vocalRange

  const onDone = (s: DrillSummary) => {
    const ratio = s.questions ? s.creditSum / s.questions : 0
    const passed = ratio >= pass
    setLast({ ratio, passed })
    setUnfinished(false)
    setRunning(false)
    if (passed) onPassed()
  }

  return (
    <div className={cn('rounded-2xl border p-5', done ? 'border-success/40 bg-success/5' : 'border-amber/40 bg-amber-soft/15')}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-xs text-muted-foreground">
            课内练习 · {info.name} · 第 {level} 级 · {block.count} 题 · {Math.round(pass * 100)}% 通过
          </div>
          <div className="mt-1 font-display text-lg font-semibold">{block.title}</div>
        </div>
        {done && !running ? (
          <span className="flex items-center gap-1.5 text-sm text-success">
            <Check className="h-4 w-4" /> 已通过
          </span>
        ) : null}
        {!running && (
          <Button
            variant={done ? 'ghost' : 'default'}
            onClick={() => {
              setRunKey((k) => k + 1)
              setRunning(true)
            }}
          >
            {unfinished ? <Play /> : last || done ? <RotateCcw /> : <Play />} {unfinished ? '继续上次的练习' : last || done ? '再练一次' : '开始练习'}
          </Button>
        )}
      </div>
      {last && !running && (
        <p className={cn('mt-3 text-sm', last.passed ? 'text-success' : 'text-muted-foreground')}>
          得分 {Math.round(last.ratio * 100)}%。{last.passed ? '通过！' : `还差一点，达到 ${Math.round(pass * 100)}% 就算通过。`}
        </p>
      )}
      {running && (
        <div className="mt-5 rounded-2xl border border-border/80 bg-background/60 p-6">
          {needsRange ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">唱歌练习前，先测一下你的舒适音域。只需要一次。</p>
              <RangeCalibration
                onSave={async (range) => {
                  const next = await ProfileService.update({ vocalRange: range })
                  await BadgeService.award('range-set')
                  setProfile(next)
                }}
              />
            </div>
          ) : (
            <DrillRunner key={runKey} module={module} kind="free" count={block.count} levelOverride={level} onDone={onDone} {...(runId ? { run: { id: runId, title: `课内练习 · ${block.title}` } } : {})} />
          )}
        </div>
      )}
    </div>
  )
}
