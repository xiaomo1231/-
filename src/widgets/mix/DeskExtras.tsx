/**
 * 跟唱后期 0.21.0: the desk's newer parts — insert order, extra effect
 * panels (gate, dynamic EQ, 2nd compressor, parallel compression, saturation,
 * modulation), voice preparation (level riding, pitch correction), backing
 * ducking / pocket / stem levels, master extras, live spectrum and loudness,
 * suggestions (local rules + optional AI), own presets and snapshots, and
 * links to the 后期课堂 lessons for each panel.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, BookOpen, Check, Loader2, Sparkles, Trash2 } from 'lucide-react'
import type { InsertId, MixSettings } from '@/songs/singTypes'
import type { MixMeters } from '@/audio/sing/mixChain'
import type { UserMixPreset } from '@/entities/types'
import { MIX_LESSONS } from '@/mixing/lessons'
import { MixCourseService } from '@/services/mixCourseService'
import { MixAIService, type MixReview } from '@/services/mixAIService'
import { measureVoice, suggest, type Suggestion, type VoiceMetrics } from '@/audio/fx/mixAdvisor'
import { ControlField } from '@/widgets/mixing/ControlField'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'
import { NumField, OnSwitch } from './controls'

const INSERT_LABEL: Record<InsertId, string> = {
  gate: '噪声门',
  lowCut: '低切',
  eq: '均衡',
  dynEq: '动态 EQ',
  comp: '压缩',
  comp2: '第二级压缩',
  parallel: '并行压缩',
  deEss: '齿音消除',
  saturation: '饱和',
  mod: '调制',
}

function insertOn(m: MixSettings, id: InsertId): boolean {
  const v = m.vocal
  return id === 'lowCut' ? v.lowCut.on : v[id].on
}

/** Order of the voice inserts: move up / down. */
export function OrderEditor({ mix, onMix }: { mix: MixSettings; onMix: (m: MixSettings) => void }) {
  const order = mix.vocal.order
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    onMix({ ...mix, vocal: { ...mix.vocal, order: next } })
  }
  return (
    <div className="space-y-2">
      <ol className="flex flex-wrap items-center gap-1 text-xs">
        {order.map((id, i) => (
          <li key={id} className={cn('flex items-center gap-0.5 rounded-lg border px-1.5 py-1', insertOn(mix, id) ? 'border-cyan/50 bg-cyan-soft/10' : 'border-border/70 text-muted-foreground')}>
            <button type="button" className="focus-ring rounded p-0.5 disabled:opacity-30" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${INSERT_LABEL[id]}前移`}>
              <ArrowUp className="h-3 w-3 -rotate-90" />
            </button>
            {INSERT_LABEL[id]}
            <button type="button" className="focus-ring rounded p-0.5 disabled:opacity-30" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`${INSERT_LABEL[id]}后移`}>
              <ArrowDown className="h-3 w-3 -rotate-90" />
            </button>
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">声音从左到右依次经过这些效果（亮着的是打开的）。常见做法：先清理（门、低切、减法 EQ），再压缩，最后饱和和调制；把压缩放到 EQ 前面，EQ 的提升就不会被压回去。</p>
    </div>
  )
}

let progressCache: Promise<Set<string>> | null = null
function useLearned(): Set<string> {
  const [done, setDone] = useState<Set<string>>(new Set())
  useEffect(() => {
    progressCache ??= MixCourseService.progress().then((rows) => new Set(rows.filter((r) => r.readAt).map((r) => r.lessonId)))
    void progressCache.then(setDone)
  }, [])
  return done
}

/** Links to the 后期课堂 lessons about a desk panel. */
export function LearnLinks({ module }: { module: string }) {
  const learned = useLearned()
  const lessons = useMemo(() => MIX_LESSONS.filter((l) => l.deskModule === module), [module])
  if (!lessons.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <BookOpen className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      <span className="text-muted-foreground">后期课堂：</span>
      {lessons.map((l) => (
        <Link key={l.id} to={`/mixing/${l.id}`} className="inline-flex items-center gap-0.5 rounded-full border border-border/70 px-2 py-0.5 hover:border-cyan/50">
          {learned.has(l.id) && <Check className="h-3 w-3 text-success" aria-label="已学过" />}
          {l.title}
        </Link>
      ))}
    </div>
  )
}

/** A panel body made of registry controls (the panel header lives in MixDesk). */
export function Controls({ paths, mix, onMix, cols = 2 }: { paths: string[]; mix: MixSettings; onMix: (m: MixSettings) => void; cols?: 2 | 3 }) {
  return (
    <div className={cn('grid gap-4', cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
      {paths.map((p) => (
        <ControlField key={p} path={p} mix={mix} onChange={onMix} />
      ))}
    </div>
  )
}

/** Per-phrase extra level for the level riding, with the phrase's lyric. */
export function PhraseOffsets({ mix, onMix, phrases }: { mix: MixSettings; onMix: (m: MixSettings) => void; phrases: Array<{ startMs: number; endMs: number; lyric?: string }> }) {
  const al = mix.vocal.autoLevel
  const set = (i: number, db: number) => onMix({ ...mix, vocal: { ...mix.vocal, autoLevel: { ...al, phraseDb: { ...al.phraseDb, [i]: Math.round(db * 2) / 2 } } } })
  if (!phrases.length) return <p className="text-xs text-muted-foreground">还没有分句（跟唱页分析完原唱后才有）。</p>
  const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms / 1000) % 60)).padStart(2, '0')}`
  return (
    <details className="rounded-xl bg-muted/30 p-3 text-sm">
      <summary className="cursor-pointer text-xs text-muted-foreground">逐句微调（在自动平衡之外，每句再加减几分贝）</summary>
      <ol className="mt-2 max-h-64 space-y-1 overflow-auto">
        {phrases.map((p, i) => {
          const db = al.phraseDb[i] ?? 0
          return (
            <li key={i} className="flex items-center gap-2">
              <span className="num w-10 text-xs text-muted-foreground">{fmt(p.startMs)}</span>
              <span className="min-w-0 flex-1 truncate text-xs">{p.lyric ?? `第 ${i + 1} 句`}</span>
              <button type="button" className="focus-ring rounded border border-border px-1.5 text-xs" onClick={() => set(i, db - 1)} aria-label="减 1 dB">
                −
              </button>
              <span className={cn('num w-12 text-center text-xs', db !== 0 && 'text-amber')}>{db > 0 ? `+${db}` : db} dB</span>
              <button type="button" className="focus-ring rounded border border-border px-1.5 text-xs" onClick={() => set(i, db + 1)} aria-label="加 1 dB">
                +
              </button>
            </li>
          )
        })}
      </ol>
    </details>
  )
}

const KEYS = ['C', 'C♯/D♭', 'D', 'E♭', 'E', 'F', 'F♯/G♭', 'G', 'A♭', 'A', 'B♭', 'B']

/** Pitch correction settings, with the key choice. */
export function TuneControls({ mix, onMix, hasReference = false, stats }: { mix: MixSettings; onMix: (m: MixSettings) => void; hasReference?: boolean; stats?: { frames: number; corrected: number; skipped: number; centsBefore: number; centsAfter: number } | null }) {
  const t = mix.vocal.tune
  const patch = (p: Partial<typeof t>) => onMix({ ...mix, vocal: { ...mix.vocal, tune: { ...t, ...p } } })
  return (
    <div className="space-y-3">
      <Controls paths={['vocal.tune.amount', 'vocal.tune.speedMs']} mix={mix} onMix={onMix} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs text-muted-foreground">往哪些音上拉：</span>
        <select value={t.scale} onChange={(e) => patch({ scale: e.target.value as typeof t.scale })} className="focus-ring h-8 rounded-lg border border-border bg-background px-2 text-xs">
          <option value="chromatic">最近的半音（不限调）</option>
          <option value="key">只用这首歌的调内音</option>
          {hasReference && <option value="reference">原唱的音（整首对齐）</option>}
        </select>
        {t.scale === 'reference' && (
          <select value={t.gaps} onChange={(e) => patch({ gaps: e.target.value as typeof t.gaps })} className="focus-ring h-8 rounded-lg border border-border bg-background px-2 text-xs" aria-label="原唱没有音的地方">
            <option value="keep">原唱没有音的地方：不修正</option>
            <option value="nearest">原唱没有音的地方：拉到最近的半音</option>
          </select>
        )}
        {t.scale === 'key' && (
          <>
            <select value={t.keyTonic} onChange={(e) => patch({ keyTonic: Number(e.target.value) })} className="focus-ring h-8 rounded-lg border border-border bg-background px-2 text-xs" aria-label="调">
              {KEYS.map((k, i) => (
                <option key={k} value={i}>
                  {k}
                </option>
              ))}
            </select>
            <select value={t.mode} onChange={(e) => patch({ mode: e.target.value as typeof t.mode })} className="focus-ring h-8 rounded-lg border border-border bg-background px-2 text-xs" aria-label="大调或小调">
              <option value="major">大调</option>
              <option value="minor">小调</option>
            </select>
          </>
        )}
      </div>
      {t.scale === 'reference' && <Controls paths={['vocal.tune.range']} mix={mix} onMix={onMix} />}
      {t.scale === 'reference' && (
        <p className="text-xs text-muted-foreground">按原唱这首歌的音高线（颤音、滑音已去掉）对齐：你唱得早一点或晚一点（±150 毫秒内）也能找到对应的音；你用别的八度唱，就对齐到你那个八度；离原唱太远的音当成故意唱的（和声、改编），不拉。</p>
      )}
      {t.on && stats && stats.frames > 0 && (
        <p className="num rounded-lg bg-muted/40 px-2 py-1.5 text-xs">
          修正了 {Math.round((stats.corrected / stats.frames) * 100)}% 的唱段
          {stats.corrected > 0 ? `，平均偏差 ${Math.round(stats.centsBefore / stats.corrected)} → ${Math.round(stats.centsAfter / stats.corrected)} 音分` : ''}
          {stats.skipped > 0 ? `；${Math.round((stats.skipped / stats.frames) * 100)}% 没动（${t.scale === 'reference' ? '原唱没有音或离得太远' : '离目标太远'}）` : ''}
        </p>
      )}
      <p className="text-xs text-muted-foreground">实验功能：在这台电脑上离线处理，长歌需要几秒。力度别太大、速度别太快，否则会有明显的"电音"感；它只能把音拉近，不能代替把歌唱准。</p>
    </div>
  )
}

/** Per-stem level and mute (separated backing). */
export function StemLevels({ names, mix, onMix }: { names: string[]; mix: MixSettings; onMix: (m: MixSettings) => void }) {
  const LABEL: Record<string, string> = { drums: '鼓', bass: '贝斯', guitar: '吉他', piano: '钢琴', other: '其它', instrumental: '伴奏', mix: '原曲' }
  if (names.length < 2) return null
  const set = (name: string, p: Partial<{ gainDb: number; mute: boolean }>) => {
    const cur = mix.backing.stems[name] ?? { gainDb: 0, mute: false }
    onMix({ ...mix, backing: { ...mix.backing, stems: { ...mix.backing.stems, [name]: { ...cur, ...p } } } })
  }
  return (
    <div className="space-y-2 rounded-xl bg-muted/30 p-3">
      <p className="text-sm font-medium">分轨音量</p>
      {names.map((n) => {
        const s = mix.backing.stems[n] ?? { gainDb: 0, mute: false }
        return (
          <div key={n} className="flex items-center gap-3">
            <span className="w-12 text-sm">{LABEL[n] ?? n}</span>
            <div className="flex-1">
              <NumField label="" value={s.gainDb} min={-24} max={12} step={0.5} unit="dB" disabled={s.mute} onChange={(gainDb) => set(n, { gainDb })} />
            </div>
            <OnSwitch checked={!s.mute} onChange={(on) => set(n, { mute: !on })} label={`${LABEL[n] ?? n}开关`} />
          </div>
        )
      })}
    </div>
  )
}

const TARGETS: Array<[string, number | null]> = [
  ['不调整', null],
  ['−16 LUFS（偏安静、动态大）', -16],
  ['−14 LUFS（流媒体常见）', -14],
  ['−11 LUFS（较响）', -11],
  ['−9 LUFS（很响，动态小）', -9],
]

/** Export loudness target. */
export function LoudnessTarget({ mix, onMix }: { mix: MixSettings; onMix: (m: MixSettings) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-muted-foreground">导出时一键到目标响度（会自动用限幅器保护峰值）</span>
      <select value={String(mix.master.targetLufs)} onChange={(e) => onMix({ ...mix, master: { ...mix.master, targetLufs: e.target.value === 'null' ? null : Number(e.target.value), limiter: e.target.value === 'null' ? mix.master.limiter : true } })} className="focus-ring h-9 rounded-lg border border-border bg-background px-2">
        {TARGETS.map(([label, v]) => (
          <option key={label} value={String(v)}>
            {label}
          </option>
        ))}
      </select>
    </label>
  )
}

// ---------------------------------------------------------------------------
// live analysis: spectrum (voice vs backing, masking marked), loudness, correlation
// ---------------------------------------------------------------------------

function resolve(v: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(v).trim()
}

export function SpectrumView({ getMeters, live }: { getMeters: () => MixMeters | null; live: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!live) return
    let raf = 0
    const vBuf = new Float32Array(1024)
    const bBuf = new Float32Array(1024)
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const m = getMeters()
      const c = canvas.current
      if (!m || !c) return
      const ctx = c.getContext('2d')
      if (!ctx) return
      const W = (c.width = c.clientWidth * devicePixelRatio)
      const H = (c.height = c.clientHeight * devicePixelRatio)
      m.voice.getFloatFrequencyData(vBuf)
      m.backing.getFloatFrequencyData(bBuf)
      const rate = m.voice.context.sampleRate
      const bins = vBuf.length
      const x = (f: number) => (Math.log10(f / 30) / Math.log10(18000 / 30)) * W
      const y = (db: number) => H - ((Math.max(-100, Math.min(-20, db)) + 100) / 80) * H
      ctx.clearRect(0, 0, W, H)
      // masking: backing louder than the voice in 1–5 kHz
      ctx.fillStyle = `hsl(${resolve('--destructive')} / 0.18)`
      for (let i = 1; i < bins; i++) {
        const f = (i * rate) / 2 / bins
        if (f < 1000 || f > 5000) continue
        if (bBuf[i]! > vBuf[i]! + 3 && vBuf[i]! > -85) ctx.fillRect(x(f), 0, Math.max(1, x((f * (i + 1)) / i) - x(f)), H)
      }
      const line = (buf: Float32Array, color: string) => {
        ctx.beginPath()
        let first = true
        for (let i = 1; i < bins; i++) {
          const f = (i * rate) / 2 / bins
          if (f < 30 || f > 18000) continue
          if (first) ctx.moveTo(x(f), y(buf[i]!))
          else ctx.lineTo(x(f), y(buf[i]!))
          first = false
        }
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5 * devicePixelRatio
        ctx.stroke()
      }
      line(bBuf, `hsl(${resolve('--muted-foreground')})`)
      line(vBuf, `hsl(${resolve('--amber')})`)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [getMeters, live])
  return (
    <div className="space-y-1">
      <canvas ref={canvas} className="h-28 w-full rounded-xl bg-muted/30" aria-label="实时频谱：人声与伴奏" />
      <p className="text-xs text-muted-foreground">
        <span className="text-amber">橙色</span>是处理后的人声，<span>灰色</span>是伴奏；红色区域是伴奏在 1–5 kHz 盖过人声的地方（人声可能不够清楚）。{live ? '' : '播放时显示。'}
      </p>
    </div>
  )
}

/** Live loudness (approximate momentary LUFS) and stereo correlation. */
export function LoudnessReadout({ getMeters, live }: { getMeters: () => MixMeters | null; live: boolean }) {
  const [vals, setVals] = useState<{ lufs: number; corr: number } | null>(null)
  useEffect(() => {
    if (!live) return
    const k = new Float32Array(16384)
    const l = new Float32Array(2048)
    const r = new Float32Array(2048)
    const t = setInterval(() => {
      const m = getMeters()
      if (!m) return
      m.loudness.getFloatTimeDomainData(k)
      let s = 0
      for (const v of k) s += v * v
      // stereo sum of two equal channels: +3 dB over the mono mean square
      const lufs = -0.691 + 10 * Math.log10((2 * s) / k.length + 1e-12)
      m.masterL.getFloatTimeDomainData(l)
      m.masterR.getFloatTimeDomainData(r)
      let lr = 0
      let ll = 0
      let rr = 0
      for (let i = 0; i < l.length; i++) {
        lr += l[i]! * r[i]!
        ll += l[i]! * l[i]!
        rr += r[i]! * r[i]!
      }
      setVals({ lufs, corr: ll > 1e-9 && rr > 1e-9 ? lr / Math.sqrt(ll * rr) : 1 })
    }, 250)
    return () => clearInterval(t)
  }, [getMeters, live])
  return (
    <div className="flex flex-wrap gap-4 text-xs">
      <div>
        <div className="text-muted-foreground">瞬时响度（约）</div>
        <div className="num text-lg">{vals && Number.isFinite(vals.lufs) && vals.lufs > -70 ? `${vals.lufs.toFixed(1)} LUFS` : '—'}</div>
      </div>
      <div>
        <div className="text-muted-foreground">左右相关性</div>
        <div className={cn('num text-lg', vals && vals.corr < 0 && 'text-destructive')}>{vals ? vals.corr.toFixed(2) : '—'}</div>
      </div>
      <p className="max-w-xs self-end text-muted-foreground">相关性接近 1 = 接近单声道；0 左右 = 很宽；小于 0 说明左右相位相反，手机外放时会变弱。</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// suggestions
// ---------------------------------------------------------------------------

function mono(b: AudioBuffer | null): Float32Array | null {
  if (!b) return null
  const out = new Float32Array(b.length)
  for (let c = 0; c < b.numberOfChannels; c++) {
    const x = b.getChannelData(c)
    for (let i = 0; i < out.length; i++) out[i]! += x[i]! / b.numberOfChannels
  }
  return out
}

export function SuggestionsPanel({ voice, backing, mix, onMix }: { voice: AudioBuffer | null; backing: AudioBuffer[]; mix: MixSettings; onMix: (m: MixSettings) => void }) {
  const [metrics, setMetrics] = useState<VoiceMetrics | null>(null)
  const [busy, setBusy] = useState(false)
  const [ai, setAi] = useState<{ state: 'idle' | 'busy' | 'done' | 'error'; review?: MixReview; error?: string }>({ state: 'idle' })
  const list: Suggestion[] = useMemo(() => (metrics ? suggest(metrics, mix) : []), [metrics, mix])

  const analyse = async () => {
    if (!voice) return
    setBusy(true)
    await new Promise((r) => setTimeout(r, 0))
    try {
      // the backing as heard: sum of the stems (rate of the first)
      let b: Float32Array | null = null
      if (backing.length) {
        b = new Float32Array(backing[0]!.length)
        for (const x of backing) {
          const m = mono(x)!
          for (let i = 0; i < Math.min(b.length, m.length); i++) b[i]! += m[i]!
        }
      }
      setMetrics(measureVoice(mono(voice)!, b, voice.sampleRate))
    } finally {
      setBusy(false)
    }
  }

  const askAI = async () => {
    if (!metrics) return
    setAi({ state: 'busy' })
    try {
      const { review } = await MixAIService.review(metrics, mix, list.map((s) => s.title))
      setAi({ state: 'done', review })
    } catch (e) {
      setAi({ state: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <section className="space-y-3 rounded-3xl border border-border/80 bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">智能建议</h3>
          <p className="text-xs text-muted-foreground">分析你的人声和伴奏（在本机完成），告诉你下一步最值得调什么，可以一键应用。</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void analyse()} disabled={!voice || busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {metrics ? '重新分析' : '分析我的人声'}
        </Button>
      </div>
      {!voice && <p className="text-sm text-muted-foreground">先在「完整版」里合成人声。</p>}
      {metrics && list.length === 0 && <p className="text-sm text-success">没有发现明显的问题，接下来可以凭耳朵微调。</p>}
      <ul className="space-y-2">
        {list.map((s) => (
          <li key={s.id} className="flex flex-wrap items-start gap-3 rounded-xl border border-border/70 p-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{s.title}</div>
              <p className="text-xs text-muted-foreground">{s.detail}</p>
            </div>
            {s.id !== 'clipping' && (
              <Button size="sm" variant="secondary" onClick={() => onMix(s.apply(mix))}>
                应用
              </Button>
            )}
          </li>
        ))}
      </ul>
      {metrics && (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <Button size="sm" variant="ghost" onClick={() => void askAI()} disabled={ai.state === 'busy'}>
            {ai.state === 'busy' ? <Loader2 className="animate-spin" /> : <Sparkles />} 请 AI 老师点评这个混音（可选，需要在设置里配置 AI）
          </Button>
          {ai.state === 'error' && <p className="text-sm text-destructive">{ai.error}</p>}
          {ai.review && (
            <div className="space-y-2 rounded-xl bg-muted/30 p-3 text-sm">
              <p>{ai.review.summary}</p>
              {ai.review.strengths.length > 0 && (
                <ul className="list-disc pl-5 text-xs text-success">
                  {ai.review.strengths.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              )}
              <ul className="list-disc space-y-1 pl-5 text-xs">
                {ai.review.suggestions.map((x) => (
                  <li key={x.text}>{x.text}</li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">下一步：{ai.review.nextStep}</p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// own presets and snapshots
// ---------------------------------------------------------------------------

export function UserPresets({ mix, onMix }: { mix: MixSettings; onMix: (m: MixSettings) => void }) {
  const [rows, setRows] = useState<UserMixPreset[]>([])
  const [name, setName] = useState('')
  useEffect(() => {
    void MixCourseService.presets().then(setRows)
  }, [])
  const save = async () => {
    const row = await MixCourseService.savePreset(name || `我的预设 ${rows.length + 1}`, mix)
    setRows((r) => [...r, row])
    setName('')
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {rows.map((r) => (
          <span key={r.id} className="inline-flex items-center gap-1 rounded-full border border-border/80 pl-3 text-sm">
            <button type="button" className="focus-ring" onClick={() => onMix(JSON.parse(JSON.stringify(r.mix)) as MixSettings)}>
              {r.name}
            </button>
            <button type="button" className="focus-ring rounded-full p-1.5 text-muted-foreground hover:text-destructive" onClick={() => void MixCourseService.removePreset(r.id).then(() => setRows((x) => x.filter((y) => y.id !== r.id)))} aria-label={`删除预设 ${r.name}`}>
              <Trash2 className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="给当前设置起个名字" className="focus-ring h-8 rounded-lg border border-border bg-background px-2 text-sm" aria-label="预设名称" />
        <Button size="sm" variant="outline" onClick={() => void save()}>
          存为我的预设
        </Button>
        <span className="text-xs text-muted-foreground">我的预设在所有歌里都能用。</span>
      </div>
    </div>
  )
}

export interface Snapshot {
  name: string
  mix: MixSettings
}

/** Snapshots of this song's mix for A/B comparison. */
export function Snapshots({ snapshots, mix, onMix, onChange }: { snapshots: Snapshot[]; mix: MixSettings; onMix: (m: MixSettings) => void; onChange: (s: Snapshot[]) => void }) {
  const same = (a: MixSettings) => JSON.stringify(a) === JSON.stringify(mix)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {snapshots.map((s, i) => (
          <span key={i} className={cn('inline-flex items-center gap-1 rounded-full border pl-3 text-sm', same(s.mix) ? 'border-amber/70 bg-amber-soft/40' : 'border-border/80')}>
            <button type="button" className="focus-ring" onClick={() => onMix(JSON.parse(JSON.stringify(s.mix)) as MixSettings)}>
              {s.name}
            </button>
            <button type="button" className="focus-ring rounded-full p-1.5 text-muted-foreground hover:text-destructive" onClick={() => onChange(snapshots.filter((_, j) => j !== i))} aria-label={`删除快照 ${s.name}`}>
              <Trash2 className="h-3 w-3" />
            </button>
          </span>
        ))}
        <Button size="sm" variant="outline" onClick={() => onChange([...snapshots, { name: `版本 ${String.fromCharCode(65 + (snapshots.length % 26))}`, mix: JSON.parse(JSON.stringify(mix)) as MixSettings }].slice(-8))}>
          保存当前为快照
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">在快照之间来回切换，听哪个版本更好（只保存在这首歌里）。</p>
    </div>
  )
}
