import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Cable, Check, Mic, RefreshCw, ShieldCheck } from 'lucide-react'
import { usePitchDetector } from '@/features/audio/usePitchDetector'
import { useGuitarAudio } from '@/features/guitar/guitarAudioStore'
import { useGuitarSetup } from '@/features/instrument/useGuitarSetup'
import { deviceDisplayName } from '@/audio/input/devices'
import { inputManager } from '@/audio/input/inputManager'
import { MONITOR_WARN_MS } from '@/audio/latency'
import { frequencyToMidi, midiToName } from '@/music/pitch'
import { MonitorToggle } from '@/widgets/guitar/MonitorToggle'
import { GuitarCalibration } from '@/widgets/guitar/GuitarCalibration'
import { Button } from '@/shared/ui/Button'
import { useProfileStore } from '@/features/profile/profileStore'
import { cn } from '@/shared/lib/utils'
import { useTimbreOverride } from '@/features/audio/useTimbreOverride'

const toDb = (x: number) => (x > 1e-6 ? 20 * Math.log10(x) : -120)

/** Device check: choose input / output, see the signal, test the low string, monitor and calibrate. */
export function GuitarSetupPage() {
  useTimbreOverride('guitar')
  const store = useGuitarAudio()
  const { refreshDevices, inputs, outputs, labelled, current, outputLabel, estimateMs } = store
  const mic = usePitchDetector('guitar', true)
  const guitar = useGuitarSetup()
  const [eTest, setETest] = useState<'waiting' | 'ok'>('waiting')
  const held = useRef(0)
  const [clipAt, setClipAt] = useState(0)
  const hintStats = useProfileStore((s) => s.profile?.chordHintStats)

  useEffect(() => {
    void refreshDevices()
    const onDevice = () => void refreshDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', onDevice)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onDevice)
  }, [refreshDevices])

  // Labels appear once permission was granted (the detector asks for it).
  useEffect(() => {
    if (mic.state === 'live') void refreshDevices()
  }, [mic.state, refreshDevices])

  const frame = mic.frame
  const lowString = guitar.open.strings[0]!
  const midi = frame?.hz ? frequencyToMidi(frame.hz) : null
  useEffect(() => {
    if (!frame) return
    if ((frame.peak ?? 0) >= 0.98) setClipAt(Date.now())
    if (eTest === 'ok') return
    if (midi !== null && Math.abs(midi - lowString) < 0.5) {
      held.current += 1
      if (held.current >= 8) setETest('ok')
    } else held.current = 0
  }, [frame, midi, lowString, eTest])

  const levelDb = frame ? toDb(frame.rms) : -120
  const levelPct = Math.max(0, Math.min(100, ((levelDb + 70) / 70) * 100))
  const clipping = Date.now() - clipAt < 1500
  const selectedInput = useMemo(() => inputs.find((d) => d.id === current?.deviceId)?.id ?? current?.deviceId ?? '', [inputs, current])

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <Link to="/guitar" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> 吉他工坊
      </Link>
      <header>
        <div className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">Device check</div>
        <h1 className="mt-2 text-4xl font-semibold">设备检查</h1>
        <p className="mt-2 text-muted-foreground">选择输入和输出设备，确认信号正常，再打开监听、做一次时间校准。用吉他线（例如摇滚史密斯的线）时，请先关掉摇滚史密斯，它可能独占这根线。</p>
      </header>

      <section className="rounded-3xl border border-border/80 bg-card p-6 surface-gradient">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">1 · 输入与输出</h2>
          <Button variant="ghost" size="sm" onClick={() => void refreshDevices()}>
            <RefreshCw /> 刷新设备
          </Button>
        </div>
        {!labelled && <p className="mt-3 text-sm text-muted-foreground">还没有读到设备名称。允许使用麦克风后会显示所有输入设备。</p>}
        {mic.error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {mic.error}
          </p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <label htmlFor="input-device" className="text-sm font-medium">
              输入设备
            </label>
            <select
              id="input-device"
              value={selectedInput}
              onChange={(e) => void store.selectInput(e.target.value)}
              className="focus-ring h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
            >
              {!selectedInput && <option value="">系统默认</option>}
              {inputs.map((d) => (
                <option key={d.id} value={d.id}>
                  {deviceDisplayName(d.label, '未命名设备')}
                  {d.kind === 'cable' ? '（吉他线）' : ''}
                </option>
              ))}
            </select>
            {current && (
              <div className="flex items-center gap-2 text-sm">
                {current.kind === 'cable' ? <Cable className="h-4 w-4 text-amber" aria-hidden /> : <Mic className="h-4 w-4 text-cyan" aria-hidden />}
                <span>
                  正在使用：{deviceDisplayName(current.label)} · {current.kind === 'cable' ? '吉他线模式' : '麦克风模式'}
                  {current.sampleRate ? ` · ${current.sampleRate} Hz` : ''}
                </span>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <label htmlFor="output-device" className="text-sm font-medium">
              输出设备
            </label>
            {inputManager.canChooseOutput ? (
              <select
                id="output-device"
                value={outputs.find((o) => o.label === outputLabel)?.id ?? 'default'}
                onChange={(e) => void store.selectOutput(e.target.value)}
                className="focus-ring h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
              >
                {outputs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {deviceDisplayName(o.label, '系统默认输出')}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-muted-foreground">这个浏览器不能在网页里切换输出，会使用系统默认输出。</p>
            )}
            <p className="text-xs text-muted-foreground">建议用有线耳机。蓝牙耳机会多出 150 毫秒以上的延迟。</p>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-border/80 bg-card p-6 surface-gradient">
        <h2 className="text-lg font-semibold">2 · 信号检查</h2>
        <div className="mt-4 grid grid-cols-3 gap-6">
          <div className="col-span-2 space-y-3">
            <div className="text-sm text-muted-foreground">输入电平</div>
            <div className="h-4 overflow-hidden rounded-full bg-muted" role="meter" aria-label="输入电平" aria-valuemin={-70} aria-valuemax={0} aria-valuenow={Math.round(levelDb)}>
              <div className={cn('h-full rounded-full transition-[width] duration-75', clipping ? 'bg-destructive' : levelPct > 85 ? 'bg-amber' : 'bg-cyan')} style={{ width: `${levelPct}%` }} />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="num">{levelDb > -119 ? `${Math.round(levelDb)} dB` : '没有信号'}</span>
              {clipping ? <span className="text-destructive">信号过载：调低吉他音量旋钮或系统输入音量</span> : <span>弹最重的扫弦时，电平条不要变红</span>}
            </div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-background/40 p-4 text-center">
            <div className="text-xs text-muted-foreground">检测到的音</div>
            <div className="num mt-1 text-3xl font-semibold">{midi !== null ? midiToName(Math.round(midi), { octave: true }) : '—'}</div>
            <div className="num text-xs text-muted-foreground">{midi !== null ? `${Math.round((midi - Math.round(midi)) * 100)} 音分` : ' '}</div>
          </div>
        </div>
        <div className={cn('mt-5 flex items-center gap-3 rounded-2xl border p-4', eTest === 'ok' ? 'border-success/40 bg-success/10' : 'border-border/70')} role="status">
          {eTest === 'ok' ? <Check className="h-5 w-5 text-success" aria-hidden /> : <ShieldCheck className="h-5 w-5 text-muted-foreground" aria-hidden />}
          <span className="text-sm">
            {eTest === 'ok'
              ? `连通测试通过：清楚地收到了空弦 ${midiToName(lowString, { octave: true })}。`
              : `连通测试：拨一下最粗的空弦（${midiToName(lowString, { octave: true })}），让它响一秒钟。没反应就检查线是否插好、调弦是否正确。`}
          </span>
        </div>
      </section>

      <section className="rounded-3xl border border-border/80 bg-card p-6 surface-gradient">
        <h2 className="text-lg font-semibold">3 · 监听</h2>
        <p className="mt-2 text-sm text-muted-foreground">电吉他插线后没有接音箱，几乎听不到声音。打开监听后，吉他声会经过音箱模拟从耳机里放出来。监听只影响你听到的声音，不影响判定。</p>
        <MonitorToggle className="mt-4" />
        <div className="mt-3 text-sm">
          估计延迟 <b className="num">{estimateMs} ms</b>
          {estimateMs > MONITOR_WARN_MS ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>换成有线耳机，不要用蓝牙。</li>
              <li>Windows“声音设置 → 更多声音设置”里，在吉他线和耳机的属性中关闭“音频增强”，格式设为 48000 Hz。</li>
              <li>关闭摇滚史密斯、会议软件等占用音频的程序。</li>
              <li>还是太慢的话，可以关掉监听，直接听琴弦本身的声音，判定照常进行。</li>
            </ul>
          ) : (
            <span className="text-muted-foreground">，练习够用。</span>
          )}
        </div>
        <Link to="/guitar/tone" className="mt-3 inline-block text-sm text-cyan hover:underline">
          调整音色和效果 →
        </Link>
      </section>

      <section className="rounded-3xl border border-border/80 bg-card p-6 surface-gradient">
        <h2 className="text-lg font-semibold">4 · 时间校准</h2>
        <div className="mt-3">
          <GuitarCalibration />
        </div>
      </section>

      <section className="rounded-3xl border border-border/80 bg-card p-6 surface-gradient">
        <h2 className="text-lg font-semibold">和弦识别提示的准确率</h2>
        <p className="mt-2 text-sm text-muted-foreground">扫弦练习里的“听起来像”只是提示，不计分。这里统计它和谱面一致的比例，用来判断以后能不能把它用于评分。</p>
        <dl className="mt-3 grid grid-cols-2 gap-4 text-sm">
          {(['cable', 'mic'] as const).map((k) => {
            const st = hintStats?.[k]
            return (
              <div key={k} className="rounded-2xl border border-border/70 p-4">
                <dt className="text-muted-foreground">{k === 'cable' ? '吉他线' : '麦克风'}</dt>
                <dd className="num mt-1 text-2xl font-semibold">{st && st.total ? `${Math.round((st.agree / st.total) * 100)}%` : '—'}</dd>
                <dd className="text-xs text-muted-foreground">{st && st.total ? `${st.agree}/${st.total} 小节` : '还没有数据：在扫弦练习里打开“和弦识别提示”'}</dd>
              </div>
            )
          })}
        </dl>
      </section>
    </div>
  )
}
