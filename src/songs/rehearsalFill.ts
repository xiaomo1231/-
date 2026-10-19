/**
 * 补位 (pure): decides what the 音箱 plays for the members who are missing from a
 * band rehearsal, and how the score as loaded on a device is muted / leveled.
 */
import type { BandSong, FillConfig, FillDrumSource, FillMode, Instrument } from './scoreServerTypes'

export const DEFAULT_FILL: FillConfig = {
  tracks: {},
  volumes: {},
  drums: 'auto',
  drumSource: 'auto',
  drumStyle: null,
  metronome: false,
  countIn: true,
}

/** A song's fill settings with defaults filled in (missing / partial = defaults). */
export function fillOf(song: Pick<BandSong, 'fill'>): FillConfig {
  const f: Partial<FillConfig> = song.fill ?? {}
  return {
    tracks: { ...f.tracks },
    volumes: { ...f.volumes },
    drums: f.drums ?? DEFAULT_FILL.drums,
    drumSource: f.drumSource ?? DEFAULT_FILL.drumSource,
    drumStyle: f.drumStyle ?? null,
    metronome: f.metronome ?? false,
    countIn: f.countIn ?? true,
  }
}

export interface FillTrackInput {
  index: number
  name: string
  isDrums: boolean
}

export interface FillMember {
  id: string
  displayName: string
  instrument: Instrument | null
}

export type ResolvedDrumSource = 'file' | 'saved' | 'generated' | 'metronome'

export interface FillPlanTrack {
  index: number
  name: string
  mode: FillMode
  /** What the 音箱 does with it. */
  play: boolean
  /** Assigned member (user id) or null. */
  player: string | null
  /** The assigned member is here. */
  present: boolean
  /** 0–150 (percent). */
  volume: number
  /** Short Chinese reason, e.g. '小王在场，由本人来弹' / '小李没来，音箱补上' / '没人负责，音箱补上' / '设为一直播放' / '设为不播放'. */
  reason: string
}

export interface FillPlanDrums {
  mode: FillMode
  play: boolean
  /** Who plays drums live: members assigned to a drum track or with instrument 'drums' who are present. */
  drummers: string[]
  source: ResolvedDrumSource
  /** Set when the chosen source was not available and another one is used (Chinese), else null. */
  sourceNote: string | null
  volume: number
  reason: string
}

export interface FillPlan {
  /** Non-drum tracks, in index order. */
  tracks: FillPlanTrack[]
  drums: FillPlanDrums
  /** Metronome on the 音箱. */
  metronome: boolean
  countIn: boolean
}

/** Clamp a volume percent to 0–150, rounded; missing / invalid = 100. */
function clampVolume(v: number | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 100
  return Math.round(Math.min(150, Math.max(0, v)))
}

/** Plan the 补位 for one rehearsal. Pure: no I/O. */
export function planFill(input: {
  tracks: FillTrackInput[]
  parts: Record<string, string>
  /** User ids present in the rehearsal. */
  present: readonly string[]
  members: readonly FillMember[]
  fill: FillConfig
  hasSavedDrums: boolean
}): FillPlan {
  const { tracks, parts, present, members, fill, hasSavedDrums } = input
  const presentSet = new Set(present)
  const memberIds = new Set(members.map((m) => m.id))
  const nameOf = new Map(members.map((m) => [m.id, m.displayName]))
  const playerOf = (index: number): string | null => {
    const id = parts[String(index)]
    return id && memberIds.has(id) ? id : null
  }

  const drumTracks = tracks.filter((t) => t.isDrums)
  const drumTrackIndexes = new Set(drumTracks.map((t) => t.index))
  const hasFileDrums = drumTracks.length > 0

  // Non-drum tracks.
  const planTracks: FillPlanTrack[] = tracks
    .filter((t) => !t.isDrums)
    .sort((a, b) => a.index - b.index)
    .map((t) => {
      const player = playerOf(t.index)
      const present = player !== null && presentSet.has(player)
      const mode: FillMode = fill.tracks[String(t.index)] ?? 'auto'
      const playerName = player ? (nameOf.get(player) ?? '') : ''
      let play: boolean
      let reason: string
      if (mode === 'on') {
        play = true
        reason = '设为一直播放'
      } else if (mode === 'off') {
        play = false
        reason = '设为不播放'
      } else if (present) {
        play = false
        reason = `${playerName}在场，由本人来弹`
      } else if (player) {
        play = true
        reason = `${playerName}没来，音箱补上`
      } else {
        play = true
        reason = '没人负责，音箱补上'
      }
      return {
        index: t.index,
        name: t.name,
        mode,
        play,
        player,
        present,
        volume: clampVolume(fill.volumes[String(t.index)]),
        reason,
      }
    })

  // Drums.
  const drummers = members
    .filter(
      (m) =>
        presentSet.has(m.id) &&
        (m.instrument === 'drums' ||
          Object.entries(parts).some(
            ([key, id]) => id === m.id && drumTrackIndexes.has(Number(key)),
          )),
    )
    .map((m) => m.id)
  const drumsMode: FillMode = fill.drums
  let drumsPlay: boolean
  let drumsReason: string
  if (drumsMode === 'on') {
    drumsPlay = true
    drumsReason = '设为一直播放'
  } else if (drumsMode === 'off') {
    drumsPlay = false
    drumsReason = '设为不播放'
  } else if (drummers.length > 0) {
    drumsPlay = false
    drumsReason = `鼓手在场（${drummers.map((id) => nameOf.get(id) ?? '').join('、')}）`
  } else {
    drumsPlay = true
    drumsReason = '没有鼓手，音箱补上'
  }

  const { source, sourceNote } = resolveDrumSource(fill.drumSource, hasSavedDrums, hasFileDrums)

  const plan: FillPlan = {
    tracks: planTracks,
    drums: {
      mode: drumsMode,
      play: drumsPlay,
      drummers,
      source,
      sourceNote,
      volume: clampVolume(fill.volumes['drums']),
      reason: drumsReason,
    },
    metronome: fill.metronome || (drumsPlay && source === 'metronome'),
    countIn: fill.countIn,
  }
  return plan
}

/** Resolve the drum source, falling back when the chosen one is missing. */
function resolveDrumSource(
  chosen: FillDrumSource,
  hasSavedDrums: boolean,
  hasFileDrums: boolean,
): { source: ResolvedDrumSource; sourceNote: string | null } {
  const fallback: ResolvedDrumSource = hasFileDrums ? 'file' : 'generated'
  switch (chosen) {
    case 'auto':
      return {
        source: hasSavedDrums ? 'saved' : fallback,
        sourceNote: null,
      }
    case 'saved':
      if (hasSavedDrums) return { source: 'saved', sourceNote: null }
      return {
        source: fallback,
        sourceNote: `还没有编辑过的鼓谱，改用${hasFileDrums ? '谱里的鼓' : '自动生成的鼓'}`,
      }
    case 'file':
      if (hasFileDrums) return { source: 'file', sourceNote: null }
      return { source: 'generated', sourceNote: '谱里没有鼓轨，改用自动生成的鼓' }
    case 'generated':
      return { source: 'generated', sourceNote: null }
    case 'metronome':
      return { source: 'metronome', sourceNote: null }
    default:
      return { source: fallback, sourceNote: null }
  }
}

/** Mute and volume per track of the score as LOADED on a device. */
export function speakerMix(
  plan: FillPlan,
  layout: {
    trackCount: number
    /** The file's drum tracks (indexes), played only when source is 'file'. */
    fileDrums: readonly number[]
    /** A drum track added from a saved or generated part, or null. Played only when source is 'saved' or 'generated'. */
    added: number | null
    /** A notation-only copy of a drum track: never played. */
    std: number | null
    /** Tracks this device's own member plays live (muted on their earphones). Default []. */
    own?: readonly number[]
  },
): { mute: boolean[]; volume: number[] } {
  const own = new Set(layout.own ?? [])
  const fileDrums = new Set(layout.fileDrums)
  const trackByIndex = new Map(plan.tracks.map((t) => [t.index, t]))
  const drumFactor = plan.drums.volume / 100
  const drumSourcePlays = plan.drums.play
  const addedSource = plan.drums.source === 'saved' || plan.drums.source === 'generated'

  const mute: boolean[] = []
  const volume: number[] = []
  for (let i = 0; i < layout.trackCount; i++) {
    if (own.has(i)) {
      mute.push(true)
      volume.push(1)
      continue
    }
    if (layout.std === i) {
      mute.push(true)
      volume.push(1)
      continue
    }
    if (layout.added === i) {
      mute.push(!(drumSourcePlays && addedSource))
      volume.push(drumFactor)
      continue
    }
    if (fileDrums.has(i)) {
      mute.push(!(drumSourcePlays && plan.drums.source === 'file'))
      volume.push(drumFactor)
      continue
    }
    const t = trackByIndex.get(i)
    if (!t) {
      mute.push(true)
      volume.push(1)
      continue
    }
    mute.push(!t.play)
    volume.push(t.volume / 100)
  }
  return { mute, volume }
}
