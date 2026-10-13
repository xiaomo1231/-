import { useEffect, useRef, useState } from 'react'
import { karaokeState, lineEnd, type KaraokeState } from '@/songs/lyrics'
import type { LyricLine } from '@/songs/singTypes'

interface LyricsDisplayProps {
  lines: LyricLine[]
  /** Current playback position in the recording, ms. Read every animation frame. */
  positionMs: () => number
  /** Always show this line (for looping a phrase) with progress measured inside it. */
  lockLine?: number
}

/** Progress steps smaller than this (0–1) do not cause a React update. */
const PROGRESS_STEP = 0.01

interface View {
  index: number
  progress: number
}

/** Karaoke state of the locked line: progress inside that line only. */
function stateAt(lines: LyricLine[], ms: number, lockLine: number | undefined): KaraokeState {
  const line = lockLine === undefined ? undefined : lines[lockLine]
  if (lockLine === undefined || !line) return karaokeState(lines, ms)
  const local: LyricLine = {
    startMs: 0,
    text: line.text,
    endMs: lineEnd(lines, lockLine) - line.startMs,
  }
  if (line.words?.length) local.words = line.words.map((w) => ({ startMs: w.startMs - line.startMs, text: w.text }))
  return { ...karaokeState([local], ms - line.startMs), index: lockLine }
}

/** Sung part in amber, the rest muted, split at `progress`. */
function Sung({ text, progress }: { text: string; progress: number }) {
  const pct = Math.round(progress * 100)
  return (
    <span
      className="bg-clip-text text-transparent"
      style={{
        backgroundImage: `linear-gradient(to right, hsl(var(--amber)) ${pct}%, hsl(var(--muted-foreground)) ${pct}%)`,
      }}
    >
      {text}
    </span>
  )
}

/**
 * K-song style lyric display: the current line large with its sung part
 * coloured, the next line small below. Driven by requestAnimationFrame; React
 * only re-renders when the line or the progress moves by at least 1%.
 */
export function LyricsDisplay({ lines, positionMs, lockLine }: LyricsDisplayProps) {
  const [view, setView] = useState<View>({ index: -1, progress: 0 })
  const readRef = useRef(positionMs)
  useEffect(() => {
    readRef.current = positionMs
  }, [positionMs])

  useEffect(() => {
    if (!lines.length) return
    let raf = 0
    let last: View | null = null
    const tick = () => {
      const s = stateAt(lines, readRef.current(), lockLine)
      const changed =
        !last ||
        s.index !== last.index ||
        Math.abs(s.progress - last.progress) >= PROGRESS_STEP ||
        ((s.progress === 0 || s.progress === 1) && s.progress !== last.progress)
      if (changed) {
        last = { index: s.index, progress: s.progress }
        setView(last)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [lines, lockLine])

  if (!lines.length) return null

  const current = view.index >= 0 ? lines[view.index] : undefined
  const next = lines[view.index < 0 ? 0 : view.index + 1]

  return (
    <div className="space-y-2 text-center">
      <p aria-live="polite" className="min-h-[2.75rem] text-2xl font-semibold leading-snug">
        {current ? <Sung text={current.text} progress={view.progress} /> : <span className="text-muted-foreground">…</span>}
      </p>
      {current?.translation && <p className="-mt-1 text-sm text-muted-foreground">{current.translation}</p>}
      {next && <p className="text-sm text-muted-foreground">{next.text}</p>}
    </div>
  )
}
