import { create } from 'zustand'
import type { StudentProfile } from '@/entities/types'
import { ProfileService } from '@/services/profileService'
import { effectiveProfile } from '@/services/adminMode'
import { useThemeStore } from '@/features/theme/themeStore'
import { setTimbre, trainingTimbre } from '@/audio/engine'
import { inputManager } from '@/audio/input/inputManager'

function applyDevices(p: StudentProfile) {
  void inputManager.setPreferences({ ...(p.audioInputId ? { inputId: p.audioInputId } : {}), ...(p.audioVoiceInputId ? { voiceInputId: p.audioVoiceInputId } : {}), ...(p.audioOutputId ? { outputId: p.audioOutputId } : {}) })
}

interface ProfileStore {
  profile: StudentProfile | null
  loading: boolean
  load: () => Promise<StudentProfile>
  /** Replace the cached profile after a service call. */
  set: (profile: StudentProfile) => void
  refresh: () => Promise<void>
}

/**
 * Single cached copy of the student profile. Pages read from here; writes go
 * through ProfileService and then `set()` / `refresh()`.
 */
export const useProfileStore = create<ProfileStore>((set, get) => ({
  profile: null,
  loading: false,
  async load() {
    const cached = get().profile
    if (cached) return cached
    set({ loading: true })
    try {
      const profile = await ProfileService.ensure()
      useThemeStore.getState().setMode(profile.theme)
      setTimbre(trainingTimbre(profile))
      applyDevices(profile)
      set({ profile: effectiveProfile(profile) })
      return profile
    } finally {
      set({ loading: false })
    }
  },
  set(profile) {
    useThemeStore.getState().setMode(profile.theme)
    setTimbre(trainingTimbre(profile))
    applyDevices(profile)
    // 管理员模式: pages see every stage unlocked; the stored row is unchanged.
    set({ profile: effectiveProfile(profile) })
  },
  async refresh() {
    const profile = await ProfileService.ensure()
    get().set(profile)
  },
}))
