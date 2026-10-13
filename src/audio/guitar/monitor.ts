import * as Tone from 'tone'
import { inputManager } from '@/audio/input/inputManager'
import { GuitarRigChain } from './chain'
import { ensureWorklets } from './worklets'
import type { RigSettings } from './rigSettings'

/**
 * Live monitoring: the selected input through the guitar chain to the
 * speakers / headphones. Detection always reads the dry input bus, so
 * effects never change scoring.
 */
class GuitarMonitor {
  private chain: GuitarRigChain | null = null
  private release: (() => void) | null = null
  private settings: RigSettings | null = null
  private bpm = 100
  private listeners = new Set<(on: boolean) => void>()
  gateAvailable = true

  get running(): boolean {
    return this.chain !== null
  }

  onChange(cb: (on: boolean) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  async start(settings: RigSettings): Promise<void> {
    this.settings = settings
    if (this.chain) {
      this.chain.apply(settings, this.bpm)
      return
    }
    this.release = await inputManager.acquire('instrument')
    const ctx = Tone.getContext().rawContext as AudioContext
    this.gateAvailable = await ensureWorklets(ctx)
    const chain = new GuitarRigChain(ctx, this.gateAvailable)
    chain.apply(settings, this.bpm)
    inputManager.bus.connect(chain.input)
    chain.output.connect(ctx.destination)
    this.chain = chain
    this.listeners.forEach((l) => l(true))
  }

  update(settings: RigSettings): void {
    this.settings = settings
    this.chain?.apply(settings, this.bpm)
  }

  /** Tempo for a synced delay (practice desk sets it). */
  setTempo(bpm: number): void {
    this.bpm = bpm
    if (this.settings) this.chain?.apply(this.settings, bpm)
  }

  stop(): void {
    if (!this.chain) return
    try {
      inputManager.bus.disconnect(this.chain.input)
    } catch {
      // already disconnected
    }
    this.chain.dispose()
    this.chain = null
    this.release?.()
    this.release = null
    this.listeners.forEach((l) => l(false))
  }
}

export const guitarMonitor = new GuitarMonitor()
