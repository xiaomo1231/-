import { useEffect, useRef, useState } from 'react'
import type { AlphaTabApi, model } from '@coderline/alphatab'
import type { ScoreFormat } from '@/songs/scoreLibraryTypes'
import { errorText, fetchBytes, fileUrl } from '../lib/api'
import { clampTranspose } from '../lib/transpose'
import { cx } from '../lib/classes'
import { Notice } from '../components/ui'
import { alphaTabUrls, applyTranspose, chooseEncoding, cleanHeader, loadAlphaTab } from './alphaTab'
import {
  effectiveScale,
  isPhone,
  loadPrefs,
  savePrefs,
  SPEED_MAX,
  SPEED_MIN,
  sheetResources,
  staveProfileOf,
  type ScorePrefs,
  type StaffMode,
  type SheetMode,
} from './scorePrefs'
import { Remote, useStar, type PopKind } from './Remote'

/** After this long without a score, say the file is slow to read. */
const SLOW_MS = 20000
/** Playback needs the sound font; after this long without it, the playback keys are hidden. */
const SOUND_WAIT_MS = 60000

/** The sheet's own colours: the cursor, the selection and the highlight follow the pen blue. */
const SHEET_CSS = `
.score-sheet .at-surface .at-cursor-beat { background: var(--sheet-pen); width: 3px; }
.score-sheet .at-surface .at-cursor-bar { background: color-mix(in srgb, var(--sheet-pen) 12%, transparent); }
.score-sheet .at-surface .at-selection div { background: color-mix(in srgb, var(--sheet-pen) 22%, transparent); }
.score-sheet .at-surface .at-highlight * { fill: var(--sheet-pen); stroke: var(--sheet-pen); }
.score-sheet .at-surface { min-height: 12rem; }
`

type Phase = 'loading' | 'ready' | 'error'

interface Props {
  path: string
  title: string
  artist: string
  pages: string[]
}

/** Loop range for the current choices: the user's selection, or the whole piece when none. */
function syncLoop(a: AlphaTabApi, loop: boolean, hasSelection: boolean): void {
  if (!loop) {
    a.playbackRange = null
    a.isLooping = false
    return
  }
  if (hasSelection) a.applyPlaybackRangeFromHighlight()
  else a.playbackRange = null
  a.isLooping = true
}

/** A Guitar Pro / MusicXML file, shown and played by alphaTab (read in place, never saved). */
export function ScoreViewer({ path, title, artist, pages }: Props) {
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
  const [countIn, setCountIn] = useState(true)
  const [metro, setMetro] = useState(false)
  const [solo, setSolo] = useState<Set<number>>(new Set())
  const [mute, setMute] = useState<Set<number>>(new Set())
  const [pop, setPop] = useState<PopKind | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [time, setTime] = useState({ now: 0, end: 0, tick: 0 })
  const star = useStar({
    path,
    format: 'score' as ScoreFormat,
    pages,
    title,
    artist,
  })

  // alphaTab callbacks and key handling read the latest values from here.
  const live = useRef({ prefs, transpose, loop, hasSelection, countIn, metro, speedPct })
  live.current = { prefs, transpose, loop, hasSelection, countIn, metro, speedPct }
  const selRef = useRef(false)

  useEffect(() => {
    if (phase !== 'loading') return
    const timer = window.setTimeout(() => setSlow(true), SLOW_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  // Create the viewer once per file.
  useEffect(() => {
    const ac = new AbortController()
    let disposed = false
    let soundTimer: number | undefined
    const playerReadyRef = { current: false }
    const run = async () => {
      try {
        const urls = alphaTabUrls()
        const [bytes, at] = await Promise.all([
          fetchBytes(fileUrl(path), ac.signal),
          loadAlphaTab(),
        ])
        if (disposed || !host.current) return
        const cur = live.current
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
            soundFont: urls.soundFont,
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
          if (live.current.transpose) applyTranspose(a, s, live.current.transpose)
          setScore(s)
          setPhase('ready')
          // No sound font after a while: keep the notation, hide the playback keys.
          window.clearTimeout(soundTimer)
          soundTimer = window.setTimeout(() => {
            if (!disposed && !playerReadyRef.current) setSoundFailed(true)
          }, SOUND_WAIT_MS)
        })
        a.renderStarted.on(() => setRendering(true))
        a.renderFinished.on(() => setRendering(false))
        a.soundFontLoad.on((e) => setSoundPct(Math.round((e.loaded / Math.max(1, e.total)) * 100)))
        a.playerReady.on(() => {
          playerReadyRef.current = true
          setSoundFailed(false)
          setReady(true)
        })
        a.playerStateChanged.on((e) => setPlaying(e.state === 1))
        a.playerPositionChanged.on((e) =>
          setTime({ now: e.currentTime, end: e.endTime, tick: e.currentTick }),
        )
        // Setting the playback range fires this event again: apply it once, and only while
        // looping (otherwise just remember the selection, so dragging never clears itself).
        let applying = false
        a.playbackRangeHighlightChanged.on((e) => {
          const sel = Boolean(e.startBeat && e.endBeat)
          selRef.current = sel
          setHasSelection(sel)
          if (applying || !live.current.loop) return
          applying = true
          try {
            syncLoop(a, true, sel)
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
    return () => {
      disposed = true
      ac.abort()
      window.clearTimeout(soundTimer)
      api.current?.destroy()
      api.current = null
    }
  }, [path])

  // Track shown on the sheet.
  useEffect(() => {
    const a = api.current
    const t = score?.tracks[track]
    if (a && t) a.renderTracks([t])
  }, [track, score])

  // Notation and sheet: staff profile, zoom and colours (one re-render for all three).
  useEffect(() => {
    const a = api.current
    const at = window.alphaTab
    if (!a || !score || !at) return
    a.settings.display.staveProfile = staveProfileOf(at, prefs.staff) as never
    a.settings.display.scale = effectiveScale(prefs)
    a.settings.fillFromJson({ display: { resources: sheetResources(prefs.sheet) } } as never)
    a.updateSettings()
    a.render()
    savePrefs(prefs)
  }, [prefs, score])

  // 变调: applied to the staves and the playback; the file's own transposition is kept aside.
  useEffect(() => {
    const a = api.current
    if (!a || !score) return
    applyTranspose(a, score, transpose)
    a.updateSettings()
    a.render()
    a.loadMidiForScore()
  }, [transpose, score])

  useEffect(() => {
    if (api.current) api.current.playbackSpeed = speedPct / 100
  }, [speedPct])
  useEffect(() => {
    if (api.current) api.current.countInVolume = countIn ? 1 : 0
  }, [countIn])
  useEffect(() => {
    if (api.current) api.current.metronomeVolume = metro ? 1 : 0
  }, [metro])
  useEffect(() => {
    if (api.current && score) syncLoop(api.current, loop, selRef.current)
  }, [loop, score])

  // Solo / mute for the tracks: alphaTab keeps these per track.
  const toggleSolo = (i: number) => {
    const a = api.current
    const t = score?.tracks[i]
    if (!a || !t) return
    const on = !solo.has(i)
    a.changeTrackSolo([t], on)
    setSolo((prev) => {
      const next = new Set(prev)
      if (on) next.add(i)
      else next.delete(i)
      return next
    })
  }
  const toggleMute = (i: number) => {
    const a = api.current
    const t = score?.tracks[i]
    if (!a || !t) return
    const on = !mute.has(i)
    a.changeTrackMute([t], on)
    setMute((prev) => {
      const next = new Set(prev)
      if (on) next.add(i)
      else next.delete(i)
      return next
    })
  }

  // Playback keys.
  const playable = ready && !soundFailed
  const togglePlay = () => {
    if (playable) api.current?.playPause()
  }
  const backToStart = () => {
    const a = api.current
    if (!a || !playable) return
    const start = a.playbackRange?.startTick ?? 0
    a.stop()
    a.tickPosition = start
  }
  const setSpeed = (pct: number) =>
    setSpeedPct(Math.max(SPEED_MIN, Math.min(SPEED_MAX, Math.round(pct))))
  const shift = (d: number) => setTranspose((t) => clampTranspose(t + d))
  const openPop = (k: PopKind) => {
    setCollapsed(false)
    setPop((cur) => (cur === k ? null : k))
  }

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

  return (
    <div className="score-bleed">
      <style>{SHEET_CSS}</style>
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
          tracks={tracks.map((t, i) => t.name.trim() || `音轨 ${i + 1}`)}
          track={track}
          onShowTrack={setTrack}
          solo={solo}
          mute={mute}
          onSolo={toggleSolo}
          onMute={toggleMute}
          transpose={transpose}
          onTranspose={shift}
          staff={prefs.staff}
          onStaff={(s: StaffMode) => setPrefs((p) => ({ ...p, staff: s }))}
          scale={effectiveScale(prefs)}
          onScale={(z: number) => setPrefs((p) => ({ ...p, zoom: z }))}
          sheet={prefs.sheet}
          onSheet={(s: SheetMode) => setPrefs((p) => ({ ...p, sheet: s }))}
          starred={star.starred}
          onStar={() => void star.toggle()}
          downloadHref={fileUrl(path, true)}
          note={star.note}
        />
      )}
    </div>
  )
}
