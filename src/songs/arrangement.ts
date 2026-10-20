/**
 * 改编谱 on the page: turning the viewer's per-track state (chosen instruments,
 * volumes, mutes) into the stored changes and back. Pure, so it can be tested.
 */
import type { ArrangementTrack } from './scoreServerTypes'

export interface MixState {
  /** Chosen instrument per track; null = the score's own. */
  programs: ReadonlyArray<number | null>
  /** Percent per track; missing = 100. */
  volumes: ReadonlyArray<number>
  mute: ReadonlySet<number>
  transpose: number
}

export interface ArrangementConfig {
  tracks: Record<string, ArrangementTrack>
  transpose: number
}

/** The changes to store for the first `count` tracks (unchanged tracks are left out). */
export function configOf(mix: MixState, count: number): ArrangementConfig {
  const tracks: Record<string, ArrangementTrack> = {}
  for (let i = 0; i < count; i++) {
    const one: ArrangementTrack = {}
    const program = mix.programs[i]
    if (program !== null && program !== undefined) one.program = program
    const volume = mix.volumes[i] ?? 100
    if (volume !== 100) one.volume = volume
    if (mix.mute.has(i)) one.mute = true
    if (Object.keys(one).length > 0) tracks[String(i)] = one
  }
  return { tracks, transpose: mix.transpose }
}

/** The viewer state an arrangement gives a score with `count` tracks (extra entries are ignored). */
export function mixOf(config: ArrangementConfig, count: number): MixState {
  const programs: Array<number | null> = []
  const volumes: number[] = []
  const mute = new Set<number>()
  for (let i = 0; i < count; i++) {
    const t = config.tracks[String(i)]
    programs.push(t?.program ?? null)
    volumes.push(t?.volume ?? 100)
    if (t?.mute) mute.add(i)
  }
  return { programs, volumes, mute, transpose: config.transpose }
}

/** True when two configs change the same things. */
export function sameConfig(a: ArrangementConfig, b: ArrangementConfig): boolean {
  if (a.transpose !== b.transpose) return false
  const keys = new Set([...Object.keys(a.tracks), ...Object.keys(b.tracks)])
  for (const k of keys) {
    const x = a.tracks[k] ?? {}
    const y = b.tracks[k] ?? {}
    if ((x.program ?? null) !== (y.program ?? null)) return false
    if ((x.volume ?? 100) !== (y.volume ?? 100)) return false
    if ((x.mute ?? false) !== (y.mute ?? false)) return false
  }
  return true
}

/** A short line of what an arrangement changes, e.g. "2 条轨换了乐器 · 移调 +2". */
export function describeConfig(config: ArrangementConfig): string {
  const tracks = Object.values(config.tracks)
  const parts: string[] = []
  const inst = tracks.filter((t) => t.program !== undefined).length
  const vol = tracks.filter((t) => t.volume !== undefined).length
  const muted = tracks.filter((t) => t.mute).length
  if (inst) parts.push(`${inst} 条轨换了乐器`)
  if (vol) parts.push(`${vol} 条轨调了音量`)
  if (muted) parts.push(`${muted} 条轨静音`)
  if (config.transpose) parts.push(`移调 ${config.transpose > 0 ? '+' : ''}${config.transpose}`)
  return parts.join(' · ') || '没有改动'
}
