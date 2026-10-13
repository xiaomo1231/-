import { create } from 'zustand'
import type { ThemeMode } from '@/entities/types'

interface ThemeStore {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
}

function applyToDom(mode: ThemeMode): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('dark', mode === 'dark')
  root.style.colorScheme = mode
}

/** Presentation only: switching never touches practice data. */
export const useThemeStore = create<ThemeStore>((set) => ({
  mode: 'dark',
  setMode(mode) {
    applyToDom(mode)
    set({ mode })
  },
}))
