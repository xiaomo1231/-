import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Play, RotateCcw } from 'lucide-react'
import * as Tone from 'tone'
import * as engine from '@/audio/engine'
import { measureBestStretch, smoothFrames } from '@/audio/pitch/analysis'
import { VoiceRecorder } from '@/audio/sing/voiceRecorder'
import { playBuffer, stopTake } from '@/audio/sing/takePlayback'
import { usePitchDetector } from '@/features/audio/usePitchDetector'
import { JUDGE_TEXT, actualJudge, judgeCorrect, type SelfJudge } from '@/pitchcamp/plan'
import { midiToName } from '@/music/pitch'
import { Button } from '@/shared/ui/Button'
import { ResultLine, TaskFrame } from './TaskFrame'

type Phase = 'idle' | 'reference' | 'take' | 'judge' | 'shown'

const TAKE_SECONDS = 2.6

/**
 * 高了还是低了：听一个音，唱出来，然后回放「参考音 → 你刚唱的」，自己判断偏高、
 * 偏低还是准，系统再告诉你实际偏了多少。录音只在这一题里放一下，不保存、不上传。
 */
export function SelfCheckTask({
  rounds,
  range,
  why,
  onDone,
}: {
  rounds: number
  range: { low: number; high: number }
  why?: string
  onDone: (result: { correct: number; total: number; seconds: number }) => void
}) {
  const mic = usePitchDetector('voice', true)
  const { record, state: micState, start: micStart } = mic
  const [round, setRound] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [target, setTarget] = useState(() => pick(range))
  const [cents, setCents] = useState<number | null>(null)
  const [answer, setAnswer] = useState<SelfJudge | null>(null)
  const correct = useRef(0)
  const recorder = useRef<VoiceRecorder | null>(null)
  const clip = useRef<AudioBuffer | null>(null)
  const began = useRef(Date.now())

  useEffect(() => () => {
    recorder.current?.stop()
    stopTake()
  }, [])

  const replay = useCallback(async () => {
    if (!clip.current) return
    await engine.ensureAudio()
    const { endAt } = engine.playSequence([{ midi: target, duration: 1.0, at: 0 }])
    await new Promise<void>((r) => engine.onAudioTime(endAt + 0.25, r))
    await playBuffer(clip.current)
  }, [target])

  const go = useCallback(async () => {
    if (phase !== 'idle') return
    if (micState !== 'live') await micStart()
    await engine.ensureAudio()
    if (!recorder.current) {
      recorder.current = new VoiceRecorder(30)
      await recorder.current.start()
    }
    setPhase('reference')
    const { endAt } = engine.playSequence([{ midi: target, duration: 1.1, at: 0 }])
    engine.onAudioTime(endAt + 0.3, () => {
      setPhase('take')
      const from = engine.rawTime()
      const stop = record()
      window.setTimeout(() => {
        const to = engine.rawTime()
        const frames = smoothFrames(stop())
        const m = measureBestStretch(frames, target, true)
        setCents(m.medianCents)
        // 只放唱的那一段（掐掉开头起音）。
        const samples = recorder.current?.clip(from + 0.3, to) ?? new Float32Array(0)
        const ctx = Tone.getContext().rawContext as AudioContext
        if (samples.length > 0) {
          const buf = ctx.createBuffer(1, samples.length, recorder.current!.sampleRate)
          buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)
          clip.current = buf
        } else clip.current = null
        setPhase('judge')
        void replay()
      }, TAKE_SECONDS * 1000)
    })
  }, [phase, micState, micStart, target, record, replay])

  const choose = (a: SelfJudge) => {
    if (phase !== 'judge') return
    setAnswer(a)
    if (cents !== null && judgeCorrect(a, cents)) correct.current += 1
    setPhase('shown')
  }

  const next = () => {
    stopTake()
    if (round + 1 >= rounds) {
      onDone({ correct: correct.current, total: rounds, seconds: (Date.now() - began.current) / 1000 })
      return
    }
    setRound((r) => r + 1)
    setTarget(pick(range))
    setCents(null)
    setAnswer(null)
    clip.current = null
    setPhase('idle')
  }

  if (mic.state === 'error')
    return (
      <TaskFrame title="高了还是低了">
        <div className="flex items-center gap-2">
          <MicOff className="h-5 w-5 text-destructive" /> 麦克风不可用：{mic.error}
        </div>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void mic.start()}>
          <RotateCcw /> 重试
        </Button>
      </TaskFrame>
    )

  const ok = answer && cents !== null ? judgeCorrect(answer, cents) : null
  return (
    <TaskFrame title="高了还是低了" why={why} index={round} total={rounds}>
      <div className="flex flex-col items-center gap-5">
        {phase === 'idle' && (
          <Button size="lg" onClick={() => void go()}>
            <Mic /> 听音，然后唱
          </Button>
        )}
        {phase === 'reference' && <div className="font-display text-2xl">仔细听…</div>}
        {phase === 'take' && <div className="font-display text-2xl text-amber">现在唱！稳住这个音</div>}
        {(phase === 'judge' || phase === 'shown') && (
          <>
            <div className="text-sm text-muted-foreground">先放参考音，再放你刚唱的。你唱的比参考音：</div>
            <div className="flex gap-3">
              {(['high', 'ok', 'low'] as SelfJudge[]).map((j) => (
                <Button key={j} size="lg" variant={answer === j ? 'default' : 'outline'} disabled={phase !== 'judge' || cents === null} onClick={() => choose(j)}>
                  {JUDGE_TEXT[j]}
                </Button>
              ))}
              <Button size="lg" variant="ghost" onClick={() => void replay()}>
                <Play /> 再听一遍
              </Button>
            </div>
            {cents === null && phase === 'judge' && (
              <ResultLine ok={null}>
                没听到稳定的歌声，这题不算。
                <Button variant="link" size="sm" onClick={next}>
                  下一题
                </Button>
              </ResultLine>
            )}
            {phase === 'shown' && cents !== null && (
              <div className="flex w-full items-center gap-4">
                <div className="flex-1">
                  <ResultLine ok={ok}>
                    {ok ? '判断对了。' : '判断不对。'}实际{' '}
                    <span className="num font-medium">
                      {cents > 0 ? '+' : ''}
                      {cents} 音分
                    </span>
                    （{JUDGE_TEXT[actualJudge(cents)]}）；目标音 {midiToName(target, { octave: true })}。
                  </ResultLine>
                </div>
                <Button size="lg" onClick={next}>
                  {round + 1 >= rounds ? '完成这一组' : '下一题'}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </TaskFrame>
  )
}

function pick(range: { low: number; high: number }): number {
  const lo = range.low + 2
  const hi = Math.max(lo, range.high - 2)
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}
