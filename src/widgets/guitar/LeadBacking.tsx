import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, Play, Save, Sparkles, Square, X } from 'lucide-react'
import * as engine from '@/audio/engine'
import { usePitchDetector } from '@/features/audio/usePitchDetector'
import { useGuitarAudio } from '@/features/guitar/guitarAudioStore'
import { useAIConfigured } from '@/features/ai/useAIConfigured'
import { useProfileStore } from '@/features/profile/profileStore'
import { toast } from '@/features/toast/toastStore'
import { analyzeImprov, downbeatTargets, improvSuggestions, improvToScore, segmentNotes, type ImprovStats, type NoteEvent } from '@/guitar/improv'
import type { PitchPoint } from '@/guitar/technique'
import { GuitarAIService } from '@/services/guitarAIService'
import { CompositionService } from '@/services/courseService'
import { aiErrorMessage } from '@/services/ai/aiClient'
import type { ImprovReview } from '@/services/ai/validate'
import { chordPitchClasses, chordSymbolFor, emptyScore, type Score } from '@/music/score'
import { frequencyToMidi, midiToName } from '@/music/pitch'
import type { RomanId } from '@/music/keys'
import { MonitorToggle } from './MonitorToggle'
import { AIError, AILabel, AISetupHint } from '@/widgets/ai/AIBits'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

export interface BackingSpec {
  tonic: number
  mode: 'major' | 'minor'
  romans: RomanId[]
  bars: number
  bpm: number
}

const COUNT_IN_BARS = 1
/** A natural minor / major: the scale used for "in scale" (pentatonic plus passing tones). */
const scalePcsFor = (tonic: number, mode: 'major' | 'minor') => (mode === 'minor' ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]).map((i) => (tonic + i) % 12)

/** Backing track (keys, bass, drums), one count-in bar, then record the pitch track for `bars` bars. */
function useBackingTake(spec: BackingSpec) {
  const mic = usePitchDetector('guitar', true)
  const judge = useGuitarAudio((s) => s.judge)
  const [phase, setPhase] = useState<'idle' | 'count' | 'take' | 'done'>('idle')
  const [bar, setBar] = useState<number | null>(null)
  const timers = useRef<Array<() => void>>([])
  const chordNames = useMemo(() => spec.romans.map((r) => chordSymbolFor({ keyTonic: spec.tonic, mode: spec.mode }, r)), [spec])
  const chordPcs = useMemo(() => Array.from({ length: spec.bars }, (_, i) => chordPitchClasses({ keyTonic: spec.tonic, mode: spec.mode }, spec.romans[i % spec.romans.length]!)), [spec])

  const stop = useCallback(() => {
    timers.current.forEach((c) => c())
    timers.current = []
    engine.stopArrangement()
    setPhase('idle')
    setBar(null)
  }, [])
  useEffect(() => stop, [stop])

  const start = useCallback(
    async (onEnd: (points: PitchPoint[], startAt: number, beat: number) => void) => {
      await engine.ensureAudio()
      const beat = 60 / spec.bpm
      const score: Score = emptyScore({
        keyTonic: spec.tonic,
        mode: spec.mode,
        bpm: spec.bpm,
        bars: COUNT_IN_BARS + spec.bars,
        chords: Array.from({ length: spec.bars }, (_, i) => ({ start: (COUNT_IN_BARS + i) * 4, beats: 4, roman: spec.romans[i % spec.romans.length]! })),
        accompaniment: { comp: 'block', bass: 'roots', drums: 'pop' },
      })
      const { startAt } = await engine.playScore(score)
      engine.scheduleClicks(spec.bpm, 4 * COUNT_IN_BARS, { at: startAt, accentEvery: 4 })
      const first = startAt + 4 * COUNT_IN_BARS * beat
      const offset = judge().seconds
      setPhase('count')
      const stopRec = mic.record()
      for (let b = 0; b < spec.bars; b++) timers.current.push(engine.onAudioTime(first + b * 4 * beat, () => setBar(b)))
      timers.current.push(engine.onAudioTime(first, () => setPhase('take')))
      timers.current.push(
        engine.onAudioTime(first + spec.bars * 4 * beat + 0.4, () => {
          const frames = stopRec()
          const points = frames.map((f) => ({ t: f.t - offset, midi: f.hz ? frequencyToMidi(f.hz) : null }))
          setPhase('done')
          setBar(null)
          onEnd(points, first, beat)
        }),
      )
    },
    [judge, mic, spec],
  )

  return { mic, phase, bar, start, stop, chordNames, chordPcs }
}

function ChordBar({ names, bars, active, marks }: { names: string[]; bars: number; active: number | null; marks?: Array<boolean | null> }) {
  return (
    <div className="grid grid-cols-8 gap-1.5">
      {Array.from({ length: bars }, (_, i) => (
        <div
          key={i}
          className={cn(
            'rounded-lg border px-2 py-2 text-center font-semibold',
            active === i ? 'border-amber/70 bg-amber-soft/40' : 'border-border/60',
            marks?.[i] === true && 'border-success/50 bg-success/10',
            marks?.[i] === false && 'border-destructive/40',
          )}
        >
          <div className="num text-[10px] text-muted-foreground">{i + 1}</div>
          {names[i % names.length]}
        </div>
      ))}
    </div>
  )
}

/** Land each bar's first note on a chord tone. */
export function TargetDrill({ spec, pass, onDone }: { spec: BackingSpec; pass: number; onDone: (r: { passed: boolean; score: number; summary: string }) => void }) {
  const { mic, phase, bar, start, stop, chordNames, chordPcs } = useBackingTake(spec)
  const [hits, setHits] = useState<Array<{ bar: number; midi: number | null; chordTone: boolean }> | null>(null)
  const busy = phase === 'count' || phase === 'take'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {busy ? (
          <Button variant="outline" onClick={stop}>
            <Square /> 停止
          </Button>
        ) : (
          <Button
            onClick={() =>
              void start((points, startAt, beat) => {
                const r = downbeatTargets(points, { startAt, beat, bars: spec.bars, chordPcs })
                setHits(r)
                const ok = r.filter((x) => x.chordTone).length
                const score = ok / spec.bars
                onDone({ passed: score >= pass, score, summary: `落在和弦音 ${ok}/${spec.bars} 小节` })
              })
            }
            disabled={mic.state !== 'live'}
          >
            <Play /> {phase === 'done' ? '再来一遍' : '开始'}
          </Button>
        )}
        <span className="text-sm text-muted-foreground">
          {spec.bpm} BPM · {spec.bars} 小节 · 一小节预备拍
        </span>
        <MonitorToggle compact className="ml-auto" />
      </div>
      {mic.error && (
        <p role="alert" className="text-sm text-destructive">
          {mic.error}
        </p>
      )}
      <ChordBar names={chordNames} bars={spec.bars} active={bar} {...(hits ? { marks: hits.map((h) => h.chordTone) } : {})} />
      {hits && (
        <ul className="grid grid-cols-4 gap-2 text-sm" role="status">
          {hits.map((h) => (
            <li key={h.bar} className="flex items-center gap-1.5">
              {h.chordTone ? <Check className="h-4 w-4 text-success" aria-label="是和弦音" /> : <X className="h-4 w-4 text-destructive" aria-label="不是和弦音" />}
              第 {h.bar + 1} 小节：{h.midi !== null ? midiToName(h.midi) : '没听到'}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Improvise over a backing track; local stats and tips, optional AI review, save to the portfolio. */
export function ImprovDrill({ spec, title, onDone }: { spec: BackingSpec; title: string; onDone: (r: { passed: boolean; score: number; summary: string }) => void }) {
  const { mic, phase, bar, start, stop, chordNames, chordPcs } = useBackingTake(spec)
  const configured = useAIConfigured()
  const stage = useProfileStore((s) => s.profile?.unlockedStage ?? 0)
  const [take, setTake] = useState<{ notes: NoteEvent[]; stats: ImprovStats; startAt: number; beat: number } | null>(null)
  const [review, setReview] = useState<ImprovReview | null>(null)
  const [busyAI, setBusyAI] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const busy = phase === 'count' || phase === 'take'

  const askAI = async () => {
    if (!take) return
    setBusyAI(true)
    setAiError(null)
    try {
      const notesByBar = Array.from({ length: spec.bars }, (_, b) => {
        const from = take.startAt + b * 4 * take.beat
        const inBar = take.notes.filter((n) => n.start >= from && n.start < from + 4 * take.beat)
        return `${b + 1}｜${inBar.length ? inBar.map((n) => `${midiToName(n.midi, { octave: true })}${n.end - n.start >= take.beat ? '(长)' : ''}`).join(' ') : '（休止）'}`
      })
      const r = await GuitarAIService.reviewImprov({
        key: `${midiToName(spec.tonic)} ${spec.mode === 'minor' ? '小调' : '大调'}`,
        chords: Array.from({ length: spec.bars }, (_, i) => chordNames[i % chordNames.length]!),
        bpm: spec.bpm,
        bars: spec.bars,
        stats: take.stats,
        notesByBar,
      })
      setReview(r.review)
    } catch (e) {
      setAiError(aiErrorMessage(e))
    } finally {
      setBusyAI(false)
    }
  }

  const save = async () => {
    if (!take) return
    const score = improvToScore(take.notes, { startAt: take.startAt, beat: take.beat, bars: spec.bars, keyTonic: spec.tonic, mode: spec.mode, bpm: spec.bpm, romans: spec.romans })
    const d = new Date()
    const comp = await CompositionService.save({ title: `即兴 · ${title} · ${d.getMonth() + 1}/${d.getDate()}`, kind: 'song', stage, bpm: spec.bpm, steps: score.bars * 4, cells: [], score })
    setSavedId(comp.id)
    toast({ title: '已存进作品集', description: '可以在作品集里播放，或在作曲台里继续编。', variant: 'success' })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {busy ? (
          <Button variant="outline" onClick={stop}>
            <Square /> 停止
          </Button>
        ) : (
          <Button
            onClick={() =>
              void start((points, startAt, beat) => {
                const notes = segmentNotes(points)
                const stats = analyzeImprov(notes, { startAt, beat, bars: spec.bars, chordPcs, scalePcs: scalePcsFor(spec.tonic, spec.mode) })
                setTake({ notes, stats, startAt, beat })
                setReview(null)
                setSavedId(null)
                const score = 0.5 * stats.inScale + 0.25 * stats.strongChordTones + 0.25 * Math.min(1, stats.phrases / 4)
                onDone({ passed: stats.notes >= 12 && stats.inScale >= 0.7, score, summary: `${stats.notes} 个音 · 音阶内 ${Math.round(stats.inScale * 100)}% · ${stats.phrases} 句` })
              })
            }
            disabled={mic.state !== 'live'}
          >
            <Play /> {take ? '再即兴一次' : '开始'}
          </Button>
        )}
        <span className="text-sm text-muted-foreground">
          {spec.bpm} BPM · {spec.bars} 小节 · 一小节预备拍
        </span>
        <MonitorToggle compact className="ml-auto" />
      </div>
      {mic.error && (
        <p role="alert" className="text-sm text-destructive">
          {mic.error}
        </p>
      )}
      <ChordBar names={chordNames} bars={spec.bars} active={bar} />
      {take && (
        <div className="space-y-4" role="status">
          <dl className="grid grid-cols-5 gap-3 text-center text-sm">
            {[
              ['音数', `${take.stats.notes}`],
              ['音阶内', `${Math.round(take.stats.inScale * 100)}%`],
              ['强拍和弦音', `${Math.round(take.stats.strongChordTones * 100)}%`],
              ['留白', `${Math.round(take.stats.rest * 100)}%`],
              ['乐句 / 音域', `${take.stats.phrases} 句 / ${take.stats.rangeSemitones} 半音`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-border/70 p-3">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="num mt-1 font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {improvSuggestions(take.stats).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            {configured && !review && (
              <Button variant="outline" onClick={() => void askAI()} disabled={busyAI || take.stats.notes === 0}>
                {busyAI ? <Loader2 className="animate-spin" /> : <Sparkles />} 请 AI 点评
              </Button>
            )}
            <Button variant="outline" onClick={() => void save()} disabled={Boolean(savedId) || take.notes.length === 0}>
              <Save /> {savedId ? '已存进作品集' : '存进作品集'}
            </Button>
          </div>
          {configured === false && <AISetupHint what="AI 会根据你弹的音和统计点评这段即兴" />}
          <AIError message={aiError} />
          {review && (
            <div className="space-y-2 rounded-2xl border border-cyan/30 bg-cyan-soft/10 p-4 text-sm">
              <AILabel>AI 点评</AILabel>
              <p className="font-medium">{review.summary}</p>
              {review.strengths.map((s) => (
                <p key={s} className="flex gap-1.5">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden /> {s}
                </p>
              ))}
              {review.suggestions.map((s) => (
                <p key={s.text}>
                  {s.bar && <span className="num mr-1 text-xs text-amber">第 {s.bar} 小节</span>}
                  {s.text}
                </p>
              ))}
              <p>
                <b>下一步：</b>
                {review.nextStep}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
