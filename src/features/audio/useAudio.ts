import { useCallback, useEffect, useRef, useState } from 'react'
import * as engine from '@/audio/engine'
import type { DrillQuestion } from '@/drills/types'

/**
 * Playback helpers for a drill question. Returns `play()` which schedules the
 * question's audio and reports when it finishes, plus an `isPlaying` flag for
 * the UI. All timing is in AudioContext seconds.
 */
export function useQuestionPlayer() {
  const [isPlaying, setPlaying] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const finishAt = useCallback((endAt: number) => {
    const ms = Math.max(0, (endAt - engine.now()) * 1000)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setPlaying(false), ms + 60)
  }, [])

  const play = useCallback(
    async (q: DrillQuestion) => {
      await engine.ensureAudio()
      engine.stopAll()
      setPlaying(true)
      const events = eventsFor(q)
      const { endAt } = engine.playSequence(events)
      finishAt(endAt)
    },
    [finishAt],
  )

  const playNotes = useCallback(
    async (midis: readonly number[], mode: 'together' | 'sequence' = 'sequence') => {
      await engine.ensureAudio()
      setPlaying(true)
      const events: engine.NoteEvent[] =
        mode === 'together'
          ? midis.map((m) => ({ midi: m, duration: 1.4, at: 0 }))
          : midis.map((m, i) => ({ midi: m, duration: 0.55, at: i * 0.45 }))
      const { endAt } = engine.playSequence(events)
      finishAt(endAt)
    },
    [finishAt],
  )

  return { play, playNotes, isPlaying }
}

/** Build the audio events that present a question. */
export function eventsFor(q: DrillQuestion): engine.NoteEvent[] {
  switch (q.kind) {
    case 'pitch_compare':
      return [
        { midi: q.a.midi, detuneCents: q.a.detuneCents, duration: 0.9, at: 0 },
        { midi: q.b.midi, detuneCents: q.b.detuneCents, duration: 0.9, at: 1.1 },
      ]
    case 'interval':
      if (q.direction === 'harmonic') {
        return [
          { midi: q.root, duration: 1.6, at: 0 },
          { midi: q.second, duration: 1.6, at: 0 },
        ]
      }
      return [
        { midi: q.root, duration: 0.8, at: 0 },
        { midi: q.second, duration: 1.0, at: 0.85 },
      ]
    case 'degree': {
      const events: engine.NoteEvent[] = []
      q.cadence.forEach((chord, i) => {
        for (const m of chord) events.push({ midi: m, duration: 0.7, at: i * 0.72, velocity: 0.65 })
      })
      const start = q.cadence.length * 0.72 + 0.45
      q.notes.forEach((m, i) => events.push({ midi: m, duration: 0.9, at: start + i * 0.8 }))
      return events
    }
    case 'scale':
      return q.notes.map((m, i) => ({ midi: m, duration: 0.42, at: i * 0.34 }))
    case 'chord':
    case 'chord_inversion': {
      // Block chord, then a quick arpeggio so inner voices are audible.
      const events: engine.NoteEvent[] = q.notes.map((m) => ({ midi: m, duration: 1.5, at: 0 }))
      q.notes.forEach((m, i) => events.push({ midi: m, duration: 0.5, at: 1.7 + i * 0.3, velocity: 0.7 }))
      return events
    }
    case 'rhythm_tap':
    case 'rhythm_echo':
    case 'rhythm_read':
      // Rhythm questions schedule their own clicks (see RhythmPad).
      return []
    case 'progression':
      return q.chords.flatMap((chord, i) => chord.map((m, j) => ({ midi: m, duration: 1.05, at: i * 1.15, velocity: j === 0 ? 0.85 : 0.7 })))
    case 'bassline': {
      const events: engine.NoteEvent[] = q.keyChord.map((m) => ({ midi: m, duration: 1.2, at: 0, velocity: 0.6 }))
      const beat = 0.6
      let t = 1.7
      for (const n of q.notes) {
        events.push({ midi: n.midi, duration: n.beats * beat * 0.9, at: t, velocity: 1 })
        t += n.beats * beat
      }
      return events
    }
    case 'dictation': {
      const events: engine.NoteEvent[] = q.keyChord.map((m) => ({ midi: m, duration: 1, at: 0, velocity: 0.6 }))
      const beat = 0.75
      let t = 1.5
      for (const n of q.melody) {
        events.push({ midi: n.midi, duration: n.beats * beat * 0.9, at: t })
        t += n.beats * beat
      }
      return events
    }
    case 'rhythm_choice': {
      const beat = 60 / q.bpm
      const events: engine.NoteEvent[] = []
      // Four count-in ticks, then the rhythm on a higher pitch.
      for (let i = 0; i < 4; i++) events.push({ midi: 72, duration: 0.05, at: i * beat, velocity: 0.5 })
      const answer = q.options.find((o) => o.id === q.answer)!
      answer.bars.forEach((bar, b) => {
        for (const onset of bar) events.push({ midi: 84, duration: 0.1, at: (4 + b * q.beatsPerBar + onset) * beat, velocity: 1 })
      })
      return events
    }
    case 'perform':
    case 'note_name':
    case 'theory':
      // Performance questions play their own reference; reading questions are silent.
      return []
  }
}
