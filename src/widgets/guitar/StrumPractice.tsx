import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Play, Plus, Repeat, Square, TrendingUp } from 'lucide-react'
import * as engine from '@/audio/engine'
import { listenForOnsets, type OnsetSession } from '@/audio/onset/onsetListener'
import { guitarMonitor } from '@/audio/guitar/monitor'
import { hintAgrees } from '@/audio/chroma'
import { inputManager } from '@/audio/input/inputManager'
import { useGuitarAudio } from '@/features/guitar/guitarAudioStore'
import { useChordTargets } from '@/features/guitar/useChordTargets'
import { useChordHint } from '@/features/guitar/useChordHint'
import { GOOD_MS, MATCH_MS, gradeOffset, judgeTake, songStrums, songSubScores, strumPattern, takeFeedback, totalBars, type HitGrade, type StrumSegment, type SubScore, type TakeResult } from '@/guitar/strum'
import { parseChordSymbol } from '@/guitar/units'
import { GuitarService } from '@/services/guitarService'
import { chordSymbolFor, emptyScore, type Score } from '@/music/score'
import type { RomanId } from '@/music/keys'
import { ChordDiagram } from '@/widgets/instrument/ChordDiagram'
import { MonitorToggle } from './MonitorToggle'
import { StrumGrid } from './StrumGrid'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

export interface StrumTake extends TakeResult {
  bpm: number
  passed: boolean
  offbeat: SubScore | null
  changes: SubScore | null
  hint: { agree: number; total: number } | null
}

export interface StrumPracticeProps {
  segments: StrumSegment[]
  tonic: number
  bpm: number
  pass: number
  preset?: string
  /** Display chords with this suffix (e.g. '5'). */
  chordSuffix?: string
  onTake: (result: StrumTake) => void
}

const COUNT_IN_BARS = 1

/**
 * Practice desk for strumming: a backing track (drums + bass, the guitar
 * part left out) or a metronome, one count-in bar, then the sections. Strums
 * are detected on the dry input and judged with the calibrated latency;
 * off-beat strums and chord-change strums get their own sub-scores. The
 * chord-recognition hint is shown but never scored.
 */
export function StrumPractice({ segments, tonic, bpm: targetBpm, pass, preset, chordSuffix, onTake }: StrumPracticeProps) {
  const judgeOffset = useGuitarAudio((s) => s.judge)
  const applyPreset = useGuitarAudio((s) => s.applyPreset)
  const [bpm, setBpm] = useState(Math.max(50, targetBpm - 10))
  const [mode, setMode] = useState<'backing' | 'click'>('backing')
  const [loop, setLoop] = useState(false)
  const [autoUp, setAutoUp] = useState(true)
  const [running, setRunning] = useState(false)
  const [cell, setCell] = useState<{ bar: number; cell: number } | null>(null)
  const [grades, setGrades] = useState<Array<HitGrade | null>>([])
  const [result, setResult] = useState<StrumTake | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showHint, setShowHint] = useState(true)
  const session = useRef<OnsetSession | null>(null)
  const timers = useRef<Array<() => void>>([])
  const raf = useRef(0)
  const loopRef = useRef(loop)
  loopRef.current = loop
  const { hint, latest: latestHint } = useChordHint(showHint)

  const bars = totalBars(segments)
  /** Per bar: segment, pattern, chord symbol. */
  const barInfo = useMemo(() => {
    const key = { keyTonic: tonic, mode: 'major' as const }
    const out: Array<{ seg: StrumSegment; segIndex: number; chord: string; roman: RomanId; firstOfSeg: boolean }> = []
    segments.forEach((seg, segIndex) => {
      for (let b = 0; b < seg.bars; b++) {
        const roman = seg.romans[b % seg.romans.length]! as RomanId
        const base = chordSymbolFor(key, roman)
        const chord = chordSuffix ? base.replace(/(m|dim|aug)$/, '') + chordSuffix : base
        out.push({ seg, segIndex, chord, roman, firstOfSeg: b === 0 })
      }
    })
    return out
  }, [segments, tonic, chordSuffix])
  const uniqueChords = useMemo(() => Array.from(new Set(barInfo.map((b) => b.chord))), [barInfo])
  const shapes = useChordTargets(uniqueChords)
  const strumCounts = useMemo(() => barInfo.map((b) => strumPattern(b.seg.pattern).cells.filter((c) => c !== '-').length), [barInfo])
  const firstIndexOfBar = useMemo(() => strumCounts.reduce<number[]>((acc, _n, i) => [...acc, i === 0 ? 0 : acc[i - 1]! + strumCounts[i - 1]!], []), [strumCounts])

  useEffect(() => {
    if (preset) applyPreset(preset)
  }, [preset, applyPreset])

  const stop = useCallback(() => {
    timers.current.forEach((c) => c())
    timers.current = []
    cancelAnimationFrame(raf.current)
    session.current?.stop()
    session.current = null
    engine.stopArrangement()
    setRunning(false)
    setCell(null)
  }, [])

  useEffect(() => stop, [stop])

  const run = useCallback(
    async (tempo: number) => {
      setError(null)
      setResult(null)
      try {
        await engine.ensureAudio()
        guitarMonitor.setTempo(tempo)
        const detected: number[] = []
        const offset = judgeOffset().seconds
        let expected: number[] = []
        const live: Array<HitGrade | null> = []
        const taken = new Set<number>()
        session.current = await listenForOnsets((o) => {
          const t = o.time - offset
          detected.push(t)
          let best = -1
          let bestD = Infinity
          expected.forEach((e, i) => {
            const d = Math.abs(t - e)
            if (!taken.has(i) && d < bestD) {
              bestD = d
              best = i
            }
          })
          if (best >= 0 && bestD * 1000 <= MATCH_MS) {
            taken.add(best)
            live[best] = gradeOffset((t - expected[best]!) * 1000)
            setGrades([...live])
          }
        })
        const beat = 60 / tempo
        let startAt: number
        if (mode === 'backing') {
          const rock = segments.some((s) => s.pattern === 'rock8')
          const score: Score = emptyScore({
            keyTonic: tonic,
            bpm: tempo,
            bars: COUNT_IN_BARS + bars,
            chords: barInfo.map((b, i) => ({ start: (COUNT_IN_BARS + i) * 4, beats: 4, roman: b.roman })),
            accompaniment: { comp: 'off', bass: 'roots', drums: rock ? 'rock' : 'pop' },
          })
          startAt = (await engine.playScore(score)).startAt
          engine.scheduleClicks(tempo, 4 * COUNT_IN_BARS, { at: startAt, accentEvery: 4 })
        } else {
          startAt = engine.scheduleClicks(tempo, 4 * (COUNT_IN_BARS + bars), { startOffset: 0.3, accentEvery: 4 }).startAt
        }
        const first = startAt + 4 * COUNT_IN_BARS * beat
        const strums = songStrums(segments, first, beat)
        expected = strums.map((s) => s.time)
        setGrades(expected.map(() => null))
        setRunning(true)
        // Chord hint samples, half-way through each bar (after the attacks settle).
        const hintChecks: Array<{ agree: boolean } | null> = []
        if (showHint) {
          barInfo.forEach((b, i) => {
            timers.current.push(
              engine.onAudioTime(first + (i * 4 + 2.5) * beat, () => {
                const h = latestHint()
                hintChecks[i] = h ? { agree: hintAgrees(h, parseChordSymbol(b.chord)) } : null
              }),
            )
          })
        }
        const tick = () => {
          const now = engine.rawTime() - engine.outputLatencySeconds()
          const pos = (now - first) / beat
          if (pos >= 0 && pos < bars * 4) {
            const bar = Math.floor(pos / 4)
            const grid = strumPattern(barInfo[bar]!.seg.pattern).grid
            setCell({ bar, cell: Math.floor(((pos - bar * 4) / 4) * grid) })
          } else setCell(null)
          raf.current = requestAnimationFrame(tick)
        }
        raf.current = requestAnimationFrame(tick)
        const end = first + bars * 4 * beat + GOOD_MS / 1000 + 0.3
        timers.current.push(
          engine.onAudioTime(end, () => {
            session.current?.stop()
            session.current = null
            cancelAnimationFrame(raf.current)
            setCell(null)
            setRunning(false)
            const r = judgeTake(expected, detected)
            const subs = songSubScores(r, strums)
            const sampled = hintChecks.filter((x): x is { agree: boolean } => x !== null && x !== undefined)
            const hintStat = showHint ? { agree: sampled.filter((x) => x.agree).length, total: barInfo.length } : null
            if (hintStat) void GuitarService.recordHint(inputManager.current?.kind ?? 'mic', hintStat.agree, hintStat.total)
            setGrades(r.hits.map((h) => h.grade))
            const passed = r.score >= pass && tempo >= targetBpm
            const take: StrumTake = { ...r, bpm: tempo, passed, offbeat: subs.offbeat, changes: subs.changes, hint: hintStat }
            setResult(take)
            onTake(take)
            let next = tempo
            if (autoUp && r.score >= pass) {
              next = Math.min(targetBpm + 40, tempo + 4)
              setBpm(next)
            }
            if (loopRef.current) timers.current.push(engine.onAudioTime(engine.rawTime() + 1.2, () => void run(next)))
          }),
        )
      } catch (e) {
        stop()
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [autoUp, barInfo, bars, judgeOffset, latestHint, mode, onTake, pass, segments, showHint, stop, targetBpm, tonic],
  )

  const judged = judgeOffset()
  const currentChord = cell ? barInfo[cell.bar]?.chord : null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        {running ? (
          <Button variant="outline" onClick={stop}>
            <Square /> 停止
          </Button>
        ) : (
          <Button onClick={() => void run(bpm)}>
            <Play /> 开始
          </Button>
        )}
        <div className="flex items-center gap-1 rounded-xl border border-border px-1" role="group" aria-label="速度">
          <Button size="icon" variant="ghost" onClick={() => setBpm((b) => Math.max(40, b - 4))} disabled={running} aria-label="减慢 4 BPM">
            <Minus />
          </Button>
          <span className="num w-20 text-center text-sm">{bpm} BPM</span>
          <Button size="icon" variant="ghost" onClick={() => setBpm((b) => Math.min(220, b + 4))} disabled={running} aria-label="加快 4 BPM">
            <Plus />
          </Button>
        </div>
        <div className="flex rounded-xl border border-border p-0.5 text-sm" role="radiogroup" aria-label="伴奏方式">
          {(['backing', 'click'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={running} onClick={() => setMode(m)} className={cn('focus-ring rounded-lg px-3 py-1', mode === m && 'bg-amber-soft/50')}>
              {m === 'backing' ? '伴奏' : '节拍器'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={autoUp} onChange={(e) => setAutoUp(e.target.checked)} className="accent-[hsl(var(--amber))]" />
          <TrendingUp className="h-4 w-4" aria-hidden /> 达标后自动加速
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} className="accent-[hsl(var(--amber))]" />
          <Repeat className="h-4 w-4" aria-hidden /> 循环
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={showHint} onChange={(e) => setShowHint(e.target.checked)} disabled={running} className="accent-[hsl(var(--amber))]" />
          和弦识别提示
        </label>
        <MonitorToggle compact className="ml-auto" />
      </div>
      <p className="text-xs text-muted-foreground">
        目标速度 {targetBpm} BPM，达到 {Math.round(pass * 100)} 分且不慢于目标速度才算通过。判定已减去 {Math.round(judged.seconds * 1000)} ms 延迟{judged.calibrated ? '' : '（估计值，建议到“设备检查”校准）'}。
      </p>

      <div className="flex flex-wrap items-end gap-4">
        {shapes.map(
          (s) =>
            s.shape && (
              <div key={s.symbol} className={cn('flex flex-col items-center rounded-xl border px-2 py-1', currentChord === s.symbol ? 'border-amber/60' : 'border-border/50')}>
                <span className="font-semibold">{s.symbol}</span>
                <ChordDiagram shape={s.shape} />
              </div>
            ),
        )}
        {showHint && (
          <div className="ml-auto rounded-xl border border-dashed border-border px-4 py-2 text-center" aria-live="polite">
            <div className="text-[11px] text-muted-foreground">听起来像（仅提示，不计分）</div>
            <div className="num text-2xl font-semibold text-cyan">{hint?.label ?? '—'}</div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {barInfo.map((b, i) => (
          <div key={i}>
            {b.firstOfSeg && b.seg.label && <div className="mb-1 text-xs font-medium text-amber">{b.seg.label}</div>}
            <StrumGrid
              pattern={strumPattern(b.seg.pattern)}
              chord={b.chord}
              activeCell={cell?.bar === i ? cell.cell : null}
              grades={grades.slice(firstIndexOfBar[i]!, firstIndexOfBar[i]! + strumCounts[i]!)}
            />
          </div>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result && (
        <div role="status" className={cn('rounded-2xl border p-4', result.passed ? 'border-success/40 bg-success/10' : 'border-border bg-card')}>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              得分 <b className="num text-lg">{Math.round(result.score * 100)}</b>
            </span>
            <span className="text-success">准 {result.perfect}</span>
            <span className="text-cyan">可 {result.good}</span>
            <span className="text-destructive">漏 {result.miss}</span>
            <span className="text-muted-foreground">多余 {result.extra}</span>
            {result.meanAbsMs !== null && <span className="text-muted-foreground">平均偏差 {result.meanAbsMs} ms</span>}
            {result.offbeat && <span>反拍 {Math.round(result.offbeat.score * 100)} 分（{result.offbeat.hit}/{result.offbeat.total}）</span>}
            {result.changes && result.changes.total > 1 && <span>换和弦那一下 {Math.round(result.changes.score * 100)} 分（{result.changes.hit}/{result.changes.total}）</span>}
            {result.hint && <span className="text-muted-foreground">和弦识别与谱面一致 {result.hint.agree}/{result.hint.total} 小节（仅提示）</span>}
          </div>
          <p className="mt-2 text-sm">{takeFeedback(result)}</p>
        </div>
      )}
    </div>
  )
}
