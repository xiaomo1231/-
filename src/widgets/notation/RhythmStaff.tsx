import { useEffect, useRef } from 'react'
import { Formatter, Renderer, Stave, StaveNote, Tuplet, Voice, Beam, Dot } from 'vexflow'
import { cn } from '@/shared/lib/utils'
import { figuresFromOnsets } from './rhythmFigures'

export interface RhythmStaffProps {
  /** Onsets in beats within one 4/4 bar. */
  onsets: readonly number[]
  beats?: number
  /** Index of the onset currently sounding, for the playback cursor. */
  activeIndex?: number | null
  className?: string
  width?: number
}

/** Single-line rhythm staff rendered with VexFlow. */
export function RhythmStaff({ onsets, beats = 4, activeIndex = null, className, width = 460 }: RhythmStaffProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = ''
    const renderer = new Renderer(el, Renderer.Backends.SVG)
    const height = 110
    const scale = 1.5
    renderer.resize(width * scale, height * scale)
    const ctx = renderer.getContext()
    ctx.scale(scale, scale)
    const fg = 'currentColor'
    ctx.setFillStyle(fg)
    ctx.setStrokeStyle(fg)

    const stave = new Stave(8, 10, width - 16, { num_lines: 1 })
    stave.addClef('percussion').addTimeSignature(`${beats}/4`)
    stave.setContext(ctx).draw()

    const figures = figuresFromOnsets(onsets, beats)
    const notes: StaveNote[] = []
    let onsetCursor = 0
    const tupletBuckets: StaveNote[][] = []
    let currentTuplet: StaveNote[] = []
    let tupletBeats = 0

    for (const f of figures) {
      const note = new StaveNote({
        keys: ['b/4'],
        duration: f.rest ? `${f.duration}r` : f.duration,
        clef: 'percussion',
      })
      for (let d = 0; d < f.dots; d++) Dot.buildAndAttach([note], { all: true })
      if (!f.rest) {
        if (onsetCursor === activeIndex) note.setStyle({ fillStyle: 'hsl(var(--amber))', strokeStyle: 'hsl(var(--amber))' })
        onsetCursor++
      }
      notes.push(note)
      if (f.tupletGroup) {
        currentTuplet.push(note)
        tupletBeats += f.beats
        if (Math.abs(tupletBeats - 1) < 0.01) {
          tupletBuckets.push(currentTuplet)
          currentTuplet = []
          tupletBeats = 0
        }
      }
    }

    const voice = new Voice({ num_beats: beats, beat_value: 4 }).setStrict(false)
    voice.addTickables(notes)
    const beams = Beam.generateBeams(notes.filter((n) => !n.isRest()))
    new Formatter().joinVoices([voice]).format([voice], width - 90)
    voice.draw(ctx, stave)
    beams.forEach((b) => b.setContext(ctx).draw())
    tupletBuckets.forEach((group) => {
      if (group.length > 1) new Tuplet(group, { num_notes: 3, notes_occupied: 2 }).setContext(ctx).draw()
    })
  }, [onsets, beats, activeIndex, width])

  return <div ref={ref} className={cn('flex justify-center text-foreground [&_svg]:h-auto [&_svg]:max-w-full', className)} aria-label="节奏谱" />
}
