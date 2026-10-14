/**
 * 音频设备 (0.26.2): the microphone for singing, the instrument input (guitar
 * cable), the output — with a live level, a short record-and-play-back test
 * and a test tone. Loopback inputs ("Loopback", "立体声混音") are marked: they
 * record what the computer plays, not a microphone.
 */
import { useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import { Mic, Play, RefreshCw, Square, Volume2 } from 'lucide-react'
import { deviceDisplayName, isLoopbackLabel } from '@/audio/input/devices'
import { inputManager } from '@/audio/input/inputManager'
import { VoiceRecorder } from '@/audio/sing/voiceRecorder'
import { usePitchDetector } from '@/features/audio/usePitchDetector'
import { useGuitarAudio } from '@/features/guitar/guitarAudioStore'
import { useProfileStore } from '@/features/profile/profileStore'
import { ProfileService } from '@/services/profileService'
import { Button } from '@/shared/ui/Button'

const selectClass =
  'focus-ring h-10 w-full rounded-xl border border-border bg-background px-3 text-sm'

const tag = (label: string, kind: 'mic' | 'cable') =>
  isLoopbackLabel(label) ? '（内录，不是麦克风）' : kind === 'cable' ? '（吉他线）' : ''

export function AudioDeviceSettings() {
  const store = useGuitarAudio()
  const { inputs, outputs, labelled, refreshDevices, outputLabel } = store
  const profile = useProfileStore((s) => s.profile)
  const setProfile = useProfileStore((s) => s.set)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    void refreshDevices()
    const onDevice = () => void refreshDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', onDevice)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onDevice)
  }, [refreshDevices])

  const setVoice = async (id: string) => {
    const dev = inputs.find((d) => d.id === id)
    setProfile(
      await ProfileService.update({
        audioVoiceInputId: id || undefined,
        audioVoiceInputLabel: dev?.label ?? '',
      }),
    )
    await refreshDevices()
  }

  const voiceId = profile?.audioVoiceInputId ?? ''
  const voiceMissing = !!voiceId && labelled && !inputs.some((d) => d.id === voiceId)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          跟唱、唱歌练习用「唱歌用的麦克风」；吉他工坊和乐器练习用「乐器输入」。录不到声音时，先在这里确认选对了设备、电平条会跳。
        </p>
        <Button variant="ghost" size="sm" onClick={() => void refreshDevices()}>
          <RefreshCw /> 刷新
        </Button>
      </div>
      {!labelled && (
        <p className="rounded-xl border border-amber/40 bg-amber-soft/20 px-3 py-2 text-sm">
          还没有读到设备名称：点下面的「测试麦克风」允许使用麦克风后，就会列出所有设备。
        </p>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="voice-input" className="text-sm font-medium">
            唱歌用的麦克风
          </label>
          <select
            id="voice-input"
            value={voiceMissing ? '' : voiceId}
            onChange={(e) => void setVoice(e.target.value)}
            className={selectClass}
          >
            <option value="">自动（系统默认的麦克风，跳过内录和吉他线）</option>
            {inputs
              .filter((d) => d.id !== 'default' && d.id !== 'communications')
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {deviceDisplayName(d.label, '未命名设备')}
                  {tag(d.label, d.kind)}
                </option>
              ))}
          </select>
          {voiceMissing && (
            <p className="text-xs text-amber">
              之前选的麦克风现在找不到了（拔掉了？），暂时用自动选择。
            </p>
          )}
          {voiceId && isLoopbackLabel(inputs.find((d) => d.id === voiceId)?.label) && (
            <p className="text-xs text-amber">
              这是内录通道，录的是电脑播放的声音，不是你的麦克风。
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="instrument-input" className="text-sm font-medium">
            乐器输入（吉他线等）
          </label>
          <select
            id="instrument-input"
            value={profile?.audioInputId ?? ''}
            onChange={(e) => void store.selectInput(e.target.value)}
            className={selectClass}
          >
            <option value="">系统默认</option>
            {inputs
              .filter((d) => d.id !== 'default' && d.id !== 'communications')
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {deviceDisplayName(d.label, '未命名设备')}
                  {tag(d.label, d.kind)}
                </option>
              ))}
          </select>
        </div>

        <div className="space-y-2">
          <label htmlFor="output-dev" className="text-sm font-medium">
            输出设备（耳机 / 音箱）
          </label>
          {inputManager.canChooseOutput ? (
            <select
              id="output-dev"
              value={outputs.find((o) => o.label === outputLabel)?.id ?? 'default'}
              onChange={(e) => void store.selectOutput(e.target.value)}
              className={selectClass}
            >
              {outputs.map((o) => (
                <option key={o.id} value={o.id}>
                  {deviceDisplayName(o.label, '系统默认输出')}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-muted-foreground">这里不能选输出，用系统默认输出。</p>
          )}
          <Button size="sm" variant="outline" onClick={() => void testTone()}>
            <Volume2 /> 播放测试音
          </Button>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-border/80 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={testing ? 'default' : 'outline'}
            onClick={() => setTesting((t) => !t)}
          >
            {testing ? <Square /> : <Mic />} {testing ? '停止测试' : '测试麦克风'}
          </Button>
          <span className="text-xs text-muted-foreground">
            打开后对着麦克风唱几句，电平条应该随声音跳动。
          </span>
        </div>
        {testing && <MicTest />}
      </div>
    </div>
  )
}

async function testTone(): Promise<void> {
  await Tone.start()
  const ctx = Tone.getContext().rawContext as AudioContext
  const t = ctx.currentTime + 0.05
  for (const [i, f] of [523.25, 659.25, 783.99].entries()) {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.value = f
    g.gain.setValueAtTime(0, t + i * 0.25)
    g.gain.linearRampToValueAtTime(0.25, t + i * 0.25 + 0.01)
    g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.25 + 0.4)
    o.connect(g).connect(ctx.destination)
    o.start(t + i * 0.25)
    o.stop(t + i * 0.25 + 0.45)
  }
}

/** Live level of the singing microphone, the device in use, and a 3-second record / play back. */
function MicTest() {
  const mic = usePitchDetector('voice', true)
  const [current, setCurrent] = useState(inputManager.current)
  const [phase, setPhase] = useState<'idle' | 'recording' | 'playing'>('idle')
  const [result, setResult] = useState<string | null>(null)
  const recorder = useRef<VoiceRecorder | null>(null)
  useEffect(() => inputManager.onChange(setCurrent), [])
  useEffect(() => () => recorder.current?.stop(), [])

  const db = mic.frame && mic.frame.rms > 1e-6 ? 20 * Math.log10(mic.frame.rms) : -120
  const pct = Math.max(0, Math.min(100, ((db + 70) / 70) * 100))

  const recordTest = async () => {
    setResult(null)
    const ctx = Tone.getContext().rawContext as AudioContext
    const rec = new VoiceRecorder(10)
    recorder.current = rec
    if (!(await rec.start())) {
      setResult('录音模块没能加载。')
      return
    }
    setPhase('recording')
    const from = ctx.currentTime + 0.1
    await new Promise((r) => setTimeout(r, 3200))
    const samples = rec.clip(from, from + 3)
    rec.stop()
    let peak = 0
    for (const v of samples) peak = Math.max(peak, Math.abs(v))
    if (peak < 0.003) {
      setResult(
        '这 3 秒几乎没有声音：麦克风可能选错了（例如选到了内录通道），或者系统里把麦克风静音了。',
      )
      setPhase('idle')
      return
    }
    setPhase('playing')
    const buf = ctx.createBuffer(1, samples.length, rec.sampleRate)
    buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.onended = () => setPhase('idle')
    src.start()
    setResult(
      `录到了声音（最大 ${Math.round(20 * Math.log10(peak))} dBFS${peak > 0.98 ? '，有削波：把输入音量调小一点' : peak < 0.05 ? '，偏小：可以把输入音量调大一点' : ''}），正在回放。`,
    )
  }

  return (
    <div className="space-y-2">
      {mic.error && (
        <p role="alert" className="text-sm text-destructive">
          {mic.error}
        </p>
      )}
      <p className="text-sm">
        正在使用：
        <b>
          {current
            ? deviceDisplayName(current.label)
            : mic.state === 'starting'
              ? '正在打开…'
              : '—'}
        </b>
        {current && isLoopbackLabel(current.label) && (
          <span className="ml-2 text-amber">（这是内录通道，不是麦克风）</span>
        )}
      </p>
      <div className="h-3 overflow-hidden rounded-full bg-muted" aria-label="麦克风电平">
        <div
          className="h-full rounded-full bg-success transition-[width] duration-75"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={mic.state !== 'live' || phase !== 'idle'}
          onClick={() => void recordTest()}
        >
          <Play />{' '}
          {phase === 'recording'
            ? '正在录 3 秒…'
            : phase === 'playing'
              ? '正在回放…'
              : '录 3 秒再回放'}
        </Button>
        {result && <span className="text-xs text-muted-foreground">{result}</span>}
      </div>
    </div>
  )
}
