import { useMemo } from 'react'
import { parseChordSymbol } from '@/guitar/units'
import { useChordShapes, useGuitarSetup } from '@/features/instrument/useGuitarSetup'
import type { ChordShape } from '@/music/fretboard'

export interface ChordTargets {
  symbol: string
  shape: ChordShape | null
  playedAs: string | null
  /** Sounding MIDI per played string, low to high. */
  targets: Array<{ string: number; midi: number }>
  /** Lowest sounding note (the root for these shapes). */
  rootMidi: number | null
}

/** Shapes and expected string pitches for chord symbols, honouring tuning and capo. */
export function useChordTargets(symbols: readonly string[]): ChordTargets[] {
  const shapeFor = useChordShapes()
  const { played } = useGuitarSetup()
  return useMemo(
    () =>
      symbols.map((symbol) => {
        const { rootPc, suffix, rootName } = parseChordSymbol(symbol)
        const found = shapeFor(rootPc, suffix, rootName)
        const shape = found?.shape ?? null
        const targets = shape ? shape.frets.flatMap((f, s) => (f === null ? [] : [{ string: s, midi: played.strings[s]! + f }])) : []
        return { symbol, shape, playedAs: found?.playedAs ?? null, targets, rootMidi: targets[0]?.midi ?? null }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbols.join('|'), played.id],
  )
}
