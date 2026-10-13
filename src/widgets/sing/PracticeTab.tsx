import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { Combine, Headphones, Loader2, Mic, Pause, Pin, PinOff, Play, Repeat, RotateCcw, Scissors, SkipBack, Square, Volume2 } from 'lucide-react'
import { useSing, type SessionTake } from '@/features/sing/useSingSession'
import { feedbackFrom, isScorable, noteFeedback, notesIn, type Phrase, type SungSample } from '@/songs/singAlong'
import { audioNow, playBuffer, stopTake, takeBuffer } from '@/audio/sing/takePlayback'
import { lyricsInPhrase, mergeWithPrevious, splitAt, splitPoint, takeFitsPhrase } from '@/songs/phrasing'
import { PitchLane } from './PitchLane'
import { LyricsDisplay } from './LyricsDisplay'
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

  // New cuts: phrase numbers mean something else now.
  useEffect(() => {
    scored.current.clear()
    setSelected({})
    setPhraseIdx((i) => Math.max(0, Math.min(i, phrases.length - 1)))
  }, [phrases])

  const range = useMemo(() => {
    if (!phrases.length) return { low: 48, high: 72 }
    const meds = phrases.map((p) => p.medianMidi)
    const mid = (Math.min(...meds) + Math.max(...meds)) / 2
    return { low: Math.floor(mid - 12), high: Math.ceil(mid + 12) }
  }, [phrases])

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
  const overlay = useCallback((): SungSample[] => (take ? Array.from(take.sungMs, (ms, i) => ({ ms, midi: take.sungMidi[i]! })) : []), [take])

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
      const takeStart = (take.audioStartMs ?? phrase.startMs - 300) + (take.nudgeMs ?? 0)
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
        <Button size="sm" variant="ghost" onClick={() => goTo(0, true)} disabled={!s.ready} aria-label="从头">
          <SkipBack />
        </Button>
        <span className="num w-24 text-xs text-muted-foreground">
          {fmt(now)} / {fmt(player.current?.duration ?? 0)}
        </span>
        <button type="button" onClick={() => setLoop((v) => !v)} aria-pressed={loop} className={cn('focus-ring flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs', loop ? 'border-amber/60 bg-amber-soft/40' : 'border-border/80 text-muted-foreground hover:text-foreground')}>
          <Repeat className="h-3.5 w-3.5" /> 循环这一句
        </button>
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
            <span className="flex items-center gap-1.5 text-xs text-success">
              <Mic className="h-3.5 w-3.5" /> 麦克风已开（正在录音）
            </span>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void s.startMic()} disabled={s.mic === 'starting'}>
              {s.mic === 'starting' ? <Loader2 className="animate-spin" /> : <Mic />} 打开麦克风
            </Button>
          )}
        </div>
      </div>
      {s.micError && <p className="text-sm text-destructive">{s.micError}</p>}
      {s.lagNotice !== null && (
        <p className="rounded-xl border border-amber/40 bg-amber-soft/20 px-3 py-2 text-sm">
          最近几句你可能都比原唱{s.lagNotice > 0 ? '晚' : '早'}约 {Math.abs(s.lagNotice)} 毫秒。评分已经按这个差来比较音高；如果是设备延迟，可以到「设置 → 延迟校准」校准一次。
        </p>
      )}

      <PitchLane curve={curve} notes={notes} positionMs={positionMs} sung={getSung} overlay={overlay} shift={shift} low={range.low} high={range.high} />
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
              <Button size="sm" variant="ghost" onClick={() => void s.updateTake(take, { kept: !take.kept })}>
                {take.kept ? <PinOff /> : <Pin />} {take.kept ? '取消保留' : '保留这一次'}
              </Button>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                对齐
                <Button size="sm" variant="ghost" onClick={() => void s.updateTake(take, { nudgeMs: (take.nudgeMs ?? 0) - 10 })} aria-label="提前 10 毫秒">
                  −10
                </Button>
                <span className="num">{take.nudgeMs ?? 0} ms</span>
                <Button size="sm" variant="ghost" onClick={() => void s.updateTake(take, { nudgeMs: (take.nudgeMs ?? 0) + 10 })} aria-label="推后 10 毫秒">
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
