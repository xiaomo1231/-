import { createContext, useContext } from 'react'
import type { LibraryInfo } from './api'

export interface LibraryValue {
  info: LibraryInfo | null
  error: string | null
  /** Bumped after every scan, so pages that fetched their lists fetch them again. */
  version: number
  scanning: boolean
  reload: () => void
  rescan: () => void
}

export const LibraryContext = createContext<LibraryValue | null>(null)

export function useLibrary(): LibraryValue {
  const value = useContext(LibraryContext)
  if (!value) throw new Error('useLibrary 只能在 LibraryContext 内使用')
  return value
}
