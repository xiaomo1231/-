import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AudioLines, Crosshair, FileAudio, Loader2, Scissors, Trash2, Volume2, VolumeX, Wand2 } from 'lucide-react'
import { SeparateDialog } from '@/widgets/separation/SeparateDialog'
import type { AlphaTabApi, model } from '@coderline/alphatab'
import type { SheetBacking, SongSheet } from '@/entities/types'
import { BackingError, BackingService } from '@/services/backingService'
import { StemPlayer, firstSoundMs } from '@/audio/backing/stemPlayer'
import { outputLatencySeconds } from '@/audio/engine'
import {
  EMPTY_SYNC,
  ROLE_LABEL,
  STEM_LABEL,
  STEM_ORDER,
  audioMsAt,
  barStartMs,
  audioMsForScoreMs,
  barTimeline,
  firstNoteScoreMs,
  roleMix,
  tapsToPoints,
  type PracticeRole,
  type StemKind,
  type SyncMap,
} from '@/songs/backingSync'
import { toast } from '@/features/toast/toastStore'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

const ROLES: PracticeRole[] = ['listen', 'lead', 'rhythm', 'bass', 'drums', 'sing']
const TAP_BARS = 8

/**
 * 原曲伴奏: the student's own recording (whole, or stems separated with UVR)
 * played in time with the sheet. The sheet player stays the clock (speed,
 * loop and count-in keep working); the recording follows it. Practice roles
 * mute the student's stem; sheet tracks can fill in what was removed.
 */
export function BackingPanel({ sheet, score, api, track, onChange, transpose = 0 }: { sheet: SongSheet; score: model.Score; api: AlphaTabApi | null; track: number; onChange: (b: SheetBacking | undefined) => void; transpose?: number }) {
  const backing = sheet.backing
  const [busy, setBusy] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(true)
  // 变调: the recording cannot change key, so it stops playing with a transposed sheet (can be turned back on).
  useEffect(() => {
    if (transpose !== 0) setEnabled(false)
  }, [transpose])
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const sepInput = useRef<HTMLInputElement>(null)
  const [sepFile, setSepFile] = useState<File | null>(null)
  const timeline = useMemo(() => barTimeline(score), [score])
  const player = useRef<StemPlayer | null>(null)
  const [ready, setReady] = useState(false)
  const stemKey = backing?.stems.map((s) => s.fileId).join('|') ?? ''
  const sync = backing?.sync ?? EMPTY_SYNC
  const syncRef = useRef(sync)
  syncRef.current = sync

  // Load the stems into a player.
  useEffect(() => {
    if (!backing?.stems.length) return
    let dead = false
    void (async () => {
      const stems = (await Promise.all(backing.stems.map(async (s) => ({ stem: s.stem, blob: await BackingService.blob(s.fileId) })))).filter((s): s is { stem: StemKind; blob: Blob } => s.blob !== null)
      if (dead) return
      player.current?.destroy()
      player.current = new StemPlayer(stems)
      setReady(true)
    })()
    return () => {
      dead = true
      player.current?.destroy()
      player.current = null
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stemKey])

  // Mixer → player.
  useEffect(() => {
    player.current?.setMix(backing?.mix ?? {}, backing?.recordingVolume ?? 1)
  }, [ready, backing?.mix, backing?.recordingVolume])

  // Which sheet tracks the synth plays while the recording is on.
  useEffect(() => {
    if (!api || !backing?.stems.length) return
    const fill = new Set(backing.fillTracks ?? [])
    for (const t of score.tracks) api.changeTrackMute([t], enabled && !fill.has(t.index))
    api.masterVolume = enabled ? (backing.synthVolume ?? 0.8) : 1
    if (!enabled) player.current?.pause()
  }, [api, enabled, score, backing?.fillTracks, backing?.synthVolume, backing?.stems.length])

  // Follow the sheet's clock.
  useEffect(() => {
    if (!api || !ready || !enabled) return
    const offState = api.playerStateChanged.on((e) => {
      const p = player.current
      if (!p) return
      if (e.state === 1) {
        p.setRate(api.playbackSpeed)
        p.play(audioMsAt(timeline, syncRef.current, api.tickPosition))
      } else p.pause()
    })
    const offPos = api.playerPositionChanged.on((e) => {
      const p = player.current
      if (!p?.isPlaying) return
      p.setRate(api.playbackSpeed)
      p.follow(audioMsAt(timeline, syncRef.current, e.currentTick))
    })
    return () => {
      offState()
      offPos()
      player.current?.pause()
    }
  }, [api, ready, enabled, timeline])

  const add = async (files: File[]) => {
    if (!files.length) return
    setBusy('正在保存音频…')
    try {
      let b = await BackingService.addFiles(sheet.id, files)
      // First time: line the recording's first sound up with the sheet's first note.
      if (!sheet.backing && !b.sync.points.length && b.sync.offsetMs === 0) {
        setBusy('正在对齐开头…')
        b = (await autoAlign(b)) ?? b
      }
      onChange(b)
      toast({ title: `已附上 ${files.length} 个音频`, description: b.stems.map((s) => STEM_LABEL[s.stem]).join('、'), variant: 'success' })
    } catch (e) {
      toast({ title: '音频没有保存', description: e instanceof BackingError ? e.message : String(e), variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const autoAlign = async (b: SheetBacking): Promise<SheetBacking | undefined> => {
    const pick = (['drums', 'mix', 'instrumental', 'bass', 'guitar'] as StemKind[]).map((k) => b.stems.find((s) => s.stem === k)).find(Boolean) ?? b.stems[0]
    if (!pick) return undefined
    const blob = await BackingService.blob(pick.fileId)
    const first = blob ? await firstSoundMs(blob).catch(() => null) : null
    if (first === null) {
      toast({ title: '没能自动找到开头', description: '可以用下面的「打拍对齐」手动对齐。', variant: 'info' })
      return undefined
    }
    return BackingService.setSync(sheet.id, { offsetMs: Math.round(first - firstNoteScoreMs(score, timeline)), points: [] })
  }

  const setSync = async (next: SyncMap) => onChange(await BackingService.setSync(sheet.id, next))

  const separator = (
    <>
      <input ref={sepInput} type="file" accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg" className="hidden" aria-label="选择要自动分轨的原曲" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setSepFile(f) }} />
      <SeparateDialog
        file={sepFile}
        onClose={() => setSepFile(null)}
        onDone={(files) => {
          setSepFile(null)
          void add(files)
        }}
      />
    </>
  )

  if (!backing?.stems.length) {
    return (
      <section
        className={cn('rounded-3xl border border-dashed p-6 transition-colors', dragging ? 'border-cyan bg-cyan-soft/20' : 'border-border/80 bg-card')}
        aria-label="原曲伴奏"
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void add([...e.dataTransfer.files])
        }}
      >
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <AudioLines className="h-5 w-5 text-cyan" aria-hidden /> 原曲伴奏（可选）
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          附上这首歌的原版音频，就能跟着原曲练：光标和原曲同步，按要练的部分去掉对应的轨道。可以是一个完整音频，也可以是用 UVR（Ultimate Vocal Remover）桌面版分好的几轨——文件名里带 vocals / drums / bass / guitar / piano / other（或 人声 / 鼓 / 贝斯 / 吉他…）会自动认出。音频只保存在这台电脑里。
        </p>
        <div className="mt-4 flex items-center gap-3">
          <Button variant="outline" onClick={() => input.current?.click()} disabled={busy !== null}>
            {busy ? <Loader2 className="animate-spin" /> : <FileAudio />} {busy ?? '选择音频文件'}
          </Button>
          <Button onClick={() => sepInput.current?.click()} disabled={busy !== null}>
            <Scissors /> 上传原曲，自动分轨
          </Button>
          <span className="text-xs text-muted-foreground">已经分好的几轨可以一次选多个，也可以拖进这里；只有原曲就点「自动分轨」。</span>
        </div>
        {separator}
        <input ref={input} type="file" multiple accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg" className="hidden" aria-label="选择音频文件" onChange={(e) => void add([...(e.target.files ?? [])]).finally(() => (e.target.value = ''))} />
      </section>
    )
  }

  const kinds = backing.stems.map((s) => s.stem)
  const role = backing.role ?? 'listen'
  const removed = roleMix(role, kinds).removed
  const otherGuitars = score.tracks.filter((t) => t.index !== track && !t.staves[0]?.isPercussion && (sheet.tracks?.find((x) => x.index === t.index)?.instrument ?? 'guitar') === 'guitar')

  const chooseRole = async (r: PracticeRole) => {
    // Lead / rhythm with a guitar stem: the sheet's other guitar tracks replace the removed guitars.
    const fill = (r === 'lead' || r === 'rhythm') && kinds.includes('guitar') ? otherGuitars.map((t) => t.index) : []
    onChange(await BackingService.setRole(sheet.id, r, fill))
  }

  return (
    <section className="space-y-5 rounded-3xl border border-cyan/40 bg-card p-6 surface-gradient" aria-label="原曲伴奏">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <AudioLines className="h-5 w-5 text-cyan" aria-hidden /> 原曲伴奏
        </h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--amber))]" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          播放谱子时同时放原曲
        </label>
        {transpose !== 0 && <p className="w-full text-xs text-muted-foreground">谱子已变调，原曲音频不能跟着变调，所以先关掉了原曲；打开的话原曲和谱子的音高会对不上。</p>}
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">我要练</div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="练习角色">
          {ROLES.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={role === r} onClick={() => void chooseRole(r)} className={cn('focus-ring rounded-full border px-3 py-1.5 text-sm', role === r ? 'border-amber/70 bg-amber-soft/40' : 'border-border/80 text-muted-foreground hover:text-foreground')}>
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
        {role === 'sing' && kinds.includes('vocals') && (
          <p className="text-sm">
            <Link to={`/sing/sheet/${sheet.id}`} className="focus-ring rounded text-cyan hover:underline">
              去「跟唱」练音准 →
            </Link>
            <span className="ml-2 text-xs text-muted-foreground">用人声轨对比你和原唱的音高，每句给出报告。</span>
          </p>
        )}
        {!removed && <p className="text-xs text-muted-foreground">只有完整音频，没法单独去掉这一部分。可以导入用 UVR 分好的轨道，或者关掉原曲、只用谱子的合成伴奏。</p>}
        {(role === 'lead' || role === 'rhythm') && kinds.includes('guitar') && (
          <div className="rounded-xl border border-border/60 p-3 text-sm">
            <p className="text-xs text-muted-foreground">分轨模型分不开主音和节奏吉他，所以原曲的吉他整轨去掉了。勾选的谱子音轨会用合成音色补上：</p>
            <div className="mt-2 flex flex-wrap gap-3">
              {score.tracks
                .filter((t) => !t.staves[0]?.isPercussion)
                .map((t) => {
                  const on = backing.fillTracks?.includes(t.index) ?? false
                  return (
                    <label key={t.index} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[hsl(var(--amber))]"
                        checked={on}
                        onChange={async () => {
                          const fill = on ? (backing.fillTracks ?? []).filter((x) => x !== t.index) : [...(backing.fillTracks ?? []), t.index]
                          onChange(await BackingService.update(sheet.id, { fillTracks: fill }))
                        }}
                      />
                      {t.name || `音轨 ${t.index + 1}`}
                      {t.index === track && <span className="text-xs text-muted-foreground">（你在练的）</span>}
                    </label>
                  )
                })}
            </div>
          </div>
        )}
      </div>

      <ul className="grid gap-2 md:grid-cols-2" aria-label="原曲轨道">
        {[...backing.stems]
          .sort((a, b) => STEM_ORDER.indexOf(a.stem) - STEM_ORDER.indexOf(b.stem))
          .map((s) => {
            const m = backing.mix?.[s.stem] ?? { volume: 1, muted: false }
            const setMix = async (patch: Partial<typeof m>) => onChange(await BackingService.update(sheet.id, { mix: { ...backing.mix, [s.stem]: { ...m, ...patch } } }))
            return (
              <li key={s.fileId} className="flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2">
                <button type="button" onClick={() => void setMix({ muted: !m.muted })} aria-pressed={m.muted} aria-label={`${m.muted ? '打开' : '静音'}${STEM_LABEL[s.stem]}`} className={cn('focus-ring rounded p-1', m.muted ? 'text-destructive' : 'text-muted-foreground hover:text-foreground')}>
                  {m.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className={cn('text-sm', m.muted && 'text-muted-foreground line-through')}>{STEM_LABEL[s.stem]}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{s.name}</div>
                </div>
                <input type="range" min={0} max={1} step={0.05} value={m.volume} onChange={(e) => void setMix({ volume: Number(e.target.value) })} aria-label={`${STEM_LABEL[s.stem]}音量`} className="w-24 accent-[hsl(var(--amber))]" />
                <button type="button" onClick={async () => onChange(await BackingService.removeStem(sheet.id, s.fileId))} aria-label={`删除${STEM_LABEL[s.stem]}`} className="focus-ring rounded p-1 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            )
          })}
      </ul>
      <div className="flex flex-wrap items-center gap-5 text-sm">
        <label className="flex items-center gap-2">
          原曲音量
          <input type="range" min={0} max={1} step={0.05} value={backing.recordingVolume ?? 1} onChange={async (e) => onChange(await BackingService.update(sheet.id, { recordingVolume: Number(e.target.value) }))} className="w-28 accent-[hsl(var(--amber))]" />
        </label>
        <label className="flex items-center gap-2">
          谱子合成音量
          <input type="range" min={0} max={1} step={0.05} value={backing.synthVolume ?? 0.8} onChange={async (e) => onChange(await BackingService.update(sheet.id, { synthVolume: Number(e.target.value) }))} className="w-28 accent-[hsl(var(--amber))]" />
        </label>
        <Button size="sm" variant="ghost" onClick={() => input.current?.click()} disabled={busy !== null}>
          {busy ? <Loader2 className="animate-spin" /> : <FileAudio />} 添加 / 替换轨道
        </Button>
        <Button size="sm" variant="ghost" onClick={() => sepInput.current?.click()} disabled={busy !== null}>
          <Scissors /> 用原曲重新自动分轨
        </Button>
        {separator}
        <input ref={input} type="file" multiple accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg" className="hidden" aria-label="添加音频文件" onChange={(e) => void add([...(e.target.files ?? [])]).finally(() => (e.target.value = ''))} />
      </div>

      <Alignment
        sync={sync}
        player={player.current}
        ready={ready}
        timeline={timeline}
        api={api}
        onSync={(s) => void setSync(s)}
        onAuto={async () => {
          setBusy('正在对齐开头…')
          try {
            const b = await autoAlign(backing)
            if (b) onChange(b)
          } finally {
            setBusy(null)
          }
        }}
        busy={busy !== null}
      />
      <p className="text-xs text-muted-foreground">用麦克风练时请戴耳机，否则原曲会被麦克风收进去影响判定；用吉他线不受影响。分轨后残留一点被去掉的乐器声是正常的。</p>
    </section>
  )
}

/** Offset nudging, auto start alignment and tap-along sync points. */
function Alignment({
  sync,
  player,
  ready,
  timeline,
  api,
  onSync,
  onAuto,
  busy,
}: {
  sync: SyncMap
  player: StemPlayer | null
  ready: boolean
  timeline: ReturnType<typeof barTimeline>
  api: AlphaTabApi | null
  onSync: (s: SyncMap) => void
  onAuto: () => void
  busy: boolean
}) {
  const [tapBar, setTapBar] = useState(0)
  const [tapping, setTapping] = useState(false)
  const taps = useRef<number[]>([])
  const [tapCount, setTapCount] = useState(0)
  const bars = timeline.length

  const nudge = (ms: number) => {
    if (sync.points.length) onSync({ ...sync, points: sync.points.map((p) => ({ ...p, audioMs: p.audioMs + ms })) })
    else onSync({ ...sync, offsetMs: sync.offsetMs + ms })
  }

  const finishTaps = () => {
    setTapping(false)
    player?.pause()
    if (taps.current.length >= 2) onSync({ ...sync, points: tapsToPoints(sync.points, tapBar, taps.current) })
    else if (taps.current.length === 1) onSync({ offsetMs: Math.round(taps.current[0]! - barStartMs(timeline, tapBar)), points: sync.points })
  }

  // Space = this bar's downbeat.
  useEffect(() => {
    if (!tapping) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      e.preventDefault()
      if (!player) return
      // What is heard lags the element's clock by the output latency.
      taps.current.push(player.positionMs() - outputLatencySeconds() * 1000)
      setTapCount(taps.current.length)
      if (taps.current.length >= TAP_BARS) finishTaps()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tapping, player])

  const startTaps = () => {
    if (!player) return
    api?.pause()
    taps.current = []
    setTapCount(0)
    // Start two bars early (by the current alignment) so the student hears it coming.
    const leadIn = barStartMs(timeline, tapBar) - barStartMs(timeline, Math.max(0, tapBar - 2))
    const at = audioMsForScoreMs(timeline, sync, barStartMs(timeline, tapBar)) - leadIn
    player.setRate(1)
    setTapping(true)
    // Let the sheet player's pause land first (it would stop the recording again).
    window.setTimeout(() => player.play(Math.max(0, at)), 200)
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">和谱子对齐</div>
        <div className="text-xs text-muted-foreground">
          {sync.points.length ? `已打 ${sync.points.length} 个同步点（第 ${sync.points[0]!.bar + 1}–${sync.points[sync.points.length - 1]!.bar + 1} 小节）` : `开头偏移 ${(sync.offsetMs / 1000).toFixed(2)} 秒`}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">原曲整体</span>
        {[-100, -20, 20, 100].map((ms) => (
          <Button key={ms} size="sm" variant="outline" onClick={() => nudge(ms)} aria-label={`原曲${ms < 0 ? '提前' : '推后'} ${Math.abs(ms)} 毫秒`}>
            {ms < 0 ? '提前' : '推后'} {Math.abs(ms)}ms
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={onAuto} disabled={busy || !ready}>
          <Wand2 /> 自动对齐开头
        </Button>
        {sync.points.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onSync({ ...sync, points: [] })}>
            清除同步点
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">打拍对齐：从第</span>
        <select value={tapBar} onChange={(e) => setTapBar(Number(e.target.value))} disabled={tapping} className="focus-ring h-8 rounded-lg border border-border bg-background px-2" aria-label="打拍起始小节">
          {Array.from({ length: bars }, (_, b) => (
            <option key={b} value={b}>
              {b + 1}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground">小节起，听到每小节第一拍按空格</span>
        {tapping ? (
          <Button size="sm" onClick={finishTaps}>
            完成（已按 {tapCount} / {TAP_BARS}）
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={startTaps} disabled={!ready}>
            <Crosshair /> 开始打拍
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">原曲中间有变速、渐慢，或光标越走越偏时，在偏的地方打几小节拍就能修正。也可以先播放谱子，听原曲是早了还是晚了，再用上面的按钮微调。</p>
    </div>
  )
}
