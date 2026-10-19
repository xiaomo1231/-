/**
 * 排练: drives this device's player from the band's rehearsal. The conductor's
 * commands arrive as state (start time, position, speed, loop); this hook starts
 * the player at the shared moment (shifted by the devices' output latency),
 * silences screens that only follow the score, reports the reference position
 * (音箱) every two seconds, puts drifting devices back in place, and tells the
 * server when a loop pass ends.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AlphaTabApi, model } from '@coderline/alphatab'
import type { RehearsalState } from '../lib/api'
import {
  onRehearsalClock,
  sendRehearsalQuietly,
  serverNow,
  useRehearsal,
  type RehearsalConn,
} from '../lib/rehearsal'
import { barAtTick, countInMs } from '@/songs/rehearsalSections'
import {
  driftLimitMs,
  expectedTimeMs,
  localStartAt,
  makesSound,
  playerShiftMs,
  referenceDevice,
} from './rehearsalTiming'

const CLOCK_EVERY_MS = 2000
const DRIFT_REPORT_MS = 5000
const CORRECT_GAP_MS = 2500
/** No clock reports or corrections until this long after the count-in (the player settles). */
const SETTLE_MS = 600
const DEVICE_KEY = 'gl-rehearsal-device'

interface DevicePrefs {
  latencyMs: number
  audible: boolean
}

function loadDevicePrefs(): DevicePrefs {
  try {
    const raw = JSON.parse(
      localStorage.getItem(DEVICE_KEY) ?? 'null',
    ) as Partial<DevicePrefs> | null
    const ms = Number(raw?.latencyMs)
    return {
      latencyMs: Number.isInteger(ms) && ms >= 0 && ms <= 1000 ? ms : 0,
      audible: raw?.audible === true,
    }
  } catch {
    return { latencyMs: 0, audible: false }
  }
}

function saveDevicePrefs(p: DevicePrefs): void {
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(p))
  } catch {
    // Private mode: the server still has it for this session.
  }
}

export interface RehearsalPlayer {
  conn: RehearsalConn
  /** The rehearsal is on and its current song is this one. */
  here: boolean
  /** The rehearsal moved on to another band song (its id), or null. */
  movedTo: string | null
  /** The rehearsal is over (it was on when this page opened, or since). */
  ended: boolean
  isLeader: boolean
  isSpeaker: boolean
  /** This device makes sound (音箱, or 耳机出声). */
  sounding: boolean
  /** Big count-in digits on the screen: when (local ms), beats and beat length. */
  countIn: { at: number; beats: number; beatMs: number } | null
  /** Call from playerPositionChanged with the player's position (ms). */
  onPosition(timeMs: number): void
  /** Call from playerFinished; true = the rehearsal handled it. */
  onFinished(): boolean
}

export function useRehearsalPlayer(opts: {
  enabled: boolean
  songId: string
  meId: string | null
  api: React.MutableRefObject<AlphaTabApi | null>
  /** The player can play (sound font in). */
  ready: boolean
  score: model.Score | null
  onSpeed: (pct: number) => void
}): RehearsalPlayer {
  const { enabled, songId, meId, api, ready, score, onSpeed } = opts
  const conn = useRehearsal(enabled)
  const state = enabled ? conn.state : null
  const here = Boolean(state?.active && state.songId === songId)

  // The rehearsal was seen running for this page: when it stops, say so.
  const [ended, setEnded] = useState(false)
  const seenActive = useRef(false)
  useEffect(() => {
    if (!state) return
    if (state.active) seenActive.current = true
    else if (seenActive.current) setEnded(true)
  }, [state])

  const me = state?.devices.find((d) => d.deviceId === conn.deviceId) ?? null
  const isLeader = Boolean(state && meId && state.leaderId === meId)
  const isSpeaker = Boolean(state && state.speakerDevice === conn.deviceId)
  const sounding = Boolean(state && here && makesSound(state, conn.deviceId))

  // This device's latency and 耳机出声 are kept in the browser and given to the server.
  const pushed = useRef(false)
  useEffect(() => {
    if (!enabled || !me) {
      if (!conn.connected) pushed.current = false
      return
    }
    const local = loadDevicePrefs()
    if (!pushed.current) {
      pushed.current = true
      if (local.latencyMs !== me.latencyMs || local.audible !== me.audible) {
        sendRehearsalQuietly({ type: 'device', latencyMs: local.latencyMs, audible: local.audible })
        return
      }
    }
    if (local.latencyMs !== me.latencyMs || local.audible !== me.audible)
      saveDevicePrefs({ latencyMs: me.latencyMs, audible: me.audible })
  }, [enabled, me, conn.connected])

  // Only the 音箱 and devices with earphones make a sound.
  useEffect(() => {
    const a = api.current
    if (!a || !enabled) return
    a.masterVolume = here && !sounding ? 0 : 1
  }, [api, enabled, here, sounding, ready])

  // --- applying the shared transport ----------------------------------------------------
  const stateRef = useRef<RehearsalState | null>(null)
  stateRef.current = here ? state : null
  const offsetRef = useRef(conn.offsetMs)
  offsetRef.current = conn.offsetMs
  const applied = useRef<RehearsalState | null>(null)
  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Local time this device started (or will start) the current run, and its count-in length. */
  const run = useRef<{ start: number; countIn: number } | null>(null)
  const [countIn, setCountIn] = useState<RehearsalPlayer['countIn']>(null)
  const sample = useRef<{ timeMs: number; at: number } | null>(null)

  const clearStart = () => {
    if (startTimer.current) clearTimeout(startTimer.current)
    startTimer.current = null
  }

  /** Count-in of a run starting at `tick`: beats of that bar at its tempo and the speed. */
  const countInOf = useCallback(
    (s: RehearsalState): { beats: number; beatMs: number } | null => {
      if (!s.countIn || !score) return null
      const bars = score.masterBars
      const i = Math.max(0, barAtTick(bars, s.tick) - 1)
      const beats = bars[i]?.timeSignatureNumerator ?? 4
      const ms = countInMs(beats, score.tempo || 120, s.speedPct)
      return ms > 0 ? { beats, beatMs: ms / beats } : null
    },
    [score],
  )

  useEffect(() => {
    const a = api.current
    const s = stateRef.current
    if (!a || !ready || !s) {
      if (!here) {
        clearStart()
        applied.current = null
        run.current = null
      }
      return
    }
    const before = applied.current
    // Device-only changes (who is ready, latency…) keep the transport as it is: a changed
    // latency is taken up by the next drift correction.
    if (before && before.seq === s.seq) return
    applied.current = s

    // The loop range plays to its end and stops; the 音箱 then asks for the next pass.
    if (s.loop) {
      a.playbackRange = { startTick: s.loop.startTick, endTick: s.loop.endTick } as never
      a.isLooping = false
    } else if (a.playbackRange) a.playbackRange = null
    a.countInVolume = s.countIn ? 1 : 0

    const speedOnly =
      before &&
      before.playing === s.playing &&
      before.tick === s.tick &&
      before.startAt === s.startAt &&
      before.pass === s.pass &&
      before.countIn === s.countIn &&
      before.songId === s.songId &&
      JSON.stringify(before.loop) === JSON.stringify(s.loop)
    if (speedOnly) {
      a.playbackSpeed = s.speedPct / 100
      onSpeed(s.speedPct)
      return
    }

    clearStart()
    setCountIn(null)
    if (!s.playing) {
      run.current = null
      if (a.playerState === 1) a.pause()
      a.tickPosition = s.tick
      return
    }
    const start = localStartAt(s, conn.deviceId, offsetRef.current)
    const ci = countInOf(s)
    run.current = { start, countIn: ci ? ci.beats * ci.beatMs : 0 }
    if (a.playerState === 1) a.pause()
    a.playbackSpeed = s.speedPct / 100
    onSpeed(s.speedPct)
    a.tickPosition = s.tick
    const go = () => {
      startTimer.current = null
      const p = api.current
      if (!p) return
      p.tickPosition = s.tick
      p.play()
    }
    const wait = start - Date.now()
    if (wait > 0) {
      if (ci) setCountIn({ at: start, ...ci })
      startTimer.current = setTimeout(go, wait)
    } else {
      // Joined late: start now without a count-in; the next clock report puts us in place.
      a.countInVolume = 0
      go()
      window.setTimeout(() => {
        if (api.current) api.current.countInVolume = s.countIn ? 1 : 0
      }, 300)
      run.current = { start: Date.now() - 10_000, countIn: 0 }
    }
  }, [api, ready, here, state, conn.deviceId, countInOf, onSpeed])

  useEffect(() => () => clearStart(), [])

  // --- the reference reports its position; the others follow it -------------------------
  const settled = () => {
    const r = run.current
    return r !== null && Date.now() > r.start + r.countIn + SETTLE_MS
  }
  const nowPosition = () => {
    const smp = sample.current
    return smp ? smp.timeMs + (Date.now() - smp.at) : null
  }

  useEffect(() => {
    if (!here || !state?.playing) return
    const timer = setInterval(() => {
      const s = stateRef.current
      const a = api.current
      if (!s || !a || a.playerState !== 1 || !settled()) return
      if (referenceDevice(s)?.deviceId !== conn.deviceId) return
      const pos = nowPosition()
      if (pos === null) return
      sendRehearsalQuietly({
        type: 'clock',
        seq: s.seq,
        pass: s.pass,
        timeMs: Math.round(pos),
        at: serverNow(),
      })
    }, CLOCK_EVERY_MS)
    return () => clearInterval(timer)
  }, [here, state?.playing, state?.seq, api, conn.deviceId])  

  const lastCorrect = useRef(0)
  const lastDriftReport = useRef(0)
  useEffect(() => {
    if (!here) return
    return onRehearsalClock((c) => {
      const s = stateRef.current
      const a = api.current
      if (!s || !a || !s.playing || c.seq !== s.seq || c.pass !== s.pass) return
      if (referenceDevice(s)?.deviceId === conn.deviceId) return
      if (a.playerState !== 1 || !settled()) return
      const own = nowPosition()
      if (own === null) return
      const expected = expectedTimeMs(c, serverNow(), playerShiftMs(s, conn.deviceId))
      const drift = Math.round(own - expected)
      const now = Date.now()
      if (now - lastDriftReport.current > DRIFT_REPORT_MS) {
        lastDriftReport.current = now
        sendRehearsalQuietly({ type: 'device', driftMs: drift })
      }
      if (
        Math.abs(drift) > driftLimitMs(makesSound(s, conn.deviceId)) &&
        now - lastCorrect.current > CORRECT_GAP_MS
      ) {
        lastCorrect.current = now
        a.timePosition = Math.max(0, expected)
        sample.current = { timeMs: Math.max(0, expected), at: now }
      }
    })
  }, [here, api, conn.deviceId])  

  const onPosition = useCallback((timeMs: number) => {
    sample.current = { timeMs, at: Date.now() }
  }, [])

  const onFinished = useCallback((): boolean => {
    const s = stateRef.current
    if (!s) return false
    if (s.playing && referenceDevice(s)?.deviceId === conn.deviceId)
      sendRehearsalQuietly({ type: 'passEnded', seq: s.seq, pass: s.pass })
    return true
  }, [conn.deviceId])

  const movedTo = state?.active && state.songId && state.songId !== songId ? state.songId : null
  return {
    conn,
    here,
    movedTo,
    ended,
    isLeader,
    isSpeaker,
    sounding,
    countIn,
    onPosition,
    onFinished,
  }
}
