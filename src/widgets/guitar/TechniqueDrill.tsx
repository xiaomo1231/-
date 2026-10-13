import { useEffect, useRef, useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import * as engine from '@/audio/engine'
import { usePitchDetector } from '@/features/audio/usePitchDetector'
import { useGuitarSetup } from '@/features/instrument/useGuitarSetup'
import { analyzeBend, analyzeVibrato, bendFeedback, vibratoFeedback, type BendResult, type PitchPoint, type VibratoResult } from '@/guitar/technique'
import { frequencyToMidi, midiToName } from '@/music/pitch'
import { MonitorToggle } from './MonitorToggle'
import { LeadTab } from './LeadTab'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

const STRING_NAME = ['6 弦', '5 弦', '4 弦', '3 弦', '2 弦', '1 弦']
const TAKE_SECONDS = 4

/** Pitch curve in cents around a reference note, with target lines. */
function PitchCurve({ points, base, lines }: { points: PitchPoint[]; base: number; lines: Array<{ midi: number; label: string; strong?: boolean }> }) {
  const W = 640
  const H = 180
  const lo = base - 1
  const hi = Math.max(...lines.map((l) => l.midi)) + 1
  const t0 = points[0]?.t ?? 0
  const span = Math.max(1, (points[points.length - 1]?.t ?? 1) - t0)
  const yOf = (m: number) => H - 14 - ((m - lo) / (hi - lo)) * (H - 28)
  const segs: string[] = []
  let cur = ''
  for (const p of points) {
    if (p.midi === null || p.midi < lo - 0.5 || p.midi > hi + 0.5) {
      if (cur) segs.push(cur)
      cur = ''
      continue
    }
    const x = 40 + ((p.t - t0) / span) * (W - 50)
    cur += `${cur ? 'L' : 'M'} ${x.toFixed(1)} ${yOf(p.midi).toFixed(1)} `
  }
  if (cur) segs.push(cur)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-2xl border border-border/70 bg-background/40" role="img" aria-label="音高曲线">
      {lines.map((l) => (
        <g key={l.label}>
          <line x1={40} x2={W - 10} y1={yOf(l.midi)} y2={yOf(l.midi)} className={l.strong ? 'stroke-amber' : 'stroke-border'} strokeDasharray={l.strong ? undefined : '4 4'} />
          <text x={4} y={yOf(l.midi) + 4} fontSize={11} className={l.strong ? 'fill-amber' : 'fill-muted-foreground'}>
            {l.label}
          </text>
        </g>
      ))}
      {segs.map((d, i) => (
        <path key={i} d={d} fill="none" className="stroke-cyan" strokeWidth={2} />
      ))}
    </svg>
  )
}

function useTake() {
  const mic = usePitchDetector('guitar', true)
  const [phase, setPhase] = useState<'idle' | 'count' | 'take' | 'done'>('idle')
  const [points, setPoints] = useState<PitchPoint[]>([])
  const timers = useRef<Array<() => void>>([])
  useEffect(() => () => timers.current.forEach((c) => c()), [])
  const start = async (onEnd: (pts: PitchPoint[]) => void) => {
    await engine.ensureAudio()
    setPhase('count')
    const clicks = engine.scheduleClicks(90, 2, { startOffset: 0.2, accentEvery: 2 })
    timers.current.push(
      engine.onAudioTime(clicks.endAt, () => {
        setPhase('take')
        const stopRec = mic.record()
        timers.current.push(
          engine.onAudioTime(clicks.endAt + TAKE_SECONDS, () => {
            const frames = stopRec()
            const pts = frames.map((f) => ({ t: f.t, midi: f.hz ? frequencyToMidi(f.hz) : null }))
            setPoints(pts)
            setPhase('done')
            onEnd(pts)
          }),
        )
      }),
    )
  }
  return { mic, phase, points, start }
}

/** Bend from a fretted note up by 1 or 2 semitones; the pitch curve shows how far it went. */
export function BendDrill({ string, fret, semitones, onDone }: { string: number; fret: number; semitones: 1 | 2; onDone: (r: { passed: boolean; score: number; summary: string }) => void }) {
  const { played } = useGuitarSetup()
  const from = played.strings[string]! + fret
  const target = from + semitones
  const { mic, phase, points, start } = useTake()
  const [result, setResult] = useState<BendResult | null>(null)
  const busy = phase === 'count' || phase === 'take'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-lg">
          {STRING_NAME[string]} {fret} 品（{midiToName(from)}），{semitones === 2 ? '推全音' : '推半音'}到 <b className="text-amber">{midiToName(target)}</b>
        </p>
        <MonitorToggle compact />
      </div>
      <LeadTab notes={[{ string, fret, beats: 2, tech: semitones === 2 ? 'bend' : 'bend-half' }]} className="max-w-xs" />
      {mic.error && (
        <p role="alert" className="text-sm text-destructive">
          {mic.error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button
          onClick={() =>
            void start((pts) => {
              const r = analyzeBend(pts, from, target)
              setResult(r)
              const score = r.errorCents === null ? 0 : Math.max(0, 1 - Math.abs(r.errorCents) / 100) * (r.heldMs >= 300 ? 1 : 0.7)
              onDone({ passed: r.ok, score, summary: r.errorCents === null ? '没有推到位' : `误差 ${r.errorCents > 0 ? '+' : ''}${r.errorCents} 音分，保持 ${(r.heldMs / 1000).toFixed(1)} 秒` })
            })
          }
          disabled={busy || mic.state !== 'live'}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Play />} {phase === 'count' ? '预备…' : phase === 'take' ? `现在推弦（${TAKE_SECONDS} 秒）` : '开始'}
        </Button>
        <span className="text-xs text-muted-foreground">两下预备拍之后，拨响、推上去、保持住。</span>
      </div>
      {points.length > 0 && (
        <PitchCurve
          points={points}
          base={from}
          lines={[
            { midi: from, label: midiToName(from) },
            { midi: target, label: midiToName(target), strong: true },
          ]}
        />
      )}
      {result && (
        <div role="status" className={cn('rounded-2xl border p-4 text-sm', result.ok ? 'border-success/40 bg-success/10' : 'border-border bg-card')}>
          {result.errorCents !== null && (
            <span className="num mr-4">
              误差 {result.errorCents > 0 ? '+' : ''}
              {result.errorCents} 音分 · 保持 {(result.heldMs / 1000).toFixed(1)} 秒
            </span>
          )}
          {bendFeedback(result, semitones)}
        </div>
      )}
    </div>
  )
}

/** Hold a note with vibrato; depth and rate are measured from the pitch curve. */
export function VibratoDrill({ string, fret, onDone }: { string: number; fret: number; onDone: (r: { passed: boolean; score: number; summary: string }) => void }) {
  const { played } = useGuitarSetup()
  const center = played.strings[string]! + fret
  const { mic, phase, points, start } = useTake()
  const [result, setResult] = useState<VibratoResult | null>(null)
  const busy = phase === 'count' || phase === 'take'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-lg">
          {STRING_NAME[string]} {fret} 品（{midiToName(center)}），保持并加揉弦
        </p>
        <MonitorToggle compact />
      </div>
      <LeadTab notes={[{ string, fret, beats: 3, tech: 'vibrato' }]} className="max-w-xs" />
      {mic.error && (
        <p role="alert" className="text-sm text-destructive">
          {mic.error}
        </p>
      )}
      <Button
        onClick={() =>
          void start((pts) => {
            const r = analyzeVibrato(pts, center)
            setResult(r)
            const depthOk = r.depthCents >= 15 && r.depthCents <= 90
            const rateOk = r.rateHz >= 3.5 && r.rateHz <= 8
            onDone({ passed: r.ok, score: (depthOk ? 0.5 : 0) + (rateOk ? 0.5 : 0), summary: `幅度 ${r.depthCents} 音分 · 每秒 ${r.rateHz} 次` })
          })
        }
        disabled={busy || mic.state !== 'live'}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Play />} {phase === 'count' ? '预备…' : phase === 'take' ? `揉弦中（${TAKE_SECONDS} 秒）` : '开始'}
      </Button>
      {points.length > 0 && (
        <PitchCurve
          points={points}
          base={center - 0.5}
          lines={[
            { midi: center, label: midiToName(center), strong: true },
            { midi: center + 0.5, label: '+50' },
          ]}
        />
      )}
      {result && (
        <div role="status" className={cn('rounded-2xl border p-4 text-sm', result.ok ? 'border-success/40 bg-success/10' : 'border-border bg-card')}>
          <span className="num mr-4">
            幅度 {result.depthCents} 音分 · 每秒 {result.rateHz} 次 · 持续 {result.seconds} 秒
          </span>
          {vibratoFeedback(result)}
        </div>
      )}
    </div>
  )
}
