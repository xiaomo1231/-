import { create } from 'zustand'
import * as Tone from 'tone'
import { inputManager, type InputInfo, type OutputInfo } from '@/audio/input/inputManager'
import { deviceComboKey, type DeviceInfo } from '@/audio/input/devices'
import { guitarMonitor } from '@/audio/guitar/monitor'
import { BUILTIN_PRESETS, DEFAULT_RIG, normalizePresets, normalizeRig, type RigPreset, type RigSettings } from '@/audio/guitar/rigSettings'
import { estimateRoundTripMs, judgeOffset } from '@/audio/latency'
import { ensureAudio } from '@/audio/engine'
import { ProfileService } from '@/services/profileService'
import { useProfileStore } from '@/features/profile/profileStore'
import { uuid } from '@/infrastructure/crypto/crypto'

export type MonitorStartResult = 'started' | 'needs-confirm' | 'error'

interface GuitarAudioState {
  inputs: DeviceInfo[]
  outputs: OutputInfo[]
  labelled: boolean
  current: InputInfo | null
  outputLabel: string
  monitorOn: boolean
  rig: RigSettings
  presetId: string | null
  presets: RigPreset[]
  error: string | null
  /** Live estimate from browser-reported latencies, ms. */
  estimateMs: number
  refreshDevices: () => Promise<void>
  selectInput: (id: string) => Promise<void>
  selectOutput: (id: string) => Promise<void>
  startMonitor: (confirmedHeadphones?: boolean) => Promise<MonitorStartResult>
  stopMonitor: () => void
  setRig: (rig: RigSettings) => void
  applyPreset: (id: string) => void
  savePreset: (name: string) => Promise<void>
  deletePreset: (id: string) => Promise<void>
  saveCalibration: (ms: number) => Promise<void>
  /** Latency to subtract when judging, for the current device pair. */
  judge: () => { seconds: number; calibrated: boolean; key: string }
  hydrate: () => void
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

async function patchProfile(patch: Parameters<typeof ProfileService.update>[0]) {
  const next = await ProfileService.update(patch)
  useProfileStore.getState().set(next)
}

function currentEstimate(current: InputInfo | null): number {
  const ctx = Tone.getContext().rawContext as AudioContext
  return estimateRoundTripMs({
    base: typeof ctx.baseLatency === 'number' ? ctx.baseLatency : 0,
    output: typeof ctx.outputLatency === 'number' ? ctx.outputLatency : 0,
    input: current?.trackLatency ?? 0,
  })
}

export const useGuitarAudio = create<GuitarAudioState>((set, get) => ({
  inputs: [],
  outputs: [],
  labelled: false,
  current: inputManager.current,
  outputLabel: '',
  monitorOn: guitarMonitor.running,
  rig: DEFAULT_RIG,
  presetId: null,
  presets: [],
  error: null,
  estimateMs: 0,

  hydrate() {
    const p = useProfileStore.getState().profile
    set({ rig: normalizeRig(p?.guitarRig ?? BUILTIN_PRESETS[0]!.settings), presets: normalizePresets(p?.guitarPresets), presetId: p?.guitarPresetId ?? (p?.guitarRig ? null : BUILTIN_PRESETS[0]!.id) })
  },

  async refreshDevices() {
    const { inputs, outputs, labelled } = await inputManager.listDevices()
    set({ inputs, outputs, labelled, current: inputManager.current, outputLabel: await inputManager.outputLabel(), estimateMs: currentEstimate(inputManager.current) })
  },

  async selectInput(id) {
    const dev = get().inputs.find((d) => d.id === id)
    await patchProfile({ audioInputId: id, audioInputLabel: dev?.label ?? '' })
    await get().refreshDevices()
  },

  async selectOutput(id) {
    const dev = get().outputs.find((d) => d.id === id)
    await patchProfile({ audioOutputId: id, audioOutputLabel: dev?.label ?? '' })
    await get().refreshDevices()
  },

  async startMonitor(confirmedHeadphones = false) {
    set({ error: null })
    try {
      await ensureAudio()
      // Find out which input we will get before sending it to the speakers.
      const preview = await inputManager.acquire('instrument')
      const kind = inputManager.current?.kind
      if (kind !== 'cable' && !confirmedHeadphones) {
        preview()
        set({ current: inputManager.current })
        return 'needs-confirm'
      }
      await guitarMonitor.start(get().rig)
      preview()
      set({ monitorOn: true, current: inputManager.current, estimateMs: currentEstimate(inputManager.current) })
      void patchProfile({ monitorOn: true })
      return 'started'
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return 'error'
    }
  },

  stopMonitor() {
    guitarMonitor.stop()
    set({ monitorOn: false })
    void patchProfile({ monitorOn: false })
  },

  setRig(rig) {
    const clean = normalizeRig(rig)
    set({ rig: clean, presetId: null })
    guitarMonitor.update(clean)
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void patchProfile({ guitarRig: clean, guitarPresetId: '' }), 400)
  },

  applyPreset(id) {
    const p = [...BUILTIN_PRESETS, ...get().presets].find((x) => x.id === id)
    if (!p) return
    const rig = { ...normalizeRig(p.settings), volume: get().rig.volume }
    set({ rig, presetId: id })
    guitarMonitor.update(rig)
    void patchProfile({ guitarRig: rig, guitarPresetId: id })
  },

  async savePreset(name) {
    const preset: RigPreset = { id: uuid(), name: name.trim().slice(0, 20) || '我的音色', description: '自定义', settings: get().rig }
    const presets = [...get().presets, preset].slice(-20)
    set({ presets, presetId: preset.id })
    await patchProfile({ guitarPresets: presets, guitarPresetId: preset.id })
  },

  async deletePreset(id) {
    const presets = get().presets.filter((p) => p.id !== id)
    set({ presets, ...(get().presetId === id ? { presetId: null } : {}) })
    await patchProfile({ guitarPresets: presets })
  },

  async saveCalibration(ms) {
    const key = deviceComboKey(get().current?.label, get().outputLabel)
    const prev = useProfileStore.getState().profile?.latencyByDevice ?? {}
    await patchProfile({ latencyByDevice: { ...prev, [key]: Math.round(ms) } })
  },

  judge() {
    const key = deviceComboKey(get().current?.label, get().outputLabel)
    return { ...judgeOffset(useProfileStore.getState().profile?.latencyByDevice, key, get().estimateMs || currentEstimate(get().current)), key }
  },
}))

// Keep the store in step with the input manager and the monitor.
inputManager.onChange((info) => useGuitarAudio.setState({ current: info, estimateMs: currentEstimate(info) }))
guitarMonitor.onChange((on) => useGuitarAudio.setState({ monitorOn: on }))
