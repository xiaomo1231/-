import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { uuid } from '@/infrastructure/crypto/crypto'
import type { SingMeta, SingTake } from '@/entities/types'
import { SingService, type SingSource } from '@/services/singService'
import { BackingService } from '@/services/backingService'
import { StemPlayer } from '@/audio/backing/stemPlayer'
import { loadPitchCurve } from '@/audio/backing/pitchCurve'
import { detector } from '@/audio/pitch/detector'
import { rawTime } from '@/audio/engine'
import { SongClock, VoiceRecorder, encodeTake } from '@/audio/sing/voiceRecorder'
import { VoiceMonitor, loadMonitorSettings, saveMonitorSettings, type MonitorSettings, type MonitorStatus } from '@/audio/sing/voiceMonitor'
import { notesOf, scoreNotes, steadyLag, toTakeScore, type NoteScore, type Phrase, type PitchCurve, type RefNote, type SungSample } from '@/songs/singAlong'
import type { StemKind } from '@/songs/backingSync'
import { autoPhrases, groupTakes, phrasesFromLyrics, phrasesFromRanges, sameStretch, takeFitsPhrase, type PhraseRange, type PhraseSource } from '@/songs/phrasing'
import { useProfileStore } from '@/features/profile/profileStore'

/** Takes kept per phrase in this session (the store keeps best / latest / pinned). */
export const SESSION_TAKES = 5
/** Recorded before / after a phrase so its edges are not cut. */
const PAD_MS = 300
const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440)

/** The samples of the last pass: a jump back in time starts a new pass. */
export function latestPass(xs: readonly SungSample[]): SungSample[] {
  let start = 0
  for (let i = 1; i < xs.length; i++) if (xs[i]!.ms < xs[i - 1]!.ms - 50) start = i
  return xs.slice(start)
}

export interface SessionTake extends SingTake {
  /** The full note-level result, for the report (only for takes of this session). */
  detail?: NoteScore
}

/**
 * Everything a 跟唱 page shares between its tabs: the recording player, the
 * singer's pitch line and notes, the microphone (pitch + raw recording), the
 * takes per phrase and the per-source metadata (lyrics, full version, mix).
 */
export function useSingSession(source: SingSource) {
  const latencyMs = useProfileStore((s) => s.profile?.deviceLatencyMs ?? 0)
  const vocals = source.stems.find((s) => s.stem === 'vocals')!
  const [curve, setCurve] = useState<PitchCurve | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMetaState] = useState<SingMeta | null>(null)
  const player = useRef<StemPlayer | null>(null)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [guide, setGuide] = useState(source.guideVolume)
  const [mic, setMic] = useState<'off' | 'starting' | 'on' | 'error'>('off')
  const [micError, setMicError] = useState<string | null>(null)
  const [allTakes, setAllTakes] = useState<SessionTake[]>([])
  const [lagNotice, setLagNotice] = useState<number | null>(null)
  const samples = useRef<SungSample[]>([])
  const recorder = useRef<VoiceRecorder | null>(null)
  const clock = useRef(new SongClock())
  const lags = useRef<number[]>([])
  const stemsRef = useRef<Array<{ stem: StemKind; blob: Blob }>>([])
  /** A take is being played back: the microphone and the song clock stay out of it. */
  const previewing = useRef(false)

  // Pitch line, metadata and stored takes.
  useEffect(() => {
    let dead = false
    loadPitchCurve(vocals.fileId, (p) => !dead && setProgress(p))
      .then((c) => !dead && setCurve(c))
      .catch((e) => !dead && setError(e instanceof Error ? e.message : String(e)))
    void SingService.meta(source.key).then((m) => !dead && setMetaState(m))
    void SingService.takes(source.key).then((rows) => !dead && setAllTakes(rows))
    return () => {
      dead = true
    }
  }, [vocals.fileId, source.key])

  // Player: every stem; the vocals become the guide.
  useEffect(() => {
    let dead = false
    void (async () => {
      const stems = (await Promise.all(source.stems.map(async (s) => ({ stem: s.stem, blob: await BackingService.blob(s.fileId) })))).filter((s): s is { stem: StemKind; blob: Blob } => s.blob !== null)
      if (dead) return
      stemsRef.current = stems
      player.current = new StemPlayer(stems)
      setReady(true)
    })()
    return () => {
      dead = true
      player.current?.destroy()
      player.current = null
    }
  }, [source.stems])

  const stemKinds = useMemo(() => source.stems.map((s) => s.stem), [source.stems])
  const backingMix = useCallback(
    (guideVolume: number) => {
      const separated = stemKinds.some((k) => !['mix', 'vocals', 'instrumental'].includes(k))
      const mix: Partial<Record<StemKind, { volume: number; muted: boolean }>> = {}
      for (const k of stemKinds) {
        if (k === 'vocals') mix[k] = { volume: guideVolume, muted: guideVolume === 0 }
        else if (k === 'mix') mix[k] = { volume: 1, muted: separated || stemKinds.includes('instrumental') }
        else if (k === 'instrumental') mix[k] = { volume: 1, muted: separated }
        else mix[k] = { volume: 1, muted: false }
      }
      return mix
    },
    [stemKinds],
  )
  useEffect(() => {
    player.current?.setMix(backingMix(guide))
  }, [ready, guide, backingMix])
  useEffect(() => {
    player.current?.setRate(speed)
  }, [ready, speed])

  // 分句: the student's own cuts, else the lyric lines (when their times are trusted), else the singer's pauses.
  const phraseSource: PhraseSource = meta?.phraseCuts?.length ? 'manual' : meta?.lyricsTimed && meta.lyrics?.length ? 'lyrics' : 'auto'
  const phrases = useMemo<Phrase[]>(() => {
    if (!curve) return []
    if (phraseSource === 'manual') return phrasesFromRanges(curve, meta!.phraseCuts!)
    if (phraseSource === 'lyrics') return phrasesFromLyrics(curve, meta!.lyrics!)
    return autoPhrases(curve)
  }, [curve, phraseSource, meta?.phraseCuts, meta?.lyrics]) // eslint-disable-line react-hooks/exhaustive-deps
  const notes = useMemo<RefNote[]>(() => (curve ? notesOf(curve) : []), [curve])
  const phrasesRef = useRef(phrases)
  phrasesRef.current = phrases

  // Takes belong to phrases by time, so they follow when the cuts change.
  const takes = useMemo(() => groupTakes(allTakes, phrases), [allTakes, phrases])
  /** Best score per phrase, from takes sung over (nearly) exactly that phrase. */
  const bests = useMemo(() => {
    const out: Record<number, number> = {}
    phrases.forEach((p, i) => {
      for (const t of takes[i] ?? []) if (t.score && takeFitsPhrase(t, p)) out[i] = Math.max(out[i] ?? 0, t.score.score)
    })
    return out
  }, [phrases, takes])

  // Microphone → pitch samples in recording time.
  useEffect(() => {
    if (mic !== 'on') return
    return detector.onFrame((f) => {
      const p = player.current
      if (!p?.isPlaying || previewing.current || !f.hz || f.clarity < 0.8) return
      const ageMs = (rawTime() - f.t) * 1000
      samples.current.push({ ms: p.positionMs() - ageMs - latencyMs * speed, midi: hzToMidi(f.hz) })
      if (samples.current.length > 80000) samples.current.splice(0, 20000)
    })
  }, [mic, latencyMs, speed])

  // Clock pairs for cutting recordings by song time.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const p = player.current
      if (p?.isPlaying && !previewing.current) clock.current.mark(rawTime(), p.positionMs())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // 监听: hear yourself in the headphones while the microphone is on.
  const [monitor, setMonitorState] = useState<MonitorSettings>(loadMonitorSettings)
  const monitorRef = useRef<VoiceMonitor | null>(null)
  const [monitorStatus, setMonitorStatus] = useState<MonitorStatus | null>(null)
  useEffect(() => {
    saveMonitorSettings(monitor)
    if (mic !== 'on' || !monitor.on) {
      monitorRef.current?.stop()
      return
    }
    monitorRef.current ??= new VoiceMonitor(setMonitorStatus)
    monitorRef.current.start(monitor)
  }, [mic, monitor])
  useEffect(() => () => monitorRef.current?.stop(), [])
  const setMonitor = useCallback((patch: Partial<MonitorSettings>) => setMonitorState((m) => ({ ...m, ...patch })), [])

  const startMic = useCallback(async () => {
    setMic('starting')
    try {
      await detector.start('voice')
      const r = new VoiceRecorder()
      if (await r.start()) recorder.current = r
      setMic('on')
    } catch (e) {
      setMicError(e instanceof Error ? e.message : String(e))
      setMic('error')
    }
  }, [])
  useEffect(
    () => () => {
      recorder.current?.stop()
      detector.stop()
    },
    [],
  )

  /** Cut the recording for a stretch of the song: samples, rate, and where it starts in the song (latency removed). */
  const cutRecording = useCallback(
    (fromMs: number, toMs: number): { samples: Float32Array; sampleRate: number; startMs: number } | null => {
      const r = recorder.current
      if (!r) return null
      const a = clock.current.timeAt(fromMs)
      const b = clock.current.timeAt(toMs)
      if (a === null || b === null || b <= a) return null
      return { samples: r.clip(a, b), sampleRate: r.sampleRate, startMs: fromMs - latencyMs * speed }
    },
    [latencyMs, speed],
  )

  const addTake = useCallback((t: SessionTake) => {
    setAllTakes((all) => {
      // Session: per stretch of the song the newest SESSION_TAKES, plus anything pinned.
      const same = (x: SessionTake) => (t.phrase < 0 ? x.phrase < 0 : x.phrase >= 0 && sameStretch(x, t))
      let n = 0
      const keep = all.filter((x) => !same(x) || x.kept || ++n < SESSION_TAKES)
      return [t, ...keep]
    })
  }, [])

  /** Score and store the phrase just sung. Returns the take (null when nothing scorable was sung). */
  const finishPhrase = useCallback(
    async (p: Phrase): Promise<SessionTake | null> => {
      // Only the latest pass over this phrase (singing it again appends a second run of samples).
      const window = latestPass(samples.current.filter((s) => s.ms >= p.startMs - PAD_MS && s.ms <= p.endMs + PAD_MS))
      const detail = scoreNotes(notes, p, window)
      if (!window.length) return null
      const cut = cutRecording(p.startMs - PAD_MS, p.endMs + PAD_MS)
      const audio = cut ? encodeTake(cut.samples, cut.sampleRate) : null
      const take: SessionTake = {
        id: uuid(),
        key: source.key,
        phrase: p.index,
        fromMs: p.startMs,
        toMs: p.endMs,
        speed,
        createdAt: Date.now(),
        score: detail ? toTakeScore(detail) : null,
        sungMs: Float32Array.from(window.map((s) => s.ms)),
        sungMidi: Float32Array.from(window.map((s) => s.midi)),
        ...(audio && cut ? { audio: audio.blob, audioStartMs: cut.startMs } : {}),
        ...(detail ? { detail } : {}),
      }
      addTake(take)
      const { detail: _d, ...stored } = take
      await SingService.saveTake(stored)
      if (detail) {
        setMetaState((m) => (m ? { ...m, phraseBests: { ...m.phraseBests, [p.index]: Math.max(detail.score, m.phraseBests[p.index] ?? 0) } } : m))
        lags.current.push(detail.lagMs)
        setLagNotice(steadyLag(lags.current))
      }
      return take
    },
    [notes, cutRecording, source.key, addTake, speed],
  )

  /** Forget the samples of a stretch (before singing it again). */
  const clearSamples = useCallback((fromMs: number, toMs: number) => {
    samples.current = samples.current.filter((s) => s.ms < fromMs || s.ms > toMs)
  }, [])

  const setMeta = useCallback(
    async (patch: Partial<Omit<SingMeta, 'key'>>) => {
      const next = await SingService.updateMeta(source.key, patch)
      setMetaState(next)
      return next
    },
    [source.key],
  )

  // ---- 重新开始 / 草稿 -----------------------------------------------------------
  /** Bumped after a fresh start or a restored draft: the practice view forgets what it scored. */
  const [resetToken, setResetToken] = useState(0)
  const afterReset = useCallback(
    (m: SingMeta) => {
      setMetaState(m)
      samples.current = []
      lags.current = []
      setLagNotice(null)
      setResetToken((x) => x + 1)
      void SingService.takes(source.key).then(setAllTakes)
    },
    [source.key],
  )
  /** Put the current takes away as a draft, then start fresh. False when there was nothing to put away. */
  const saveDraftAndRestart = useCallback(
    async (name: string) => {
      const m = await SingService.saveDraft(source.key, name)
      if (m) afterReset(m)
      return m !== null
    },
    [source.key, afterReset],
  )
  const clearAllTakes = useCallback(async () => afterReset(await SingService.clearTakes(source.key)), [source.key, afterReset])
  const clearPhraseTakes = useCallback(
    async (ids: string[]) => {
      setMetaState(await SingService.clearTakes(source.key, ids))
      setAllTakes((all) => all.filter((t) => !ids.includes(t.id)))
    },
    [source.key],
  )
  const restoreDraft = useCallback(async (id: string) => afterReset(await SingService.restoreDraft(source.key, id)), [source.key, afterReset])
  const deleteDraft = useCallback(async (id: string) => setMetaState(await SingService.deleteDraft(source.key, id)), [source.key])

  const updateTake = useCallback(async (t: SessionTake, patch: Partial<Pick<SingTake, 'kept' | 'nudgeMs'>>) => {
    await SingService.updateTake(t.id, patch)
    setAllTakes((all) => all.map((x) => (x.id === t.id ? { ...x, ...patch } : x)))
  }, [])

  /**
   * Change how the song is cut (lyrics, hand cuts). The full-version picks are
   * per phrase, so they start over; the takes themselves follow by time.
   */
  const resegment = useCallback(
    async (patch: { lyrics?: SingMeta['lyrics']; lyricsTimed?: boolean; phraseCuts?: PhraseRange[] }) => {
      const comp = meta?.comp
      return setMeta({ ...patch, ...(comp ? { comp: { ...comp, picks: {}, phraseOffsets: {} } } : {}) })
    },
    [meta?.comp, setMeta],
  )

  // Keep the stored phrase bests (list page) in step with the current cuts.
  useEffect(() => {
    if (!meta || !curve) return
    const a = JSON.stringify(meta.phraseBests)
    const b = JSON.stringify(bests)
    if (a !== b && Object.keys(bests).length + Object.keys(meta.phraseBests).length > 0) void SingService.updateMeta(source.key, { phraseBests: bests }).then(setMetaState)
  }, [bests]) // eslint-disable-line react-hooks/exhaustive-deps

  const play = useCallback((fromMs?: number) => {
    const p = player.current
    if (!p) return
    p.play(fromMs ?? p.positionMs())
    setPlaying(true)
  }, [])
  const pause = useCallback(() => {
    player.current?.pause()
    setPlaying(false)
  }, [])

  return {
    source,
    curve,
    progress,
    error,
    phrases,
    phraseSource,
    resegment,
    bests,
    previewing,
    resetToken,
    saveDraftAndRestart,
    clearAllTakes,
    clearPhraseTakes,
    restoreDraft,
    deleteDraft,
    notes,
    meta,
    setMeta,
    player,
    ready,
    playing,
    play,
    pause,
    speed,
    setSpeed,
    guide,
    setGuide,
    mic,
    micError,
    monitor,
    monitorStatus,
    setMonitor,
    startMic,
    samples,
    clearSamples,
    takes,
    addTake,
    finishPhrase,
    updateTake,
    cutRecording,
    recorder,
    clock,
    latencyMs,
    lagNotice,
    stems: stemsRef,
    backingMix,
  }
}

export type SingSession = ReturnType<typeof useSingSession>

export const SingSessionContext = createContext<SingSession | null>(null)

export function useSing(): SingSession {
  const s = useContext(SingSessionContext)
  if (!s) throw new Error('useSing outside SingSessionContext')
  return s
}

/** Decode a take's recording (or any blob) in the shared audio context. */
export async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  const ctx = Tone.getContext().rawContext as AudioContext
  return ctx.decodeAudioData(await blob.arrayBuffer())
}
