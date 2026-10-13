import { useEffect, useRef, useState } from 'react'
import { Eye, Gauge, Headphones, Loader2, Pause, Play, Repeat, Square, Timer, Volume2, VolumeX } from 'lucide-react'
import type { AlphaTabApi, model } from '@coderline/alphatab'
import { alphaTabUrls, loadAlphaTab } from '@/audio/alphatabLoader'
import { loadScoreDecoded } from '@/audio/alphatabEncoding'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

export type StaffMode = 'ScoreTab' | 'Tab' | 'Score'

export interface BarRange {
  from: number
  /** Exclusive. */
  to: number
}

export interface AlphaTabViewProps {
  bytes: Uint8Array
  track: number
  staff: StaffMode
  /** Bars to loop when looping is on. */
  range: BarRange
  /** Called once the file is parsed, with the score for the practice panel. */
  onScore?: (score: model.Score) => void
  /** The player, for features that follow its clock (原曲伴奏). */
  onApi?: (api: AlphaTabApi | null) => void
  /** Another panel controls which tracks sound (原曲伴奏): hide the track mixer and play-along toggle. */
  externalMix?: boolean
  /** 变调: semitones for every pitched track (notation and playback; tab frets stay as written). */
  transpose?: number
}

/** A staff's own transposition from the file, remembered before 变调 changes it. */
const fileTransposition = new WeakMap<object, number>()

/** A CSS colour (any syntax, including theme variables) as "rgb(r, g, b)" for alphaTab. */
function cssColor(value: string): string {
  const el = document.createElement('span')
  el.style.color = value
  el.style.display = 'none'
  document.body.appendChild(el)
  const rgb = getComputedStyle(el).color
  el.remove()
  return rgb
}

function themeResources() {
  const fg = cssColor('hsl(var(--foreground))')
  const muted = cssColor('hsl(var(--muted-foreground))')
  const line = cssColor('hsl(var(--muted-foreground) / 0.55)')
  return { mainGlyphColor: fg, secondaryGlyphColor: muted, scoreInfoColor: fg, barNumberColor: muted, staffLineColor: line, barSeparatorColor: line }
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const SPEEDS = [0.5, 0.6, 0.75, 0.9, 1, 1.25]

/** What the sheet shows on top of the notes; the noisiest are off by default. */
const DISPLAY_ITEMS = [
  { key: 'chords', label: '和弦名', elements: ['EffectChordNames'], on: true },
  { key: 'markers', label: '段落名', elements: ['EffectMarker'], on: true },
  { key: 'text', label: '文字注释', elements: ['EffectText'], on: false },
  { key: 'letRing', label: '延音（LetRing）', elements: ['EffectLetRing', 'EffectPalmMute'], on: false },
  { key: 'dynamics', label: '力度记号', elements: ['EffectDynamics', 'EffectCrescendo'], on: true },
  { key: 'technique', label: '技巧文字（H / P / 推弦…）', elements: ['EffectTap', 'EffectLeftHandTap', 'EffectPickStroke', 'EffectFingering', 'EffectHarmonics'], on: true },
  { key: 'lyrics', label: '歌词', elements: ['EffectLyrics'], on: true },
  { key: 'tempo', label: '速度与拍号标记', elements: ['EffectTempo', 'EffectTripletFeel'], on: true },
] as const
type DisplayKey = (typeof DISPLAY_ITEMS)[number]['key']
const DISPLAY_STORE = 'groovelab:sheet-display'

function loadDisplay(): Record<DisplayKey, boolean> {
  const base = Object.fromEntries(DISPLAY_ITEMS.map((d) => [d.key, d.on])) as Record<DisplayKey, boolean>
  try {
    return { ...base, ...(JSON.parse(localStorage.getItem(DISPLAY_STORE) ?? '{}') as Partial<Record<DisplayKey, boolean>>) }
  } catch {
    return base
  }
}

/**
 * alphaTab's notation.elements for the chosen display, keyed by element name
 * (the form its settings JSON takes — numeric keys do not survive the trip to
 * the render worker).
 */
function displayElements(display: Record<DisplayKey, boolean>): Map<string, boolean> {
  const m = new Map<string, boolean>()
  for (const d of DISPLAY_ITEMS) for (const el of d.elements) m.set(el, display[d.key])
  return m
}

/**
 * The sheet as written (alphaTab): standard notation and / or tab, playback
 * with a following cursor, speed, loop, count-in, metronome and per-track
 * mute / solo — including "play along", which mutes the student's track.
 */
export function AlphaTabView({ bytes, track, staff, range, onScore, onApi, externalMix, transpose = 0 }: AlphaTabViewProps) {
  const host = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const api = useRef<AlphaTabApi | null>(null)
  const [score, setScore] = useState<model.Score | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(true)
  const [soundPct, setSoundPct] = useState(0)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState({ now: 0, end: 0 })
  const [speed, setSpeed] = useState(1)
  const [loop, setLoop] = useState(false)
  const [countIn, setCountIn] = useState(true)
  const [metronome, setMetronome] = useState(false)
  const [muted, setMuted] = useState<Set<number>>(new Set())
  const [solo, setSolo] = useState<Set<number>>(new Set())
  const [display, setDisplay] = useState(loadDisplay)
  const [displayOpen, setDisplayOpen] = useState(false)
  const onScoreRef = useRef(onScore)
  onScoreRef.current = onScore
  const onApiRef = useRef(onApi)
  onApiRef.current = onApi

  // Create the viewer once per file.
  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const at = await loadAlphaTab()
        if (disposed || !host.current || !scroller.current) return
        const urls = alphaTabUrls()
        // Chinese Guitar Pro 3–5 files keep their texts in GBK: find the encoding that reads cleanly.
        let encoding = 'utf-8'
        try {
          encoding = loadScoreDecoded(at, bytes).encoding
        } catch {
          // alphaTab reports unreadable files itself below
        }
        const a = new at.AlphaTabApi(host.current, {
          core: { scriptFile: urls.script, fontDirectory: urls.fonts, useWorkers: true },
          importer: { encoding },
          notation: { elements: displayElements(loadDisplay()) },
          display: { staveProfile: staff, scale: 0.95, resources: themeResources() },
          player: { playerMode: at.PlayerMode.EnabledSynthesizer, soundFont: urls.soundFont, scrollElement: scroller.current, enableCursor: true, enableUserInteraction: true, scrollOffsetY: -30 },
        } as never)
        api.current = a
        onApiRef.current?.(a)
        a.scoreLoaded.on((s) => {
          setScore(s)
          onScoreRef.current?.(s)
        })
        a.renderStarted.on(() => setRendering(true))
        a.renderFinished.on(() => setRendering(false))
        a.soundFontLoad.on((e) => setSoundPct(Math.round((e.loaded / Math.max(1, e.total)) * 100)))
        a.playerReady.on(() => setReady(true))
        a.playerStateChanged.on((e) => setPlaying(e.state === 1))
        a.playerPositionChanged.on((e) => setTime({ now: e.currentTime, end: e.endTime }))
        a.countInVolume = 1
        a.metronomeVolume = 0
        if (!a.load(bytes, [track])) setError('这个文件没能显示出来。')
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : '乐谱组件加载失败。')
      }
    })()
    return () => {
      disposed = true
      onApiRef.current?.(null)
      api.current?.destroy()
      api.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes])

  // Track switch.
  useEffect(() => {
    const a = api.current
    const t = score?.tracks[track]
    if (a && t) a.renderTracks([t])
  }, [track, score])

  // What is shown above / below the notes.
  useEffect(() => {
    const a = api.current
    try {
      localStorage.setItem(DISPLAY_STORE, JSON.stringify(display))
    } catch {
      // storage blocked: the choice lasts for this visit
    }
    if (!a || !score) return
    a.settings.fillFromJson({ notation: { elements: displayElements(display) } } as never)
    a.updateSettings()
    a.render()
  }, [display, score])

  // Notation mode.
  useEffect(() => {
    const a = api.current
    if (!a || !score) return
    a.settings.display.staveProfile = (window.alphaTab?.StaveProfile[staff] ?? 0) as never
    a.updateSettings()
    a.render()
  }, [staff, score])

  // 变调. alphaTab reads settings.notation.transpositionPitches only when a score is loaded,
  // so the staves get the same value directly; then re-render and rebuild the playback.
  useEffect(() => {
    const a = api.current
    if (!a || !score) return
    a.settings.notation.transpositionPitches = score.tracks.map((t) => {
      const st = t.staves[0]
      if (!st || st.isPercussion) return 0
      if (!fileTransposition.has(st)) fileTransposition.set(st, st.transpositionPitch)
      const own = fileTransposition.get(st)!
      for (const x of t.staves) x.transpositionPitch = own - transpose
      return transpose - own
    })
    a.updateSettings()
    a.render()
    a.loadMidiForScore()
  }, [transpose, score])

  useEffect(() => {
    if (api.current) api.current.playbackSpeed = speed
  }, [speed])
  useEffect(() => {
    if (api.current) api.current.countInVolume = countIn ? 1 : 0
  }, [countIn])
  useEffect(() => {
    if (api.current) api.current.metronomeVolume = metronome ? 1 : 0
  }, [metronome])

  // Loop the chosen bars.
  useEffect(() => {
    const a = api.current
    if (!a || !score) return
    if (!loop) {
      a.playbackRange = null
      a.isLooping = false
      return
    }
    const first = score.masterBars[range.from]
    const last = score.masterBars[Math.min(range.to, score.masterBars.length) - 1]
    if (!first || !last) return
    a.playbackRange = { startTick: first.start, endTick: last.start + last.calculateDuration() } as never
    a.isLooping = true
  }, [loop, range.from, range.to, score])

  const toggleMute = (i: number) => {
    const a = api.current
    const t = score?.tracks[i]
    if (!a || !t) return
    const next = new Set(muted)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    a.changeTrackMute([t], next.has(i))
    setMuted(next)
  }
  const toggleSolo = (i: number) => {
    const a = api.current
    const t = score?.tracks[i]
    if (!a || !t) return
    const next = new Set(solo)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    a.changeTrackSolo([t], next.has(i))
    setSolo(next)
  }
  const playAlong = muted.has(track)

  if (error) {
    return (
      <p role="alert" className="rounded-2xl border border-destructive/40 p-5 text-sm text-destructive">
        {error}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/80 bg-card p-3">
        <Button size="sm" onClick={() => api.current?.playPause()} disabled={!ready} aria-label={playing ? '暂停' : '播放'}>
          {!ready ? <Loader2 className="animate-spin" /> : playing ? <Pause /> : <Play />} {!ready ? `加载音色 ${soundPct}%` : playing ? '暂停' : '播放'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => api.current?.stop()} disabled={!ready} aria-label="停止">
          <Square />
        </Button>
        <span className="num w-24 text-xs text-muted-foreground">
          {fmt(time.now)} / {fmt(time.end)}
        </span>
        <label className="flex items-center gap-1.5 text-sm">
          <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden />
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="focus-ring h-8 rounded-lg border border-border bg-background px-2" aria-label="速度">
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {Math.round(s * 100)}%
              </option>
            ))}
          </select>
        </label>
        <Toggle on={loop} onClick={() => setLoop((v) => !v)} icon={<Repeat />} label={`循环第 ${range.from + 1}–${range.to} 小节`} />
        <Toggle on={countIn} onClick={() => setCountIn((v) => !v)} icon={<Timer />} label="预备拍" />
        <Toggle on={metronome} onClick={() => setMetronome((v) => !v)} icon={<Volume2 />} label="节拍器" />
        {!externalMix && <Toggle on={playAlong} onClick={() => toggleMute(track)} icon={<Headphones />} label="跟伴奏弹（静音当前音轨）" />}
        <Toggle on={displayOpen} onClick={() => setDisplayOpen((v) => !v)} icon={<Eye />} label="显示" />
        {displayOpen && (
          <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 pt-2 text-xs">
            {DISPLAY_ITEMS.map((d) => (
              <label key={d.key} className="flex items-center gap-1.5">
                <input type="checkbox" checked={display[d.key]} onChange={(e) => setDisplay((x) => ({ ...x, [d.key]: e.target.checked }))} className="accent-[hsl(var(--amber))]" />
                {d.label}
              </label>
            ))}
            <span className="text-muted-foreground">谱面太挤时可以关掉一些；文字注释里常有谱子网站的广告，默认不显示。</span>
          </div>
        )}
      </div>

      {!externalMix && score && score.tracks.length > 1 && (
        <ul className="flex flex-wrap gap-2 text-xs" aria-label="音轨混音">
          {score.tracks.map((t, i) => (
            <li key={i} className={cn('flex items-center gap-1 rounded-full border px-2.5 py-1', i === track ? 'border-cyan/50' : 'border-border/80')}>
              <span className="max-w-32 truncate">{t.name || `音轨 ${i + 1}`}</span>
              <button type="button" onClick={() => toggleMute(i)} aria-pressed={muted.has(i)} aria-label={`${muted.has(i) ? '取消静音' : '静音'}「${t.name}」`} className={cn('focus-ring rounded p-0.5', muted.has(i) ? 'text-destructive' : 'text-muted-foreground hover:text-foreground')}>
                {muted.has(i) ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              </button>
              <button type="button" onClick={() => toggleSolo(i)} aria-pressed={solo.has(i)} aria-label={`独奏「${t.name}」`} className={cn('focus-ring rounded px-1 font-semibold', solo.has(i) ? 'text-amber' : 'text-muted-foreground hover:text-foreground')}>
                S
              </button>
            </li>
          ))}
        </ul>
      )}

      <div ref={scroller} className="at-surface relative max-h-[72vh] overflow-auto rounded-2xl border border-border/80 bg-card p-4">
        {rendering && (
          <div className="pointer-events-none absolute right-4 top-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> 正在排版…
          </div>
        )}
        <div ref={host} />
      </div>
      <p className="text-xs text-muted-foreground">可以在谱面上点击跳到某一处，或拖动选出一段来播放。谱子播放用乐谱组件自带的音色，声音从系统默认输出设备发出。</p>
    </div>
  )
}

function Toggle({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={cn('focus-ring flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5', on ? 'border-amber/60 bg-amber-soft/40 text-foreground' : 'border-border/80 text-muted-foreground hover:text-foreground')}>
      {icon}
      {label}
    </button>
  )
}
