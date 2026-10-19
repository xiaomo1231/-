import { useEffect, useMemo, useRef, useState } from 'react'
import type { AlphaTabApi, model } from '@coderline/alphatab'
import type { ScoreFormat } from '@/songs/scoreLibraryTypes'
import { errorText, fetchBytes, fileUrl, type PracticeUpdate } from '../lib/api'
import { clampTranspose } from '../lib/transpose'
import { cx } from '../lib/classes'
import { loadPracticeFor, practiceFor, savePractice, savePracticeOnExit } from '../lib/practice'
import { Notice } from '../components/ui'
import { useBand } from '../lib/band'
import { canBrowseLibrary, useMe } from '../lib/session'
import { hrefCombine } from '../lib/combos'
import { hrefViewer } from '../lib/route'
import { StarRating } from '../components/StarRating'
import type { ConversionRecord } from '../lib/api'
import { useRehearsalPlayer } from './useRehearsalPlayer'
import { RehearsalPanel } from './RehearsalPanel'
import { RehearsalStrip } from './RehearsalStrip'
import { CountInOverlay } from './CountInOverlay'
import { CommentsLayer } from './CommentsLayer'
import { CommentsPanel } from './CommentsPanel'
import { FillPanel } from './FillPanel'
import { LatencyCalibration } from './LatencyCalibration'
import { addComment, removeComment, updateSong } from '../lib/band'
import { openInRehearsal } from '../lib/rehearsalNav'
import { sendRehearsal } from '../lib/rehearsal'
import { useDrumStyles } from '../lib/drums'
import { HREF_BAND } from '../lib/route'
import { fillOf, planFill, speakerMix, type ResolvedDrumSource } from '@/songs/rehearsalFill'
import { nextSection, sectionAt, sectionsOf } from '@/songs/rehearsalSections'
import type { FillConfig } from '../lib/api'
import { trackLabels } from './trackNames'
import {
  buildDrumTrack,
  exportGp,
  findDrumTrack,
  partFromTrack,
  standardizeDrumTrack,
} from '@/songs/drumScore'
import { combine, exportCombined, unrollRepeats } from '@/songs/combineScores'
import { usedPieces, visiblePieces } from '@/songs/drumPart'
import type { DrumPart } from '@/songs/drumTypes'
import { api as server, conversionFileUrl } from '../lib/api'
import { hrefDrums } from '../lib/route'
import { DrumKey } from './DrumKey'
import { SheetsPanel } from './SheetsPanel'
import { DrumTab } from './DrumTab'
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
  prepareNotation,
  isVocalTrack,
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
import { fontGain, playedProgram } from './fontGain'
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
  /** Opened from the drum editor's 试听: show the drum part first. */
  showDrums: boolean
  /** 组合乐队谱 recipe id ('' = the file as it is). */
  combo: string
  /** PDF 转换版 id: play the converted GP5 of the PDF at `path` ('' = none). */
  conv: string
  /** Opened by the band's rehearsal: follow it (音箱 / 看谱) instead of practising alone. */
  rehearsal: boolean
}

type RehearsalPop = 'fill' | 'comments' | 'calibrate' | null

/** First (MIDI) tick where 1-based `bar` is played, and the tick after it (repeats unrolled). */
function barTicks(a: AlphaTabApi | null, s: model.Score | null, bar: number): [number, number] {
  const look = (
    a?.tickCache as unknown as {
      masterBarLookup?: Map<number, { start: number; end: number }>
    } | null
  )?.masterBarLookup?.get(bar - 1)
  if (look) return [look.start, look.end]
  const mb = s?.masterBars[bar - 1]
  const next = s?.masterBars[bar]
  const start = mb?.start ?? 0
  return [start, next ? next.start : start + (mb ? mb.calculateDuration() : 3840)]
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
function highlightBars(
  a: AlphaTabApi,
  s: model.Score,
  track: number,
  bars: [number, number],
): void {
  const staff = s.tracks[track]?.staves[0]
  const first = staff?.bars[bars[0] - 1]?.voices[0]?.beats[0]
  const lastVoice = staff?.bars[bars[1] - 1]?.voices[0]
  const last = lastVoice?.beats[lastVoice.beats.length - 1]
  if (first && last) a.highlightPlaybackRange(first, last)
}

const sameBars = (a: [number, number] | null, b: [number, number] | null) =>
  a === b || (a !== null && b !== null && a[0] === b[0] && a[1] === b[1])

/** A Guitar Pro / MusicXML file, shown and played by alphaTab (read in place, never saved). */
export function ScoreViewer({
  path,
  title,
  artist,
  pages,
  band,
  showDrums,
  combo,
  conv,
  rehearsal,
}: Props) {
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
  /** The sound font the player was built with (its loudness is balanced per track). */
  const [activeFont, setActiveFont] = useState<SoundFontId>('basic')
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
  const [sheetsOpen, setSheetsOpen] = useState(false)
  /** PDF 转换版: its record (for 用户品鉴). */
  const [convRec, setConvRec] = useState<ConversionRecord | null>(null)
  useEffect(() => {
    if (!conv) return
    let cancelled = false
    server
      .conversion(conv)
      .then((r) => {
        if (!cancelled) setConvRec(r)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [conv])
  /** The saved drum part (if any), the track built from it, and the file's own drum track. */
  const [drums, setDrums] = useState<{
    part: DrumPart | null
    added: number | null
    original: number | null
    /** A standard-notation copy of the file's own drum track: drawn in its place, never played. */
    std: number | null
    /** Rehearsal: a saved drum part exists for this file (whether or not it was loaded). */
    savedExists: boolean
  }>({ part: null, added: null, original: null, std: null, savedExists: false })
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
  /** 排练: this page follows the band's rehearsal. */
  const rehearsalMode = rehearsal && Boolean(band)
  const savedFill: FillConfig | null = bandSong ? fillOf(bandSong) : null
  /** What the drums are made of in the rehearsal (changing it rebuilds the player). */
  const rehDrumKey =
    rehearsalMode && savedFill ? `${savedFill.drumSource}|${savedFill.drumStyle ?? ''}` : ''
  const rehRef = useRef({ mode: rehearsalMode, fill: savedFill, songId: band })
  rehRef.current = { mode: rehearsalMode, fill: savedFill, songId: band }
  const [rehPop, setRehPop] = useState<RehearsalPop>(null)
  const [renderVersion, setRenderVersion] = useState(0)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [focusBar, setFocusBar] = useState<number | null>(null)
  // 补位 changes are shared: saved shortly after the last change (sliders send many);
  // until then the draft is what this screen shows and plays.
  const fillTimer = useRef<number | undefined>(undefined)
  const [fillDraft, setFillDraft] = useState<FillConfig | null>(null)
  const fill: FillConfig | null = fillDraft ?? savedFill
  const saveFill = (f: FillConfig) => {
    setFillDraft(f)
    window.clearTimeout(fillTimer.current)
    fillTimer.current = window.setTimeout(() => {
      if (!band) return
      void updateSong({ id: band, fill: f })
        .catch((e: unknown) => {
          setRestoreNote(e instanceof Error ? e.message : '补位设置没能保存。')
          window.setTimeout(() => setRestoreNote(''), 5000)
        })
        .finally(() => setFillDraft(null))
    }, 500)
  }
  const drumStyles = useDrumStyles()
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
  const showDrumsRef = useRef(showDrums)
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

  const reh = useRehearsalPlayer({
    enabled: rehearsalMode,
    songId: band,
    meId: me?.id ?? null,
    api,
    ready,
    score,
    onSpeed: setSpeedPct,
  })
  const rehPlayerRef = useRef(reh)
  rehPlayerRef.current = reh
  /** Someone else conducts: this player follows and its own transport keys wait. */
  const following = reh.here && !reh.isLeader
  const leading = reh.here && reh.isLeader

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
        const [bytes, at, fonts, savedDrums] = await Promise.all([
          fetchBytes(conv ? conversionFileUrl(conv) : fileUrl(path), ac.signal),
          loadAlphaTab(),
          availableSoundFonts(),
          server.drums(path, ac.signal).catch(() => null),
        ])
        if (disposed || !host.current) return
        setSoundFonts(fonts)
        const cur = live.current
        const font: SoundFontId = fonts.has(cur.prefs.soundFont) ? cur.prefs.soundFont : 'basic'
        setActiveFont(font)
        // A saved drum part: the file plus a drum track built from it, written out as a GP
        // file and loaded like any other (alphaTab lays the sheet out in a worker, which needs
        // a score that went through its importer). The file in the library is never changed.
        let fileBytes = bytes
        let drumTrack: number | null = null
        let fileDrums: number | null = null
        // 组合乐队谱: the recipe's parts from several versions, put onto this (base) file.
        if (combo) {
          const recipe = await server.combo(combo, ac.signal)
          const load = async (p: string, unroll: boolean) => {
            const b = p === path ? bytes : await fetchBytes(fileUrl(p), ac.signal)
            const settings = new at.Settings()
            settings.importer.encoding = chooseEncoding(at, b)
            const sc = at.importer.ScoreLoader.loadScoreFromBytes(b, settings)
            return unroll ? unrollRepeats(at, sc) : sc
          }
          const base = await load(recipe.base, recipe.baseUnrollRepeats)
          const parts = []
          for (const pt of recipe.parts)
            parts.push({ ...pt, score: await load(pt.path, pt.unrollRepeats) })
          if (disposed) return
          const out = combine(at, base, parts, { keepBaseTracks: [] })
          fileBytes = exportCombined(at, out.score)
          if (out.warnings.length) {
            setRestoreNote(`组合乐队谱：${out.warnings.slice(0, 3).join('；')}`)
            window.setTimeout(() => setRestoreNote(''), 8000)
          }
        }
        // 排练: the drums the band chose (补位). 'file' / 'metronome' keep the file's own drums;
        // 'generated' builds a part from the templates (the same on every device).
        let drumsToAdd = savedDrums
        let rehSource: ResolvedDrumSource | null = null
        const reh0 = rehRef.current
        if (reh0.mode && reh0.fill && !combo) {
          const settings = new at.Settings()
          settings.importer.encoding = chooseEncoding(at, bytes)
          const probe = at.importer.ScoreLoader.loadScoreFromBytes(bytes, settings)
          const hasFile = findDrumTrack(probe) !== null
          const hasSaved = savedDrums !== null && savedDrums.bars.length === probe.masterBars.length
          rehSource = planFill({
            tracks: hasFile ? [{ index: 0, name: '', isDrums: true }] : [],
            parts: {},
            present: [],
            members: [],
            fill: reh0.fill,
            hasSavedDrums: hasSaved,
          }).drums.source
          drumsToAdd = null
          if (rehSource === 'saved') drumsToAdd = savedDrums
          else if (rehSource === 'generated') {
            try {
              const g = await server.rehearsalDrums(reh0.songId, reh0.fill.drumStyle, ac.signal)
              if (g.first === 0 && g.bars.length === probe.masterBars.length)
                drumsToAdd = {
                  version: 1,
                  path,
                  title,
                  artist,
                  bars: g.bars,
                  source: 'template',
                  edited: false,
                  style: g.style,
                  updatedAt: 0,
                  updatedBy: '',
                }
            } catch {
              drumsToAdd = null
            }
          }
          if (disposed) return
        }
        let stdTrack: number | null = null
        if (!combo && !drumsToAdd) {
          // The file's own drum track, redrawn in standard drum notation (hands up, feet down,
          // standard positions, % for repeated bars); the original keeps playing.
          try {
            const settings = new at.Settings()
            settings.importer.encoding = chooseEncoding(at, bytes)
            const copy = at.importer.ScoreLoader.loadScoreFromBytes(bytes, settings)
            const own = findDrumTrack(copy)
            if (own !== null) {
              stdTrack = standardizeDrumTrack(at, copy, own)
              fileBytes = exportGp(at, copy)
            }
          } catch {
            stdTrack = null
            fileBytes = bytes
          }
        }
        if (drumsToAdd && !combo) {
          try {
            const settings = new at.Settings()
            settings.importer.encoding = chooseEncoding(at, bytes)
            const copy = at.importer.ScoreLoader.loadScoreFromBytes(bytes, settings)
            if (drumsToAdd.bars.length === copy.masterBars.length) {
              fileDrums = findDrumTrack(copy)
              const label = rehSource === 'generated' ? '鼓（自动生成）' : '鼓（鼓谱）'
              drumTrack = buildDrumTrack(at, copy, drumsToAdd, label).index
              fileBytes = exportGp(at, copy)
            }
          } catch {
            fileBytes = bytes
            drumTrack = null
          }
        }
        const a = new at.AlphaTabApi(host.current, {
          core: { scriptFile: urls.script, fontDirectory: urls.fonts, useWorkers: true },
          importer: { encoding: chooseEncoding(at, fileBytes) },
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
          // A saved drum part plays instead of the file's own drums (that track is muted).
          const added = drumTrack !== null && drumTrack < s.tracks.length ? drumTrack : null
          const original = added !== null ? fileDrums : findDrumTrack(s)
          const std = stdTrack !== null && stdTrack < s.tracks.length ? stdTrack : null
          setDrums({
            part: added !== null ? drumsToAdd : null,
            added,
            original,
            std,
            savedExists: savedDrums !== null,
          })
          if (showDrumsRef.current && (added ?? original) !== null) setTrack((added ?? original)!)
          // Instruments the font cannot play are swapped before the player reads the score.
          for (const t of s.tracks) {
            t.playbackInfo.program = playedProgram(font, t.playbackInfo.program)
            for (const st of t.staves)
              for (const b of st.bars)
                for (const v of b.voices)
                  for (const bt of v.beats)
                    for (const au of bt.automations)
                      if (au.type === at.model.AutomationType.Instrument)
                        au.value = playedProgram(font, au.value)
          }
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
              const bars = r.loopBars && r.loopBars[1] <= s.masterBars.length ? r.loopBars : null
              if (bars && rendered) highlightBars(a, s, live.current.track, bars)
              else pendingBars.current = bars
              const parts = [`${r.speedPct}%`]
              if (bars)
                parts.push(
                  bars[0] === bars[1] ? `第 ${bars[0]} 小节` : `第 ${bars[0]}–${bars[1]} 小节`,
                )
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
          setRenderVersion((v) => v + 1)
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
        a.playerPositionChanged.on((e) => {
          setTime({ now: e.currentTime, end: e.endTime, tick: e.currentTick })
          rehPlayerRef.current.onPosition(e.currentTime)
        })
        a.activeBeatsChanged.on((e) => {
          if (live.current.prefs.fretboard)
            setActiveNotes(notesFromBeats(e.activeBeats, live.current.track))
        })
        // One pass of the loop is over: count it, speed up, and (with a pause or a count-in)
        // start the next one by hand.
        a.playerFinished.on(() => {
          // In the rehearsal the 音箱 reports the end of a pass; the server decides what's next.
          if (rehPlayerRef.current.here && rehPlayerRef.current.onFinished()) return
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
        if (!a.load(fileBytes, [0])) {
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
  }, [path, soundFontChoice, combo, conv, rehDrumKey]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (me?.instrument === 'keys' && live.current.prefs.staff === 'Tab')
      setPrefs((p) => ({ ...p, staff: 'ScoreTab' }))
  }, [score, bandSong, myTrack, bandSpeed, path, me?.instrument])

  // Track shown on the sheet.
  useEffect(() => {
    const a = api.current
    const own = score?.tracks[track]
    // The file's drum track is drawn from its standard-notation copy.
    const t =
      track === drums.original && drums.std !== null ? (score?.tracks[drums.std] ?? own) : own
    const at = window.alphaTab
    if (a && t && at) {
      // Singers' parts in 简谱 / 五线谱; drums, piano and other parts without tab in 五线谱.
      const want = prepareNotation(at, t, live.current.prefs)
      if (a.settings.display.staveProfile !== want) {
        a.settings.display.staveProfile = want as never
        a.updateSettings()
      }
      a.renderTracks([t])
    }
    setActiveNotes([])
  }, [track, score, drums])

  // Notation and sheet: staff profile, zoom and colours (one re-render for all three).
  useEffect(() => {
    const a = api.current
    const at = window.alphaTab
    if (!a || !score || !at) return
    const shown = score.tracks[live.current.track]
    a.settings.display.staveProfile = (
      shown ? prepareNotation(at, shown, prefs) : staveProfileOf(at, prefs.staff)
    ) as never
    a.settings.display.scale = effectiveScale(prefs)
    a.settings.fillFromJson({ display: { resources: sheetResources(prefs.sheet) } } as never)
    a.updateSettings()
    a.render()
  }, [prefs.staff, prefs.vocalStaff, prefs.zoom, prefs.sheet, score]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const rehState = reh.here ? reh.conn.state : null
  useEffect(() => {
    if (!leading || !rehState) return
    if (rehState.speedPct !== speedPct)
      void sendRehearsal({ type: 'speed', speedPct }).catch(() => undefined)
  }, [speedPct, leading]) // eslint-disable-line react-hooks/exhaustive-deps
  // The conductor arriving at a song brings its 预备拍 setting along.
  const countInSent = useRef('')
  useEffect(() => {
    if (!leading || !rehState || !fill || rehState.playing) return
    const key = `${rehState.songId}:${rehState.startedAt}`
    if (countInSent.current === key) return
    countInSent.current = key
    if (rehState.countIn !== fill.countIn)
      void sendRehearsal({ type: 'countIn', on: fill.countIn }).catch(() => undefined)
  }, [leading, rehState, fill])
  useEffect(() => {
    if (api.current) api.current.playbackSpeed = speedPct / 100
    const c = clock.current
    if (c.startedAt) c.maxSpeed = Math.max(c.maxSpeed, speedPct)
  }, [speedPct])
  useEffect(() => {
    if (api.current && !reh.here) api.current.countInVolume = countIn ? 1 : 0
  }, [countIn, reh.here])

  // 补位: what this song's 音箱 plays, from who is in the room right now.
  const presentIds = useMemo(
    () => [...new Set((rehState?.devices ?? []).map((d) => d.userId))],
    [rehState?.devices],
  )
  const rehTrackInfo = useMemo(
    () =>
      (score?.tracks ?? [])
        .map((t, i) => ({
          index: i,
          isDrums: Boolean(t.isPercussion || t.staves[0]?.isPercussion),
        }))
        .filter((t) => t.index !== drums.added && t.index !== drums.std),
    [score, drums.added, drums.std],
  )
  const myTracks = useMemo(
    () =>
      bandSong && me
        ? Object.entries(bandSong.parts)
            .filter(([, uid]) => uid === me.id)
            .map(([k]) => Number(k))
        : [],
    [bandSong, me],
  )
  const rehNames = useMemo(
    () =>
      trackLabels(score?.tracks ?? []).map((l, i) =>
        l.original ? `${l.zh}（${l.original}）` : l.zh || `音轨 ${i + 1}`,
      ),
    [score],
  )
  const plan = useMemo(() => {
    if (!fill || !bandSong) return null
    return planFill({
      tracks: rehTrackInfo.map((t) => ({ ...t, name: rehNames[t.index] ?? '' })),
      parts: bandSong.parts,
      present: reh.here ? presentIds : (bandState?.members ?? []).map((m) => m.id),
      members: bandState?.members ?? [],
      fill,
      hasSavedDrums: drums.savedExists,
    })
  }, [
    fill,
    bandSong,
    rehTrackInfo,
    rehNames,
    reh.here,
    presentIds,
    bandState?.members,
    drums.savedExists,
  ])
  const mix = useMemo(() => {
    if (!reh.here || !plan || !score) return null
    return speakerMix(plan, {
      trackCount: score.tracks.length,
      fileDrums: rehTrackInfo.filter((t) => t.isDrums).map((t) => t.index),
      added: drums.added,
      std: drums.std,
      own: reh.sounding && !reh.isSpeaker ? myTracks : [],
    })
  }, [
    reh.here,
    reh.sounding,
    reh.isSpeaker,
    plan,
    score,
    rehTrackInfo,
    drums.added,
    drums.std,
    myTracks,
  ])

  useEffect(() => {
    if (!api.current) return
    api.current.metronomeVolume = (mix ? plan?.metronome : metro || metroOnly) ? 1 : 0
  }, [metro, metroOnly, mix, plan?.metronome])

  // Muting: the student's M keys, plus 跟着练 (the shown track) and 只放节拍器 (everything).
  useEffect(() => {
    const a = api.current
    if (!a || !score) return
    if (mix) {
      score.tracks.forEach((t, i) => a.changeTrackMute([t], mix.mute[i] ?? true))
      return
    }
    score.tracks.forEach((t, i) =>
      a.changeTrackMute(
        [t],
        metroOnly ||
          mute.has(i) ||
          (followAlong && i === track) ||
          (drums.added !== null && i === drums.original) ||
          i === drums.std,
      ),
    )
  }, [mute, followAlong, metroOnly, track, score, drums, mix])

  useEffect(() => {
    const a = api.current
    if (!a || !score) return
    score.tracks.forEach((t, i) => a.changeTrackSolo([t], !mix && solo.has(i)))
  }, [solo, score, mix])

  useEffect(() => {
    const a = api.current
    if (!a || !score) return
    // The user's level times the font's balance for that instrument (see fontGain).
    score.tracks.forEach((t, i) =>
      a.changeTrackVolume(
        [t],
        ((volumes[i] ?? 100) / 100) *
          (mix ? (mix.volume[i] ?? 1) : 1) *
          fontGain(activeFont, t.playbackInfo.program, t.isPercussion),
      ),
    )
  }, [volumes, score, activeFont, mix])

  // Loop: the range, and how passes follow each other.
  const manual = isManualLoop(prefs.trainer)
  useEffect(() => {
    if (reh.here) return
    if (api.current && score) syncLoop(api.current, loop, selRef.current, manual)
    if (!loop) cancelGap()
  }, [loop, score, manual, reh.here])

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
      setRestoreNote('排练中由指挥开始和暂停。')
      window.setTimeout(() => setRestoreNote(''), 3000)
      return
    }
    if (leading && rehState) {
      const a = api.current
      const tick = a?.tickPosition ?? 0
      void (
        rehState.playing
          ? sendRehearsal({ type: 'pause', tick })
          : sendRehearsal({ type: 'play', tick, speedPct: live.current.speedPct })
      ).catch(() => undefined)
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
    if (leading && rehState) {
      const start = rehState.loop?.startTick ?? 0
      void sendRehearsal(
        rehState.playing ? { type: 'pause', tick: start } : { type: 'seek', tick: start },
      ).catch(() => undefined)
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
      const t = e.target
      if (!(t instanceof Element && t.closest('.gl-remote'))) setPop(null)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [pop])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!reh.movedTo) return
    const next = bandState?.songs.find((x) => x.id === reh.movedTo)
    if (next) void openInRehearsal(next, true)
  }, [reh.movedTo, bandState?.songs])

  const tracks = score?.tracks ?? []
  const masterBars = score?.masterBars ?? []
  let bar = 0
  for (let i = 0; i < masterBars.length; i++) {
    if ((masterBars[i]?.start ?? 0) <= time.tick) bar = i + 1
    else break
  }
  const sections = useMemo(() => sectionsOf((score?.masterBars ?? []) as never), [score])
  const sectionIdx = sectionAt(sections, bar)
  const nextSec = nextSection(sections, bar)
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
  const isDrumTrack = Boolean(shownTrack?.isPercussion || shownTrack?.staves[0]?.isPercussion)
  /** The shown drum track as a step grid: the saved part, or the file's drum track converted. */
  const drumPart = useMemo<DrumPart | null>(() => {
    if (!score || !isDrumTrack) return null
    if (track === drums.added) return drums.part
    try {
      return partFromTrack(score, track, { path, title, artist, updatedBy: '' })
    } catch {
      return null
    }
  }, [score, isDrumTrack, track, drums, path, title, artist])
  /** 文字鼓谱 replaces the sheet; 标准鼓谱 is the sheet itself. */
  const viewPart = prefs.drumView === 'tab' ? drumPart : null
  const drumPieces = useMemo(() => (viewPart ? visiblePieces(viewPart) : []), [viewPart])
  const keyPieces = useMemo(() => (drumPart ? usedPieces(drumPart) : []), [drumPart])
  const gridShown = viewPart !== null
  // Back from the grid / text view: the sheet was laid out while hidden, draw it again.
  const wasGrid = useRef(false)
  useEffect(() => {
    if (wasGrid.current && !gridShown) api.current?.render()
    wasGrid.current = gridShown
  }, [gridShown])
  const showFretboard =
    prefs.fretboard &&
    shownTrack !== undefined &&
    hasFretboard(shownTrack) &&
    !isVocalTrack(shownTrack)
  const status =
    loop && loopState
      ? loopState.done
        ? `已练完 ${loopState.pass} 遍`
        : loopStatus(prefs.trainer, loopState)
      : null

  return (
    <div className="score-bleed">
      <style>{SHEET_CSS}</style>
      {bandSong && rehearsalMode && reh.ended && (
        <div className="gutter mx-auto mb-2 w-full max-w-[1180px]">
          <Notice tone="muted">
            排练已经结束，现在是自己练习。
            <a className="ml-2 underline-offset-4 hover:underline" href={HREF_BAND}>
              回到乐队 →
            </a>
          </Notice>
        </div>
      )}
      {bandSong && reh.here && rehState && me && (
        <>
          {/* The status line stays under the site header while the score scrolls. */}
          <div className="sticky z-30" style={{ top: headerH }}>
            <div className="gutter mx-auto w-full max-w-[1180px]">
              <RehearsalStrip
                songTitle={bandSong.title}
                songIndex={(bandState?.rehearsalSetlist.indexOf(bandSong.id) ?? -1) + 1}
                songCount={bandState?.rehearsalSetlist.length ?? 0}
                section={sectionIdx >= 0 ? (sections[sectionIdx]?.name ?? null) : null}
                nextSection={nextSec?.name ?? null}
                bar={bar}
                bars={masterBars.length}
                speedPct={speedPct}
                loop={
                  rehState.loop
                    ? {
                        pass: rehState.pass,
                        passes: rehState.loop.passes,
                        startBar: rehState.loop.startBar,
                        endBar: rehState.loop.endBar,
                      }
                    : null
                }
                playing={rehState.playing}
                role={reh.isSpeaker ? '你是音箱' : reh.sounding ? '耳机出声' : '静音看谱'}
              />
            </div>
          </div>
          <div className="gutter mx-auto mb-2 w-full max-w-[1180px]">
            <RehearsalPanel
              state={rehState}
              me={me}
              deviceId={reh.conn.deviceId}
              members={bandState?.members ?? []}
              songs={bandState?.songs ?? []}
              setlist={bandState?.rehearsalSetlist ?? []}
              connected={reh.conn.connected}
              error={reh.conn.error}
              sections={sections}
              currentBar={bar}
              bars={masterBars.length}
              selection={selBars}
              speedPct={speedPct}
              commentCount={bandSong.comments?.length ?? 0}
              latencyMs={reh.conn.myDevice?.latencyMs ?? 0}
              onCommand={(c) => void sendRehearsal(c).catch(() => undefined)}
              tickOfBar={(b) => barTicks(api.current, score, b)[0]}
              endTickOfBar={(b) => barTicks(api.current, score, b)[1]}
              onSeekBar={(b) =>
                void sendRehearsal({
                  type: 'seek',
                  tick: barTicks(api.current, score, b)[0],
                }).catch(() => undefined)
              }
              onPlayFromBar={(b) => {
                const tick = barTicks(api.current, score, b)[0]
                void sendRehearsal({ type: 'play', tick, speedPct }).catch(() => undefined)
              }}
              onOpenFill={() => setRehPop('fill')}
              onOpenComments={() => setRehPop('comments')}
              onCalibrate={() => setRehPop('calibrate')}
            />
          </div>
        </>
      )}
      {bandSong && !reh.here && (
        <div className="gutter mx-auto mb-2 w-full max-w-[1180px]">
          {myTrack !== null && (
            <p className="mt-1 text-xs text-muted-foreground">
              你在这首歌里弹「{trackNames[myTrack] ?? `音轨 ${myTrack + 1}`}
              」，已自动显示你的声部并静音它，其他声部照常伴奏。
            </p>
          )}
          <button
            type="button"
            className="mt-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => setCommentsOpen(true)}
          >
            小节留言（{bandSong.comments?.length ?? 0}）
          </button>
        </div>
      )}
      {bandSong && (rehPop === 'comments' || commentsOpen) && (
        <RehearsalDialog
          title="小节留言"
          onClose={() => {
            setRehPop(null)
            setCommentsOpen(false)
          }}
        >
          <CommentsPanel
            comments={bandSong.comments ?? []}
            members={bandState?.members ?? []}
            me={me}
            currentBar={Math.max(1, bar)}
            bars={masterBars.length || 999}
            focusBar={focusBar}
            onAdd={(b, text) => addComment(bandSong.id, b, text)}
            onRemove={(id) => removeComment(bandSong.id, id)}
            onJump={(b) => {
              const tick = barTicks(api.current, score, b)[0]
              if (leading) void sendRehearsal({ type: 'seek', tick }).catch(() => undefined)
              else if (!following && api.current) api.current.tickPosition = tick
              setRehPop(null)
              setCommentsOpen(false)
            }}
          />
        </RehearsalDialog>
      )}
      {bandSong && rehPop === 'fill' && plan && fill && (
        <RehearsalDialog title="补位：音箱放什么" onClose={() => setRehPop(null)}>
          <FillPanel
            plan={plan}
            fill={fill}
            onChange={saveFill}
            nameOf={(id) => bandState?.members.find((m) => m.id === id)?.displayName ?? '成员'}
            hasFileDrums={rehTrackInfo.some((t) => t.isDrums)}
            hasSavedDrums={drums.savedExists}
            drumStyles={drumStyles.styles}
            caption={
              reh.here
                ? '按现在在场的人自动决定；改动会马上同步到每台设备。'
                : '假设全员到齐；排练时会按实际到场的人自动决定。'
            }
          />
        </RehearsalDialog>
      )}
      {rehPop === 'calibrate' && (
        <LatencyCalibration
          initialMs={reh.conn.myDevice?.latencyMs ?? 0}
          onSave={(ms) => {
            void sendRehearsal({ type: 'device', latencyMs: ms }).catch(() => undefined)
            setRehPop(null)
          }}
          onClose={() => setRehPop(null)}
        />
      )}
      {reh.here && reh.countIn && (
        <CountInOverlay
          startAt={reh.countIn.at}
          beats={reh.countIn.beats}
          beatMs={reh.countIn.beatMs}
        />
      )}
      {convRec && (
        <div className="gutter mx-auto mb-3 w-full max-w-[1180px] rounded-lg border border-border px-3 py-2">
          <p className="m-0 text-sm">
            <span className="font-bold">PDF 转换版（实验）</span>
            <span className="text-muted-foreground">
              {' '}
              · {convRec.bars} 小节 · 请对照
              <a
                className="mx-1 underline-offset-4 hover:underline"
                href={hrefViewer({ path, format: 'pdf', title, artist })}
              >
                原 PDF
              </a>
              检查，尤其是节奏。
            </span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3">
            <span className="text-xs text-muted-foreground">好不好用？给它打分：</span>
            <StarRating
              size="sm"
              value={convRec.rating.average}
              count={convRec.rating.count}
              mine={convRec.myRating}
              onRate={(stars) => {
                void server
                  .rateConversion(convRec.id, stars)
                  .then(setConvRec)
                  .catch(() => undefined)
              }}
            />
          </div>
        </div>
      )}
      {/* 上传的简谱: many band scores have no singer's part; members upload one here. */}
      <div className="gutter mx-auto mb-2 w-full max-w-[1180px]">
        {me && canBrowseLibrary(me) && (
          <a
            href={hrefCombine(path, combo || undefined)}
            className="mr-4 text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            {combo ? '编辑这个组合乐队谱 →' : '组合乐队谱（从不同版本挑声部）→'}
          </a>
        )}
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          aria-expanded={sheetsOpen}
          onClick={() => setSheetsOpen((v) => !v)}
        >
          {sheetsOpen ? '收起简谱 / 歌词谱 ▴' : '简谱 / 歌词谱（上传的）▾'}
        </button>
        {sheetsOpen && (
          <div className="mt-2">
            <SheetsPanel path={path} />
          </div>
        )}
      </div>
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
        {gridShown && viewPart && (
          <div className="pb-4">
            <DrumTab part={viewPart} pieces={drumPieces} />
          </div>
        )}
        <div ref={host} className={cx('at-surface w-full', gridShown && 'hidden')} />
        {bandSong && !gridShown && (
          <CommentsLayer
            api={api.current}
            surface={host.current}
            comments={bandSong.comments ?? []}
            renderVersion={renderVersion}
            onOpen={(b) => {
              setFocusBar(b)
              if (reh.here) setRehPop('comments')
              else setCommentsOpen(true)
            }}
          />
        )}
        {isDrumTrack && !gridShown && loaded && keyPieces.length > 0 && (
          <div className="mt-6 px-1">
            <p className="mb-2 text-xs text-[color:var(--sheet-dim)]">鼓谱图例</p>
            <DrumKey pieces={keyPieces} />
          </div>
        )}
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
          tracks={drums.std !== null ? trackNames.slice(0, drums.std) : trackNames}
          track={track}
          onShowTrack={setTrack}
          solo={solo}
          mute={mute}
          onSolo={toggleSolo}
          onMute={toggleMute}
          transpose={transpose}
          onTranspose={shift}
          isDrumTrack={isDrumTrack}
          drumView={prefs.drumView}
          onDrumView={(v) => setPrefs((p) => ({ ...p, drumView: v }))}
          drumEditHref={hrefDrums({ path, title, artist })}
          hasDrumPart={drums.part !== null}
          staff={prefs.staff}
          isVocalTrack={shownTrack !== undefined && isVocalTrack(shownTrack)}
          vocalStaff={prefs.vocalStaff}
          onVocalStaff={(v) => setPrefs((p) => ({ ...p, vocalStaff: v }))}
          staffHint={
            shownTrack &&
            !isVocalTrack(shownTrack) &&
            staffFor(shownTrack, prefs.staff) !== prefs.staff
              ? '这一轨没有六线谱（鼓、键盘等），自动用五线谱显示。'
              : ''
          }
          onStaff={(s: StaffMode) => setPrefs((p) => ({ ...p, staff: s }))}
          scale={effectiveScale(prefs)}
          onScale={(z: number) => setPrefs((p) => ({ ...p, zoom: z }))}
          sheet={prefs.sheet}
          onSheet={(s: SheetMode) => setPrefs((p) => ({ ...p, sheet: s }))}
          starred={star.starred}
          onStar={() => void star.toggle()}
          downloadHref={conv ? conversionFileUrl(conv) : fileUrl(path, true)}
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

/** A simple dialog over the score (補位, 留言): closes with Escape or the ✕. */
function RehearsalDialog(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { onClose } = props
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        className="max-h-[85dvh] w-full max-w-[860px] overflow-y-auto rounded-t-xl border border-border bg-card p-4 sm:rounded-xl"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="m-0 text-base font-bold">{props.title}</h2>
          <button
            type="button"
            className="h-9 w-9 rounded-md border border-border"
            aria-label="关闭"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        {props.children}
      </div>
    </div>
  )
}
