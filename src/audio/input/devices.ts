/**
 * Pure helpers about audio devices (no browser APIs), so they can be tested.
 */

export type InputKind = 'cable' | 'mic'

/**
 * Guitar-to-USB cables and instrument interfaces show up as ordinary
 * recording devices; their names give them away. Rocksmith's Real Tone
 * Cable reports "Rocksmith Guitar Adapter".
 */
const CABLE_PATTERNS = [
  /rocksmith/i,
  /real\s*tone/i,
  /guitar/i,
  /吉他/,
  /\binstrument\b/i,
  /hi-?z/i,
  /\birig\b/i,
  /guitar\s*link/i,
  /jam\s*up/i,
  /\bbass\b/i,
]

export function isGuitarCableLabel(label: string | undefined | null): boolean {
  if (!label) return false
  return CABLE_PATTERNS.some((p) => p.test(label))
}

/**
 * Loopback / "what you hear" inputs record what the computer plays, not a
 * microphone (silence when nothing plays): never picked for singing by themselves.
 */
const LOOPBACK_PATTERNS = [
  /loop\s*back/i,
  /stereo\s*mix/i,
  /立体声混音/,
  /what\s*u\s*hear/i,
  /wave\s*out/i,
  /内录/,
  /monitor\s+of/i,
]

export function isLoopbackLabel(label: string | undefined | null): boolean {
  if (!label) return false
  return LOOPBACK_PATTERNS.some((p) => p.test(label))
}

export function inputKindOf(label: string | undefined | null): InputKind {
  return isGuitarCableLabel(label) ? 'cable' : 'mic'
}

/** Key for per-device settings (latency): the input and output device names. */
export function deviceComboKey(
  inputLabel: string | undefined | null,
  outputLabel: string | undefined | null,
): string {
  const norm = (s: string | undefined | null) =>
    (s || 'default')
      .replace(/\([0-9a-f]{4}:[0-9a-f]{4}\)/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  return `${norm(inputLabel)}→${norm(outputLabel)}`
}

/** Friendly name for a device label (strip USB ids and "Default - " prefixes). */
export function deviceDisplayName(
  label: string | undefined | null,
  fallback = '系统默认设备',
): string {
  if (!label) return fallback
  return (
    label
      .replace(/^(default|communications|默认|通信)\s*-\s*/i, '')
      .replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)/gi, '')
      .trim() || fallback
  )
}

export interface DeviceInfo {
  id: string
  label: string
  kind: InputKind
}

/**
 * The input to open. Instruments: the chosen input (else the system default).
 * Singing: the microphone chosen for singing; else the chosen input when it
 * is a microphone; else the system default when that is a real microphone;
 * else the first real microphone (not a guitar cable, not a loopback).
 */
export function pickInputFor(
  purpose: 'voice' | 'instrument',
  devices: readonly DeviceInfo[],
  preferredId: string | undefined,
  voiceId?: string,
): string | undefined {
  const preferred = preferredId ? devices.find((d) => d.id === preferredId) : undefined
  if (purpose === 'instrument') return preferred?.id
  const chosen = voiceId ? devices.find((d) => d.id === voiceId) : undefined
  if (chosen) return chosen.id
  const realMic = (d: DeviceInfo) => d.kind === 'mic' && !isLoopbackLabel(d.label)
  if (preferred && realMic(preferred)) return preferred.id
  const def = devices.find((d) => d.id === 'default')
  if (def && realMic(def)) return undefined
  const mic =
    devices.find((d) => realMic(d) && d.id !== 'default' && d.id !== 'communications') ??
    devices.find(realMic)
  return mic?.id
}
