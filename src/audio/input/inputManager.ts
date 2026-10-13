import * as Tone from 'tone'
import { AppError } from '@/infrastructure/errors/AppError'
import { inputKindOf, pickInputFor, type DeviceInfo, type InputKind } from './devices'

/**
 * One shared audio input for the whole site. Consumers (pitch detector,
 * onset detector, guitar monitor) connect to a stable `bus` node; when the
 * device changes the stream is swapped underneath and nobody has to
 * reconnect. Call-oriented processing (echo cancellation, noise
 * suppression, auto gain) is always off: it bends pitch and level.
 *
 * The signal never leaves the browser and is never recorded.
 */

export type InputPurpose = 'voice' | 'instrument'

export class MicError extends AppError {}

export interface InputInfo {
  deviceId: string | undefined
  label: string
  kind: InputKind
  /** Reported by Chrome for the capture track, in seconds (0 when unknown). */
  trackLatency: number
  sampleRate: number | undefined
}

export interface OutputInfo {
  id: string
  label: string
}

type Listener = (info: InputInfo | null) => void

function rawContext(): AudioContext {
  return Tone.getContext().rawContext as AudioContext
}

class InputManager {
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private busNode: GainNode | null = null
  private holders = new Map<symbol, InputPurpose>()
  private info: InputInfo | null = null
  private listeners = new Set<Listener>()
  private preferredInput: string | undefined
  private preferredOutput: string | undefined
  private opening: Promise<void> | null = null

  /** Stable node to connect consumers to. */
  get bus(): GainNode {
    if (!this.busNode) this.busNode = rawContext().createGain()
    return this.busNode
  }

  get current(): InputInfo | null {
    return this.info
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit() {
    this.listeners.forEach((l) => l(this.info))
  }

  /** Saved choices from the profile. Re-opens the input if a holder is active. */
  async setPreferences(prefs: { inputId?: string; outputId?: string }): Promise<void> {
    const inputChanged = prefs.inputId !== this.preferredInput
    this.preferredInput = prefs.inputId
    this.preferredOutput = prefs.outputId
    await this.applyOutput()
    if (inputChanged && this.holders.size) await this.reopen()
  }

  /** Audio inputs and outputs. Labels are only available after permission was granted once. */
  async listDevices(): Promise<{ inputs: DeviceInfo[]; outputs: OutputInfo[]; labelled: boolean }> {
    if (!navigator.mediaDevices?.enumerateDevices) return { inputs: [], outputs: [], labelled: false }
    const all = await navigator.mediaDevices.enumerateDevices()
    const inputs = all.filter((d) => d.kind === 'audioinput').map((d) => ({ id: d.deviceId, label: d.label, kind: inputKindOf(d.label) }))
    const outputs = all.filter((d) => d.kind === 'audiooutput').map((d) => ({ id: d.deviceId, label: d.label }))
    return { inputs, outputs, labelled: inputs.some((d) => d.label) }
  }

  /** The chosen output device id ('' = system default). */
  get outputId(): string {
    return this.preferredOutput ?? ''
  }

  /** Whether the browser can route playback to a chosen output device. */
  get canChooseOutput(): boolean {
    return typeof (rawContext() as AudioContext & { setSinkId?: unknown }).setSinkId === 'function'
  }

  private async applyOutput(): Promise<void> {
    const ctx = rawContext() as AudioContext & { setSinkId?: (id: string) => Promise<void>; sinkId?: string }
    if (typeof ctx.setSinkId !== 'function') return
    const target = this.preferredOutput ?? ''
    if ((ctx.sinkId ?? '') === target) return
    try {
      await ctx.setSinkId(target)
    } catch {
      // The device may have been unplugged; stay on the current output.
    }
  }

  /** The label of the output in use (best effort). */
  async outputLabel(): Promise<string> {
    const { outputs } = await this.listDevices()
    const id = this.preferredOutput ?? 'default'
    return outputs.find((o) => o.id === id)?.label ?? outputs.find((o) => o.id === 'default')?.label ?? ''
  }

  /** Start using the input. Returns a release function. */
  async acquire(purpose: InputPurpose): Promise<() => void> {
    const token = Symbol(purpose)
    const before = this.wantedPurpose()
    this.holders.set(token, purpose)
    try {
      if (!this.stream || before !== this.wantedPurpose()) await this.reopen()
    } catch (e) {
      this.holders.delete(token)
      throw e
    }
    return () => {
      const prev = this.wantedPurpose()
      if (!this.holders.delete(token)) return
      if (this.holders.size === 0) this.close()
      else if (prev !== this.wantedPurpose()) void this.reopen()
    }
  }

  /** Instrument use wins: a guitar lesson and the tuner both need the cable. */
  private wantedPurpose(): InputPurpose | null {
    if (this.holders.size === 0) return null
    return [...this.holders.values()].includes('instrument') ? 'instrument' : 'voice'
  }

  private async reopen(): Promise<void> {
    if (this.opening) await this.opening.catch(() => undefined)
    this.opening = this.open()
    try {
      await this.opening
    } finally {
      this.opening = null
    }
  }

  private async open(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new MicError('这个浏览器不能读取音频输入。请使用电脑版 Chrome，并通过 http://localhost 打开。', 'MIC_UNSUPPORTED')
    }
    await Tone.start()
    const purpose = this.wantedPurpose() ?? 'voice'
    const { inputs } = await this.listDevices()
    const deviceId = pickInputFor(purpose, inputs, this.preferredInput)
    const constraints: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 1 },
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: constraints })
    } catch (err) {
      const name = (err as DOMException)?.name
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new MicError('音频输入权限被拒绝。点击地址栏左侧的锁形图标，把「麦克风」改为允许，然后刷新页面。', 'MIC_DENIED', err)
      }
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        throw new MicError(deviceId ? '选中的输入设备找不到了，可能已经拔出。请在“吉他工坊 → 设备检查”里重新选择。' : '没有找到音频输入设备。请插上麦克风或吉他线，检查系统声音设置。', 'MIC_NOT_FOUND', err)
      }
      throw new MicError('无法打开音频输入：可能被其他程序占用（例如摇滚史密斯或会议软件）。关闭后重试。', 'MIC_FAILED', err)
    }
    this.closeStream()
    this.stream = stream
    const ctx = rawContext()
    this.source = ctx.createMediaStreamSource(stream)
    this.source.connect(this.bus)
    const track = stream.getAudioTracks()[0]
    const settings = (track?.getSettings() ?? {}) as MediaTrackSettings & { latency?: number }
    const label = track?.label ?? ''
    this.info = {
      deviceId: settings.deviceId ?? deviceId,
      label,
      kind: inputKindOf(label),
      trackLatency: typeof settings.latency === 'number' ? settings.latency : 0,
      sampleRate: settings.sampleRate,
    }
    track?.addEventListener('ended', () => {
      if (this.stream === stream) {
        this.closeStream()
        this.info = null
        this.emit()
      }
    })
    this.emit()
  }

  private closeStream() {
    this.source?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.source = null
    this.stream = null
  }

  private close() {
    this.closeStream()
    this.info = null
    this.emit()
  }
}

export const inputManager = new InputManager()
