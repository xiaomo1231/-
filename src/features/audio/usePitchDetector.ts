import { useCallback, useEffect, useRef, useState } from 'react'
import { detector, type DetectorPreset } from '@/audio/pitch/detector'
import type { PitchFrame } from '@/audio/pitch/analysis'

export type MicState = 'idle' | 'starting' | 'live' | 'error'

/**
 * Starts the shared microphone detector while the component is mounted and
 * exposes the latest frame (throttled to animation frames) plus a recorder
 * for takes. The detector is stopped on unmount.
 */
export function usePitchDetector(preset: DetectorPreset, autoStart = false) {
  const [state, setState] = useState<MicState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [frame, setFrame] = useState<PitchFrame | null>(null)
  const recording = useRef<PitchFrame[] | null>(null)
  const latest = useRef<PitchFrame | null>(null)
  const raf = useRef(0)

  const start = useCallback(async () => {
    setState('starting')
    setError(null)
    try {
      await detector.start(preset)
      setState('live')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setState('error')
    }
  }, [preset])

  useEffect(() => {
    const off = detector.onFrame((f) => {
      latest.current = f
      recording.current?.push(f)
    })
    const loop = () => {
      if (latest.current) setFrame(latest.current)
      raf.current = requestAnimationFrame(loop)
    }
    raf.current = requestAnimationFrame(loop)
    return () => {
      off()
      cancelAnimationFrame(raf.current)
    }
  }, [])

  useEffect(() => {
    if (autoStart) void start()
    return () => detector.stop()
  }, [autoStart, start])

  /** Begin collecting frames; returns a function that stops and hands them back. */
  const record = useCallback(() => {
    recording.current = []
    return () => {
      const frames = recording.current ?? []
      recording.current = null
      return frames
    }
  }, [])

  /** Frames recorded so far, without stopping. */
  const peek = useCallback(() => [...(recording.current ?? [])], [])

  return { state, error, frame, start, record, peek }
}
