import { useEffect, useRef } from 'react'
import { Formatter, GhostNote, Renderer, TabNote, TabStave, Voice, type Note } from 'vexflow'
import { BASS_STANDARD, GUITAR_STANDARD, fingerMelody, type Tuning } from '@/music/fretboard'
import type { Event } from '@/music/score'
import { resolvedBackground } from './background'

export interface TabViewProps {
  events: readonly Event[]
  instrument: 'guitar' | 'bass'
  chords?: ReadonlyArray<{ start: number; text: string }>
  activeEvent?: number | null
  className?: string
  /** Guitar tuning with capo applied (defaults to standard). */
  tuning?: Tuning
  capo?: number
}

const DURATION: Record<string, string> = {
  '4': 'w',
  '3': 'hd',
  '2': 'h',
  '1.5': 'qd',
  '1': 'q',
  '0.75': '8d',
  '0.5': '8',
  '0.25': '16',
}

const BARS_PER_LINE = 4

/**
 * Six-line (guitar) or four-line (bass) tab with rhythm stems, drawn from the
 * same score events as the staff. Fret positions come from the box-fingering
 * search, so a melody stays in one hand position where possible.
 */
export function TabView({ events, instrument, chords = [], activeEvent = null, className, tuning: guitarTuning, capo = 0 }: TabViewProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = ''
    const tuning = instrument === 'bass' ? BASS_STANDARD : (guitarTuning ?? GUITAR_STANDARD)
    const strings = tuning.strings.length
    const notes = events.filter((e) => e.midi !== null)
    // Bass tab is written an octave lower than the melody when the melody is high.
    const shift = instrument === 'bass' ? -12 * Math.max(0, Math.round((Math.min(...notes.map((n) => n.midi!), 60) - 43) / 12)) : 0
    const positions = fingerMelody(notes.map((e) => e.midi! + shift), tuning, 15)
    const posByEvent = new Map<Event, (typeof positions)[number]>()
    notes.forEach((e, i) => posByEvent.set(e, positions[i] ?? null))

    const totalBars = Math.max(1, Math.ceil((events.reduce((m, e) => Math.max(m, e.start + e.beats), 0) - 1e-6) / 4))
    const lineCount = Math.ceil(totalBars / BARS_PER_LINE)
    const width = 760
    const lineH = 30 + strings * 13 + 50
    const scale = 1.25
    const renderer = new Renderer(el, Renderer.Backends.SVG)
    renderer.resize(width * scale, lineCount * lineH * scale + 10)
    const ctx = renderer.getContext()
    ctx.scale(scale, scale)
    ctx.setFillStyle('currentColor')
    ctx.setStrokeStyle('currentColor')
    ctx.setBackgroundFillStyle(resolvedBackground(el))

    for (let line = 0; line < lineCount; line++) {
      const firstBar = line * BARS_PER_LINE
      const barsHere = Math.min(BARS_PER_LINE, totalBars - firstBar)
      let x = 10
      for (let b = 0; b < barsHere; b++) {
        const bar = firstBar + b
        const w = (width - 30) / BARS_PER_LINE
        const stave = new TabStave(x, line * lineH + 20, w, { num_lines: strings })
        if (b === 0) stave.addClef('tab')
        stave.setContext(ctx).draw()
        const barEvents = events.filter((e) => Math.floor(e.start / 4 + 1e-6) === bar)
        const vfNotes: Note[] = barEvents.map((e) => {
          const dur = DURATION[String(e.beats)] ?? 'q'
          if (e.midi === null) return new GhostNote(dur)
          const p = posByEvent.get(e)
          if (!p) return new GhostNote(dur)
          const n = new TabNote({ positions: [{ str: strings - p.string, fret: p.fret }], duration: dur }, true)
          if (events.indexOf(e) === activeEvent) n.setStyle({ fillStyle: 'hsl(36 96% 60%)', strokeStyle: 'hsl(36 96% 60%)' })
          return n
        })
        if (vfNotes.length) {
          const voice = new Voice({ num_beats: 4, beat_value: 4 }).setStrict(false)
          voice.addTickables(vfNotes)
          new Formatter().joinVoices([voice]).format([voice], w - (b === 0 ? 50 : 20))
          voice.draw(ctx, stave)
        }
        // Chord names above the bar, positioned by beat.
        const startX = stave.getNoteStartX()
        const endX = stave.getNoteEndX()
        for (const c of chords) {
          if (Math.floor(c.start / 4 + 1e-6) !== bar) continue
          ctx.save()
          ctx.setFont('Space Grotesk, sans-serif', 12, 'bold')
          ctx.setFillStyle('hsl(186 90% 56%)')
          ctx.fillText(c.text, startX + ((c.start - bar * 4) / 4) * (endX - startX), line * lineH + 26)
          ctx.restore()
        }
        x += w
      }
    }
  }, [events, instrument, chords, activeEvent, guitarTuning])

  return (
    <div className={className}>
      {instrument === 'guitar' && (capo > 0 || (guitarTuning && guitarTuning.strings[0] !== GUITAR_STANDARD.strings[0])) && <div className="mb-1 text-center text-xs text-amber">{guitarTuning?.name}</div>}
      <div ref={ref} className="flex justify-center overflow-x-auto text-foreground [&_svg]:h-auto [&_svg]:max-w-full" role="img" aria-label={instrument === 'bass' ? '四线谱' : '六线谱'} />
    </div>
  )
}
