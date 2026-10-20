/**
 * The signed-in account and the band it is working in, as one shared store. App
 * start fills it from /api/me, login and the account pages update it, and a lost
 * session clears it. The chosen band is remembered on this device; every API call
 * sends it (X-Band), so the band pages, uploads and rehearsal follow it.
 */
import { useSyncExternalStore } from 'react'
import type { BandBrief, Instrument, MeInfo, UserInfo } from '@/songs/scoreServerTypes'

const BAND_KEY = 'gl:band'

let me: MeInfo | null = null
let chosenBand: string | null = readChosen()
const listeners = new Set<() => void>()

function readChosen(): string | null {
  try {
    return localStorage.getItem(BAND_KEY)
  } catch {
    return null
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

const emit = () => {
  for (const l of listeners) l()
}

export function getMe(): MeInfo | null {
  return me
}

/** A login answer has no bands yet: keep the ones known until /api/me says otherwise. */
export function setMe(u: UserInfo | MeInfo | null): void {
  me = u ? { ...u, bands: 'bands' in u ? u.bands : (me?.bands ?? []) } : null
  emit()
}

/** The signed-in account, or null (signed out, or not checked yet). */
export function useMe(): MeInfo | null {
  return useSyncExternalStore(subscribe, getMe)
}

/** The band the pages work in: the one chosen on this device if still one of the account's, else the first. */
export function getBand(): BandBrief | null {
  const bands = me?.bands ?? []
  return bands.find((b) => b.id === chosenBand) ?? bands[0] ?? null
}

export function getBandId(): string | null {
  return getBand()?.id ?? null
}

let lastBand: BandBrief | null = null
let lastBandKey = ''
/** The current band (a stable object while nothing changed, as useSyncExternalStore needs). */
function bandSnapshot(): BandBrief | null {
  const b = getBand()
  const key = b ? `${b.id}|${b.name}|${b.leader}|${b.members}` : ''
  if (key !== lastBandKey) {
    lastBandKey = key
    lastBand = b
  }
  return lastBand
}

export function useCurrentBand(): BandBrief | null {
  return useSyncExternalStore(subscribe, bandSnapshot)
}

/** Switches to another of the account's bands. */
export function chooseBand(id: string): void {
  chosenBand = id
  try {
    localStorage.setItem(BAND_KEY, id)
  } catch {
    // Private mode: the choice lasts until the page closes.
  }
  emit()
}

/** Runs `cb` whenever the current band changes (another band chosen, joined or left). */
export function onBandChange(cb: () => void): () => void {
  let last = getBandId()
  return subscribe(() => {
    const now = getBandId()
    if (now !== last) {
      last = now
      cb()
    }
  })
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
