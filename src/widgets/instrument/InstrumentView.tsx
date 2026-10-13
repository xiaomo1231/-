import { useMemo } from 'react'
import type { InstrumentId } from '@/entities/types'
import { fingerMelody, positionsForPitchClasses, tuningForInstrument } from '@/music/fretboard'
import { useChordShapes, useGuitarSetup } from '@/features/instrument/useGuitarSetup'
import { midiToName, pitchClass } from '@/music/pitch'
import { VirtualKeyboard } from '@/widgets/keyboard/VirtualKeyboard'
import { ChordDiagram } from './ChordDiagram'
import { Fretboard, type FretMarker } from './Fretboard'
import { markLabelMap } from './markLabels'

export interface InstrumentViewProps {
  instrument: InstrumentId
  /** Notes to show. For guitar / bass each note gets one fingered position. */
  notes: readonly number[]
  /** Labels per note (degree, name). Defaults to note names. */
  labels?: readonly string[]
  /** Small badge per note (e.g. the order ①②), drawn beside the marker. */
  badges?: readonly string[]
  /** Pitch class drawn as the root (amber). */
  rootPc?: number
  /**
   * 'positions' (default): one position per note, in order.
   * 'all': every position of these pitch classes in the first 12 frets (scale maps).
   */
  mode?: 'positions' | 'all'
  /** Show a chord box (guitar). */
  chord?: { rootPc: number; suffix: string; rootName: string }
  onNote?: (midi: number) => void
  /** Index into `notes` of the note being played now (highlighted). */
  activeIndex?: number
  className?: string
}

/**
 * Show notes where the student will actually play them: a fretboard for
 * guitar and bass, a keyboard for piano or no instrument.
 */
export function InstrumentView({ instrument, notes, labels, badges, rootPc, mode = 'positions', chord, onNote, activeIndex, className }: InstrumentViewProps) {
  const setup = useGuitarSetup()
  const shapeFor = useChordShapes()
  const tuning = instrument === 'guitar' ? setup.played : tuningForInstrument(instrument)
  const activeMidi = activeIndex !== undefined ? notes[activeIndex] : undefined

  const fret = useMemo(() => {
    if (!tuning) return null
    if (notes.length === 0) return { markers: [] as FretMarker[], from: 0, to: 12 }
    let markers: FretMarker[]
    if (mode === 'all') {
      const pcs = Array.from(new Set(notes.map(pitchClass)))
      markers = positionsForPitchClasses(pcs, tuning, 0, 12).map((p) => {
        const idx = notes.findIndex((n) => pitchClass(n) === pitchClass(p.midi))
        return {
          ...p,
          label: labels?.[idx] ?? midiToName(p.midi),
          ...(badges?.[idx] ? { badge: badges[idx] } : {}),
          tone: rootPc !== undefined && pitchClass(p.midi) === rootPc ? 'root' : 'note',
          active: activeMidi !== undefined && p.midi === activeMidi,
        }
      })
    } else {
      markers = fingerMelody(notes, tuning, 15)
        .map((p, i) =>
          p
            ? ({
                ...p,
                label: labels?.[i] ?? midiToName(p.midi),
                ...(badges?.[i] ? { badge: badges[i] } : {}),
                tone: rootPc !== undefined && pitchClass(p.midi) === rootPc ? 'root' : 'note',
                active: i === activeIndex,
              } as FretMarker)
            : null,
        )
        .filter((m): m is FretMarker => m !== null)
    }
    const frets = markers.map((m) => m.fret).filter((f) => f > 0)
    const hi = Math.max(5, ...frets)
    const lo = frets.length ? Math.min(...frets) : 0
    const from = mode === 'all' || lo <= 4 ? 0 : Math.max(0, lo - 2)
    const to = mode === 'all' ? 12 : Math.min(15, Math.max(from + 7, hi + 1))
    return { markers, from, to }
  }, [tuning, notes, labels, badges, rootPc, mode, activeIndex, activeMidi])

  if (tuning && fret) {
    const found = chord && instrument === 'guitar' ? shapeFor(chord.rootPc, chord.suffix, chord.rootName) : null
    const shape = found?.shape ?? null
    return (
      <div className={className}>
        {instrument === 'guitar' && setup.capo > 0 && <div className="mb-1 text-xs text-amber">变调夹 {setup.capo} 品：品位从变调夹算起</div>}
        <div className="flex items-center gap-6">
          <Fretboard
            tuning={tuning}
            markers={fret.markers}
            fromFret={fret.from}
            toFret={fret.to}
            {...(onNote ? { onPosition: (p) => onNote(p.midi) } : {})}
            className="flex-1"
          />
          {shape && (
            <div className="flex flex-col items-center">
              <ChordDiagram shape={shape} />
              {found?.playedAs && <span className="text-[11px] text-muted-foreground">{found.playedAs}</span>}
            </div>
          )}
        </div>
      </div>
    )
  }

  const low = Math.min(48, ...notes)
  const high = Math.max(72, ...notes)
  return (
    <VirtualKeyboard
      low={low - pitchClass(low)}
      high={high + ((12 - pitchClass(high)) % 12)}
      marked={notes}
      markLabels={markLabelMap(notes, badges && labels ? labels.map((l, i) => (badges[i] ? `${badges[i]}·${l}` : l)) : labels)}
      {...(activeMidi !== undefined ? { activeMidi } : {})}
      {...(onNote ? { onNote } : {})}
      className={className ?? 'max-h-28'}
    />
  )
}
