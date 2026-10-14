/**
 * 自动后期 (0.26.0): one click works out a whole mix from the voice, the
 * backing and (optionally) the original singer; every setting says why.
 * Apply, compare with the current mix (A/B on an excerpt), undo.
 */
import { useState } from 'react'
import { Loader2, Sparkles, Undo2, Volume2 } from 'lucide-react'
import type { MixSettings } from '@/songs/singTypes'
import { autoMix, autoMixBalance, type AutoDirection, type AutoMixResult } from '@/audio/fx/autoMix'
import { renderMix } from '@/audio/sing/mixChain'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'
import type { MixPlayer, Region } from './mixPlayer'

const RATE = 16000

/** Buffers → one mono 16 kHz signal (summed), through an offline context. */
async function mono16k(buffers: AudioBuffer[]): Promise<Float32Array | null> {
  const len = Math.max(0, ...buffers.map((b) => b.duration))
  if (!buffers.length || len <= 0) return null
  const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil(len * RATE)), RATE)
  for (const b of buffers) {
    const s = ctx.createBufferSource()
    s.buffer = b
    s.connect(ctx.destination)
    s.start()
  }
  return (await ctx.startRendering()).getChannelData(0).slice()
}

const monoOf = (ch: Float32Array[]) => {
  const out = new Float32Array(ch[0]?.length ?? 0)
  for (const c of ch) for (let i = 0; i < out.length; i++) out[i]! += c[i]! / ch.length
  return out
}

export function AutoMixPanel({
  voice,
  backing,
  backingNames,
  bpm,
  lowestMidi,
  mix,
  onApply,
  loadReference,
  player,
  previewRegion,
  modular,
}: {
  voice: AudioBuffer | null
  backing: AudioBuffer[]
  backingNames: string[]
  bpm: number
  lowestMidi?: number
  mix: MixSettings
  onApply: (m: MixSettings) => void
  loadReference?: () => Promise<AudioBuffer | null>
  player: MixPlayer
  previewRegion: () => Region
  modular: boolean
}) {
  const [direction, setDirection] = useState<AutoDirection>(loadReference ? 'reference' : 'clean')
  const [strength, setStrength] = useState(0.7)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AutoMixResult | null>(null)
  const [before, setBefore] = useState<MixSettings | null>(null)
  const [listening, setListening] = useState<string | null>(null)

  const generate = async () => {
    if (!voice) return
    setError(null)
    setResult(null)
    try {
      setBusy('正在分析你的人声和伴奏…')
      const v = await mono16k([voice])
      const b = await mono16k(backing)
      let ref: Float32Array | null = null
      if (direction === 'reference' && loadReference) {
        setBusy('正在分析原唱…')
        const r = await loadReference()
        ref = r ? await mono16k([r]) : null
      }
      if (!v) throw new Error('没有可以分析的人声。')
      setBusy('正在计算设置…')
      await new Promise((r) => setTimeout(r, 0))
      const res = autoMix(
        {
          voice: v,
          backing: b,
          reference: ref,
          sampleRate: RATE,
          bpm,
          ...(lowestMidi !== undefined ? { lowestMidi } : {}),
          direction,
          strength,
        },
        mix,
      )
      if (direction === 'reference' && !ref)
        res.decisions.unshift({
          area: '原唱',
          text: '这首歌没有原唱的人声轨，按「通用干净」计算。',
        })
      // Measure the processed voice and backing on an excerpt, then set the balance exactly.
      if (backing.length) {
        setBusy('正在试混并校准音量…')
        const total = Math.max(voice.duration, ...backing.map((x) => x.duration))
        const mid = total / 2
        const region = { start: Math.max(0, mid - 30), end: Math.min(total, mid + 30) }
        const [pv, pb] = await Promise.all([
          renderMix({
            voice,
            backing,
            backingNames,
            mix: res.mix,
            bpm,
            part: 'voice',
            sampleRate: RATE,
            region,
          }),
          renderMix({
            voice,
            backing,
            backingNames,
            mix: res.mix,
            bpm,
            part: 'backing',
            sampleRate: RATE,
            region,
          }),
        ])
        res.mix = autoMixBalance(res.mix, monoOf(pv), monoOf(pb), RATE, res.targetBalanceDb)
      }
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const compare = async () => {
    if (!result) return
    try {
      const region = previewRegion()
      const current = before ?? mix
      await player.playPasses(
        region,
        [
          { mix: current, label: '原来的设置', graph: null },
          { mix: result.mix, label: '自动后期', graph: null },
        ],
        (i) => setListening(i === 0 ? '原来的设置' : '自动后期'),
      )
    } finally {
      setListening(null)
    }
  }

  return (
    <section
      className="space-y-3 rounded-3xl border border-border/80 bg-card p-5"
      aria-label="自动后期"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-amber" aria-hidden /> 自动后期
        </h3>
        <div
          className="flex rounded-xl border border-border/80 p-0.5 text-xs"
          role="radiogroup"
          aria-label="自动后期方向"
        >
          {(
            [
              ['reference', '参考原唱'],
              ['clean', '通用干净'],
            ] as const
          ).map(([d, label]) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={direction === d}
              disabled={busy !== null || (d === 'reference' && !loadReference)}
              onClick={() => setDirection(d)}
              className={cn(
                'focus-ring rounded-lg px-3 py-1 disabled:opacity-40',
                direction === d ? 'bg-amber-soft/50 text-foreground' : 'text-muted-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {direction === 'reference' && (
          <label className="flex items-center gap-2 text-xs">
            向原唱靠拢
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={strength}
              onChange={(e) => setStrength(Number(e.target.value))}
              className="w-28 accent-[hsl(var(--amber))]"
              aria-label="向原唱靠拢的程度"
            />
            <span className="num w-9">{Math.round(strength * 100)}%</span>
          </label>
        )}
        <Button
          size="sm"
          onClick={() => void generate()}
          disabled={!voice || busy !== null}
          className="ml-auto"
        >
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} 生成
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {direction === 'reference'
          ? '按原唱的人声 / 伴奏音量比、音色和空间感来设，同时修好你录音里的问题（底噪、喷麦、忽大忽小、齿音、被伴奏盖住）。靠拢程度越高越像原唱的混法；音色最多改 ±6 dB，不会把你调成别人的声音。'
          : '不参考原唱，只按你的声音和伴奏把问题修好，再配一个合适的风格。'}
      </p>
      {!voice && (
        <p className="text-xs text-muted-foreground">
          先在「完整版」里合成你的人声，才能自动后期。
        </p>
      )}
      {busy && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {busy}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result && (
        <div className="space-y-3 rounded-2xl border border-border/80 bg-background/40 p-3">
          <ul className="space-y-1.5 text-sm">
            {result.decisions.map((d, i) => (
              <li key={i} className="flex gap-2">
                <span className="w-16 shrink-0 text-xs font-medium text-amber">{d.area}</span>
                <span className="text-muted-foreground">{d.text}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                if (
                  modular &&
                  !window.confirm(
                    '应用自动后期会按新的设置重新铺一遍模块工作区（现在的连线会被替换）。继续吗？',
                  )
                )
                  return
                setBefore(mix)
                onApply(result.mix)
              }}
            >
              应用
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void compare()}
              disabled={listening !== null}
            >
              <Volume2 /> {listening ? `正在播放：${listening}` : '对比原来 / 自动'}
            </Button>
            {before && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onApply(before)
                  setBefore(null)
                }}
              >
                <Undo2 /> 撤销，回到原来的设置
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
