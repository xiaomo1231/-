/**
 * 监听 (live monitoring): the microphone back into the headphones while
 * singing, with its own level and an optional light reverb (singers pitch
 * better when they hear themselves, and a little room makes it comfortable).
 * Browser monitoring has some delay (usually 20–60 ms, depending on the
 * device); it is meant for headphones only, otherwise the speakers feed back.
 */
import { inputManager } from '@/audio/input/inputManager'
import { reverbImpulse } from '@/audio/sing/mixChain'

export interface MonitorSettings {
  on: boolean
  /** 0–1.5 */
  volume: number
  reverb: boolean
}

export const MONITOR_DEFAULTS: MonitorSettings = { on: false, volume: 0.8, reverb: true }
const STORE = 'groovelab:sing-monitor'

export function loadMonitorSettings(): MonitorSettings {
  try {
    return { ...MONITOR_DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<MonitorSettings>) }
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

export class VoiceMonitor {
  private nodes: AudioNode[] = []
  private out: GainNode | null = null
  private wet: GainNode | null = null

  get running(): boolean {
    return this.out !== null
  }

  start(s: MonitorSettings): void {
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
