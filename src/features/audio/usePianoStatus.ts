import { useEffect, useState } from 'react'
import { onPianoStatus, pianoStatus, type PianoStatus } from '@/audio/piano'

/** Live loading state of the bundled piano samples. */
export function usePianoStatus(): PianoStatus {
  const [s, setS] = useState(pianoStatus())
  useEffect(() => onPianoStatus(setS), [])
  return s
}
