import { Download, Loader2, Pause, Play, Repeat, Save, Square } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { renderMix } from '@/audio/sing/mixChain'
import { graphFromMix, type ModGraph } from '@/songs/mixGraph'
import { ModularWorkspace } from './ModularWorkspace'
import { AutoMixPanel } from './AutoMixPanel'
import { toast } from '@/features/toast/toastStore'
import { encodeWav } from '@/export/wav'
import { encodeMp3 } from '@/export/mp3'
import { prepareVoice, needsPrep, prepStats } from '@/audio/fx/voicePrep'
import type { RefNote } from '@/songs/singAlong'
import { SingService } from '@/services/singService'
import { Button, Slider } from '@/shared/ui'
import { ControlField } from '@/widgets/mixing/ControlField'
import { GUIDE_STEPS } from '@/songs/mixLessons'
import { cloneMix, delayMs, MIX_PRESETS } from '@/songs/mixPresets'
import type { EqBand, EqBandType, MixPresetId, MixSettings } from '@/songs/singTypes'
import { EarQuiz } from './EarQuiz'
import { EqCurve } from './EqCurve'
import { ModulePanel, NumField, OnSwitch, selectClass } from './controls'
import {
  Controls,
  LearnLinks,
  LoudnessReadout,
  LoudnessTarget,
  OrderEditor,
  PhraseOffsets,
  SpectrumView,
  StemLevels,
  SuggestionsPanel,
  TuneControls,
  UserPresets,
  Snapshots,
  type Snapshot,
} from './DeskExtras'
import { Meters } from './Meters'
import { MixPlayer, type Region } from './mixPlayer'
import {
  bypassModule,
  fitMix,
  formatDb,
  formatHz,
  formatPan,
  mixEqual,
  previewRegion,
  type AnyModuleId,
  type ModuleId,
} from './mixUtils'

export interface MixDeskProps {
  voice: AudioBuffer | null
  backing: AudioBuffer[]
  /** Stem names of the backing buffers (per-stem levels). */
  backingNames?: string[]
  /** Phrases of the song (level riding), with their lyric when known. */
  phrases?: Array<{ startMs: number; endMs: number; lyric?: string }>
  bpm?: number
  mix: MixSettings
  onMix: (m: MixSettings) => void
  snapshots?: Snapshot[]
  onSnapshots?: (s: Snapshot[]) => void
  /** The original singer's notes (for pitch correction toward them). */
  refNotes?: RefNote[]
  songKey: string
  title: string
  artist?: string
  /** The original singer's separated vocals, decoded when 自动后期 needs them (null = none). */
  loadReference?: () => Promise<AudioBuffer | null>
  /** 模块模式 (0.25.0): the workspace wiring (kept even while in the quick mode). */
  graph?: ModGraph | null
  onGraph?: (g: ModGraph) => void
  mode?: 'quick' | 'modular'
  /** Switch mode; `graph` is the first wiring when the workspace opens for the first time (saved together). */
  onMode?: (m: 'quick' | 'modular', graph?: ModGraph) => void
}

const GUIDE_KEY = 'groovelab:mixGuideSeen'
const AUDITION_MAX_SEC = 15
const QUIZ_MAX_SEC = 6
const SAMPLE_RATE = 44100
const PRESETS = Object.entries(MIX_PRESETS) as Array<
  [MixPresetId, (typeof MIX_PRESETS)[MixPresetId]]
>
const ENGINE_OPTIONS: ReadonlyArray<[MixSettings['engine'], string]> = [
  ['airwindows', '新音色'],
  ['classic', '经典'],
]
const DIVISIONS: MixSettings['vocal']['delay']['division'][] = ['1/4', '1/8', '1/8.', '1/16']
const DEFAULT_OPEN: Record<string, boolean> = {
  lowcut: true,
  eq: true,
  comp: true,
  deess: true,
  reverb: true,
  delay: false,
  balance: true,
  master: true,
}

function notifyError(title: string, err: unknown): void {
  toast({
    title,
    description: err instanceof Error ? err.message : '请再试一次。',
    variant: 'error',
  })
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || '翻唱'

const formatClock = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Registry controls in one row; the `faded` paths stay editable but are drawn at reduced emphasis. */
function Knobs({
  paths,
  faded,
  mix,
  onMix,
}: {
  paths: string[]
  faded: string[]
  mix: MixSettings
  onMix: (m: MixSettings) => void
}): JSX.Element {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {paths.map((p) => (
        <div key={p} className={faded.includes(p) ? 'opacity-60' : undefined}>
          <ControlField path={p} mix={mix} onChange={onMix} />
        </div>
      ))}
    </div>
  )
}

/**
 * 后期工作台：实时预览（效果链）、预设、各模块面板（含「这是什么」与「听听看」）、
 * 均衡曲线、电平表、第一次使用的引导、耳朵训练、导出与保存到作品集。
 */
export function MixDesk(props: MixDeskProps): JSX.Element {
  const { voice: rawVoice, backing, bpm = 100, onMix, songKey, title, artist } = props
  const backingNames = useMemo(() => props.backingNames ?? [], [props.backingNames])
  const phrases = useMemo(() => props.phrases ?? [], [props.phrases])
  // The working copy: values clamped and EQ fitted to four bands, the same as what the audio chain reads.
  const mix = useMemo(() => fitMix(props.mix), [props.mix])
  // The voice after level riding / pitch correction (computed off the chain, cached).
  const [voice, setVoice] = useState<AudioBuffer | null>(rawVoice)
  const [prepping, setPrepping] = useState(false)
  useEffect(() => {
    if (!rawVoice || !needsPrep(mix)) {
      setVoice(rawVoice)
      return
    }
    let dead = false
    setPrepping(true)
    void prepareVoice(rawVoice, mix, phrases, props.refNotes)
      .then((v) => !dead && setVoice(v))
      .finally(() => !dead && setPrepping(false))
    return () => {
      dead = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawVoice, phrases, mix.vocal.autoLevel, mix.vocal.tune, props.refNotes])
  const total = useMemo(
    () => Math.max(voice?.duration ?? 0, ...backing.map((b) => b.duration), 0),
    [voice, backing],
  )

  const playerRef = useRef<MixPlayer | null>(null)
  if (!playerRef.current) playerRef.current = new MixPlayer()
  const player = playerRef.current

  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [scrub, setScrub] = useState<number | null>(null)
  const scrubRef = useRef<number | null>(null)
  const [loopOn, setLoopOn] = useState(false)
  const [range, setRange] = useState<Region | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>(DEFAULT_OPEN)
  const [lessonOpen, setLessonOpen] = useState<Record<string, boolean>>({})
  const [listen, setListen] = useState<{ id: string; label: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [guideStep, setGuideStep] = useState<number | null>(null)
  const [spotlight, setSpotlight] = useState<string | null>(null)
  const [mp3Kbps, setMp3Kbps] = useState(256)
  const panelEls = useRef<Record<string, HTMLElement | null>>({})

  // Keep the audio graph in step with the props.
  useEffect(() => {
    player.setBuffers(voice, backing, backingNames)
  }, [player, voice, backing, backingNames])
  useEffect(() => {
    setPos(0)
    setRange(null)
  }, [rawVoice, backing])
  useEffect(() => {
    player.setMix(mix)
  }, [player, mix])
  const modular = props.mode === 'modular' && !!props.graph
  useEffect(() => {
    player.setGraph(modular ? props.graph! : null)
  }, [player, modular, props.graph])
  useEffect(() => {
    player.setBpm(bpm)
  }, [player, bpm])
  useEffect(() => () => player.dispose(), [player])

  // Playhead and transport state, polled at 10 Hz.
  useEffect(() => {
    const id = window.setInterval(() => {
      const p = playerRef.current
      if (!p) return
      setPlaying(p.isPlaying())
      if (scrubRef.current === null) setPos(p.position())
    }, 100)
    return () => window.clearInterval(id)
  }, [])

  const getMeters = useCallback(() => player.meters(), [player])
  const getReduction = useCallback(() => player.reduction(), [player])

  // First-open guide.
  useEffect(() => {
    let seen = true
    try {
      seen = window.localStorage.getItem(GUIDE_KEY) === '1'
    } catch {
      seen = true
    }
    if (!seen) setGuideStep(0)
  }, [])
  useEffect(() => {
    if (guideStep === null) {
      setSpotlight(null)
      return
    }
    const step = GUIDE_STEPS[guideStep]
    if (!step) return
    setOpen((o) => ({ ...o, [step.id]: true }))
    setSpotlight(step.id)
    requestAnimationFrame(() =>
      panelEls.current[step.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    )
  }, [guideStep])
  const finishGuide = () => {
    try {
      window.localStorage.setItem(GUIDE_KEY, '1')
    } catch {
      // storage unavailable: the guide simply shows again next time
    }
    setGuideStep(null)
  }

  // ---- updates -----------------------------------------------------------

  const apply = (next: MixSettings) => onMix(fitMix(next))
  const vocal = (p: Partial<MixSettings['vocal']>) =>
    apply({ ...mix, vocal: { ...mix.vocal, ...p } })
  const setBand = (i: number, patch: Partial<EqBand>) =>
    vocal({
      eq: {
        ...mix.vocal.eq,
        bands: mix.vocal.eq.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)),
      },
    })
  const backingPatch = (p: Partial<MixSettings['backing']>) =>
    apply({ ...mix, backing: { ...mix.backing, ...p } })
  const masterPatch = (p: Partial<MixSettings['master']>) =>
    apply({ ...mix, master: { ...mix.master, ...p } })

  // Presets are compared and applied with the current engine: 音色 is a separate choice from the preset.
  const withEngine = (s: MixSettings): MixSettings => ({ ...s, engine: mix.engine })
  // 新音色 ignores some knobs (see mixing/airwindows/mapping.ts): kept editable, drawn fainter.
  const aw = mix.engine === 'airwindows'
  const activePreset = PRESETS.find(([, p]) => mixEqual(mix, fitMix(withEngine(p.settings))))?.[1]

  // ---- transport -----------------------------------------------------------

  const loopRegion = (on = loopOn, rng = range): Region | null => {
    if (!on || total <= 0) return null
    const r = rng ?? { start: 0, end: total }
    return r.end > r.start ? r : null
  }

  const startAt = async (from: number, on = loopOn, rng = range) => {
    try {
      await player.play(from, loopRegion(on, rng))
      setPlaying(true)
    } catch (err) {
      notifyError('播放失败', err)
    }
  }

  const onPlay = () => startAt(pos >= total - 0.05 ? 0 : pos)
  const onPause = () => {
    player.pause()
    setPos(player.position())
    setPlaying(false)
  }
  const onStop = () => {
    player.stop()
    setPos(0)
    setPlaying(false)
  }
  const onSeek = (v: number) => {
    scrubRef.current = null
    setScrub(null)
    setPos(v)
    void player.seek(v, loopRegion())
  }
  const toggleLoop = () => {
    const next = !loopOn
    setLoopOn(next)
    if (playing) void startAt(player.position(), next, range)
  }
  const setLoopEdge = (edge: 'start' | 'end') => {
    const here = Math.round(pos * 10) / 10
    const cur = range ?? { start: 0, end: total }
    const next = edge === 'start' ? { start: here, end: cur.end } : { start: cur.start, end: here }
    if (next.end <= next.start) {
      toast({
        title: edge === 'start' ? '起点要在终点之前' : '终点要在起点之后',
        variant: 'warning',
      })
      return
    }
    setRange(next)
    if (playing && loopOn) void startAt(player.position(), loopOn, next)
  }
  const clearRange = () => {
    setRange(null)
    if (playing && loopOn) void startAt(player.position(), loopOn, null)
  }

  const shownPos = scrub ?? pos

  // ---- audition (「听听看」) -----------------------------------------------

  const audition = async (id: AnyModuleId, label: string) => {
    if (total <= 0) return
    const region = previewRegion(total, range, AUDITION_MAX_SEC)
    const passes = [
      { mix: bypassModule(mix, id), label: `不加${label}` },
      { mix, label: `加上${label}` },
    ]
    try {
      await player.playPasses(region, passes, (i) => setListen({ id, label: passes[i]!.label }))
    } catch (err) {
      notifyError('试听失败', err)
    } finally {
      setListen(null)
      setPlaying(false)
    }
  }

  // ---- export ---------------------------------------------------------------

  const render = async (part: 'all' | 'voice' | 'backing') => {
    const channels = await renderMix({
      voice,
      backing,
      backingNames,
      mix,
      bpm,
      part,
      sampleRate: SAMPLE_RATE,
      graph: modular ? props.graph : null,
    })
    return { channels, wav: encodeWav(channels, SAMPLE_RATE) }
  }

  const runExport = async (
    part: 'all' | 'voice' | 'backing',
    label: string,
    suffix: string,
    format: 'wav' | 'mp3' = 'wav',
  ) => {
    setBusy(label)
    try {
      const { channels, wav } = await render(part)
      if (format === 'mp3') {
        setBusy(`${label}（MP3 编码中）`)
        downloadBlob(
          await encodeMp3(channels, SAMPLE_RATE, mp3Kbps),
          `${safeName(title)}-${suffix}.mp3`,
        )
        return
      }
      downloadBlob(
        new Blob([wav as BlobPart], { type: 'audio/wav' }),
        `${safeName(title)}-${suffix}.wav`,
      )
    } catch (err) {
      notifyError('导出失败', err)
    } finally {
      setBusy(null)
    }
  }

  const saveToWorks = async () => {
    setBusy('正在合成作品')
    try {
      const { channels, wav } = await render('all')
      await SingService.saveCover({
        key: songKey,
        title,
        ...(artist ? { artist } : {}),
        mix,
        blob: new Blob([wav as BlobPart], { type: 'audio/wav' }),
        durationMs: Math.round(((channels[0]?.length ?? 0) / SAMPLE_RATE) * 1000),
      })
      toast({
        title: '已保存到作品集',
        description: '在作品集的「翻唱」里可以找到它。',
        variant: 'success',
      })
    } catch (err) {
      notifyError('保存失败', err)
    } finally {
      setBusy(null)
    }
  }

  // ---- panels ------------------------------------------------------------

  const panelTitles: Record<ModuleId, string> = {
    lowcut: '低切',
    eq: '均衡',
    comp: '压缩',
    deess: '齿音消除',
    reverb: '混响',
    delay: '延迟',
    balance: '平衡',
  }

  const panelProps = (id: string, lessonId?: ModuleId) => ({
    id,
    open: open[id] ?? true,
    onToggleOpen: () => setOpen((o) => ({ ...o, [id]: !(o[id] ?? true) })),
    lessonId,
    lessonOpen: !!lessonOpen[id],
    onToggleLesson: () => setLessonOpen((o) => ({ ...o, [id]: !o[id] })),
    listenLabel: listen?.id === id ? listen.label : null,
    onListen: lessonId ? () => void audition(lessonId, panelTitles[lessonId]) : () => undefined,
    listenDisabled: total <= 0 || busy !== null,
    highlighted: spotlight === id,
    panelRef: (el: HTMLElement | null) => {
      panelEls.current[id] = el
    },
  })

  /** Panel props for a 0.21 module: switch at a path, 「听听看」 inside the body. */
  const extraPanel = (
    id: AnyModuleId,
    title: string,
    on: boolean,
    setOn: (on: boolean) => void,
    summary: string,
  ) => ({
    ...panelProps(id),
    title,
    summary: on ? summary : '已关闭',
    on,
    onToggle: setOn,
  })
  const listenButton = (id: AnyModuleId, label: string) => (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => void audition(id, label)}
        disabled={total <= 0 || busy !== null}
      >
        听听看（关 / 开各放一遍）
      </Button>
      {listen && listen.id === id && (
        <span className="text-xs text-amber">正在播放：{listen.label}</span>
      )}
    </div>
  )
  const setVocal = <K extends keyof MixSettings['vocal']>(
    k: K,
    patch: Partial<MixSettings['vocal'][K]>,
  ) => vocal({ [k]: { ...(mix.vocal[k] as object), ...patch } } as Partial<MixSettings['vocal']>)

  const v = mix.vocal
  const bands = v.eq.bands
  const guide = guideStep !== null ? GUIDE_STEPS[guideStep] : undefined
  const canExport = voice !== null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">后期工作台</h2>
          <p className="text-xs text-muted-foreground">
            人声先经过「效果顺序」里的插入效果，再送去混响 /
            延迟，最后和伴奏一起进入母线。每个效果下面都有对应的后期课堂链接。
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setGuideStep(0)}>
          重看引导
        </Button>
      </div>

      {!voice && (
        <p className="rounded-2xl border border-amber/40 bg-amber-soft/40 px-4 py-3 text-sm text-foreground">
          先在「完整版」里合成你的人声。现在只能听伴奏，人声导出也暂时不可用。
        </p>
      )}

      {/* Transport */}
      <section className="space-y-4 rounded-3xl border border-border/80 bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          {playing ? (
            <Button onClick={onPause} disabled={total <= 0}>
              <Pause />
              暂停
            </Button>
          ) : (
            <Button onClick={onPlay} disabled={total <= 0 || busy !== null}>
              <Play />
              播放
            </Button>
          )}
          <Button variant="outline" onClick={onStop} disabled={total <= 0}>
            <Square />
            停止
          </Button>
          <Button
            variant={loopOn ? 'secondary' : 'outline'}
            aria-pressed={loopOn}
            onClick={toggleLoop}
            disabled={total <= 0}
          >
            <Repeat />
            循环
          </Button>
          <span className="ml-auto font-mono text-sm tabular-nums text-muted-foreground">
            {formatClock(shownPos)} / {formatClock(total)}
          </span>
        </div>
        <Slider
          aria-label="播放位置"
          disabled={total <= 0}
          min={0}
          max={Math.max(total, 0.01)}
          step={0.05}
          value={[Math.min(shownPos, Math.max(total, 0.01))]}
          onValueChange={(vals) => {
            const s = vals[0]
            if (s === undefined) return
            scrubRef.current = s
            setScrub(s)
          }}
          onValueCommit={(vals) => {
            const s = vals[0]
            if (s !== undefined) onSeek(s)
          }}
        />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            循环区间：{range ? `${formatClock(range.start)} – ${formatClock(range.end)}` : '整首'}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setLoopEdge('start')}
            disabled={total <= 0}
          >
            设起点 A
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setLoopEdge('end')}
            disabled={total <= 0}
          >
            设终点 B
          </Button>
          <Button size="sm" variant="ghost" onClick={clearRange} disabled={!range}>
            整首
          </Button>
        </div>
      </section>

      {props.onMode && (
        <section className="flex flex-wrap items-center gap-3 rounded-3xl border border-border/80 bg-card p-4">
          <div
            className="flex rounded-xl border border-border/80 p-0.5 text-sm"
            role="radiogroup"
            aria-label="后期方式"
          >
            {(['quick', 'modular'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={(props.mode ?? 'quick') === m}
                onClick={() =>
                  props.onMode?.(m, m === 'modular' && !props.graph ? graphFromMix(mix) : undefined)
                }
                className={`focus-ring rounded-lg px-4 py-1.5 ${(props.mode ?? 'quick') === m ? 'bg-amber-soft/50 font-medium text-foreground' : 'text-muted-foreground'}`}
              >
                {m === 'quick' ? '快速模式' : '模块模式'}
              </button>
            ))}
          </div>
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {modular
              ? '模块模式：自己拖模块、连线搭后期链路；听到和导出的都是工作区里的连线。人声的逐句平衡 / 音高修正和各分轨音量两种模式共用。'
              : '快速模式：固定顺序的一整条链路，配预设和讲解。想自己搭链路（并联、发送总线、同一种效果放好几个）就切到模块模式——第一次会按现在的设置自动铺好。'}
          </p>
          {modular && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (window.confirm('按快速模式现在的设置重新铺一遍工作区？现在的连线会被替换。'))
                  props.onGraph?.(graphFromMix(mix))
              }}
            >
              按快速模式重新铺
            </Button>
          )}
        </section>
      )}

      <section className="space-y-2 rounded-3xl border border-border/80 bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-foreground">音色</span>
          <div
            className="flex rounded-xl border border-border/80 p-0.5 text-sm"
            role="group"
            aria-label="音色"
          >
            {ENGINE_OPTIONS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={mix.engine === id}
                onClick={() => apply({ ...mix, engine: id })}
                className={`focus-ring rounded-lg px-4 py-1.5 ${mix.engine === id ? 'bg-amber-soft/50 font-medium text-foreground' : 'text-muted-foreground'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {mix.engine === 'airwindows'
            ? '压缩、齿音消除、饱和与混响使用移植自 Airwindows（Chris Johnson，MIT 许可）的效果器；旋钮和经典版相同，可以来回切换对比。'
            : '浏览器自带的效果器（0.27 及以前的声音）。'}
        </p>
      </section>

      <AutoMixPanel
        voice={voice}
        backing={backing}
        backingNames={backingNames}
        bpm={bpm}
        {...(props.refNotes?.length
          ? { lowestMidi: Math.min(...props.refNotes.map((n) => n.midi)) }
          : {})}
        mix={mix}
        onApply={(m) => {
          apply(m)
          if (modular) props.onGraph?.(graphFromMix(fitMix(m)))
        }}
        {...(props.loadReference ? { loadReference: props.loadReference } : {})}
        player={player}
        previewRegion={() => previewRegion(total, range, AUDITION_MAX_SEC)}
        modular={modular}
      />

      {modular ? (
        <>
          <ModularWorkspace
            graph={props.graph!}
            onGraph={(g) => props.onGraph?.(g)}
            mix={mix}
            onMix={apply}
            player={player}
            playing={playing}
            backingNames={backingNames}
          />
          <section className="grid gap-5 rounded-3xl border border-border/80 bg-card p-5 lg:grid-cols-[1fr_220px]">
            <div className="space-y-3">
              <SpectrumView getMeters={getMeters} live={playing} />
              <LoudnessReadout getMeters={getMeters} live={playing} />
            </div>
            <Meters getMeters={getMeters} getReduction={getReduction} />
          </section>
          {prepping && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" /> 正在处理人声（逐句音量平衡 / 音高修正）…
            </p>
          )}
        </>
      ) : (
        <>
          {/* Presets */}
          <section className="space-y-3 rounded-3xl border border-border/80 bg-card p-5">
            <h3 className="text-sm font-semibold text-foreground">一键预设</h3>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map(([id, p]) => {
                const active = mixEqual(mix, fitMix(withEngine(p.settings)))
                return (
                  <button
                    key={id}
                    type="button"
                    title={p.description}
                    aria-pressed={active}
                    onClick={() => apply(withEngine(cloneMix(p.settings)))}
                    className={`focus-ring rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      active
                        ? 'border-primary-strong bg-primary-strong text-primary-foreground'
                        : 'border-border/80 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {activePreset
                ? activePreset.description
                : '当前是自定义设置；点一个预设可以回到它的起点。'}
            </p>
            <UserPresets mix={mix} onMix={apply} />
            {props.onSnapshots && (
              <Snapshots
                snapshots={props.snapshots ?? []}
                mix={mix}
                onMix={apply}
                onChange={props.onSnapshots}
              />
            )}
          </section>

          {/* Curve and meters */}
          <section className="grid gap-5 rounded-3xl border border-border/80 bg-card p-5 lg:grid-cols-[1fr_220px]">
            <EqCurve
              vocal={v}
              analyser={player.meters()?.voice ?? null}
              live={playing}
              onBandsChange={(next) => vocal({ eq: { ...v.eq, bands: next } })}
            />
            <Meters getMeters={getMeters} getReduction={getReduction} />
          </section>
          <section className="space-y-3 rounded-3xl border border-border/80 bg-card p-5">
            <SpectrumView getMeters={getMeters} live={playing} />
            <LoudnessReadout getMeters={getMeters} live={playing} />
          </section>
          {prepping && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" /> 正在处理人声（逐句音量平衡 / 音高修正）…
            </p>
          )}

          {/* Module chain */}
          <div className="space-y-3">
            <ModulePanel
              {...panelProps('order')}
              title="效果顺序"
              summary={
                v.order.filter((id) => (id === 'lowCut' ? v.lowCut.on : v[id].on)).length +
                ' 个打开'
              }
              on={null}
            >
              <OrderEditor mix={mix} onMix={apply} />
            </ModulePanel>

            <ModulePanel
              {...extraPanel(
                'gate',
                '噪声门',
                v.gate.on,
                (on) => setVocal('gate', { on }),
                `${formatDb(v.gate.thresholdDb)} 以下压低 ${v.gate.rangeDb} dB`,
              )}
            >
              <Controls
                paths={['vocal.gate.thresholdDb', 'vocal.gate.rangeDb', 'vocal.gate.releaseMs']}
                mix={mix}
                onMix={apply}
                cols={3}
              />
              <p className="text-xs text-muted-foreground">
                句子之间的底噪、呼吸、耳机漏音会被压低；阈值要比最轻的唱声低，否则字尾会被切掉。
              </p>
              {listenButton('gate', '噪声门')}
              <LearnLinks module="gate" />
            </ModulePanel>
            <ModulePanel
              {...panelProps('lowcut', 'lowcut')}
              title="低切"
              summary={v.lowCut.on ? formatHz(v.lowCut.freq) : '已关闭'}
              on={v.lowCut.on}
              onToggle={(on) => vocal({ lowCut: { ...v.lowCut, on } })}
            >
              <NumField
                label="截止频率"
                value={v.lowCut.freq}
                min={40}
                max={300}
                step={1}
                unit="Hz"
                log
                digits={0}
                disabled={!v.lowCut.on}
                onChange={(freq) => vocal({ lowCut: { ...v.lowCut, freq } })}
              />
            </ModulePanel>

            <ModulePanel
              {...panelProps('eq', 'eq')}
              title="均衡（EQ）"
              summary={`4 段 · ${bands.map((b) => (b.gainDb > 0 ? '+' : '') + Math.round(b.gainDb * 10) / 10).join(' / ')} dB`}
              on={v.eq.on}
              onToggle={(on) => vocal({ eq: { ...v.eq, on } })}
            >
              {bands.map((b, i) => (
                <div
                  key={i}
                  className="grid gap-3 rounded-xl bg-muted/30 p-3 sm:grid-cols-[auto_1fr]"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground">第 {i + 1} 段</span>
                    <select
                      aria-label={`第 ${i + 1} 段类型`}
                      value={b.type}
                      onChange={(e) => setBand(i, { type: e.target.value as EqBandType })}
                      className={selectClass}
                    >
                      <option value="lowshelf">低架</option>
                      <option value="peaking">峰值</option>
                      <option value="highshelf">高架</option>
                    </select>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <NumField
                      label="频率"
                      value={b.freq}
                      min={20}
                      max={20000}
                      step={1}
                      unit="Hz"
                      log
                      digits={0}
                      disabled={!v.eq.on}
                      onChange={(freq) => setBand(i, { freq })}
                    />
                    <NumField
                      label="增益"
                      value={b.gainDb}
                      min={-15}
                      max={15}
                      step={0.1}
                      unit="dB"
                      disabled={!v.eq.on}
                      onChange={(gainDb) => setBand(i, { gainDb })}
                    />
                    <NumField
                      label="Q（越大越窄）"
                      value={b.q}
                      min={0.1}
                      max={10}
                      step={0.1}
                      unit=""
                      log
                      digits={2}
                      disabled={!v.eq.on}
                      onChange={(q) => setBand(i, { q })}
                    />
                  </div>
                </div>
              ))}
            </ModulePanel>

            <ModulePanel
              {...panelProps('comp', 'comp')}
              title="压缩"
              summary={v.comp.on ? `${formatDb(v.comp.thresholdDb)} · ${v.comp.ratio}:1` : '已关闭'}
              on={v.comp.on}
              onToggle={(on) => vocal({ comp: { ...v.comp, on } })}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <NumField
                  label="阈值"
                  value={v.comp.thresholdDb}
                  min={-60}
                  max={0}
                  step={0.5}
                  unit="dB"
                  disabled={!v.comp.on}
                  onChange={(thresholdDb) => vocal({ comp: { ...v.comp, thresholdDb } })}
                />
                <NumField
                  label="比率"
                  value={v.comp.ratio}
                  min={1}
                  max={20}
                  step={0.5}
                  unit=":1"
                  digits={1}
                  disabled={!v.comp.on}
                  onChange={(ratio) => vocal({ comp: { ...v.comp, ratio } })}
                />
                <div className={aw ? 'opacity-60' : undefined}>
                  <NumField
                    label="启动时间"
                    value={v.comp.attackMs}
                    min={0.1}
                    max={200}
                    step={0.1}
                    unit="ms"
                    log
                    digits={1}
                    disabled={!v.comp.on}
                    onChange={(attackMs) => vocal({ comp: { ...v.comp, attackMs } })}
                  />
                </div>
                <NumField
                  label="释放时间"
                  value={v.comp.releaseMs}
                  min={10}
                  max={2000}
                  step={1}
                  unit="ms"
                  log
                  digits={0}
                  disabled={!v.comp.on}
                  onChange={(releaseMs) => vocal({ comp: { ...v.comp, releaseMs } })}
                />
                <NumField
                  label="补偿增益"
                  value={v.comp.makeupDb}
                  min={0}
                  max={24}
                  step={0.5}
                  unit="dB"
                  disabled={!v.comp.on}
                  onChange={(makeupDb) => vocal({ comp: { ...v.comp, makeupDb } })}
                />
              </div>
              {aw && (
                <p className="text-xs text-muted-foreground">
                  新音色的压缩器会按音乐自动决定起音，「起音」只在经典音色下起作用。
                </p>
              )}
            </ModulePanel>

            <ModulePanel
              {...panelProps('deess', 'deess')}
              title="齿音消除"
              summary={v.deEss.on ? formatHz(v.deEss.freq) : '已关闭'}
              on={v.deEss.on}
              onToggle={(on) => vocal({ deEss: { ...v.deEss, on } })}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <NumField
                  label="频率"
                  value={v.deEss.freq}
                  min={3000}
                  max={12000}
                  step={10}
                  unit="Hz"
                  log
                  digits={0}
                  disabled={!v.deEss.on}
                  onChange={(freq) => vocal({ deEss: { ...v.deEss, freq } })}
                />
                <NumField
                  label="强度"
                  value={v.deEss.amountDb}
                  min={0}
                  max={12}
                  step={0.5}
                  unit="dB"
                  disabled={!v.deEss.on}
                  onChange={(amountDb) => vocal({ deEss: { ...v.deEss, amountDb } })}
                />
                <div className={aw ? 'opacity-60' : undefined}>
                  <NumField
                    label="阈值（齿音超过它才压）"
                    value={v.deEss.thresholdDb}
                    min={-60}
                    max={0}
                    step={0.5}
                    unit="dB"
                    disabled={!v.deEss.on}
                    onChange={(thresholdDb) => vocal({ deEss: { ...v.deEss, thresholdDb } })}
                  />
                </div>
              </div>
              {aw && (
                <p className="text-xs text-muted-foreground">
                  新音色的齿音消除会自己找齿音，「阈值」只在经典音色下起作用。
                </p>
              )}
              <LearnLinks module="deess" />
            </ModulePanel>

            <ModulePanel
              {...extraPanel(
                'dynEq',
                '动态 EQ',
                v.dynEq.on,
                (on) => setVocal('dynEq', { on }),
                `${formatHz(v.dynEq.freq)} 最多 −${v.dynEq.maxCutDb} dB`,
              )}
            >
              <Controls
                paths={[
                  'vocal.dynEq.freq',
                  'vocal.dynEq.q',
                  'vocal.dynEq.thresholdDb',
                  'vocal.dynEq.ratio',
                  'vocal.dynEq.maxCutDb',
                ]}
                mix={mix}
                onMix={apply}
                cols={3}
              />
              <p className="text-xs text-muted-foreground">
                只在某个频段"冒出来"的时候才衰减它（比如低音时的轰、高音时的刺），平时不动。
              </p>
              {listenButton('dynEq', '动态 EQ')}
              <LearnLinks module="dynEq" />
            </ModulePanel>

            <ModulePanel
              {...extraPanel(
                'comp2',
                '第二级压缩',
                v.comp2.on,
                (on) => setVocal('comp2', { on }),
                `${formatDb(v.comp2.thresholdDb)} · ${v.comp2.ratio}:1`,
              )}
            >
              <Knobs
                paths={[
                  'vocal.comp2.thresholdDb',
                  'vocal.comp2.ratio',
                  'vocal.comp2.attackMs',
                  'vocal.comp2.releaseMs',
                  'vocal.comp2.makeupDb',
                ]}
                faded={aw ? ['vocal.comp2.attackMs', 'vocal.comp2.releaseMs'] : []}
                mix={mix}
                onMix={apply}
              />
              {aw && (
                <p className="text-xs text-muted-foreground">
                  新音色的第二级压缩自动决定起音和释放，这两个旋钮只在经典音色下起作用。
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                两台压缩各压一点（例如第一台慢、整体平稳，第二台快、只抓峰值），比一台压很多更自然。
              </p>
              {listenButton('comp2', '第二级压缩')}
              <LearnLinks module="comp2" />
            </ModulePanel>

            <ModulePanel
              {...extraPanel(
                'parallel',
                '并行压缩',
                v.parallel.on,
                (on) => setVocal('parallel', { on }),
                `混入 ${Math.round(v.parallel.blend * 100)}%`,
              )}
            >
              <Knobs
                paths={[
                  'vocal.parallel.thresholdDb',
                  'vocal.parallel.ratio',
                  'vocal.parallel.blend',
                ]}
                faded={aw ? ['vocal.parallel.thresholdDb', 'vocal.parallel.ratio'] : []}
                mix={mix}
                onMix={apply}
              />
              {aw && (
                <p className="text-xs text-muted-foreground">
                  新音色用固定的强压缩做并行，「阈值」「比例」只在经典音色下起作用；混合比例照常。
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                把一份压得很扁的人声混在原声下面：轻的地方被托起来、更有密度，响的地方仍保留原来的冲击。
              </p>
              {listenButton('parallel', '并行压缩')}
              <LearnLinks module="parallel" />
            </ModulePanel>

            <ModulePanel
              {...extraPanel(
                'saturation',
                '饱和',
                v.saturation.on,
                (on) => setVocal('saturation', { on }),
                `${{ tape: '磁带', tube: '电子管', hard: '硬削波' }[v.saturation.type]} · ${Math.round(v.saturation.drive * 100)}%`,
              )}
            >
              <Controls
                paths={['vocal.saturation.type', 'vocal.saturation.drive', 'vocal.saturation.mix']}
                mix={mix}
                onMix={apply}
                cols={3}
              />
              <p className="text-xs text-muted-foreground">
                加一点谐波：声音更暖、更密、在伴奏里更容易听到；开大就是失真效果。
              </p>
              {listenButton('saturation', '饱和')}
              <LearnLinks module="saturation" />
            </ModulePanel>

            <ModulePanel
              {...extraPanel(
                'mod',
                '调制',
                v.mod.on,
                (on) => setVocal('mod', { on }),
                `${{ chorus: '合唱', flanger: '镶边', phaser: '移相', doubler: '加倍' }[v.mod.type]} · ${Math.round(v.mod.mix * 100)}%`,
              )}
            >
              <Controls
                paths={['vocal.mod.type', 'vocal.mod.rate', 'vocal.mod.depth', 'vocal.mod.mix']}
                mix={mix}
                onMix={apply}
              />
              <p className="text-xs text-muted-foreground">
                加倍让人声更宽、像唱了两遍；合唱更梦幻；镶边和移相是明显的"扫动"特效，适合点缀。
              </p>
              {listenButton('mod', '调制')}
              <LearnLinks module="mod" />
            </ModulePanel>

            <ModulePanel
              {...panelProps('reverb', 'reverb')}
              title="混响"
              summary={v.reverb.on ? `干湿 ${Math.round(v.reverb.mix * 100)}%` : '已关闭'}
              on={v.reverb.on}
              onToggle={(on) => vocal({ reverb: { ...v.reverb, on } })}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <NumField
                  label="房间大小"
                  value={v.reverb.size}
                  min={0}
                  max={1}
                  step={0.01}
                  unit="%"
                  percent
                  digits={0}
                  disabled={!v.reverb.on}
                  onChange={(size) => vocal({ reverb: { ...v.reverb, size } })}
                />
                <NumField
                  label="衰减时间"
                  value={v.reverb.decay}
                  min={0.2}
                  max={8}
                  step={0.1}
                  unit="s"
                  log
                  digits={1}
                  disabled={!v.reverb.on}
                  onChange={(decay) => vocal({ reverb: { ...v.reverb, decay } })}
                />
                <NumField
                  label="预延迟"
                  value={v.reverb.preDelayMs}
                  min={0}
                  max={200}
                  step={1}
                  unit="ms"
                  digits={0}
                  disabled={!v.reverb.on}
                  onChange={(preDelayMs) => vocal({ reverb: { ...v.reverb, preDelayMs } })}
                />
                <NumField
                  label="干湿比（混响比例）"
                  value={v.reverb.mix}
                  min={0}
                  max={1}
                  step={0.01}
                  unit="%"
                  percent
                  digits={0}
                  disabled={!v.reverb.on}
                  onChange={(mix) => vocal({ reverb: { ...v.reverb, mix } })}
                />
              </div>
              <Controls
                paths={['vocal.reverb.type', 'vocal.reverb.lowCut', 'vocal.reverb.highCut']}
                mix={mix}
                onMix={apply}
                cols={3}
              />
              <LearnLinks module="reverb" />
            </ModulePanel>

            <ModulePanel
              {...panelProps('delay', 'delay')}
              title="延迟"
              summary={
                v.delay.on
                  ? v.delay.sync
                    ? `${v.delay.division} 同步`
                    : `${Math.round(v.delay.timeMs)} ms`
                  : '已关闭'
              }
              on={v.delay.on}
              onToggle={(on) => vocal({ delay: { ...v.delay, on } })}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className="size-4 accent-[hsl(var(--primary-strong))]"
                      checked={v.delay.sync}
                      disabled={!v.delay.on}
                      onChange={(e) => vocal({ delay: { ...v.delay, sync: e.target.checked } })}
                    />
                    按歌曲速度（{Math.round(bpm)} BPM）同步
                  </label>
                  {v.delay.sync ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">时值</span>
                      <select
                        aria-label="延迟时值"
                        value={v.delay.division}
                        disabled={!v.delay.on}
                        onChange={(e) =>
                          vocal({
                            delay: {
                              ...v.delay,
                              division: e.target.value as MixSettings['vocal']['delay']['division'],
                            },
                          })
                        }
                        className={selectClass}
                      >
                        {DIVISIONS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {Math.round(delayMs(bpm, v.delay.division))} ms
                      </span>
                    </div>
                  ) : (
                    <NumField
                      label="延迟时间"
                      value={v.delay.timeMs}
                      min={20}
                      max={2000}
                      step={1}
                      unit="ms"
                      log
                      digits={0}
                      disabled={!v.delay.on}
                      onChange={(timeMs) => vocal({ delay: { ...v.delay, timeMs } })}
                    />
                  )}
                </div>
                <div className="space-y-4">
                  <NumField
                    label="回授（重复次数）"
                    value={v.delay.feedback}
                    min={0}
                    max={0.9}
                    step={0.01}
                    unit="%"
                    percent
                    digits={0}
                    disabled={!v.delay.on}
                    onChange={(feedback) => vocal({ delay: { ...v.delay, feedback } })}
                  />
                  <NumField
                    label="干湿比（延迟比例）"
                    value={v.delay.mix}
                    min={0}
                    max={1}
                    step={0.01}
                    unit="%"
                    percent
                    digits={0}
                    disabled={!v.delay.on}
                    onChange={(mix) => vocal({ delay: { ...v.delay, mix } })}
                  />
                </div>
              </div>
              <Controls
                paths={['vocal.delay.pingPong', 'vocal.delay.highCut']}
                mix={mix}
                onMix={apply}
              />
              <LearnLinks module="delay" />
            </ModulePanel>

            <ModulePanel
              {...extraPanel(
                'autoLevel',
                '逐句音量平衡',
                v.autoLevel.on,
                (on) => setVocal('autoLevel', { on }),
                `力度 ${Math.round(v.autoLevel.strength * 100)}%`,
              )}
            >
              <Controls paths={['vocal.autoLevel.strength']} mix={mix} onMix={apply} />
              <p className="text-xs text-muted-foreground">
                像录音师"推推子"一样：把太轻的句子推上来、太响的拉下去，让压缩不用那么重。
              </p>
              <PhraseOffsets mix={mix} onMix={apply} phrases={phrases} />
              {listenButton('autoLevel', '逐句音量平衡')}
              <LearnLinks module="autoLevel" />
            </ModulePanel>

            <ModulePanel
              {...extraPanel(
                'tune',
                '音高修正（实验）',
                v.tune.on,
                (on) => setVocal('tune', { on }),
                `力度 ${Math.round(v.tune.amount * 100)}%`,
              )}
            >
              <TuneControls
                mix={mix}
                onMix={apply}
                hasReference={!!props.refNotes?.length}
                stats={prepping ? null : prepStats(rawVoice, mix)}
              />
              {listenButton('tune', '音高修正')}
              <LearnLinks module="tune" />
            </ModulePanel>

            <ModulePanel
              {...panelProps('balance', 'balance')}
              title="平衡"
              summary={`人声 ${formatDb(v.gainDb)} · ${formatPan(v.pan)} · 伴奏 ${formatDb(mix.backing.gainDb)}`}
              on={null}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <NumField
                  label="人声音量"
                  value={v.gainDb}
                  min={-24}
                  max={12}
                  step={0.5}
                  unit="dB"
                  onChange={(gainDb) => vocal({ gainDb })}
                />
                <NumField
                  label="人声声像（负数偏左，正数偏右）"
                  value={v.pan}
                  min={-1}
                  max={1}
                  step={0.01}
                  unit="%"
                  percent
                  digits={0}
                  onChange={(pan) => vocal({ pan })}
                />
                <NumField
                  label="伴奏音量"
                  value={mix.backing.gainDb}
                  min={-24}
                  max={12}
                  step={0.5}
                  unit="dB"
                  onChange={(gainDb) => backingPatch({ gainDb })}
                />
              </div>
              <div className="space-y-3 rounded-xl bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">伴奏 EQ</span>
                  <OnSwitch
                    checked={mix.backing.eq.on}
                    onChange={(on) => backingPatch({ eq: { ...mix.backing.eq, on } })}
                    label="伴奏 EQ 开关"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <NumField
                    label="低频（120 Hz 以下）"
                    value={mix.backing.eq.lowDb}
                    min={-15}
                    max={15}
                    step={0.5}
                    unit="dB"
                    disabled={!mix.backing.eq.on}
                    onChange={(lowDb) => backingPatch({ eq: { ...mix.backing.eq, lowDb } })}
                  />
                  <NumField
                    label="中频（1 kHz）"
                    value={mix.backing.eq.midDb}
                    min={-15}
                    max={15}
                    step={0.5}
                    unit="dB"
                    disabled={!mix.backing.eq.on}
                    onChange={(midDb) => backingPatch({ eq: { ...mix.backing.eq, midDb } })}
                  />
                  <NumField
                    label="高频（8 kHz 以上）"
                    value={mix.backing.eq.highDb}
                    min={-15}
                    max={15}
                    step={0.5}
                    unit="dB"
                    disabled={!mix.backing.eq.on}
                    onChange={(highDb) => backingPatch({ eq: { ...mix.backing.eq, highDb } })}
                  />
                </div>
              </div>
              <div className="space-y-3 rounded-xl bg-muted/30 p-3">
                <p className="text-sm font-medium">给人声让位置</p>
                <Controls
                  paths={['backing.duck.on', 'backing.duck.amountDb', 'backing.duck.releaseMs']}
                  mix={mix}
                  onMix={apply}
                  cols={3}
                />
                <Controls
                  paths={['backing.pocket.on', 'backing.pocket.freq', 'backing.pocket.amountDb']}
                  mix={mix}
                  onMix={apply}
                  cols={3}
                />
                <div className="flex flex-wrap gap-2">
                  {listenButton('duck', '伴奏让位')}
                  {listenButton('pocket', '中频凹陷')}
                </div>
                <LearnLinks module="duck" />
                <LearnLinks module="pocket" />
              </div>
              <StemLevels names={backingNames} mix={mix} onMix={apply} />
              <LearnLinks module="balance" />
            </ModulePanel>

            <ModulePanel
              {...panelProps('master')}
              title="母线"
              summary={`${mix.master.limiter ? '限幅器开' : '限幅器关'} · ${formatDb(mix.master.gainDb)}`}
              on={null}
            >
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-foreground">限幅器（防止爆音）</span>
                <OnSwitch
                  checked={mix.master.limiter}
                  onChange={(limiter) => masterPatch({ limiter })}
                  label="限幅器开关"
                />
              </div>
              <NumField
                label="总输出音量"
                value={mix.master.gainDb}
                min={-24}
                max={12}
                step={0.5}
                unit="dB"
                onChange={(gainDb) => masterPatch({ gainDb })}
              />
              <Controls paths={['master.ceilingDb']} mix={mix} onMix={apply} />
              <LoudnessTarget mix={mix} onMix={apply} />
              <div className="space-y-3 rounded-xl bg-muted/30 p-3">
                <Controls
                  paths={[
                    'master.multiband.on',
                    'master.multiband.lowHz',
                    'master.multiband.highHz',
                  ]}
                  mix={mix}
                  onMix={apply}
                  cols={3}
                />
                {mix.master.multiband.on && (
                  <Controls
                    paths={[
                      'master.multiband.bands.0.thresholdDb',
                      'master.multiband.bands.0.ratio',
                      'master.multiband.bands.1.thresholdDb',
                      'master.multiband.bands.1.ratio',
                      'master.multiband.bands.2.thresholdDb',
                      'master.multiband.bands.2.ratio',
                    ]}
                    mix={mix}
                    onMix={apply}
                  />
                )}
                {listenButton('multiband', '多段压缩')}
              </div>
              <div className="space-y-3 rounded-xl bg-muted/30 p-3">
                <Controls
                  paths={['master.width.on', 'master.width.amount']}
                  mix={mix}
                  onMix={apply}
                />
                {listenButton('width', '立体声宽度')}
              </div>
              <LearnLinks module="master" />
            </ModulePanel>
          </div>

          <SuggestionsPanel voice={voice} backing={backing} mix={mix} onMix={apply} />

          <EarQuiz
            player={player}
            mix={mix}
            getRegion={() => previewRegion(total, range, QUIZ_MAX_SEC)}
          />
        </>
      )}

      {/* Export */}
      <section className="space-y-3 rounded-3xl border border-border/80 bg-card p-5">
        <h3 className="font-semibold text-foreground">导出</h3>
        {!canExport && (
          <p className="text-sm text-muted-foreground">
            先在「完整版」里合成你的人声。（仍可单独导出伴奏。）
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => runExport('all', '正在导出完整版', '完整版')}
            disabled={!canExport || busy !== null}
          >
            <Download />
            导出完整版 WAV
          </Button>
          <Button
            variant="outline"
            onClick={() => runExport('all', '正在导出完整版', '完整版', 'mp3')}
            disabled={!canExport || busy !== null}
          >
            <Download />
            导出完整版 MP3
          </Button>
          <select
            value={mp3Kbps}
            onChange={(e) => setMp3Kbps(Number(e.target.value))}
            className={selectClass}
            aria-label="MP3 码率"
          >
            {[128, 192, 256, 320].map((k) => (
              <option key={k} value={k}>
                MP3 {k} kbps
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            onClick={() => runExport('voice', '正在导出人声', '人声')}
            disabled={!canExport || busy !== null}
          >
            只导出处理后的人声
          </Button>
          <Button
            variant="outline"
            onClick={() => runExport('backing', '正在导出伴奏', '伴奏')}
            disabled={backing.length === 0 || busy !== null}
          >
            只导出伴奏
          </Button>
          <Button variant="secondary" onClick={saveToWorks} disabled={!canExport || busy !== null}>
            <Save />
            保存到作品集
          </Button>
        </div>
        {busy && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" />
            {busy}…
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          翻唱使用的是原曲伴奏，仅供个人练习，请勿公开发布。
        </p>
      </section>

      {guide && !modular && (
        <div
          role="dialog"
          aria-label="后期工作台引导"
          className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-lg rounded-3xl border border-border/80 bg-card p-5 shadow-soft"
        >
          <p className="text-xs text-muted-foreground">
            第 {guideStep! + 1} / {GUIDE_STEPS.length} 步
          </p>
          <h3 className="mt-1 font-semibold text-foreground">{guide.title}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{guide.text}</p>
          <div className="mt-4 flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={finishGuide}>
              跳过
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setGuideStep((s) => Math.max(0, (s ?? 0) - 1))}
                disabled={guideStep === 0}
              >
                上一步
              </Button>
              {guideStep === GUIDE_STEPS.length - 1 ? (
                <Button size="sm" onClick={finishGuide}>
                  完成
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() =>
                    setGuideStep((s) => Math.min(GUIDE_STEPS.length - 1, (s ?? 0) + 1))
                  }
                >
                  下一步
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
