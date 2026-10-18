/**
 * The signed-in account, as one shared store. App start fills it from /api/me,
 * login and the account pages update it, and a lost session clears it.
 */
import { useSyncExternalStore } from 'react'
import type { Instrument, UserInfo } from '@/songs/scoreServerTypes'

let me: UserInfo | null = null
const listeners = new Set<() => void>()

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function getMe(): UserInfo | null {
  return me
}

export function setMe(u: UserInfo | null): void {
  me = u
  for (const l of listeners) l()
}

/** The signed-in account, or null (signed out, or not checked yet). */
export function useMe(): UserInfo | null {
  return useSyncExternalStore(subscribe, getMe)
}

export const INSTRUMENT_LABELS: Record<Instrument, string> = {
  guitar: '吉他',
  bass: '贝斯',
  drums: '鼓',
  keys: '键盘',
  vocal: '主唱',
  other: '其他',
}

/** Admins always can; members only when the admin has granted the whole library. */
export function canBrowseLibrary(u: UserInfo): boolean {
  return u.role === 'admin' || u.libraryAccess
}
