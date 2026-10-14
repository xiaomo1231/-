/**
 * 监听 (live monitoring): the microphone back into the headphones while
 * singing, with its own level and an optional light reverb (singers pitch
 * better when they hear themselves, and a little room makes it comfortable).
 * Browser monitoring has some delay (usually 20–60 ms, depending on the
 * device); it is meant for headphones only, otherwise the speakers feed back.
 */
import { inputManager } from '@/audio/input/inputManager'
import { reverbImpulse } from '@/audio/sing/mixChain'
import { desktop, type NativeMonitorInfo } from '@/app/desktop'
import { nativeInputNode } from '@/audio/input/nativeInput'

export interface MonitorSettings {
  on: boolean
  /** 0–1.5 */
  volume: number
  reverb: boolean
  /** App only (0.23.0): monitor through the sound card driver instead of the browser. */
  native: boolean
  /** App only: 'wasapi', or 'asio:<driver name>'. */
  nativeApi: string
}

export const MONITOR_DEFAULTS: MonitorSettings = {
  on: false,
  volume: 0.8,
  reverb: true,
  native: true,
  nativeApi: 'wasapi',
}

/** What the monitor is doing now (shown under the monitor controls). */
export type MonitorStatus =
  | { kind: 'browser' }
  | { kind: 'native'; info: NativeMonitorInfo; note?: string }
  | { kind: 'fallback'; reason: string; switchTo?: string }
const STORE = 'groovelab:sing-monitor'

export function loadMonitorSettings(): MonitorSettings {
  try {
    return {
      ...MONITOR_DEFAULTS,
      ...(JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<MonitorSettings>),
    }
  } catch {
    return { ...MONITOR_DEFAULTS }
  }
}

export function saveMonitorSettings(s: MonitorSettings): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(s))
  } catch {
    // storage blocked: lasts for this visit
  }
}

/** ASIO cannot be used for this setup (no inputs / no microphone signal there). */
class AsioUnusable extends Error {}

export class VoiceMonitor {
  /** The real microphone's name (kept while ASIO feeds the input). */
  private micLabel = ''
  /** Why the monitor just switched away from ASIO (shown once with the next status). */
  private note = ''
  private nodes: AudioNode[] = []
  private out: GainNode | null = null
  private wet: GainNode | null = null
  /** Settings the native monitor was started with ('' = not running natively). */
  private nativeKey = ''
  private starting: Promise<void> | null = null
  /** With ASIO: the driver's microphone feeding recording and scoring. */
  private feed: { stop: () => void } | null = null

  constructor(private readonly onStatus: (s: MonitorStatus) => void = () => undefined) {}

  get running(): boolean {
    return this.out !== null || this.nativeKey !== ''
  }

  start(s: MonitorSettings): void {
    const app = desktop()
    if (app && s.native) {
      void this.startNative(s)
      return
    }
    if (this.nativeKey) this.stopNative()
    this.startBrowser(s)
    this.onStatus({ kind: 'browser' })
  }

  /** Through the app's sound card driver; falls back to the browser monitor when that fails. */
  private async startNative(s: MonitorSettings): Promise<void> {
    const app = desktop()!
    const key = s.nativeApi
    await this.starting
    if (this.nativeKey === key) {
      void app.monitor.update({
        volume: Math.min(32, s.volume * inputManager.voiceGain),
        reverb: s.reverb,
      })
      return
    }
    this.stopBrowser()
    this.starting = (async () => {
      try {
        if (this.nativeKey) await app.monitor.stop()
        await this.endFeed()
        const asio = key.startsWith('asio:') ? key.slice(5) : ''
        if (asio) {
          // ASIO uses one sound card for both ways: it needs inputs there (a headphone DAC has none).
          const dev = (await app.monitor.devices()).find((d) => d.api === 'ASIO' && d.name === asio)
          if (!dev || dev.inputs === 0)
            throw new AsioUnusable(`「${asio}」的 ASIO 没有输入（麦克风不在这块声卡上）`)
        } else if (!this.feed) {
          // Remember the real microphone (while ASIO feeds the page, the input shows the driver's name).
          this.micLabel = inputManager.current?.label ?? this.micLabel
        }
        const info = await app.monitor.start({
          api: asio ? 'asio' : 'wasapi',
          // ASIO keeps the sound card's own rate (changing it would disturb other programs); the page converts.
          ...(asio ? { asioName: asio, feed: true } : {}),
          inputName: (this.feed ? this.micLabel : inputManager.current?.label) ?? this.micLabel,
          outputName: await inputManager.outputLabel().catch(() => ''),
          volume: Math.min(32, s.volume * inputManager.voiceGain),
          reverb: s.reverb,
        })
        // ASIO holds the whole sound card: recording and scoring read the driver's microphone too.
        if (asio) {
          this.micLabel = inputManager.current?.label ?? this.micLabel
          await app.monitor.stats()
          const src = await nativeInputNode(inputManager.bus.context)
          this.feed = src
          await inputManager.useExternal(src.node, `${asio}（ASIO）`)
          // A microphone always gives some signal (noise); digital silence means nothing is plugged in there.
          await new Promise((r) => setTimeout(r, 1800))
          if ((await app.monitor.stats()).peak < 1e-5)
            throw new AsioUnusable(
              `「${asio}」的 ASIO 没有收到麦克风的声音（麦克风可能接在别的声卡上）`,
            )
        }
        this.nativeKey = key
        this.onStatus({ kind: 'native', info, ...(this.note ? { note: this.note } : {}) })
        this.note = ''
      } catch (e) {
        this.nativeKey = ''
        await app.monitor.stop().catch(() => undefined)
        await this.endFeed()
        if (e instanceof AsioUnusable) {
          // Back to the low-latency WASAPI monitor (it can listen on one card and play on another).
          this.note = `${e.message}，已改用 WASAPI 低延迟监听（ASIO 要求麦克风和耳机接在同一块声卡上）。`
          this.onStatus({ kind: 'fallback', reason: this.note, switchTo: 'wasapi' })
          return
        }
        this.startBrowser(s)
        this.onStatus({
          kind: 'fallback',
          reason:
            e instanceof Error
              ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
              : String(e),
        })
      } finally {
        this.starting = null
      }
    })()
    await this.starting
  }

  private stopNative(): void {
    this.nativeKey = ''
    void desktop()
      ?.monitor.stop()
      .catch(() => undefined)
      .then(() => this.endFeed())
  }

  /** Back to the browser microphone (after ASIO let go of the sound card). */
  private async endFeed(): Promise<void> {
    if (!this.feed) return
    const f = this.feed
    this.feed = null
    f.stop()
    await inputManager.useExternal(null).catch(() => undefined)
  }

  private startBrowser(s: MonitorSettings): void {
    if (this.out) return this.update(s)
    const bus = inputManager.bus
    const ctx = bus.context
    // Many interfaces and guitar cables arrive as two channels with the signal on
    // one side only: fold to mono first (L+R), so both ears hear the voice.
    const mono = ctx.createGain()
    mono.channelCount = 1
    mono.channelCountMode = 'explicit'
    mono.channelInterpretation = 'speakers'
    // A gentle low cut keeps breath pops and handling noise out of the ears.
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 90
    hp.channelCount = 1
    hp.channelCountMode = 'explicit'
    // The fold halves a one-sided signal: bring it back up (+6 dB); the volume slider does the rest.
    mono.gain.value = 2
    // out is stereo (explicit), so the mono voice is copied to both ears.
    const out = ctx.createGain()
    out.channelCount = 2
    out.channelCountMode = 'explicit'
    out.channelInterpretation = 'speakers'
    const wet = ctx.createGain()
    const conv = ctx.createConvolver()
    conv.buffer = reverbImpulse(ctx, 0.35, 1.2, 'plate')
    bus.connect(mono).connect(hp)
    hp.connect(out)
    hp.connect(conv).connect(wet).connect(out)
    out.connect(ctx.destination)
    this.nodes = [mono, hp, conv]
    this.out = out
    this.wet = wet
    this.update(s)
  }

  update(s: MonitorSettings): void {
    if (!this.out || !this.wet) return
    const t = this.out.context.currentTime
    this.out.gain.setTargetAtTime(Math.max(0, Math.min(1.5, s.volume)), t, 0.02)
    this.wet.gain.setTargetAtTime(s.reverb ? 0.25 : 0, t, 0.02)
  }

  stop(): void {
    if (this.nativeKey) this.stopNative()
    this.stopBrowser()
  }

  private stopBrowser(): void {
    try {
      inputManager.bus.disconnect(this.nodes[0]!)
    } catch {
      // already disconnected
    }
    for (const n of this.nodes) n.disconnect()
    this.wet?.disconnect()
    this.out?.disconnect()
    this.nodes = []
    this.out = null
    this.wet = null
  }
}
