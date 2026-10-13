/**
 * Pure helpers about audio devices (no browser APIs), so they can be tested.
 */

export type InputKind = 'cable' | 'mic'

/**
 * Guitar-to-USB cables and instrument interfaces show up as ordinary
 * recording devices; their names give them away. Rocksmith's Real Tone
 * Cable reports "Rocksmith Guitar Adapter".
 */
const CABLE_PATTERNS = [/rocksmith/i, /real\s*tone/i, /guitar/i, /吉他/, /\binstrument\b/i, /hi-?z/i, /\birig\b/i, /guitar\s*link/i, /jam\s*up/i, /\bbass\b/i]

export function isGuitarCableLabel(label: string | undefined | null): boolean {
  if (!label) return false
  return CABLE_PATTERNS.some((p) => p.test(label))
}

export function inputKindOf(label: string | undefined | null): InputKind {
  return isGuitarCableLabel(label) ? 'cable' : 'mic'
}

/** Key for per-device settings (latency): the input and output device names. */
export function deviceComboKey(inputLabel: string | undefined | null, outputLabel: string | undefined | null): string {
  const norm = (s: string | undefined | null) =>
    (s || 'default')
      .replace(/\([0-9a-f]{4}:[0-9a-f]{4}\)/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  return `${norm(inputLabel)}→${norm(outputLabel)}`
}

/** Friendly name for a device label (strip USB ids and "Default - " prefixes). */
export function deviceDisplayName(label: string | undefined | null, fallback = '系统默认设备'): string {
  if (!label) return fallback
  return label
    .replace(/^(default|communications|默认|通信)\s*-\s*/i, '')
    .replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)/gi, '')
    .trim() || fallback
}

export interface DeviceInfo {
  id: string
  label: string
  kind: InputKind
}

/**
 * For singing, pick a microphone even when a guitar cable is the selected
 * input: the preferred device if it is a microphone, otherwise the first
 * device that is not a cable, otherwise the system default.
 */
export function pickInputFor(purpose: 'voice' | 'instrument', devices: readonly DeviceInfo[], preferredId: string | undefined): string | undefined {
  const preferred = preferredId ? devices.find((d) => d.id === preferredId) : undefined
  if (purpose === 'instrument') return preferred?.id
  if (preferred && preferred.kind === 'mic') return preferred.id
  const mic = devices.find((d) => d.kind === 'mic' && d.id !== 'default' && d.id !== 'communications') ?? devices.find((d) => d.kind === 'mic')
  return mic?.id
}
