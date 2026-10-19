/**
 * 校准这台设备的声音延迟: the device plays clicks, the player taps when each one is heard,
 * and the median gap is the delay the rehearsal should compensate for.
 */
import { useEffect, useRef, useState } from 'react'
import { cx, SELECT } from '../lib/classes'
import { estimateLatency, reportedLatencyMs } from './latencyMath'

/** Clicks per run, and the gap between them. */
const CLICK_COUNT = 16
const CLICK_GAP_S = 0.6
/** Lead-in before the first click, so the context has time to start. */
const LEAD_S = 0.3
/** How long to keep listening for taps after the last click. */
const TAIL_MS = 900
const MAX_MS = 1000

type Phase = 'idle' | 'running' | 'done'

interface Result {
  ms: number
  used: number
  spread: number
}

function audioContextCtor(): typeof AudioContext | null {
  const w = window as unknown as { webkitAudioContext?: typeof AudioContext }
  return window.AudioContext ?? w.webkitAudioContext ?? null
}

export function LatencyCalibration({
  initialMs,
  onSave,
  onClose,
}: {
  initialMs: number
  onSave: (ms: number) => void
  onClose: () => void
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [tapCount, setTapCount] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const [reported, setReported] = useState<number | null>(null)
  const [manual, setManual] = useState<string | null>(null)
  const [error, setError] = useState('')

  const ctxRef = useRef<AudioContext | null>(null)
  const clicksRef = useRef<number[]>([])
  const tapsRef = useRef<number[]>([])
  const timerRef = useRef<number | null>(null)
  const tapButtonRef = useRef<HTMLButtonElement | null>(null)
  const phaseRef = useRef<Phase>('idle')
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p
    setPhase(p)
  }

  const closeContext = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
    const ctx = ctxRef.current
    ctxRef.current = null
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined)
  }

  const finish = () => {
    timerRef.current = null
    const ctx = ctxRef.current
    setResult(estimateLatency(clicksRef.current, tapsRef.current))
    if (ctx) setReported(reportedLatencyMs(ctx))
    setPhaseBoth('done')
  }

  const start = async () => {
    setError('')
    setResult(null)
    setManual(null)
    setReported(null)
    closeContext()
    tapsRef.current = []
    setTapCount(0)
    const Ctor = audioContextCtor()
    if (!Ctor) {
      setError('这台浏览器不能播放测试声音，请换用 Chrome 或 Edge 再试。')
      return
    }
    try {
      const ctx = new Ctor()
      ctxRef.current = ctx
      // Resume inside the click handler so the browser allows sound.
      await ctx.resume()
      const perf0 = performance.now()
      const ctx0 = ctx.currentTime
      const clicks: number[] = []
      for (let i = 0; i < CLICK_COUNT; i++) {
        const t = ctx0 + LEAD_S + i * CLICK_GAP_S
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = 1000
        gain.gain.setValueAtTime(0, t)
        gain.gain.linearRampToValueAtTime(0.8, t + 0.002)
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.03)
        osc.connect(gain).connect(ctx.destination)
        osc.start(t)
        osc.stop(t + 0.04)
        // Expected time the click is heard by the page: excludes the device's output latency,
        // which is exactly what the taps are measuring.
        clicks.push(perf0 + (t - ctx0) * 1000)
      }
      clicksRef.current = clicks
      setPhaseBoth('running')
      const lastT = ctx0 + LEAD_S + (CLICK_COUNT - 1) * CLICK_GAP_S
      const delay = Math.max(0, (lastT - ctx.currentTime) * 1000 + TAIL_MS)
      timerRef.current = window.setTimeout(finish, delay)
    } catch {
      closeContext()
      setError('无法开始测试，请检查声音输出设备后再试。')
    }
  }

  const tap = () => {
    if (phaseRef.current !== 'running') return
    tapsRef.current = [...tapsRef.current, performance.now()]
    setTapCount(tapsRef.current.length)
  }

  // Focus the big button on open; Escape closes; Space taps while running.
  useEffect(() => {
    tapButtonRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.code === 'Space' && phaseRef.current === 'running') {
        if (e.repeat) return
        e.preventDefault()
        tap()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Release the audio context on unmount.
  useEffect(() => () => closeContext(), [])

  const shown = manual ?? String(result?.ms ?? initialMs)
  const save = () => {
    if (shown.trim() === '') return
    const n = Number(shown)
    if (!Number.isFinite(n)) return
    onSave(Math.min(MAX_MS, Math.max(0, Math.round(n))))
  }

  const running = phase === 'running'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="latency-cal-title"
        className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-5 text-foreground shadow-xl"
      >
        <h2 id="latency-cal-title" className="m-0 text-lg font-semibold">
          校准这台设备的声音延迟
        </h2>
        <p className="m-0 text-sm text-muted-foreground">
          戴上这台设备要用的耳机或连上音箱，听到“嗒”声时点下面的大按钮（或按空格），连续点 10 次左右。蓝牙耳机/音箱一般慢 150–300 毫秒，有线一般 0–50 毫秒。
        </p>

        <button
          ref={tapButtonRef}
          type="button"
          onPointerDown={tap}
          aria-label={running ? '听到嗒声时点这里' : '开始前此按钮无效'}
          className={cx(
            'flex min-h-[140px] w-full touch-manipulation select-none flex-col items-center justify-center gap-1 rounded-2xl text-xl font-semibold transition-colors',
            running
              ? 'bg-primary text-primary-foreground hover:bg-primary-strong active:opacity-80'
              : 'border border-border text-muted-foreground',
          )}
        >
          <span>{running ? '听到“嗒”就点' : '先点下面的「开始」'}</span>
          {running && <span className="text-sm font-normal opacity-80">已点 {tapCount} 次</span>}
        </button>

        {running && (
          <p className="m-0 text-sm text-muted-foreground" aria-live="polite">
            已点 {tapCount} 次，共 {CLICK_COUNT} 声。
          </p>
        )}

        {phase === 'done' && result && (
          <div className="space-y-2 text-sm" aria-live="polite">
            <p className="m-0 text-base font-medium">这台设备大约慢 {result.ms} 毫秒</p>
            {result.spread > 60 && (
              <p className="m-0 text-amber-600 dark:text-amber-400">点得不太稳，建议再测一次。</p>
            )}
            {reported !== null && (
              <p className="m-0 text-xs text-muted-foreground">
                浏览器报告的输出延迟：{reported} 毫秒（蓝牙常常报告不准）
              </p>
            )}
          </div>
        )}

        {phase === 'done' && !result && (
          <p className="m-0 text-sm text-amber-600 dark:text-amber-400">
            有效的点击太少，没能算出延迟。请戴好设备后重新测一次。
          </p>
        )}

        {error && <p className="m-0 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <label className="flex items-center gap-2 text-sm">
          <span className="shrink-0">延迟（毫秒）</span>
          <input
            type="number"
            min={0}
            max={MAX_MS}
            step={1}
            inputMode="numeric"
            value={shown}
            disabled={running}
            onChange={(e) => setManual(e.target.value)}
            aria-label="延迟毫秒数"
            className={cx(SELECT, 'w-28 tabular-nums')}
          />
          <span className="text-xs text-muted-foreground">0–1000，可手动修改</span>
        </label>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => void start()}
            disabled={running}
            className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm hover:border-foreground disabled:opacity-50"
          >
            {phase === 'idle' ? '开始' : '重新测'}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={running || shown.trim() === ''}
            className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-strong disabled:opacity-50"
          >
            保存
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm text-muted-foreground hover:text-foreground"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
