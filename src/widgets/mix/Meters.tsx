import { useEffect, useRef } from 'react'
import type { MixGraph } from '@/audio/sing/mixChain'
import { formatDb, peakDb, rmsDb } from './mixUtils'

const FLOOR_DB = -60
const PEAK_FALL_DB_PER_S = 12
const PEAK_HOLD_MS = 1200

const CHANNELS: Array<{ key: keyof MixGraph['meters']; label: string; bar: string }> = [
  { key: 'voice', label: '人声', bar: 'bg-amber' },
  { key: 'backing', label: '伴奏', bar: 'bg-cyan' },
  { key: 'master', label: '总输出', bar: 'bg-primary' },
]

const toPercent = (db: number) => Math.min(100, Math.max(0, ((db - FLOOR_DB) / -FLOOR_DB) * 100))

export interface MetersProps {
  /** Read every animation frame, so the graph can appear after the first play. */
  getMeters: () => MixGraph['meters'] | null
  /** Compressor gain reduction in dB (≤ 0). */
  getReduction: () => number
}

/**
 * Three vertical RMS meters with peak hold (人声 / 伴奏 / 总输出) and the
 * compressor's gain-reduction readout. Values are written straight to the DOM
 * each frame to avoid re-rendering React at 60 fps.
 */
export function Meters({ getMeters, getReduction }: MetersProps): JSX.Element {
  const fillRefs = useRef<Array<HTMLDivElement | null>>([])
  const peakRefs = useRef<Array<HTMLDivElement | null>>([])
  const readRefs = useRef<Array<HTMLSpanElement | null>>([])
  const reduceBar = useRef<HTMLDivElement | null>(null)
  const reduceText = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const holds = CHANNELS.map(() => ({ db: -120, at: 0 }))
    const buffers = new Map<number, Float32Array<ArrayBuffer>>()

    const frame = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      const meters = getMeters()
      CHANNELS.forEach((ch, i) => {
        const node = meters?.[ch.key]
        let rms = -120
        let peak = -120
        if (node) {
          let buf = buffers.get(i)
          if (!buf || buf.length !== node.fftSize) {
            buf = new Float32Array(node.fftSize)
            buffers.set(i, buf)
          }
          node.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>)
          rms = rmsDb(buf)
          peak = peakDb(buf)
        }
        const hold = holds[i]!
        if (peak >= hold.db) {
          hold.db = peak
          hold.at = now
        } else if (now - hold.at > PEAK_HOLD_MS) {
          hold.db = Math.max(peak, hold.db - PEAK_FALL_DB_PER_S * dt)
        }
        const fill = fillRefs.current[i]
        if (fill) fill.style.height = `${toPercent(rms)}%`
        const mark = peakRefs.current[i]
        if (mark) mark.style.bottom = `${toPercent(hold.db)}%`
        const read = readRefs.current[i]
        if (read) read.textContent = rms <= -119 ? '—' : formatDb(rms)
      })
      const red = getReduction()
      if (reduceBar.current)
        reduceBar.current.style.width = `${Math.min(100, Math.max(0, (-red / 20) * 100))}%`
      if (reduceText.current) reduceText.current.textContent = red < -0.05 ? formatDb(red) : '0 dB'
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [getMeters, getReduction])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-44 justify-around gap-3">
        {CHANNELS.map((ch, i) => (
          <div key={ch.key} className="flex w-12 flex-col items-center gap-1.5">
            <div className="relative h-36 w-full overflow-hidden rounded-md bg-muted">
              <div
                ref={(el) => {
                  fillRefs.current[i] = el
                }}
                className={`absolute bottom-0 left-0 right-0 ${ch.bar} opacity-80`}
                style={{ height: '0%' }}
              />
              <div
                ref={(el) => {
                  peakRefs.current[i] = el
                }}
                className="absolute left-0 right-0 h-0.5 bg-foreground/80"
                style={{ bottom: '0%' }}
              />
            </div>
            <span className="text-[11px] text-muted-foreground">{ch.label}</span>
            <span
              ref={(el) => {
                readRefs.current[i] = el
              }}
              className="font-mono text-[11px] tabular-nums text-muted-foreground"
            >
              —
            </span>
          </div>
        ))}
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>压缩增益衰减</span>
          <span ref={reduceText} className="font-mono tabular-nums">
            0 dB
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            ref={reduceBar}
            className="h-full bg-amber transition-[width] duration-75"
            style={{ width: '0%' }}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          条越长，压缩器压得越重。人声偶尔压下 2–4 dB 通常比较自然。
        </p>
      </div>
    </div>
  )
}
