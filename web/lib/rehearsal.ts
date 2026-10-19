/**
 * 排练 (rehearsal in one room) on the web side: one Server-Sent Events stream per
 * page carries the band's rehearsal state, the reference device's clock and a
 * "band changed" signal, so every member's band page and score refresh at once.
 * The stream is shared by every component that uses it and closed shortly after
 * the last one goes away.
 *
 * Clock model: `offsetMs` is what to ADD to the local clock to get server time.
 */
import { useEffect, useSyncExternalStore } from 'react'
import {
  api,
  errorText,
  type RehearsalClock,
  type RehearsalCommand,
  type RehearsalDevice,
  type RehearsalState,
} from './api'
import { reloadBand } from './band'

export interface TimeSample {
  /** Local time before the request. */
  t0: number
  /** Server time from the response. */
  server: number
  /** Local time after the response. */
  t1: number
}

/** Offset from the sample with the smallest round trip (least queueing noise). */
export function estimateOffset(samples: TimeSample[]): number {
  if (samples.length === 0) throw new Error('没有可用的时间样本。')
  let best = samples[0]!
  for (const s of samples) {
    if (s.t1 - s.t0 < best.t1 - best.t0) best = s
  }
  return best.server - (best.t0 + best.t1) / 2
}

/** Measure the server clock offset with `n` sequential round trips. */
export async function measureOffset(n = 8): Promise<number> {
  const samples: TimeSample[] = []
  let lastError: unknown = null
  for (let i = 0; i < n; i++) {
    const t0 = Date.now()
    try {
      const { now } = await api.serverTime()
      samples.push({ t0, server: now, t1: Date.now() })
    } catch (e) {
      lastError = e
    }
  }
  if (samples.length === 0) {
    throw lastError instanceof Error ? lastError : new Error('无法同步服务器时间，请检查网络。')
  }
  return estimateOffset(samples)
}

const DEVICE_KEY = 'gl-device-id'
const REMEASURE_MS = 60_000
const CLOSE_AFTER_MS = 3000
const ERROR_VISIBLE_MS = 5000

/**
 * This tab's device id: random, kept in sessionStorage so a reload keeps it while two
 * tabs (each with its own player) count as two devices.
 */
function loadDeviceId(): string {
  const fresh = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('')
  try {
    const saved = sessionStorage.getItem(DEVICE_KEY)
    if (saved && /^[A-Za-z0-9_-]{8,40}$/.test(saved)) return saved
    const id = fresh()
    sessionStorage.setItem(DEVICE_KEY, id)
    return id
  } catch {
    return fresh()
  }
}

/** A short name for this kind of device. */
export function deviceLabel(ua: string = navigator.userAgent): string {
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad'
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? '手机' : '平板'
  return '电脑'
}

export const deviceId = loadDeviceId()

interface Snapshot {
  state: RehearsalState | null
  connected: boolean
  offsetMs: number
  error: string | null
}

let snap: Snapshot = { state: null, connected: false, offsetMs: 0, error: null }
const listeners = new Set<() => void>()
const clockListeners = new Set<(c: RehearsalClock) => void>()
let users = 0
let source: EventSource | null = null
let closeTimer: ReturnType<typeof setTimeout> | null = null
let remeasureTimer: ReturnType<typeof setInterval> | null = null
let errorTimer: ReturnType<typeof setTimeout> | null = null

function set(patch: Partial<Snapshot>): void {
  snap = { ...snap, ...patch }
  listeners.forEach((l) => l())
}

function showError(e: unknown): void {
  set({ error: errorText(e) })
  if (errorTimer) clearTimeout(errorTimer)
  errorTimer = setTimeout(() => set({ error: null }), ERROR_VISIBLE_MS)
}

/** A newer state replaces the shown one; an older transport (lower seq) never does. */
function acceptState(s: RehearsalState): void {
  const cur = snap.state
  if (cur && s.seq < cur.seq && s.startedAt === cur.startedAt) return
  set({ state: s })
}

function remeasure(): void {
  measureOffset()
    .then((o) => set({ offsetMs: o }))
    .catch(() => undefined)
}

function open(): void {
  if (source) return
  remeasure()
  const url = `/api/rehearsal/events?device=${encodeURIComponent(deviceId)}&label=${encodeURIComponent(deviceLabel())}`
  const es = new EventSource(url)
  source = es
  let opened = false
  es.onopen = () => {
    set({ connected: true })
    // A reconnect: the server may have restarted; take whatever it sends next.
    if (opened) {
      set({ state: null })
      remeasure()
    }
    opened = true
  }
  es.addEventListener('rehearsal', (ev) => {
    try {
      acceptState(JSON.parse((ev as MessageEvent<string>).data) as RehearsalState)
    } catch {
      // Malformed event: the next one corrects us.
    }
  })
  es.addEventListener('clock', (ev) => {
    try {
      const c = JSON.parse((ev as MessageEvent<string>).data) as RehearsalClock
      clockListeners.forEach((l) => l(c))
    } catch {
      // ignore
    }
  })
  es.addEventListener('band', () => reloadBand())
  es.onerror = () => {
    set({ connected: false })
    if (es.readyState === EventSource.CLOSED) {
      showError('和服务器的实时连接断开了，请刷新页面。')
      source = null
    }
  }
  remeasureTimer = setInterval(remeasure, REMEASURE_MS)
}

function close(): void {
  source?.close()
  source = null
  if (remeasureTimer) clearInterval(remeasureTimer)
  remeasureTimer = null
  set({ connected: false })
}

function retain(): () => void {
  users++
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
  open()
  return () => {
    users--
    if (users > 0) return
    closeTimer = setTimeout(() => {
      closeTimer = null
      if (users === 0) close()
    }, CLOSE_AFTER_MS)
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** Every clock event of the reference device (音箱, else the conductor's device). */
export function onRehearsalClock(cb: (c: RehearsalClock) => void): () => void {
  clockListeners.add(cb)
  return () => {
    clockListeners.delete(cb)
  }
}

/** Sends a command; the answer (the new state) is shown right away. Rejects with a readable message. */
export async function sendRehearsal(cmd: RehearsalCommand): Promise<void> {
  try {
    acceptState(await api.rehearsalCommand({ deviceId, command: cmd }))
  } catch (e) {
    showError(e)
    throw new Error(errorText(e))
  }
}

/** Sends without waiting and without showing errors (clock reports, device status). */
export function sendRehearsalQuietly(cmd: RehearsalCommand): void {
  api
    .rehearsalCommand({ deviceId, command: cmd })
    .then(acceptState)
    .catch(() => undefined)
}

/** Server time now, from the local clock and the measured offset. */
export function serverNow(): number {
  return Date.now() + snap.offsetMs
}

export interface RehearsalConn {
  /** null until the first state arrives. */
  state: RehearsalState | null
  connected: boolean
  /** This tab's device id (kept in sessionStorage). */
  deviceId: string
  /** This device's entry in the state, when connected. */
  myDevice: RehearsalDevice | null
  /** Server time = Date.now() + offsetMs. */
  offsetMs: number
  /** Sends a command; rejects with a readable (Chinese) message. */
  send(cmd: RehearsalCommand): Promise<void>
  /** Last error, shown for a few seconds. */
  error: string | null
}

/** The band's rehearsal, live. Also keeps the band (useBand) up to date while mounted. */
export function useRehearsal(enabled = true): RehearsalConn {
  useEffect(() => (enabled ? retain() : undefined), [enabled])
  const s = useSyncExternalStore(subscribe, () => snap)
  return {
    state: s.state,
    connected: s.connected,
    deviceId,
    myDevice: s.state?.devices.find((d) => d.deviceId === deviceId) ?? null,
    offsetMs: s.offsetMs,
    send: sendRehearsal,
    error: s.error,
  }
}
