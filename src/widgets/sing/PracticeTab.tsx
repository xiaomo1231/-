import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { Combine, Headphones, Loader2, Mic, Pause, Pin, PinOff, Play, Repeat, RotateCcw, Scissors, SkipBack, Square, Trash2, Volume2 } from 'lucide-react'
import { latestPass, useSing, type SessionTake } from '@/features/sing/useSingSession'
import { feedbackFrom, isScorable, noteFeedback, notesIn, type Phrase, type SungSample } from '@/songs/singAlong'
import { audioNow, playBuffer, stopTake, takeBuffer } from '@/audio/sing/takePlayback'
import { lyricsInPhrase, mergeWithPrevious, splitAt, splitPoint, takeFitsPhrase } from '@/songs/phrasing'
import { PitchLane } from './PitchLane'
import { RestartDialog } from './RestartDialog'
import { RunBanner, RunReportCard, type RunReport } from './FullRun'
import { assembleVoice, type VoicePiece } from '@/songs/compAssembly'
import { encodeTake } from '@/audio/sing/voiceRecorder'
import { SingService } from '@/services/singService'
import { uuid } from '@/infrastructure/crypto/crypto'
import { lyricsInPhrase as lyricOf } from '@/songs/phrasing'
import { LyricsDisplay } from './LyricsDisplay'
import { NativeMonitorControls } from './NativeMonitorControls'
import { ProfileService } from '@/services/profileService'
import { useProfileStore } from '@/features/profile/profileStore'

interface LaneView {
  /** Semitones shown above the highest and below the lowest note. */
  pad: number
  height: 'normal' | 'tall' | 'xl'
}
const LANE_VIEW_KEY = 'groovelab:sing-lane-view'
const LANE_HEIGHT: Record<LaneView['height'], string> = { normal: 'h-64', tall: 'h-96', xl: 'h-[34rem]' }
function loadLaneView(): LaneView {
  try {
    const v = JSON.parse(localStorage.getItem(LANE_VIEW_KEY) ?? '{}') as Partial<LaneView>
    return { pad: typeof v.pad === 'number' ? Math.max(0, Math.min(12, v.pad)) : 2, height: v.height === 'tall' || v.height === 'xl' ? v.height : 'tall' }
  } catch {
    return { pad: 2, height: 'tall' }
  }
}
/** The lag scoring found, used to line the take up (not for takes nudged by hand before 0.24.0). */
const autoLag = (t: { score: { lagMs: number } | null; nudgeMs?: number; alignAuto?: boolean }) => (t.nudgeMs === undefined || t.alignAuto ? (t.score?.lagMs ?? 0) : 0)
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const midiName = (m: number) => {
  const r = Math.round(m)
  return `${NOTE_NAMES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`
}
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

const SPEEDS = [0.75, 0.9, 1]
/** Start a looped / chosen phrase this early so the student hears it coming. */
const LEAD_IN_MS = 1500

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const pct = (x: number) => `${Math.round(x * 100)}`

type PreviewMode = 'solo' | 'backing' | 'compare'
interface Preview {
  mode: PreviewMode
  /** The phrase and take it plays — locked until it ends. */
  phrase: number
  takeId: string
  stage: 'loading' | 'guide' | 'take'
}
/** Backing starts this long before the phrase when listening with it. */
const BACKING_LEAD_MS = 1000
const STAGE_LABEL: Record<Preview['stage'], string> = { loading: '正在准备…', guide: '正在放原唱这一句…', take: '正在放你唱的…' }
const MODE_LABEL: Record<PreviewMode, string> = { solo: '只听我唱的', backing: '和伴奏一起听', compare: '和原唱对比' }

/** 跟唱 tab: sing along, phrase reports with takes, playback of what you sang. */
export function PracticeTab() {
  const s = useSing()
  const { curve, phrases, notes, meta, player, takes } = s
  const [now, setNow] = useState(0)
  const [loop, setLoop] = useState(false)
  const [phraseIdx, setPhraseIdx] = useState(0)
  const [selected, setSelected] = useState<Record<number, string>>({})
  const [preview, setPreview] = useState<Preview | null>(null)
  const previewRef = useRef<Preview | null>(null)
  /** Bumped whenever a preview starts or stops: a stale one stops at its next step. */
  const token = useRef(0)
  /** Where the song was before the preview (restored afterwards). */
  const savedPos = useRef<number | null>(null)
  /** Song clock while only the take plays (no stems running). */
  const takeClock = useRef<{ songMs0: number; ctxT0: number; speed: number } | null>(null)
  const scored = useRef<Set<number>>(new Set())
  /** After jumping to a phrase, keep it chosen through the lead-in (which may run over the end of the one before). */
  const pinned = useRef<{ index: number; untilMs: number } | null>(null)
  const phrase: Phrase | undefined = phrases[phraseIdx]
  const lyrics = useMemo(() => meta?.lyrics ?? [], [meta?.lyrics])

  const [restartOpen, setRestartOpen] = useState(false)

  // ---- 整首重新开始: sing the whole song from the top -------------------------
  const [run, setRun] = useState<{ phase: 'countdown' | 'running' | 'paused'; countdown: number; startedAt: number } | null>(null)
  const runRef = useRef(run)
  runRef.current = run
  const runPieces = useRef<VoicePiece[]>([])
  const runSegStart = useRef(0)
  const [runReport, setRunReport] = useState<RunReport | null>(null)
  const scorableCount = useMemo(() => phrases.filter((p) => isScorable(notesIn(notes, p))).length, [phrases, notes])
  /** Phrase takes sung during this run (the newest per phrase). */
  const runTakes = useMemo(() => {
    if (!run) return []
    const out: SessionTake[] = []
    for (const [k, list] of Object.entries(takes)) {
      if (Number(k) < 0) continue
      const t = list.find((x) => x.createdAt >= run.startedAt && x.score)
      if (t) out.push(t)
    }
    return out
  }, [run, takes])
  const runAvg = runTakes.length ? runTakes.reduce((t, x) => t + x.score!.score, 0) / runTakes.length : null

  const startRun = async () => {
    if (previewRef.current) stopPreview()
    setRunReport(null)
    setLoop(false)
    if (s.mic !== 'on') await s.startMic()
    s.pause()
    s.clearSamples(0, Infinity)
    scored.current.clear()
    runPieces.current = []
    runSegStart.current = 0
    player.current?.seek(0)
    setPhraseIdx(0)
    const startedAt = Date.now()
    for (let c = 3; c > 0; c--) {
      setRun({ phase: 'countdown', countdown: c, startedAt })
      await new Promise((r) => setTimeout(r, 1000))
      if (!runRef.current) return
    }
    setRun({ phase: 'running', countdown: 0, startedAt })
    s.play(0)
  }
  const cutSegment = () => {
    const end = player.current?.positionMs() ?? 0
    const cut = s.cutRecording(runSegStart.current, end)
    if (cut && cut.samples.length) runPieces.current.push({ samples: cut.samples, sampleRate: cut.sampleRate, startMs: cut.startMs })
  }
  const pauseRun = () => {
    if (!run || run.phase !== 'running') return
    cutSegment()
    s.pause()
    setRun({ ...run, phase: 'paused' })
  }
  const resumeRun = () => {
    if (!run || run.phase !== 'paused') return
    runSegStart.current = player.current?.positionMs() ?? 0
    s.play()
    setRun({ ...run, phase: 'running' })
  }
  /** End of the run (the song ended or 结束 was pressed): whole-song take into 完整版, then the report. */
  const finishRun = async () => {
    const r = runRef.current
    if (!r) return
    if (r.phase === 'running') cutSegment()
    s.pause()
    setRun(null)
    if (r.phase === 'countdown') return
    const RATE = 44100
    let savedToFull = false
    const pieces = runPieces.current
    if (pieces.length) {
      const endMs = Math.max(...pieces.map((p) => p.startMs + (p.samples.length / p.sampleRate) * 1000))
      const voice = assembleVoice(pieces, endMs, RATE, 10)
      const scores = runTakes.map((t) => t.score!)
      const mean = scores.length ? scores.reduce((a, b) => a + b.score, 0) / scores.length : 0
      const take: SessionTake = {
        id: uuid(),
        key: s.source.key,
        phrase: -1,
        createdAt: Date.now(),
        score: scores.length
          ? { score: mean, notesSung: scores.reduce((a, b) => a + b.notesSung, 0), notesTotal: scores.reduce((a, b) => a + b.notesTotal, 0), meanAbsCents: Math.round(scores.reduce((a, b) => a + b.meanAbsCents, 0) / scores.length), biasCents: Math.round(scores.reduce((a, b) => a + b.biasCents, 0) / scores.length), lagMs: 0, octaveShift: 0, noteCents: [] }
          : null,
        sungMs: new Float32Array(),
        sungMidi: new Float32Array(),
        audio: encodeTake(voice, RATE).blob,
        audioStartMs: 0,
      }
      s.addTake(take)
      await SingService.saveTake(take)
      const comp = s.meta?.comp
      await s.setMeta({ comp: { mode: 'full', picks: comp?.picks ?? {}, offsetMs: comp?.offsetMs ?? 0, phraseOffsets: comp?.phraseOffsets ?? {}, fullTakeId: take.id } })
      savedToFull = true
    }
    const last = s.meta?.drafts?.[0]
    setRunReport({
      phrases: runTakes
        .map((t) => {
          const i = phrases.findIndex((p) => takes[p.index]?.includes(t))
          const ph = phrases[i]
          return { index: i, lyric: ph ? lyricOf(lyrics, ph) : '', score: t.score!.score, notesSung: t.score!.notesSung, notesTotal: t.score!.notesTotal, biasCents: t.score!.biasCents }
        })
        .filter((x) => x.index >= 0)
        .sort((a, b) => a.index - b.index),
      scorable: scorableCount,
      ...(last?.avgBest !== undefined ? { previous: { name: last.name, avg: last.avgBest } } : {}),
      savedToFull,
    })
  }
  const finishRunRef = useRef(finishRun)
  finishRunRef.current = finishRun
  // A fresh start or a restored draft: nothing of the old run counts as scored any more.
  useEffect(() => {
    if (!s.resetToken) return
    scored.current.clear()
    setSelected({})
  }, [s.resetToken])

  // New cuts: phrase numbers mean something else now.
  useEffect(() => {
    scored.current.clear()
    setSelected({})
    setPhraseIdx((i) => Math.max(0, Math.min(i, phrases.length - 1)))
  }, [phrases])

  // 音域: the whole song's lowest to highest note, plus room the student can widen; lane height too.
  const [laneView, setLaneView] = useState<LaneView>(loadLaneView)
  const changeLaneView = (patch: Partial<LaneView>) =>
    setLaneView((v) => {
      const next = { ...v, ...patch }
      try {
        localStorage.setItem(LANE_VIEW_KEY, JSON.stringify(next))
      } catch {
        // per visit only
      }
      return next
    })
  const refreshProfile = useProfileStore((p) => p.refresh)
  const setDeviceLatency = async (ms: number) => {
    await ProfileService.setSingLatency(ms)
    await refreshProfile()
  }
  const extremes = useMemo(() => {
    const ms = notes.map((n) => n.midi).filter((m) => Number.isFinite(m))
    return ms.length ? { low: Math.min(...ms), high: Math.max(...ms) } : null
  }, [notes])
  const range = useMemo(() => {
    if (!extremes) return { low: 48, high: 72 }
    const pad = laneView.pad
    let low = Math.floor(extremes.low - pad)
    let high = Math.ceil(extremes.high + pad)
    // At least an octave and a half, so a narrow song is not stretched.
    const short = 18 - (high - low)
    if (short > 0) {
      low -= Math.floor(short / 2)
      high += Math.ceil(short / 2)
    }
    return { low, high }
  }, [extremes, laneView.pad])

  const restartPhrase = useCallback(
    (p: Phrase) => {
      scored.current.delete(p.index)
      s.clearSamples(p.startMs - LEAD_IN_MS, p.endMs + 400)
      player.current?.seek(Math.max(0, p.startMs - LEAD_IN_MS))
    },
    [s, player],
  )

  // Clock: follow the recording, score phrases as they end, loop.
  const finishRef = useRef(s.finishPhrase)
  finishRef.current = s.finishPhrase
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const p = player.current
      if (previewRef.current) {
        // Listening back: only the position moves; no scoring, following or looping.
        setNow(Math.floor(positionMs() / 250) * 250)
      } else if (p) {
        const pos = p.positionMs()
        setNow(Math.floor(pos / 250) * 250)
        if (p.isPlaying) {
          for (const ph of phrases) {
            if (pos > ph.endMs + 250 && pos < ph.endMs + 2500 && !scored.current.has(ph.index)) {
              scored.current.add(ph.index)
              void finishRef.current(ph).then((t) => t && setSelected((m) => ({ ...m, [ph.index]: t.id })))
            }
          }
          const pin = pinned.current
          if (pin && (pos >= pin.untilMs || pos < pin.untilMs - LEAD_IN_MS - 1000)) pinned.current = null
          const cur = phrases.findIndex((ph) => pos >= ph.startMs - 300 && pos <= ph.endMs + 300)
          if (!loop && !pinned.current && cur >= 0 && cur !== phraseIdx) setPhraseIdx(cur)
          if (loop && phrase && pos > phrase.endMs + 700) restartPhrase(phrase)
          const lastPhrase = phrases[phrases.length - 1]
          if (runRef.current?.phase === 'running' && lastPhrase && pos > lastPhrase.endMs + 2600) void finishRunRef.current()
        } else if (runRef.current?.phase === 'running' && pos >= (p.duration || Infinity) - 300) {
          void finishRunRef.current()
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phrases, loop, phrase, phraseIdx, player, restartPhrase]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Choose a phrase. While singing along, jump to just before it; otherwise only select it (and start there next time). */
  const goTo = (i: number, play = false) => {
    const p = phrases[i]
    if (!p) return
    if (previewRef.current) stopPreview()
    setPhraseIdx(i)
    pinned.current = { index: i, untilMs: p.startMs }
    restartPhrase(p)
    if (play && !player.current?.isPlaying) s.play(Math.max(0, p.startMs - LEAD_IN_MS))
  }

  const toggle = () => {
    if (previewRef.current) stopPreview()
    if (player.current?.isPlaying) s.pause()
    else s.play()
  }

  // Takes of the phrase: newest first; the selected one (default: newest).
  const list: SessionTake[] = useMemo(() => (phrase ? (takes[phrase.index] ?? []) : []), [phrase, takes])
  const take = list.find((t) => t.id === selected[phrase?.index ?? -1]) ?? list[0]
  const bestId = useMemo(() => [...list].filter((t) => t.score).sort((a, b) => b.score!.score - a.score!.score)[0]?.id, [list])
  // Older takes may hold several passes over the phrase: show only the last one.
  const overlay = useMemo((): SungSample[] => (take ? latestPass(Array.from(take.sungMs, (ms, i) => ({ ms, midi: take.sungMidi[i]! }))) : []), [take])
  const getOverlay = useCallback(() => overlay, [overlay])

  const positionMs = useCallback(() => {
    const c = takeClock.current
    if (c) return c.songMs0 + (audioNow() - c.ctxT0) * 1000 * c.speed
    return player.current?.positionMs() ?? 0
  }, [player])

  // Decode the chosen take ahead of time, so listening starts at once.
  useEffect(() => {
    if (take?.audio) void takeBuffer(take)
  }, [take])
  const getSung = useCallback(() => s.samples.current, [s.samples])
  const shift = useCallback(() => take?.score?.octaveShift ?? 0, [take])

  // ---- listening back -------------------------------------------------------
  // Listening is its own state: the practice clock stops following, scoring and
  // looping; the phrase and take are locked; afterwards everything goes back to
  // where it was (paused).
  const endPreview = () => {
    stopTake()
    takeClock.current = null
    const p = player.current
    s.pause()
    p?.setMix(s.backingMix(s.guide))
    p?.setRate(s.speed)
    if (savedPos.current !== null) p?.seek(savedPos.current)
    savedPos.current = null
    s.previewing.current = false
    previewRef.current = null
    setPreview(null)
  }
  function stopPreview() {
    token.current++
    endPreview()
  }
  useEffect(
    () => () => {
      token.current++
      stopTake()
      s.previewing.current = false
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const listen = async (mode: PreviewMode) => {
    if (!take || !phrase) return
    const my = ++token.current
    const p = player.current
    stopTake()
    takeClock.current = null
    if (!previewRef.current) savedPos.current = p?.positionMs() ?? 0
    s.previewing.current = true
    s.pause()
    const base: Preview = { mode, phrase: phrase.index, takeId: take.id, stage: 'loading' }
    const stage = (st: Preview['stage']) => {
      previewRef.current = { ...base, stage: st }
      setPreview(previewRef.current)
    }
    stage('loading')
    const live = () => my === token.current
    try {
      await Tone.start()
      const buf = await takeBuffer(take)
      if (!live() || !buf) return
      const speed = take.speed ?? 1
      // Song time at the first sample of the recording.
      // Lined up with the singer automatically (the lag scoring found: earphones / device delay), plus the student's own nudge.
      const takeStart = (take.audioStartMs ?? phrase.startMs - 300) - autoLag(take) + (take.nudgeMs ?? 0)
      const takeAlone = async () => {
        stage('take')
        const when = audioNow() + 0.03
        takeClock.current = { songMs0: takeStart, ctxT0: when, speed }
        await playBuffer(buf, 0, undefined, when)
      }
      if (mode === 'solo' || !p) {
        await takeAlone()
      } else if (mode === 'backing') {
        // Backing from a second before the phrase, at the speed it was sung; the take joins exactly where it belongs.
        const from = Math.max(0, Math.min(takeStart, phrase.startMs - BACKING_LEAD_MS))
        p.setMix(s.backingMix(0))
        p.setRate(speed)
        await p.seekReady(from)
        if (!live()) return
        p.play(from)
        await p.whenRunning()
        if (!live()) return
        stage('take')
        const now = audioNow()
        const offset = (p.positionMs() - takeStart) / speed / 1000
        await playBuffer(buf, Math.max(0, offset), undefined, offset < 0 ? now - offset : now)
      } else {
        // The singer's phrase alone, then yours.
        const only: Record<string, { volume: number; muted: boolean }> = {}
        for (const k of s.source.stems.map((x) => x.stem)) only[k] = { volume: 1, muted: k !== 'vocals' }
        p.setMix(only)
        p.setRate(1)
        const from = Math.max(0, phrase.startMs - 300)
        await p.seekReady(from)
        if (!live()) return
        stage('guide')
        p.play(from)
        while (live() && p.positionMs() < phrase.endMs + 300) await new Promise((r) => setTimeout(r, 30))
        p.pause()
        if (!live()) return
        await new Promise((r) => setTimeout(r, 350))
        if (!live()) return
        await takeAlone()
      }
    } finally {
      if (live()) endPreview()
    }
  }

  // ---- cutting phrases by hand --------------------------------------------------
  const canSplitAt = phrase && curve ? splitPoint(curve, phrase) : null
  const mergeUp = () => {
    if (!phrase || phraseIdx === 0) return
    if (previewRef.current) stopPreview()
    void s.resegment({ phraseCuts: mergeWithPrevious(phrases, phraseIdx) })
    setPhraseIdx(phraseIdx - 1)
  }
  const splitHere = () => {
    if (!phrase || canSplitAt === null) return
    if (previewRef.current) stopPreview()
    void s.resegment({ phraseCuts: splitAt(phrases, phraseIdx, canSplitAt) })
  }
  const resetCuts = () => {
    if (previewRef.current) stopPreview()
    void s.resegment({ phraseCuts: [] })
  }

  if (!curve) return null
  const report = take?.score
  const detail = take?.detail
  const scorable = phrase ? isScorable(notesIn(notes, phrase)) : false

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/80 bg-card p-3">
        <Button size="sm" onClick={toggle} disabled={!s.ready}>
          {s.playing ? <Pause /> : <Play />} {s.playing ? '暂停' : '播放'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            // Back to the very start, stopped: playing is the student's next click.
            if (player.current?.isPlaying) s.pause()
            goTo(0)
            player.current?.seek(0)
          }}
          disabled={!s.ready}
          aria-label="回到开头"
          title="回到开头（不自动播放）"
        >
          <SkipBack />
        </Button>
        <span className="num w-24 text-xs text-muted-foreground">
          {fmt(now)} / {fmt(player.current?.duration ?? 0)}
        </span>
        <button type="button" onClick={() => setLoop((v) => !v)} aria-pressed={loop} className={cn('focus-ring flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs', loop ? 'border-amber/60 bg-amber-soft/40' : 'border-border/80 text-muted-foreground hover:text-foreground')}>
          <Repeat className="h-3.5 w-3.5" /> 循环这一句
        </button>
        <button type="button" onClick={() => setRestartOpen(true)} className="focus-ring flex items-center gap-1.5 rounded-lg border border-border/80 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground" title="把之前的评分存为草稿或删除，从头开始">
          <RotateCcw className="h-3.5 w-3.5" /> 整首重新开始{s.meta?.drafts?.length ? `（草稿 ${s.meta.drafts.length}）` : ''}
        </button>
        <RestartDialog open={restartOpen} onClose={() => setRestartOpen(false)} onStart={() => void startRun()} />
        <label className="flex items-center gap-1.5 text-xs">
          速度
          <select value={s.speed} onChange={(e) => s.setSpeed(Number(e.target.value))} className="focus-ring h-8 rounded-lg border border-border bg-background px-2">
            {SPEEDS.map((x) => (
              <option key={x} value={x}>
                {Math.round(x * 100)}%
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          原唱音量
          <input type="range" min={0} max={1} step={0.05} value={s.guide} onChange={(e) => s.setGuide(Number(e.target.value))} className="w-24 accent-[hsl(var(--amber))]" />
        </label>
        <div className="ml-auto">
          {s.mic === 'on' ? (
            <div className="flex flex-wrap items-center justify-end gap-3">
              <span className="flex items-center gap-1.5 text-xs text-success">
                <Mic className="h-3.5 w-3.5" /> 麦克风已开（正在录音）
              </span>
              <button
                type="button"
                onClick={() => s.setMonitor({ on: !s.monitor.on })}
                aria-pressed={s.monitor.on}
                title="戴耳机时打开：一边唱一边听到自己的声音"
                className={cn('focus-ring flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs', s.monitor.on ? 'border-amber/60 bg-amber-soft/40' : 'border-border/80 text-muted-foreground hover:text-foreground')}
              >
                <Headphones className="h-3.5 w-3.5" /> 监听
              </button>
              {s.monitor.on && (
                <>
                  <label className="flex items-center gap-1.5 text-xs">
                    音量
                    <input type="range" min={0} max={1.5} step={0.05} value={s.monitor.volume} onChange={(e) => s.setMonitor({ volume: Number(e.target.value) })} className="w-20 accent-[hsl(var(--amber))]" aria-label="监听音量" />
                  </label>
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={s.monitor.reverb} onChange={(e) => s.setMonitor({ reverb: e.target.checked })} className="accent-[hsl(var(--amber))]" />
                    加一点混响
                  </label>
                  <NativeMonitorControls monitor={s.monitor} setMonitor={s.setMonitor} />
                </>
              )}
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void s.startMic()} disabled={s.mic === 'starting'}>
              {s.mic === 'starting' ? <Loader2 className="animate-spin" /> : <Mic />} 打开麦克风
            </Button>
          )}
        </div>
      </div>
      {s.micError && <p className="text-sm text-destructive">{s.micError}</p>}
      {run && <RunBanner phase={run.phase} countdown={run.countdown} sung={runTakes.length} total={scorableCount} avg={runAvg} onPause={pauseRun} onResume={resumeRun} onStop={() => void finishRun()} />}
      {runReport && (
        <RunReportCard
          report={runReport}
          onClose={() => setRunReport(null)}
          onPractise={(i) => {
            setRunReport(null)
            setLoop(true)
            goTo(i, true)
          }}
        />
      )}
      {s.mic === 'on' && s.monitor.on && (
        <p className="text-xs text-muted-foreground">
          监听已开：请一定戴耳机（用外放会啸叫）。
          {s.monitorStatus?.kind === 'native'
            ? `低延迟监听（${s.monitorStatus.info.api}，${s.monitorStatus.info.input} → ${s.monitorStatus.info.output}），延迟约 ${s.monitorStatus.info.latencyMs} 毫秒${s.monitorStatus.info.api === 'ASIO' ? '；声卡由应用独占，录音也从 ASIO 读取' : ''}。`
            : s.monitorStatus?.kind === 'fallback'
              ? `低延迟监听没能打开（${s.monitorStatus.reason}），先用普通监听，会有一点延迟（通常 20–60 毫秒）。`
              : '普通监听会有一点延迟（通常 20–60 毫秒），觉得别扭可以调小音量或关掉；'}
          录音和评分不受影响。
        </p>
      )}
      {s.lagNotice !== null && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber/40 bg-amber-soft/20 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            最近几句你可能都比原唱{s.lagNotice > 0 ? '晚' : '早'}约 {Math.abs(s.lagNotice)} 毫秒。评分已经按这个差来比较音高。如果每句都差不多，多半是耳机或设备的延迟（无线耳机常见 150–250 毫秒）。
          </span>
          {s.lagNotice > 0 && s.latencyMs + s.lagNotice <= 400 && (
            <Button size="sm" variant="outline" onClick={() => void setDeviceLatency(s.latencyMs + s.lagNotice!)}>
              补偿这 {s.lagNotice} 毫秒（录音延迟改为 {s.latencyMs + s.lagNotice} 毫秒）
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
        <span title="耳机、声卡、蓝牙带来的总延迟。录音和评分会往前挪这么多；无线耳机一般 150–250 毫秒，有线耳机一般 0–40 毫秒。可以在「设置 → 跟唱录音延迟」自动检测">录音延迟</span>
        <button type="button" className="focus-ring rounded-md border border-border/80 px-2 py-0.5 hover:text-foreground disabled:opacity-40" disabled={s.latencyMs <= 0} onClick={() => void setDeviceLatency(s.latencyMs - 10)} aria-label="录音延迟减 10 毫秒">
          −
        </button>
        <span className="num w-14 text-center">{s.latencyMs} 毫秒</span>
        <button type="button" className="focus-ring rounded-md border border-border/80 px-2 py-0.5 hover:text-foreground disabled:opacity-40" disabled={s.latencyMs >= 400} onClick={() => void setDeviceLatency(s.latencyMs + 10)} aria-label="录音延迟加 10 毫秒">
          ＋
        </button>
        <span className="mr-3" />
        {extremes && (
          <span>
            整首音域 {midiName(extremes.low)}–{midiName(extremes.high)}（{Math.round(extremes.high - extremes.low)} 个半音）
          </span>
        )}
        <span className="ml-2">上下留白</span>
        <button type="button" className="focus-ring rounded-md border border-border/80 px-2 py-0.5 hover:text-foreground disabled:opacity-40" disabled={laneView.pad <= 0} onClick={() => changeLaneView({ pad: Math.max(0, laneView.pad - 2) })} aria-label="缩小音域显示">
          −
        </button>
        <span className="num w-10 text-center">{laneView.pad} 半音</span>
        <button type="button" className="focus-ring rounded-md border border-border/80 px-2 py-0.5 hover:text-foreground disabled:opacity-40" disabled={laneView.pad >= 12} onClick={() => changeLaneView({ pad: Math.min(12, laneView.pad + 2) })} aria-label="扩大音域显示">
          ＋
        </button>
        <span className="ml-2">高度</span>
        {(['normal', 'tall', 'xl'] as const).map((h) => (
          <button key={h} type="button" aria-pressed={laneView.height === h} onClick={() => changeLaneView({ height: h })} className={cn('focus-ring rounded-md border px-2 py-0.5', laneView.height === h ? 'border-amber/60 bg-amber-soft/40 text-foreground' : 'border-border/80 hover:text-foreground')}>
            {h === 'normal' ? '标准' : h === 'tall' ? '高' : '更高'}
          </button>
        ))}
      </div>
      <PitchLane curve={curve} notes={notes} positionMs={positionMs} sung={getSung} overlay={getOverlay} shift={shift} low={range.low} high={range.high} extremes={extremes} heightClass={LANE_HEIGHT[laneView.height]} />
      {lyrics.length > 0 && <LyricsDisplay lines={lyrics} positionMs={positionMs} {...((loop || preview) && phrase ? { lockLine: lyrics.findIndex((l) => l.startMs >= phrase.startMs - 500 && l.startMs <= phrase.endMs) } : {})} />}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Headphones className="h-3.5 w-3.5" /> 请戴耳机唱，否则伴奏会被录进去。灰色横条是原唱的音（颤音、滑音已经去掉，不打分），彩色是你，淡蓝是你选中的那一次。任何舒服的八度都可以。
      </p>

      <div className="grid gap-6 lg:grid-cols-[1fr_19rem]">
        <section className="space-y-4 rounded-3xl border border-border/80 bg-card p-6 surface-gradient" aria-live="polite">
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold">{phrase ? `第 ${phrase.index + 1} 句（${fmt(phrase.startMs)}–${fmt(phrase.endMs)}）` : '还没有找到乐句'}</h2>
            {phrase && lyricsInPhrase(lyrics, phrase) && <p className="text-base">{lyricsInPhrase(lyrics, phrase)}</p>}
            {phrase && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span>{s.phraseSource === 'lyrics' ? '按歌词分句' : s.phraseSource === 'manual' ? '分句已手动调整' : lyrics.length ? '按原唱的停顿分句（到「歌词」里对齐歌词后会按歌词分句）' : '按原唱的停顿分句（添加歌词并对齐后会按歌词分句）'}</span>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={mergeUp} disabled={phraseIdx === 0}>
                  <Combine className="h-3.5 w-3.5" /> 并入上一句
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={splitHere} disabled={canSplitAt === null} title={canSplitAt === null ? '这一句中间没有明显的停顿' : `在 ${fmt(canSplitAt)} 处的停顿拆开`}>
                  <Scissors className="h-3.5 w-3.5" /> 拆成两句
                </Button>
                {s.phraseSource === 'manual' && (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={resetCuts}>
                    <RotateCcw className="h-3.5 w-3.5" /> 恢复自动分句
                  </Button>
                )}
              </div>
            )}
          </div>
          {list.length > 0 && (
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="选择一次跟唱">
              {list.map((t, i) => (
                <button key={t.id} type="button" role="radio" aria-checked={t.id === take?.id} onClick={() => {
                    if (previewRef.current) stopPreview()
                    if (phrase) setSelected((m) => ({ ...m, [phrase.index]: t.id }))
                  }} className={cn('focus-ring rounded-full border px-2.5 py-1 text-xs', t.id === take?.id ? 'border-amber/70 bg-amber-soft/40' : 'border-border/80 text-muted-foreground hover:text-foreground')}>
                  {i === 0 ? '最近' : `前 ${i} 次`}
                  {t.id === bestId ? ' · 最好' : ''}
                  {t.score ? ` · ${pct(t.score.score)}` : ''}
                  {t.kept ? ' · 已保留' : ''}
                  {phrase && !takeFitsPhrase(t, phrase) ? ' · 按旧分句唱的' : ''}
                </button>
              ))}
            </div>
          )}
          {!scorable && phrase ? (
            <p className="text-sm text-muted-foreground">这一句原唱的音很少（或接近说唱），不评分，可以只看音高线练习。</p>
          ) : report ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-6 text-sm">
                <Stat label="得分" value={pct(report.score)} />
                <Stat label="唱到的音" value={`${report.notesSung} / ${report.notesTotal}`} />
                <Stat label="平均偏差" value={`${report.meanAbsCents} 音分`} />
                <Stat label="倾向" value={Math.abs(report.biasCents) < 15 ? '居中' : report.biasCents > 0 ? `偏高 ${report.biasCents}` : `偏低 ${-report.biasCents}`} />
              </div>
              <ol className="flex flex-wrap gap-1.5" aria-label="每个音的偏差">
                {report.noteCents.map((c, i) => (
                  <li key={i} title={c === null ? `第 ${i + 1} 个音：没唱到` : `第 ${i + 1} 个音：${c > 0 ? '+' : ''}${c} 音分`} className={cn('num flex h-7 min-w-7 items-center justify-center rounded-md px-1 text-[11px]', c === null ? 'border border-dashed border-border text-muted-foreground' : Math.abs(c) <= 25 ? 'bg-success/20 text-success' : Math.abs(c) < 100 ? 'bg-amber-soft/60 text-foreground' : 'bg-destructive/15 text-destructive')}>
                    {i + 1}
                  </li>
                ))}
              </ol>
              <p className="text-sm text-muted-foreground">{detail ? noteFeedback(detail) : feedbackFrom(report.noteCents, report.notesSung, report.lagMs)}</p>
              <p className="text-xs text-muted-foreground/80">这些数字是根据这一次演唱估计的，不是对嗓音的评判。</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{s.mic === 'on' ? '唱完这一句后会在这里显示报告。' : '先打开麦克风，再按播放跟着唱。'}</p>
          )}
          {take && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
              {preview ? (
                <>
                  <Button size="sm" variant="outline" onClick={stopPreview}>
                    {preview.stage === 'loading' ? <Loader2 className="animate-spin" /> : <Square />} 停止
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {MODE_LABEL[preview.mode]} · {STAGE_LABEL[preview.stage]}
                  </span>
                </>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={() => void listen('solo')} disabled={!take.audio}>
                    <Volume2 /> 只听我唱的
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void listen('backing')} disabled={!take.audio}>
                    和伴奏一起听
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void listen('compare')} disabled={!take.audio}>
                    和原唱对比
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => goTo(phraseIdx, true)} disabled={!s.ready}>
                    <Play /> 从这一句开始跟唱
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() => {
                  if (!phrase || !window.confirm(`清除第 ${phrase.index + 1} 句的 ${list.length} 条演唱记录和评分？不能恢复。`)) return
                  if (previewRef.current) stopPreview()
                  scored.current.delete(phrase.index)
                  setSelected((m) => {
                    const { [phrase.index]: _gone, ...rest } = m
                    return rest
                  })
                  void s.clearPhraseTakes(list.map((t) => t.id))
                }}
              >
                <Trash2 /> 清除这一句的记录
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void s.updateTake(take, { kept: !take.kept })}>
                {take.kept ? <PinOff /> : <Pin />} {take.kept ? '取消保留' : '保留这一次'}
              </Button>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {autoLag(take) ? `已自动对齐 ${autoLag(take) > 0 ? '−' : '+'}${Math.abs(Math.round(autoLag(take)))} ms，再微调` : '对齐'}
                <Button size="sm" variant="ghost" onClick={() => void s.updateTake(take, { nudgeMs: (take.nudgeMs ?? 0) - 10, alignAuto: take.alignAuto ?? take.nudgeMs === undefined })} aria-label="提前 10 毫秒">
                  −10
                </Button>
                <span className="num">{take.nudgeMs ?? 0} ms</span>
                <Button size="sm" variant="ghost" onClick={() => void s.updateTake(take, { nudgeMs: (take.nudgeMs ?? 0) + 10, alignAuto: take.alignAuto ?? take.nudgeMs === undefined })} aria-label="推后 10 毫秒">
                  +10
                </Button>
              </span>
              {!take.audio && <span className="text-xs text-muted-foreground">这一次没有录音（麦克风录音没开）。</span>}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-border/80 bg-card p-4" aria-label="乐句">
          <h2 className="mb-2 px-2 text-sm font-medium">乐句（{phrases.length}）</h2>
          <ol className="max-h-[28rem] space-y-1 overflow-auto">
            {phrases.map((p, i) => {
              const ts = takes[p.index] ?? []
              const last = ts.find((t) => takeFitsPhrase(t, p))?.score?.score
              const best = s.bests[i]
              const line = lyricsInPhrase(lyrics, p)
              const canScore = isScorable(notesIn(notes, p))
              return (
                <li key={p.index}>
                  <button type="button" onClick={() => goTo(i)} className={cn('focus-ring w-full rounded-lg px-2 py-1.5 text-left text-sm', i === phraseIdx ? 'bg-amber-soft/40' : 'hover:bg-muted')}>
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        第 {i + 1} 句 <span className="num text-xs text-muted-foreground">{fmt(p.startMs)}</span>
                      </span>
                      <span className="num text-[11px] text-muted-foreground">{!canScore ? '不评分' : last === undefined ? '未唱' : `最近 ${pct(last)}${best !== undefined ? ` · 最好 ${pct(best)}` : ''}`}</span>
                    </div>
                    {line && <div className="truncate text-xs text-muted-foreground">{line}</div>}
                  </button>
                </li>
              )
            })}
          </ol>
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="num text-xl font-semibold">{value}</div>
    </div>
  )
}
