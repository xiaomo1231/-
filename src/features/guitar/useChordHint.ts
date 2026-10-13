import { useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import { inputManager } from '@/audio/input/inputManager'
import { chromaFromSpectrum, matchChord, type ChordHint } from '@/audio/chroma'

/**
 * Chord-recognition hint on the dry input: a long FFT every 100 ms, folded
 * into a chroma averaged over the last few frames. A hint only, never scored.
 */
export function useChordHint(enabled: boolean): { hint: ChordHint | null; latest: () => ChordHint | null } {
  const [hint, setHint] = useState<ChordHint | null>(null)
  const latest = useRef<ChordHint | null>(null)

  useEffect(() => {
    if (!enabled) return
    let release: (() => void) | null = null
    let analyser: AnalyserNode | null = null
    let timer: ReturnType<typeof setInterval> | null = null
    let alive = true
    const history: number[][] = []
    void (async () => {
      try {
        release = await inputManager.acquire('instrument')
      } catch {
        return
      }
      if (!alive) {
        release()
        return
      }
      const ctx = Tone.getContext().rawContext as AudioContext
      analyser = ctx.createAnalyser()
      analyser.fftSize = 16384
      analyser.smoothingTimeConstant = 0
      inputManager.bus.connect(analyser)
      const buf = new Float32Array(analyser.frequencyBinCount)
      timer = setInterval(() => {
        if (!analyser) return
        analyser.getFloatFrequencyData(buf)
        const chroma = chromaFromSpectrum(buf, ctx.sampleRate, analyser.fftSize)
        history.push(chroma)
        if (history.length > 3) history.shift()
        const avg = chroma.map((_, i) => history.reduce((s, h) => s + h[i]!, 0) / history.length)
        const h = matchChord(avg)
        const shown = h && h.score > 0.6 && h.confidence > 0.03 ? h : null
        latest.current = shown
        setHint((prev) => (prev?.label === shown?.label ? prev : shown))
      }, 100)
    })()
    return () => {
      alive = false
      if (timer) clearInterval(timer)
      if (analyser) {
        try {
          inputManager.bus.disconnect(analyser)
        } catch {
          // already disconnected
        }
      }
      release?.()
      latest.current = null
      setHint(null)
    }
  }, [enabled])

  return { hint, latest: () => latest.current }
}
