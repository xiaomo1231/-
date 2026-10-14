import { useEffect, useMemo, useState } from 'react'
import * as Tone from 'tone'
import { uuid } from '@/infrastructure/crypto/crypto'
import { Circle, Loader2, Pause, Play, Square, Wand2 } from 'lucide-react'
import { useSing, type SessionTake } from '@/features/sing/useSingSession'
import { EMPTY_COMP, type CompPlan } from '@/songs/singTypes'
import {
  assembleComp,
  assembleVoice,
  sliceMs,
  type CompPiece,
  type VoicePiece,
} from '@/songs/compAssembly'
import { lyricForPhrase } from '@/songs/lyrics'
import { isScorable, notesIn, scoreNotes } from '@/songs/singAlong'
import { encodeTake } from '@/audio/sing/voiceRecorder'
import { takeBuffer } from '@/audio/sing/takePlayback'
import { SingService } from '@/services/singService'
import { toast } from '@/features/toast/toastStore'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

const RATE = 44100
const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Decode a blob in the shared context, mono-mixed to Float32 at its own rate. */
async function decodeMono(blob: Blob): Promise<{ samples: Float32Array; sampleRate: number }> {
  const ctx = Tone.getContext().rawContext as AudioContext
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
  const out = new Float32Array(buf.length)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < buf.length; i++) out[i]! += d[i]! / buf.numberOfChannels
  }
  return { samples: out, sampleRate: buf.sampleRate }
}

/**
 * 完整版: stitch the best phrase takes (or a whole-song take) into one voice
 * track, ready for the post-production desk.
 */
export function FullVersionTab({
  onVoice,
}: {
  onVoice: (voice: AudioBuffer, label: string) => void
}) {
  const s = useSing()
  const { phrases, notes, meta, takes, player } = s
  const plan: CompPlan = meta?.comp ?? EMPTY_COMP
  const [alignToSinger, setAlignToSinger] = useState(true)
  const [building, setBuilding] = useState(false)
  const [recording, setRecording] = useState<'idle' | 'on' | 'paused'>('idle')
  const [segStart, setSegStart] = useState(0)
  const [pieces, setPieces] = useState<VoicePiece[]>([])
  const fullTakes = takes[-1] ?? []

  const best = (list: SessionTake[]) =>
    [...list]
      .filter((t) => t.audio && t.score)
      .sort((a, b) => b.score!.score - a.score!.score)[0] ?? list.find((t) => t.audio)
  const pickFor = (i: number): string | 'guide' | null =>
    i in plan.picks ? plan.picks[i]! : (best(takes[i] ?? [])?.id ?? null)

  const save = (patch: Partial<CompPlan>) => void s.setMeta({ comp: { ...plan, ...patch } })

  const songMs =
    player.current?.duration ?? (phrases.length ? phrases[phrases.length - 1]!.endMs + 3000 : 0)

  // ---- stitch ----------------------------------------------------------------
  const buildComp = async () => {
    setBuilding(true)
    try {
      await Tone.start()
      const out: CompPiece[] = []
      let guide: { samples: Float32Array; sampleRate: number } | null = null
      for (const p of phrases) {
        const pick = pickFor(p.index)
        const nudge = (plan.phraseOffsets[p.index] ?? 0) + plan.offsetMs
        if (pick === 'guide') {
          if (!guide) {
            const v = s.stems.current.find((x) => x.stem === 'vocals')
            if (v) guide = await decodeMono(v.blob)
          }
          if (guide)
            out.push({
              samples: sliceMs(guide.samples, guide.sampleRate, p.startMs - 150, p.endMs + 150),
              sampleRate: guide.sampleRate,
              startMs: p.startMs - 150 + nudge,
              phraseStartMs: p.startMs + nudge,
              phraseEndMs: p.endMs + nudge,
            })
          continue
        }
        const t = (takes[p.index] ?? []).find((x) => x.id === pick)
        if (!t?.audio) continue
        const buf = await takeBuffer(t)
        if (!buf) continue
        const lag = alignToSinger ? (t.score?.lagMs ?? 0) : 0
        out.push({
          samples: buf.getChannelData(0).slice(),
          sampleRate: buf.sampleRate,
          startMs: (t.audioStartMs ?? p.startMs) + (t.nudgeMs ?? 0) - lag + nudge,
          phraseStartMs: p.startMs + nudge,
          phraseEndMs: p.endMs + nudge,
        })
      }
      if (!out.length) {
        toast({
          title: '还没有可以拼的录音',
          description: '先在「跟唱」里打开麦克风唱几句。',
          variant: 'info',
        })
        return
      }
      // Each phrase keeps only its own singing; neighbours are cut at the quietest moment between them.
      finish(assembleComp(out, songMs, RATE), '拼接的完整版')
    } finally {
      setBuilding(false)
    }
  }

  const finish = (voice: Float32Array, label: string) => {
    const ctx = Tone.getContext().rawContext as AudioContext
    const buf = ctx.createBuffer(1, voice.length, RATE)
    buf.copyToChannel(voice as Float32Array<ArrayBuffer>, 0)
    onVoice(buf, label)
    toast({
      title: '人声已合成',
      description: '到「后期」里调音色、和伴奏一起导出。',
      variant: 'success',
    })
  }

  // ---- whole-song take ---------------------------------------------------------
  const startFull = () => {
    if (s.mic !== 'on') {
      toast({
        title: '先打开麦克风',
        description: '在「跟唱」页签里点「打开麦克风」。',
        variant: 'info',
      })
      return
    }
    s.clearSamples(0, Infinity)
    setPieces([])
    setSegStart(0)
    s.play(0)
    setRecording('on')
  }
  const cutSegment = (): VoicePiece | null => {
    const end = player.current?.positionMs() ?? 0
    const cut = s.cutRecording(segStart, end)
    return cut ? { samples: cut.samples, sampleRate: cut.sampleRate, startMs: cut.startMs } : null
  }
  const pauseFull = () => {
    const piece = cutSegment()
    s.pause()
    if (piece) setPieces((ps) => [...ps, piece])
    setRecording('paused')
  }
  const resumeFull = () => {
    setSegStart(player.current?.positionMs() ?? 0)
    s.play()
    setRecording('on')
  }
  const stopFull = async () => {
    const last = recording === 'on' ? cutSegment() : null
    s.pause()
    setRecording('idle')
    const all = last ? [...pieces, last] : pieces
    if (!all.length) return
    const endMs = Math.max(...all.map((p) => p.startMs + (p.samples.length / p.sampleRate) * 1000))
    const voice = assembleVoice(all, endMs, RATE, 10)
    // Score every phrase it covered, for the take list.
    const scores = phrases
      .map((p) => scoreNotes(notes, p, s.samples.current))
      .filter((x): x is NonNullable<typeof x> => x !== null)
    const mean = scores.length ? scores.reduce((a, b) => a + b.score, 0) / scores.length : 0
    const audio = encodeTake(voice, RATE)
    const take: SessionTake = {
      id: uuid(),
      key: s.source.key,
      phrase: -1,
      createdAt: Date.now(),
      score: scores.length
        ? {
            score: mean,
            notesSung: scores.reduce((a, b) => a + b.notesSung, 0),
            notesTotal: scores.reduce((a, b) => a + b.notes.length, 0),
            meanAbsCents: Math.round(
              scores.reduce((a, b) => a + b.meanAbsCents, 0) / scores.length,
            ),
            biasCents: Math.round(scores.reduce((a, b) => a + b.biasCents, 0) / scores.length),
            lagMs: 0,
            octaveShift: 0,
            noteCents: [],
          }
        : null,
      sungMs: Float32Array.from(s.samples.current.map((x) => x.ms)),
      sungMidi: Float32Array.from(s.samples.current.map((x) => x.midi)),
      audio: audio.blob,
      audioStartMs: 0,
    }
    s.addTake(take)
    await SingService.saveTake(take)
    save({ mode: 'full', fullTakeId: take.id })
    finish(voice, '整首一口气')
  }

  const sendFullTake = async (t: SessionTake) => {
    const buf = await takeBuffer(t)
    if (!buf) return
    const shift = Math.round(
      (((t.audioStartMs ?? 0) + (t.nudgeMs ?? 0) + plan.offsetMs) / 1000) * RATE,
    )
    const src =
      buf.sampleRate === RATE
        ? buf.getChannelData(0)
        : assembleVoice(
            [{ samples: buf.getChannelData(0).slice(), sampleRate: buf.sampleRate, startMs: 0 }],
            buf.duration * 1000,
            RATE,
            0,
          )
    const voice = new Float32Array(Math.max(1, src.length + Math.max(0, shift)))
    voice.set(shift >= 0 ? src : src.subarray(-shift), Math.max(0, shift))
    save({ mode: 'full', fullTakeId: t.id })
    finish(voice, '整首一口气')
  }

  useEffect(() => () => void (recording !== 'idle' && s.pause()), [recording, s])

  const missing = useMemo(
    () => phrases.filter((p) => pickFor(p.index) === null).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phrases, plan, takes],
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="完整版方式">
        {(['comp', 'full'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={plan.mode === m}
            onClick={() => save({ mode: m })}
            className={cn(
              'focus-ring rounded-2xl border px-4 py-3 text-left',
              plan.mode === m
                ? 'border-amber/70 bg-amber-soft/30'
                : 'border-border/80 hover:border-cyan/40',
            )}
          >
            <div className="font-medium">{m === 'comp' ? '拼最好的几句' : '一口气唱完'}</div>
            <div className="text-xs text-muted-foreground">
              {m === 'comp'
                ? '从每句的录音里各挑一次（默认最好的那次），自动拼成整首。'
                : '从头到尾连续唱，可以中途暂停再接着唱。'}
            </div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="flex items-center gap-1 text-muted-foreground">
          整体对齐
          <Button size="sm" variant="ghost" onClick={() => save({ offsetMs: plan.offsetMs - 10 })}>
            −10
          </Button>
          <span className="num">{plan.offsetMs} ms</span>
          <Button size="sm" variant="ghost" onClick={() => save({ offsetMs: plan.offsetMs + 10 })}>
            +10
          </Button>
        </span>
        {plan.mode === 'comp' && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[hsl(var(--amber))]"
              checked={alignToSinger}
              onChange={(e) => setAlignToSinger(e.target.checked)}
            />
            对齐到原唱的节奏（按每句测到的早晚自动挪一下）
          </label>
        )}
      </div>

      {plan.mode === 'comp' ? (
        <section className="space-y-3">
          <ol className="max-h-[30rem] space-y-1.5 overflow-auto rounded-2xl border border-border/80 bg-card p-3">
            {phrases.map((p) => {
              const list = (takes[p.index] ?? []).filter((t) => t.audio)
              const pick = pickFor(p.index)
              const line = lyricForPhrase(meta?.lyrics ?? [], p)
              const scorable = isScorable(notesIn(notes, p))
              return (
                <li
                  key={p.index}
                  className="flex flex-wrap items-center gap-3 rounded-xl px-2 py-1.5 text-sm hover:bg-muted/50"
                >
                  <span className="w-28 shrink-0">
                    第 {p.index + 1} 句{' '}
                    <span className="num text-xs text-muted-foreground">{fmt(p.startMs)}</span>
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {line}
                  </span>
                  <select
                    value={pick ?? ''}
                    onChange={(e) =>
                      save({
                        picks: {
                          ...plan.picks,
                          [p.index]: e.target.value === '' ? null : e.target.value,
                        },
                      })
                    }
                    className="focus-ring h-8 max-w-56 rounded-lg border border-border bg-background px-2 text-xs"
                    aria-label={`第 ${p.index + 1} 句用哪一次`}
                  >
                    <option value="">留空</option>
                    {list.map((t, i) => (
                      <option key={t.id} value={t.id}>
                        {i === 0 ? '最近' : `前 ${i} 次`}
                        {scorable && t.score ? ` · ${Math.round(t.score.score * 100)} 分` : ''}
                        {t.kept ? ' · 保留' : ''}
                      </option>
                    ))}
                    <option value="guide">用原唱补位</option>
                  </select>
                  <span className="flex items-center text-xs text-muted-foreground">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        save({
                          phraseOffsets: {
                            ...plan.phraseOffsets,
                            [p.index]: (plan.phraseOffsets[p.index] ?? 0) - 10,
                          },
                        })
                      }
                      aria-label="这一句提前 10 毫秒"
                    >
                      −
                    </Button>
                    <span className="num w-12 text-center">{plan.phraseOffsets[p.index] ?? 0}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        save({
                          phraseOffsets: {
                            ...plan.phraseOffsets,
                            [p.index]: (plan.phraseOffsets[p.index] ?? 0) + 10,
                          },
                        })
                      }
                      aria-label="这一句推后 10 毫秒"
                    >
                      +
                    </Button>
                  </span>
                </li>
              )
            })}
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void buildComp()} disabled={building}>
              {building ? <Loader2 className="animate-spin" /> : <Wand2 />} 合成人声，送去后期
            </Button>
            {missing > 0 && (
              <span className="text-xs text-muted-foreground">
                有 {missing} 句没有录音，会留空（可以选「用原唱补位」，补位的部分仍是原唱的声音）。
              </span>
            )}
          </div>
        </section>
      ) : (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/80 bg-card p-3">
            {recording === 'idle' ? (
              <Button onClick={startFull} disabled={!s.ready}>
                <Circle className="fill-current text-destructive" /> 从头开始录整首
              </Button>
            ) : (
              <>
                {recording === 'on' ? (
                  <Button variant="outline" onClick={pauseFull}>
                    <Pause /> 暂停
                  </Button>
                ) : (
                  <Button variant="outline" onClick={resumeFull}>
                    <Play /> 接着录
                  </Button>
                )}
                <Button onClick={() => void stopFull()}>
                  <Square /> 录完了
                </Button>
                <span className="text-xs text-destructive">
                  {recording === 'on' ? '● 正在录音' : '已暂停'}
                </span>
              </>
            )}
            <span className="text-xs text-muted-foreground">
              戴上耳机；伴奏和原唱音量用「跟唱」页签里的设置。
            </span>
          </div>
          {fullTakes.length > 0 && (
            <ul className="space-y-1.5">
              {fullTakes.map((t, i) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 px-3 py-2 text-sm"
                >
                  <span>{i === 0 ? '最近一次' : `前 ${i} 次`}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(t.createdAt).toLocaleString()}
                  </span>
                  {t.score && (
                    <span className="num text-xs text-muted-foreground">
                      平均 {Math.round(t.score.score * 100)} 分
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    onClick={() => void sendFullTake(t)}
                  >
                    用这一次，送去后期
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
