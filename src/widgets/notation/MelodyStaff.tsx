import { useEffect, useRef } from 'react'
import { Accidental, Annotation, AnnotationVerticalJustify, Barline, Dot, Formatter, Renderer, Stave, StaveNote, Voice, Beam } from 'vexflow'
import { spell, vexKey, type SpelledNote } from '@/music/spelling'
import { cn } from '@/shared/lib/utils'

export interface StaffNote {
  /** MIDI, or null for a rest. */
  midi: number | null
  /** Beats (quarter = 1). */
  beats: number
  /** Explicit spelling (overrides key-based spelling). */
  spelled?: SpelledNote
  /** Lyric syllable under the note. */
  lyric?: string
}

export interface MelodyStaffProps {
  notes: readonly StaffNote[]
  clef?: 'treble' | 'bass'
  /** Major-key tonic for spelling and the key signature. */
  keyTonic?: number
  showKeySignature?: boolean
  timeSignature?: string | null
  /** Note index drawn in the highlight colour (playback cursor). */
  activeIndex?: number | null
  /** Per-note colour overrides: 'ok' | 'bad' | 'muted'. */
  marks?: ReadonlyArray<'ok' | 'bad' | 'muted' | undefined>
  /** Pixel width before scaling. */
  width?: number
  scale?: number
  className?: string
  /** Chord names above the staff, positioned by beat from the start. */
  chords?: ReadonlyArray<{ start: number; text: string }>
}

const DURATION: Record<string, [string, number]> = {
  '4': ['w', 0],
  '3': ['h', 1],
  '2': ['h', 0],
  '1.5': ['q', 1],
  '1': ['q', 0],
  '0.75': ['8', 1],
  '0.5': ['8', 0],
  '0.25': ['16', 0],
}

const COLOR: Record<'ok' | 'bad' | 'muted' | 'active', string> = {
  ok: 'hsl(152 58% 48%)',
  bad: 'hsl(0 72% 58%)',
  muted: 'hsl(220 10% 55%)',
  active: 'hsl(36 96% 60%)',
}

/**
 * Melody on a single staff with automatic bar lines (4/4). Accidentals come
 * from the key: notes inside the key signature are drawn without a sign;
 * chromatic notes get one. Rendering only — playback lives in the caller.
 */
export function MelodyStaff({
  notes,
  clef = 'treble',
  keyTonic = 60,
  showKeySignature = true,
  timeSignature = '4/4',
  activeIndex = null,
  marks,
  width,
  scale = 1.35,
  className,
  chords,
}: MelodyStaffProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = ''
    if (notes.length === 0) return

    // Split into bars of 4 beats.
    const bars: Array<Array<{ n: StaffNote; index: number }>> = [[]]
    let acc = 0
    notes.forEach((n, index) => {
      if (acc >= 4 - 1e-6) {
        bars.push([])
        acc = 0
      }
      bars[bars.length - 1]!.push({ n, index })
      acc += n.beats
    })

    const keySpelled = spell(keyTonic, { keyTonic })
    const keySig = `${keySpelled.letter}${keySpelled.accidental}`
    const keyPcs = new Set([0, 2, 4, 5, 7, 9, 11].map((s) => (keyTonic + s) % 12))
    const firstExtra = 40 + (showKeySignature ? 40 : 0) + (timeSignature ? 25 : 0)
    const perBar = Math.max(170, notes.length <= 2 ? 120 : 0)
    const barWidths = bars.map((b, i) => Math.max(perBar, 60 + b.length * 34) + (i === 0 ? firstExtra : 0))
    const totalW = width ?? barWidths.reduce((s, w) => s + w, 0) + 20
    const hasLyrics = notes.some((n) => n.lyric)
    const height = 130 + (hasLyrics ? 22 : 0) + (chords?.length ? 8 : 0)

    const renderer = new Renderer(el, Renderer.Backends.SVG)
    renderer.resize(totalW * scale, height * scale)
    const ctx = renderer.getContext()
    ctx.scale(scale, scale)
    ctx.setFillStyle('currentColor')
    ctx.setStrokeStyle('currentColor')

    let x = 10
    bars.forEach((bar, bi) => {
      const w = width ? (totalW - 20) / bars.length : barWidths[bi]!
      const stave = new Stave(x, chords?.length ? 28 : 20, w)
      if (bi === 0) {
        stave.addClef(clef)
        if (showKeySignature) stave.addKeySignature(keySig)
        if (timeSignature) stave.addTimeSignature(timeSignature)
      }
      if (bi === bars.length - 1) stave.setEndBarType(Barline.type.END)
      stave.setContext(ctx).draw()

      const staveNotes: StaveNote[] = bar.map(({ n, index }) => {
        const [dur, dots] = DURATION[String(n.beats)] ?? ['q', 0]
        let note: StaveNote
        if (n.midi === null) {
          note = new StaveNote({ keys: [clef === 'bass' ? 'd/3' : 'b/4'], duration: `${dur}r`, clef })
        } else {
          const sp = n.spelled ?? spell(n.midi, { keyTonic })
          note = new StaveNote({ keys: [vexKey(sp)], duration: dur, clef, auto_stem: true })
          // With a key signature only out-of-key notes carry a sign (♮ cancels
          // the signature); without one every sharp / flat is written.
          if (showKeySignature) {
            if (!keyPcs.has(((n.midi % 12) + 12) % 12)) note.addModifier(new Accidental(sp.accidental || 'n'), 0)
          } else if (sp.accidental) {
            note.addModifier(new Accidental(sp.accidental), 0)
          }
        }
        for (let d = 0; d < dots; d++) Dot.buildAndAttach([note], { all: true })
        if (n.lyric) {
          const a = new Annotation(n.lyric).setVerticalJustification(AnnotationVerticalJustify.BOTTOM)
          a.setFont('PingFang SC, Microsoft YaHei, sans-serif', 12)
          note.addModifier(a, 0)
        }
        const mark = index === activeIndex ? 'active' : marks?.[index]
        if (mark) note.setStyle({ fillStyle: COLOR[mark], strokeStyle: COLOR[mark] })
        return note
      })
      const beats = bar.reduce((s, b) => s + b.n.beats, 0)
      const voice = new Voice({ num_beats: Math.max(1, Math.ceil(beats)), beat_value: 4 }).setStrict(false)
      voice.addTickables(staveNotes)
      const beams = Beam.generateBeams(staveNotes.filter((n) => !n.isRest()))
      new Formatter().joinVoices([voice]).format([voice], w - (bi === 0 ? firstExtra : 20) - 10)
      voice.draw(ctx, stave)
      beams.forEach((b) => b.setContext(ctx).draw())
      if (chords?.length) {
        const barStart = bar.length ? bars.slice(0, bi).reduce((t, bb) => t + bb.reduce((s2, e) => s2 + e.n.beats, 0), 0) : 0
        const startX = stave.getNoteStartX()
        const endX = stave.getNoteEndX()
        for (const c of chords) {
          if (c.start < barStart - 1e-6 || c.start >= barStart + 4 - 1e-6) continue
          ctx.save()
          ctx.setFont('Space Grotesk, sans-serif', 12, 'bold')
          ctx.setFillStyle('hsl(186 90% 56%)')
          ctx.fillText(c.text, startX + ((c.start - barStart) / 4) * (endX - startX), 22)
          ctx.restore()
        }
      }
      x += w
    })
  }, [notes, clef, keyTonic, showKeySignature, timeSignature, activeIndex, marks, width, scale, chords])

  return (
    <div
      ref={ref}
      className={cn('flex justify-center overflow-x-auto text-foreground [&_svg]:h-auto [&_svg]:max-w-full', className)}
      role="img"
      aria-label="五线谱"
    />
  )
}
