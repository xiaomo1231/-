import { useEffect, useMemo, useRef } from 'react'
import { eqCurve, logFreqs } from '@/songs/mixPresets'
import type { EqBand, MixSettings } from '@/songs/singTypes'
import { DB_RANGE, dbToY, fitBands, freqToX, xToFreq, yToDb } from './mixUtils'

/** A CSS colour (theme variables allowed) resolved to rgb() for canvas. */
function resolve(value: string): string {
  const el = document.createElement('span')
  el.style.color = value
  el.style.display = 'none'
  document.body.appendChild(el)
  const c = getComputedStyle(el).color
  el.remove()
  return c
}

const CURVE_FREQS = logFreqs(160)
const LABEL_FREQS: Array<[number, string]> = [
  [50, '50'],
  [100, '100'],
  [200, '200'],
  [500, '500'],
  [1000, '1k'],
  [2000, '2k'],
  [5000, '5k'],
  [10000, '10k'],
]
const SPEC_MIN_DB = -90
const SPEC_MAX_DB = -20
const BAND_GAIN_LIMIT = 15
const HANDLE_HIT_PX = 16
const PAD_BOTTOM = 18

export interface EqCurveProps {
  vocal: MixSettings['vocal']
  /** Voice meter analyser; drawn as a live spectrum behind the curve while `live`. */
  analyser: AnalyserNode | null
  live: boolean
  onBandsChange: (bands: EqBand[]) => void
}

export function EqCurve({ vocal, analyser, live, onBandsChange }: EqCurveProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const latest = useRef({ vocal, onBandsChange })
  latest.current = { vocal, onBandsChange }
  const bands = useMemo(() => fitBands(vocal.eq.bands), [vocal.eq.bands])
  const response = useMemo(() => eqCurve(vocal, CURVE_FREQS), [vocal])
  const dragging = useRef<number | null>(null)

  const plotSize = (cv: HTMLCanvasElement) => ({
    w: cv.clientWidth,
    h: cv.clientHeight - PAD_BOTTOM,
  })

  // Draw: static grid + curve + handles; spectrum is redrawn every frame while live.
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    let raf = 0
    const colors = {
      grid: resolve('hsl(var(--border))'),
      label: resolve('hsl(var(--muted-foreground))'),
      curve: resolve('hsl(var(--amber))'),
      spectrum: resolve('hsl(var(--cyan) / 0.22)'),
      handle: resolve('hsl(var(--cyan))'),
      zero: resolve('hsl(var(--muted-foreground) / 0.6)'),
    }
    const spectrum = analyser ? new Float32Array(analyser.frequencyBinCount) : null

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const cssW = cv.clientWidth
      const cssH = cv.clientHeight
      if (cv.width !== Math.round(cssW * dpr)) cv.width = Math.round(cssW * dpr)
      if (cv.height !== Math.round(cssH * dpr)) cv.height = Math.round(cssH * dpr)
      const g = cv.getContext('2d')
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, cssW, cssH)
      const { w, h } = plotSize(cv)

      // Grid: dB lines and frequency lines.
      g.font = '11px system-ui, sans-serif'
      g.strokeStyle = colors.grid
      g.fillStyle = colors.label
      g.lineWidth = 1
      for (const db of [-12, -6, 0, 6, 12]) {
        const y = Math.round(dbToY(db, h)) + 0.5
        g.globalAlpha = db === 0 ? 1 : 0.5
        g.beginPath()
        g.moveTo(0, y)
        g.lineTo(w, y)
        g.stroke()
        g.globalAlpha = 1
        g.fillText(`${db > 0 ? '+' : ''}${db}`, 4, y - 3)
      }
      for (const [f, label] of LABEL_FREQS) {
        const x = Math.round(freqToX(f, w)) + 0.5
        g.globalAlpha = 0.4
        g.beginPath()
        g.moveTo(x, 0)
        g.lineTo(x, h)
        g.stroke()
        g.globalAlpha = 1
        g.fillText(label, x + 3, h + 13)
      }

      // Live spectrum (voice after processing).
      if (analyser && spectrum && live) {
        analyser.getFloatFrequencyData(spectrum as Float32Array<ArrayBuffer>)
        const binHz = analyser.context.sampleRate / analyser.fftSize
        g.beginPath()
        g.moveTo(0, h)
        for (let x = 0; x <= w; x += 2) {
          const bin = Math.min(spectrum.length - 1, Math.max(1, Math.round(xToFreq(x, w) / binHz)))
          const db = spectrum[bin] ?? SPEC_MIN_DB
          const t = Math.min(1, Math.max(0, (db - SPEC_MIN_DB) / (SPEC_MAX_DB - SPEC_MIN_DB)))
          g.lineTo(x, h - t * h)
        }
        g.lineTo(w, h)
        g.closePath()
        g.fillStyle = colors.spectrum
        g.fill()
      }

      // Response curve.
      g.beginPath()
      CURVE_FREQS.forEach((f, i) => {
        const x = freqToX(f, w)
        const y = dbToY(response[i] ?? 0, h)
        if (i === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      })
      g.strokeStyle = colors.curve
      g.lineWidth = 2
      g.stroke()

      // Band handles.
      bands.forEach((b, i) => {
        const x = freqToX(b.freq, w)
        const y = dbToY(b.gainDb, h)
        g.globalAlpha = latest.current.vocal.eq.on ? 1 : 0.4
        g.beginPath()
        g.arc(x, y, 7, 0, Math.PI * 2)
        g.fillStyle = colors.handle
        g.fill()
        g.fillStyle = colors.zero
        g.fillText(String(i + 1), x + 9, y - 6)
        g.globalAlpha = 1
      })
    }

    const loop = () => {
      draw()
      if (live && analyser) raf = requestAnimationFrame(loop)
    }
    loop()
    const onResize = () => draw()
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
    }
    // `bands` and `response` are derived from `vocal`; redraw whenever they change.
  }, [analyser, live, bands, response])

  // Pointer drag (freq + gain) and wheel (Q). Wheel uses a native listener so it can be non-passive.
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return

    const pointerPos = (e: { clientX: number; clientY: number }) => {
      const r = cv.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const nearest = (x: number, y: number): number | null => {
      const { w, h } = plotSize(cv)
      let best: number | null = null
      let bestD = HANDLE_HIT_PX
      fitBands(latest.current.vocal.eq.bands).forEach((b, i) => {
        const d = Math.hypot(freqToX(b.freq, w) - x, dbToY(b.gainDb, h) - y)
        if (d < bestD) {
          bestD = d
          best = i
        }
      })
      return best
    }
    const setBand = (index: number, patch: Partial<EqBand>) => {
      const next = fitBands(latest.current.vocal.eq.bands).map((b, i) =>
        i === index ? { ...b, ...patch } : { ...b },
      )
      latest.current.onBandsChange(next)
    }

    const onDown = (e: PointerEvent) => {
      const { x, y } = pointerPos(e)
      const idx = nearest(x, y)
      if (idx === null) return
      dragging.current = idx
      cv.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      const idx = dragging.current
      if (idx === null) return
      const { x, y } = pointerPos(e)
      const { w, h } = plotSize(cv)
      const freq = Math.round(xToFreq(x, w) * 10) / 10
      const gain = Math.round(yToDb(y, h) * 10) / 10
      setBand(idx, {
        freq: Math.min(20000, Math.max(20, freq)),
        gainDb: Math.min(BAND_GAIN_LIMIT, Math.max(-BAND_GAIN_LIMIT, gain)),
      })
    }
    const onUp = (e: PointerEvent) => {
      if (dragging.current === null) return
      dragging.current = null
      if (cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId)
    }
    const onWheel = (e: WheelEvent) => {
      const { x, y } = pointerPos(e)
      const idx = nearest(x, y)
      if (idx === null) return
      e.preventDefault()
      const b = fitBands(latest.current.vocal.eq.bands)[idx]!
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      setBand(idx, { q: Math.min(10, Math.max(0.1, Math.round(b.q * factor * 100) / 100)) })
    }

    cv.addEventListener('pointerdown', onDown)
    cv.addEventListener('pointermove', onMove)
    cv.addEventListener('pointerup', onUp)
    cv.addEventListener('pointercancel', onUp)
    cv.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      cv.removeEventListener('pointerdown', onDown)
      cv.removeEventListener('pointermove', onMove)
      cv.removeEventListener('pointerup', onUp)
      cv.removeEventListener('pointercancel', onUp)
      cv.removeEventListener('wheel', onWheel)
    }
  }, [])

  return (
    <div className="space-y-1.5">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`均衡曲线：${bands.map((b, i) => `第 ${i + 1} 段 ${Math.round(b.freq)} Hz ${b.gainDb > 0 ? '+' : ''}${b.gainDb} dB`).join('，')}。可拖动圆点调整频率和增益，滚轮调整 Q 值。`}
        className="h-56 w-full touch-none select-none rounded-xl bg-muted/40"
        style={{ cursor: 'crosshair' }}
      />
      <p className="text-xs text-muted-foreground">
        拖动圆点改变频率（左右）和增益（上下）；在圆点上滚动鼠标调整 Q 值（越大越窄）。
      </p>
      <span className="sr-only">增益范围 ±{DB_RANGE} dB</span>
    </div>
  )
}
