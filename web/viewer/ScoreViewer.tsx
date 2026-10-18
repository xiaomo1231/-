import { useEffect, useMemo, useRef, useState } from 'react'
import type { AlphaTabApi, model } from '@coderline/alphatab'
import type { ScoreFormat } from '@/songs/scoreLibraryTypes'
import { errorText, fetchBytes, fileUrl, type PracticeUpdate } from '../lib/api'
import { clampTranspose } from '../lib/transpose'
import { cx } from '../lib/classes'
import { loadPracticeFor, practiceFor, savePractice, savePracticeOnExit } from '../lib/practice'
import { Notice } from '../components/ui'
import { useBand } from '../lib/band'
import { useMe } from '../lib/session'
import { useLiveSync, type LivePlayer } from './liveSync'
import { LiveBar } from './LiveBar'
import { trackLabels } from './trackNames'
import {
  alphaTabUrls,
  applyTranspose,
  chooseEncoding,
  cleanHeader,
  loadAlphaTab,
  tidyTempoMarks,
} from './alphaTab'
import {
  effectiveScale,
  isPhone,
  isShortLandscape,
  loadPrefs,
  savePrefs,
  SPEED_MAX,
  SPEED_MIN,
  sheetResources,
  staveProfileOf,
  staffFor,
  type ScorePrefs,
  type StaffMode,
  type SheetMode,
} from './scorePrefs'
import {
  gapMs,
  loopStatus,
  nextPass,
  startLoop,
  type LoopState,
  type TrainerConfig,
} from './practiceEngine'
import { availableSoundFonts, soundFontUrl, type SoundFontId } from './soundFonts'
import { hasFretboard, notesFromBeats, tuningLabels, type FretNote } from './fretboardNotes'
import { Fretboard } from './Fretboard'
import { Remote, useStar, type PopKind } from './Remote'

/** After this long without a score, say the file is slow to read. */
const SLOW_MS = 20000
/** Playback needs the sound font; after this long without it, the playback keys are hidden. */
const SOUND_WAIT_MS = 60000
/** A larger sound font that has not loaded after this long is given up for the basic one. */
const BIG_SOUND_WAIT_MS = 240000
/** While playing, the practice time is saved this often. */
const SAVE_EVERY_MS = 30000

/** The sheet's own colours: the cursor, the selection and the highlight follow the pen blue. */
const SHEET_CSS = `
.score-sheet .at-surface .at-cursor-beat { background: var(--sheet-pen); width: 3px; }
.score-sheet .at-surface .at-cursor-bar { background: color-mix(in srgb, var(--sheet-pen) 12%, transparent); }
.score-sheet .at-surface .at-selection div { background: color-mix(in srgb, var(--sheet-pen) 22%, transparent); }
.score-sheet .at-surface .at-highlight * { fill: var(--sheet-pen); stroke: var(--sheet-pen); }
.score-sheet .at-surface { min-height: 12rem; position: relative; z-index: 0; isolation: isolate; }
/* alphaTab's cursor layer (z-index 1000) stays inside the sheet, under the header, fretboard and remote. */
`

type Phase = 'loading' | 'ready' | 'error'

interface Props {
  path: string
  title: string
  artist: string
  pages: string[]
  /** Opened from the band's setlist: that band song's id ('' otherwise). */
  band: string
}

/** Passes with a pause or a count-in between them are restarted by hand; others loop seamlessly. */
const isManualLoop = (t: TrainerConfig) => t.gapBeats > 0 || t.countInEachLoop

/** Loop range for the current choices: the user's selection, or the whole piece when none. */
function syncLoop(a: AlphaTabApi, loop: boolean, hasSelection: boolean, manual: boolean): void {
  if (!loop) {
    a.playbackRange = null
    a.isLooping = false
    return
  }
  if (hasSelection) a.applyPlaybackRangeFromHighlight()
  else a.playbackRange = null
  a.isLooping = !manual
}

/** Highlights bars [first, last] (1-based) of the shown track, as if the student had dragged them. */
function highlightBars(a: AlphaTabApi, s: model.Score, track: number, bars: [number, number]): void {
  const staff = s.tracks[track]?.staves[0]
  const first = staff?.bars[bars[0] - 1]?.voices[0]?.beats[0]
  const lastVoice = staff?.bars[bars[1] - 1]?.voices[0]
  const last = lastVoice?.beats[lastVoice.beats.length - 1]
  if (first && last) a.highlightPlaybackRange(first, last)
}

const sameBars = (a: [number, number] | null, b: [number, number] | null) =>
  a === b || (a !== null && b !== null && a[0] === b[0] && a[1] === b[1])

/** A Guitar Pro / MusicXML file, shown and played by alphaTab (read in place, never saved). */
export function ScoreViewer({ path, title, artist, pages, band }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const api = useRef<AlphaTabApi | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [message, setMessage] = useState('')
  const [slow, setSlow] = useState(false)
  const [score, setScore] = useState<model.Score | null>(null)
  const [prefs, setPrefs] = useState<ScorePrefs>(loadPrefs)
  const [track, setTrack] = useState(0)
  const [transpose, setTranspose] = useState(0)
  const [ready, setReady] = useState(false)
  const [soundFailed, setSoundFailed] = useState(false)
  const [soundPct, setSoundPct] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [speedPct, setSpeedPct] = useState(100)
  const [loop, setLoop] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [selBars, setSelBars] = useState<[number, number] | null>(null)
  const [countIn, setCountIn] = useState(true)
  const [metro, setMetro] = useState(false)
  const [solo, setSolo] = useState<Set<number>>(new Set())
  const [mute, setMute] = useState<Set<number>>(new Set())
  const [volumes, setVolumes] = useState<number[]>([])
  const [followAlong, setFollowAlong] = useState(false)
  const [metroOnly, setMetroOnly] = useState(false)
  const [loopState, setLoopState] = useState<LoopState | null>(null)
  const [soundFonts, setSoundFonts] = useState<ReadonlySet<SoundFontId>>(() => new Set(['basic']))
  const [activeNotes, setActiveNotes] = useState<FretNote[]>([])
  const [headerH, setHeaderH] = useState(0)
  const [pop, setPop] = useState<PopKind | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [time, setTime] = useState({ now: 0, end: 0, tick: 0 })
  const [restoreNote, setRestoreNote] = useState('')
  const me = useMe()
  const { state: bandState } = useBand()
  const bandSong = band ? bandState?.songs.find((x) => x.id === band) : undefined
  /** The track this member plays in the band song (lowest index when several). */
  const myTrack = (() => {
    if (!bandSong || !me) return null
    const mine = Object.entries(bandSong.parts)
      .filter(([, uid]) => uid === me.id)
      .map(([i]) => Number(i))
      .sort((x, y) => x - y)
    return mine[0] ?? null
  })()
  const bandSpeed = bandSong?.rehearsalSpeedPct ?? null
  const star = useStar({
    path,
    format: 'score' as ScoreFormat,
    pages,
    title,
    artist,
  })

  // alphaTab callbacks, timers and key handling read the latest values from here.
  const live = useRef({
    prefs,
    transpose,
    loop,
    hasSelection,
    countIn,
    metro,
    speedPct,
    track,
    loopState,
    selBars,
    mute,
    score,
  })
  live.current = {
    prefs,
    transpose,
    loop,
    hasSelection,
    countIn,
    metro,
    speedPct,
    track,
    loopState,
    selBars,
    mute,
    score,
  }
  const selRef = useRef(false)
  const bandSpeedRef = useRef<number | null>(bandSpeed)
  bandSpeedRef.current = bandSpeed
  const gapTimer = useRef<number | undefined>(undefined)
  const openedPath = useRef('')
  const playerReadyRef = useRef(false)
  /** Practice time not yet sent, and whether the saved state may be written. */
  const clock = useRef({ startedAt: 0, seconds: 0, maxSpeed: 0, restored: false })
  const pendingBars = useRef<[number, number] | null>(null)

  const cancelGap = () => {
    window.clearTimeout(gapTimer.current)
    gapTimer.current = undefined
  }

  // 一起播放: the band song's shared transport drives this player.
  const livePlayer = useMemo<LivePlayer>(
    () => ({
      startAt(tick, pct) {
        const a = api.current
        if (!a) return
        cancelGap()
        if (a.playerState === 1) a.pause()
        a.playbackSpeed = pct / 100
        setSpeedPct(pct)
        a.tickPosition = tick
        a.play()
      },
      pause(tick) {
        const a = api.current
        if (!a) return
        cancelGap()
        a.pause()
        a.tickPosition = tick
      },
      seek(tick) {
        if (api.current) api.current.tickPosition = tick
      },
      setSpeed(pct) {
        if (api.current) api.current.playbackSpeed = pct / 100
        setSpeedPct(pct)
      },
      currentTick: () => api.current?.tickPosition ?? 0,
      currentSpeed: () => live.current.speedPct,
    }),
    [],
  )
  const together = useLiveSync(bandSong ? bandSong.id : null, me?.id ?? null, livePlayer)
  const leaderId = together.connected ? (together.state?.leaderId ?? null) : null
  /** Someone else leads: this player follows and its own transport keys wait. */
  const following = leaderId !== null && leaderId !== me?.id
  const leading = leaderId !== null && leaderId === me?.id

  useEffect(() => {
    if (phase !== 'loading') return
    const timer = window.setTimeout(() => setSlow(true), SLOW_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  // The sticky fretboard sits under the site header.
  useEffect(() => {
    const header = document.querySelector('header')
    if (!header) return
    const measure = () => setHeaderH(header.getBoundingClientRect().height)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(header)
    return () => ro.disconnect()
  }, [])

  // Practice records: sends the time played since the last save plus the state to keep.
  const flushRef = useRef<(exit: boolean) => void>(() => {})
  flushRef.current = (exit: boolean) => {
    const c = clock.current
    if (!c.restored) return
    const now = Date.now()
    const L = live.current
    let secs = c.seconds
    if (c.startedAt) {
      secs += (now - c.startedAt) / 1000
      c.startedAt = now
    }
    c.seconds = 0
    const played = secs >= 1
    // Only scores actually practised get a record; afterwards their state is kept too.
    if (!played && !practiceFor(path)) return
    const u: PracticeUpdate = {
      path,
      title,
      artist,
      speedPct: L.speedPct,
      loopBars: L.selBars,
      muted: [...L.mute].sort((a, b) => a - b),
    }
    if (played) {
      u.addSeconds = Math.round(secs * 10) / 10
      u.playedSpeedPct = Math.max(SPEED_MIN, Math.min(SPEED_MAX, c.maxSpeed || L.speedPct))
    }
    c.maxSpeed = c.startedAt ? L.speedPct : 0
    if (exit) savePracticeOnExit(u)
    else void savePractice(u)
  }

  // Create the viewer once per file, and again when the sound font changes (alphaTab cannot
  // swap a sound font in place reliably: after a swap it stays silent). The student's speed,
  // loop selection, mutes and volumes live in React state and carry over.
  const soundFontChoice = prefs.soundFont
  useEffect(() => {
    const ac = new AbortController()
    let disposed = false
    let soundTimer: number | undefined
    let rendered = false
    const again = openedPath.current === path
    openedPath.current = path
    playerReadyRef.current = false
    setReady(false)
    setSoundFailed(false)
    setSoundPct(0)
    if (again) {
      pendingBars.current = live.current.selBars
    } else {
      clock.current = { startedAt: 0, seconds: 0, maxSpeed: 0, restored: false }
      pendingBars.current = null
    }
    const run = async () => {
      try {
        const urls = alphaTabUrls()
        const [bytes, at, fonts] = await Promise.all([
          fetchBytes(fileUrl(path), ac.signal),
          loadAlphaTab(),
          availableSoundFonts(),
        ])
        if (disposed || !host.current) return
        setSoundFonts(fonts)
        const cur = live.current
        const font: SoundFontId = fonts.has(cur.prefs.soundFont) ? cur.prefs.soundFont : 'basic'
        const a = new at.AlphaTabApi(host.current, {
          core: { scriptFile: urls.script, fontDirectory: urls.fonts, useWorkers: true },
          importer: { encoding: chooseEncoding(at, bytes) },
          display: {
            staveProfile: staveProfileOf(at, cur.prefs.staff),
            scale: effectiveScale(cur.prefs),
            layoutMode: at.LayoutMode.Page,
            resources: sheetResources(cur.prefs.sheet),
          },
          // The "Words & Music by …" line is wider than a phone screen.
          ...(isPhone() ? { notation: { elements: { scoreWordsAndMusic: false } } } : {}),
          player: {
            playerMode: at.PlayerMode.EnabledSynthesizer,
            soundFont: soundFontUrl(font),
            scrollElement: (document.scrollingElement ?? document.documentElement) as HTMLElement,
            scrollMode: at.ScrollMode.Continuous,
            enableCursor: true,
            enableUserInteraction: true,
            // The row being played sits about a third of the way down the page.
            scrollOffsetY: -Math.round(window.innerHeight / 3),
          },
        } as never)
        api.current = a
        a.countInVolume = cur.countIn ? 1 : 0
        a.metronomeVolume = cur.metro ? 1 : 0
        a.playbackSpeed = cur.speedPct / 100
        a.scoreLoaded.on((s) => {
          cleanHeader(s)
          tidyTempoMarks(s)
          if (live.current.transpose) applyTranspose(a, s, live.current.transpose)
          setScore(s)
          setVolumes((v) => (again && v.length === s.tracks.length ? v : s.tracks.map(() => 100)))
          setPhase('ready')
          // No sound font after a while: keep the notation, hide the playback keys (a larger
          // sound font that never arrives is given up for the basic one).
          window.clearTimeout(soundTimer)
          soundTimer = window.setTimeout(
            () => {
              if (disposed || playerReadyRef.current) return
              if (font === 'basic') {
                setSoundFailed(true)
                return
              }
              setRestoreNote('高品质音色没能加载，已换回标准音色。')
              window.setTimeout(() => setRestoreNote(''), 5000)
              setPrefs((p) => ({ ...p, soundFont: 'basic' }))
            },
            font === 'basic' ? SOUND_WAIT_MS : BIG_SOUND_WAIT_MS,
          )
          if (again) return
          // Last time's speed, loop and muted tracks.
          void loadPracticeFor(path).then((r) => {
            if (disposed) return
            if (r) {
              if (bandSpeedRef.current === null) setSpeedPct(r.speedPct)
              setMute(new Set(r.muted.filter((i) => i < s.tracks.length)))
              const bars =
                r.loopBars && r.loopBars[1] <= s.masterBars.length ? r.loopBars : null
              if (bars && rendered) highlightBars(a, s, live.current.track, bars)
              else pendingBars.current = bars
              const parts = [`${r.speedPct}%`]
              if (bars) parts.push(bars[0] === bars[1] ? `第 ${bars[0]} 小节` : `第 ${bars[0]}–${bars[1]} 小节`)
              if (r.speedPct !== 100 || bars || r.muted.length) {
                setRestoreNote(`已恢复上次的练习：${parts.join(' · ')}`)
                window.setTimeout(() => setRestoreNote(''), 4000)
              }
            }
            clock.current.restored = true
          })
        })
        a.renderStarted.on(() => setRendering(true))
        a.renderFinished.on(() => {
          setRendering(false)
          // The loop range can be drawn only once the bars are laid out.
          rendered = true
          const bars = pendingBars.current
          const s = live.current.score
          if (bars && s) {
            pendingBars.current = null
            highlightBars(a, s, live.current.track, bars)
          }
        })
        a.soundFontLoad.on((e) => setSoundPct(Math.round((e.loaded / Math.max(1, e.total)) * 100)))
        // A larger sound font that cannot be read (too big for this device's memory, a broken
        // download…) falls back to the basic one instead of leaving the player silent.
        a.error.on(() => {
          if (disposed || playerReadyRef.current || font === 'basic') return
          setRestoreNote('这个音色在这台设备上没能加载，已换回标准音色。')
          window.setTimeout(() => setRestoreNote(''), 6000)
          setPrefs((p) => ({ ...p, soundFont: 'basic' }))
        })
        a.playerReady.on(() => {
          playerReadyRef.current = true
          setSoundFailed(false)
          setReady(true)
        })
        // A sound font chosen later: playback is back as soon as it is in.
        a.soundFontLoaded.on(() => {
          if (playerReadyRef.current) setReady(true)
        })
        a.playerStateChanged.on((e) => {
          const on = e.state === 1
          setPlaying(on)
          const c = clock.current
          if (on && !c.startedAt) {
            c.startedAt = Date.now()
            c.maxSpeed = Math.max(c.maxSpeed, live.current.speedPct)
          } else if (!on && c.startedAt) {
            c.seconds += (Date.now() - c.startedAt) / 1000
            c.startedAt = 0
            flushRef.current(false)
          }
        })
        a.playerPositionChanged.on((e) =>
          setTime({ now: e.currentTime, end: e.endTime, tick: e.currentTick }),
        )
        a.activeBeatsChanged.on((e) => {
          if (live.current.prefs.fretboard)
            setActiveNotes(notesFromBeats(e.activeBeats, live.current.track))
        })
        // One pass of the loop is over: count it, speed up, and (with a pause or a count-in)
        // start the next one by hand.
        a.playerFinished.on(() => {
          const L = live.current
          if (!L.loop || !L.loopState || L.loopState.done) return
          const t = L.prefs.trainer
          const next = nextPass(t, L.loopState)
          setLoopState(next)
          const manual = isManualLoop(t)
          if (next.done) {
            if (!manual) a.stop()
            return
          }
          if (t.enabled) {
            a.playbackSpeed = next.speedPct / 100
            setSpeedPct(next.speedPct)
          }
          if (!manual) return
          cancelGap()
          const wait = gapMs(t.gapBeats, L.score?.tempo ?? 0, next.speedPct)
          gapTimer.current = window.setTimeout(
            () => {
              gapTimer.current = undefined
              if (!live.current.loop || !api.current) return
              a.countInVolume = t.countInEachLoop ? 1 : 0
              a.play()
              a.countInVolume = live.current.countIn ? 1 : 0
            },
            Math.max(80, wait),
          )
        })
        // Setting the playback range fires this event again: apply it once, and only while
        // looping (otherwise just remember the selection, so dragging never clears itself).
        let applying = false
        a.playbackRangeHighlightChanged.on((e) => {
          const sel = Boolean(e.startBeat && e.endBeat)
          selRef.current = sel
          setHasSelection(sel)
          const bars: [number, number] | null =
            e.startBeat && e.endBeat
              ? [e.startBeat.voice.bar.index + 1, e.endBeat.voice.bar.index + 1]
              : null
          setSelBars((old) => (sameBars(old, bars) ? old : bars))
          if (applying || !live.current.loop) return
          applying = true
          try {
            syncLoop(a, true, sel, isManualLoop(live.current.prefs.trainer))
          } finally {
            applying = false
          }
        })
        if (!a.load(bytes, [0])) {
          setMessage('这个文件没能显示出来。可以下载后用电脑上的 Guitar Pro 打开。')
          setPhase('error')
        }
      } catch (e) {
        if (!disposed) {
          setMessage(errorText(e))
          setPhase('error')
        }
      }
    }
    void run()
    const onHide = () => flushRef.current(true)
    window.addEventListener('pagehide', onHide)
    return () => {
      disposed = true
      ac.abort()
      window.removeEventListener('pagehide', onHide)
      flushRef.current(true)
      window.clearTimeout(soundTimer)
      cancelGap()
      api.current?.destroy()
      api.current = null
    }
  }, [path, soundFontChoice])

  // Band song: show this member's own part, play along with the others, at the band's speed.
  const bandApplied = useRef('')
  useEffect(() => {
    if (!score || !bandSong) return
    const key = `${bandSong.id}:${path}`
    if (bandApplied.current === key) return
    bandApplied.current = key
    if (myTrack !== null && myTrack < score.tracks.length) {
      setTrack(myTrack)
      setFollowAlong(true)
    }
    if (bandSpeed !== null) setSpeedPct(bandSpeed)
    // Keyboard players and singers read notes: tab alone hides them (some files write the
    // keyboard part as guitar tab), so show the standard staff above it.
    if ((me?.instrument === 'keys' || me?.instrument === 'vocal') && live.current.prefs.staff === 'Tab')
      setPrefs((p) => ({ ...p, staff: 'ScoreTab' }))
  }, [score, bandSong, myTrack, bandSpeed, path, me?.instrument])

  // Track shown on the sheet.
  useEffect(() => {
    const a = api.current
    const t = score?.tracks[track]
    const at = window.alphaTab
    if (a && t && at) {
      // Drums, piano and other parts without tab are drawn in 五线谱 whatever 谱面 says.
      const want = staveProfileOf(at, staffFor(t, live.current.prefs.staff))
      if (a.settings.display.staveProfile !== want) {
        a.settings.display.staveProfile = want as never
        a.updateSettings()
      }
      a.renderTracks([t])
    }
    setActiveNotes([])
  }, [track, score])

  // Notation and sheet: staff profile, zoom and colours (one re-render for all three).
  useEffect(() => {
    const a = api.current
    const at = window.alphaTab
    if (!a || !score || !at) return
    a.settings.display.staveProfile = staveProfileOf(
      at,
      staffFor(score.tracks[live.current.track], prefs.staff),
    ) as never
    a.settings.display.scale = effectiveScale(prefs)
    a.settings.fillFromJson({ display: { resources: sheetResources(prefs.sheet) } } as never)
    a.updateSettings()
    a.render()
  }, [prefs.staff, prefs.zoom, prefs.sheet, score]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => savePrefs(prefs), [prefs])

  // 变调: applied to the staves and the playback; the file's own transposition is kept aside.
  useEffect(() => {
    const a = api.current
    if (!a || !score) return
    applyTranspose(a, score, transpose)
    a.updateSettings()
    a.render()
    a.loadMidiForScore()
  }, [transpose, score])

  const togetherRef = useRef(together)
  togetherRef.current = together
  useEffect(() => {
    if (!leading) return
    const t = togetherRef.current
    if (t.state && t.state.speedPct !== speedPct) t.speed(speedPct)
  }, [speedPct, leading])
  useEffect(() => {
    if (api.current) api.current.playbackSpeed = speedPct / 100
    const c = clock.current
    if (c.startedAt) c.maxSpeed = Math.max(c.maxSpeed, speedPct)
  }, [speedPct])
  useEffect(() => {
    if (api.current) api.current.countInVolume = countIn ? 1 : 0
  }, [countIn])
  useEffect(() => {
    if (api.current) api.current.metronomeVolume = metro || metroOnly ? 1 : 0
  }, [metro, metroOnly])

  // Muting: the student's M keys, plus 跟着练 (the shown track) and 只放节拍器 (everything).
  useEffect(() => {
    const a = api.current
    if (!a || !score) return
    score.tracks.forEach((t, i) =>
      a.changeTrackMute([t], metroOnly || mute.has(i) || (followAlong && i === track)),
    )
  }, [mute, followAlong, metroOnly, track, score])

  useEffect(() => {
    const a = api.current
    if (!a || !score) return
    score.tracks.forEach((t, i) => a.changeTrackSolo([t], solo.has(i)))
  }, [solo, score])

  useEffect(() => {
    const a = api.current
    if (!a || !score) return
    score.tracks.forEach((t, i) => a.changeTrackVolume([t], (volumes[i] ?? 100) / 100))
  }, [volumes, score])

  // Loop: the range, and how passes follow each other.
  const manual = isManualLoop(prefs.trainer)
  useEffect(() => {
    if (api.current && score) syncLoop(api.current, loop, selRef.current, manual)
    if (!loop) cancelGap()
  }, [loop, score, manual])

  // A new loop run (loop switched on, trainer switched, or another selection) starts at pass 1.
  const trainerOn = prefs.trainer.enabled
  const barsKey = selBars ? selBars.join('-') : ''
  useEffect(() => {
    if (!loop) {
      setLoopState(null)
      return
    }
    const s = startLoop(live.current.prefs.trainer, live.current.speedPct)
    setLoopState(s)
    if (live.current.prefs.trainer.enabled) setSpeedPct(s.speedPct)
  }, [loop, trainerOn, barsKey])

  // State to remember (speed, loop range, muted tracks), saved shortly after it settles.
  const mutedKey = [...mute].sort((a, b) => a - b).join(',')
  useEffect(() => {
    if (!clock.current.restored) return
    const timer = window.setTimeout(() => flushRef.current(false), 2000)
    return () => window.clearTimeout(timer)
  }, [speedPct, barsKey, mutedKey])

  // While playing, the time is saved every half minute.
  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => flushRef.current(false), SAVE_EVERY_MS)
    return () => window.clearInterval(timer)
  }, [playing])

  // A phone turned sideways: the remote folds away while playing, to leave the sheet free.
  useEffect(() => {
    if (playing && isShortLandscape()) {
      setPop(null)
      setCollapsed(true)
    }
  }, [playing])

  const toggleSolo = (i: number) =>
    setSolo((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  const toggleMute = (i: number) =>
    setMute((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  // Playback keys.
  const playable = ready && !soundFailed
  const togglePlay = () => {
    if (!playable) return
    if (following) {
      setRestoreNote('正在跟随主控播放，由主控开始和暂停。')
      window.setTimeout(() => setRestoreNote(''), 3000)
      return
    }
    if (leading) {
      if (playing) together.pause()
      else together.play()
      return
    }
    if (gapTimer.current !== undefined) {
      // Paused between two passes: stay stopped.
      cancelGap()
      return
    }
    // After the last pass, play starts a new run from pass 1.
    if (live.current.loop && live.current.loopState?.done) {
      const s = startLoop(live.current.prefs.trainer, live.current.speedPct)
      setLoopState(s)
      if (live.current.prefs.trainer.enabled) {
        setSpeedPct(s.speedPct)
        if (api.current) api.current.playbackSpeed = s.speedPct / 100
      }
    }
    api.current?.playPause()
  }
  const backToStart = () => {
    const a = api.current
    if (!a || !playable || following) return
    if (leading) {
      together.seek(a.playbackRange?.startTick ?? 0)
      if (playing) together.pause()
      return
    }
    cancelGap()
    const start = a.playbackRange?.startTick ?? 0
    a.stop()
    a.tickPosition = start
    if (live.current.loop) {
      const s = startLoop(live.current.prefs.trainer, live.current.speedPct)
      setLoopState(s)
      if (live.current.prefs.trainer.enabled) setSpeedPct(s.speedPct)
    }
  }
  const setSpeed = (pct: number) =>
    setSpeedPct(Math.max(SPEED_MIN, Math.min(SPEED_MAX, Math.round(pct))))
  const shift = (d: number) => setTranspose((t) => clampTranspose(t + d))
  const openPop = (k: PopKind) => {
    setCollapsed(false)
    setPop((cur) => (cur === k ? null : k))
  }
  const toggleFretboard = () => setPrefs((p) => ({ ...p, fretboard: !p.fretboard }))

  // Keyboard: on the viewer only, never while typing.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const target = e.target as HTMLElement | null
    if (target?.closest('input, select, textarea, [contenteditable="true"]')) return
    if (e.key === 'Escape') {
      if (pop) {
        setPop(null)
        e.preventDefault()
      }
      return
    }
    if (!score) return
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    let handled = true
    if (k === ' ' || k === 'Spacebar') togglePlay()
    else if (k === 'Backspace') backToStart()
    else if (k === 'l') setLoop((v) => !v)
    else if (k === 's') openPop('speed')
    else if (k === 't') openPop('tracks')
    else if (k === 'k') openPop('key')
    else if (k === 'p') openPop('practice')
    else if (k === 'b') toggleFretboard()
    else if (k === 'c') setCountIn((v) => !v)
    else if (k === 'm') toggleMute(track)
    else if (k === 'f') void star.toggle()
    else handled = false
    if (handled) e.preventDefault()
  }
  // A click anywhere outside the remote closes its popover.
  useEffect(() => {
    if (!pop) return
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement | null)?.closest('.gl-remote')) setPop(null)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [pop])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const tracks = score?.tracks ?? []
  const masterBars = score?.masterBars ?? []
  let bar = 0
  for (let i = 0; i < masterBars.length; i++) {
    if ((masterBars[i]?.start ?? 0) <= time.tick) bar = i + 1
    else break
  }
  const loaded = phase === 'ready'
  const sound: 'loading' | 'ready' | 'off' = soundFailed ? 'off' : ready ? 'ready' : 'loading'
  const trackNames = useMemo(
    () =>
      trackLabels(score?.tracks ?? []).map((l, i) =>
        l.original ? `${l.zh}（${l.original}）` : l.zh || `音轨 ${i + 1}`,
      ),
    [score],
  )
  const shownTrack = tracks[track]
  const showFretboard = prefs.fretboard && shownTrack !== undefined && hasFretboard(shownTrack)
  const status =
    loop && loopState
      ? loopState.done
        ? `已练完 ${loopState.pass} 遍`
        : loopStatus(prefs.trainer, loopState)
      : null

  return (
    <div className="score-bleed">
      <style>{SHEET_CSS}</style>
      {bandSong && (
        <div className="gutter mx-auto mb-2 w-full max-w-[1180px]">
          <LiveBar
            live={together}
            members={bandState?.members ?? []}
            myId={me?.id ?? null}
          />
          {myTrack !== null && (
            <p className="mt-1 text-xs text-muted-foreground">
              你在这首歌里弹「{trackNames[myTrack] ?? `音轨 ${myTrack + 1}`}」，已自动显示你的声部并静音它，其他声部照常伴奏。
            </p>
          )}
        </div>
      )}
      {phase === 'error' && (
        <div className="px-4">
          <Notice tone="error">{message}</Notice>
        </div>
      )}
      <div
        className={cx(
          'score-sheet sheet relative',
          prefs.sheet === 'paper' && 'sheet-paper',
          phase === 'error' && 'hidden',
        )}
        style={{
          minHeight: phase === 'loading' ? '60vh' : undefined,
          paddingTop: 16,
          paddingLeft: 'max(12px, env(safe-area-inset-left, 0px))',
          paddingRight: 'max(12px, env(safe-area-inset-right, 0px))',
          paddingBottom: loaded ? 'calc(230px + env(safe-area-inset-bottom, 0px))' : 16,
        }}
      >
        {showFretboard && (
          <div
            className="sticky z-20 -mx-3 mb-2 border-b border-[color:var(--sheet-line)] px-3 py-1"
            style={{ top: headerH, background: 'var(--sheet-bg)' }}
          >
            <Fretboard labels={tuningLabels(shownTrack)} notes={activeNotes} />
          </div>
        )}
        {prefs.fretboard && shownTrack && !showFretboard && loaded && (
          <p className="mb-2 text-xs text-[color:var(--sheet-dim)]">
            这一轨不是弦乐器的六线谱，没有指板可显示。
          </p>
        )}
        {phase === 'loading' && (
          <div
            role="status"
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 text-[color:var(--sheet-dim)]"
          >
            <p className="text-sm">{slow ? '这个文件读得比较慢，请再等一等…' : '正在排谱…'}</p>
            <div aria-hidden className="flex gap-2">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-2 w-2 rounded-full bg-[color:var(--sheet-pen)] motion-safe:animate-pulse"
                  style={{ animationDelay: `${i * 180}ms` }}
                />
              ))}
            </div>
          </div>
        )}
        {rendering && (
          <p className="pointer-events-none absolute right-3 top-2 z-10 text-xs text-[color:var(--sheet-dim)]">
            正在排版…
          </p>
        )}
        <div ref={host} className="at-surface w-full" />
      </div>

      {loaded && score && (
        <Remote
          pop={pop}
          onPop={setPop}
          collapsed={collapsed}
          onCollapsed={(c) => {
            setCollapsed(c)
            if (c) setPop(null)
          }}
          sound={sound}
          soundPct={soundPct}
          playing={playing}
          onPlayPause={togglePlay}
          onBackToStart={backToStart}
          now={time.now}
          end={time.end}
          bar={bar}
          bars={masterBars.length}
          speedPct={speedPct}
          onSpeedPct={setSpeed}
          tempo={score.tempo ?? 0}
          loop={loop}
          onLoop={() => setLoop((v) => !v)}
          hasSelection={hasSelection}
          countIn={countIn}
          onCountIn={() => setCountIn((v) => !v)}
          metro={metro}
          onMetro={() => setMetro((v) => !v)}
          tracks={trackNames}
          track={track}
          onShowTrack={setTrack}
          solo={solo}
          mute={mute}
          onSolo={toggleSolo}
          onMute={toggleMute}
          transpose={transpose}
          onTranspose={shift}
          staff={prefs.staff}
          staffHint={
            shownTrack && staffFor(shownTrack, prefs.staff) !== prefs.staff
              ? '这一轨没有六线谱（鼓、键盘、人声等），自动用五线谱显示。'
              : ''
          }
          onStaff={(s: StaffMode) => setPrefs((p) => ({ ...p, staff: s }))}
          scale={effectiveScale(prefs)}
          onScale={(z: number) => setPrefs((p) => ({ ...p, zoom: z }))}
          sheet={prefs.sheet}
          onSheet={(s: SheetMode) => setPrefs((p) => ({ ...p, sheet: s }))}
          starred={star.starred}
          onStar={() => void star.toggle()}
          downloadHref={fileUrl(path, true)}
          note={star.note || restoreNote}
          practiceActive={(loop && trainerOn) || followAlong || metroOnly}
          followAlong={followAlong}
          onFollowAlong={() => setFollowAlong((v) => !v)}
          metroOnly={metroOnly}
          onMetroOnly={() => setMetroOnly((v) => !v)}
          trainer={prefs.trainer}
          onTrainer={(t: TrainerConfig) => setPrefs((p) => ({ ...p, trainer: t }))}
          loopStatus={status}
          volumes={volumes}
          onVolume={(i: number, pct: number) =>
            setVolumes((v) => v.map((x, j) => (j === i ? pct : x)))
          }
          fretboard={prefs.fretboard}
          onFretboard={toggleFretboard}
          soundFonts={soundFonts}
          soundFont={prefs.soundFont}
          onSoundFont={(id: SoundFontId) => setPrefs((p) => ({ ...p, soundFont: id }))}
        />
      )}
    </div>
  )
}
