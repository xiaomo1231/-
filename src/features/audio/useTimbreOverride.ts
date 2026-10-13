import { useEffect } from 'react'
import { overrideTimbre, type Timbre } from '@/audio/engine'

/** Use `timbre` while the calling page is mounted, then return to the training timbre. */
export function useTimbreOverride(timbre: Timbre): void {
  useEffect(() => overrideTimbre(timbre), [timbre])
}
