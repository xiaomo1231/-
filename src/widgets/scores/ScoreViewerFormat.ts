/**
 * 看谱器 (pure): how a library file is opened, from its extension (the same
 * mapping as the library's ScoreFormat), plus small helpers for the viewer.
 */
import type { ScoreFormat } from '@/songs/scoreLibraryTypes'

const FORMAT_BY_EXT = new Map<string, ScoreFormat>([
  ...['gp3', 'gp4', 'gp5', 'gpx', 'gp', 'musicxml', 'xml', 'mxl'].map(
    (e): [string, ScoreFormat] => [e, 'score'],
  ),
  ...['gtp', 'ptb'].map((e): [string, ScoreFormat] => [e, 'legacy']),
  ...['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tif', 'tiff', 'webp'].map((e): [string, ScoreFormat] => [
    e,
    'image',
  ]),
  ['pdf', 'pdf'],
  ['txt', 'text'],
  ...['mid', 'midi', 'kar'].map((e): [string, ScoreFormat] => [e, 'midi']),
  ...['mp3', 'wav', 'wma', 'ogg', 'm4a', 'flac', 'aac'].map((e): [string, ScoreFormat] => [
    e,
    'audio',
  ]),
  ...['mp4', 'wmv', 'avi', 'mkv', 'flv', 'mov'].map((e): [string, ScoreFormat] => [e, 'video']),
])

/** The format of a file by its extension (with or without the dot, any case). */
export function scoreFormatOf(ext: string): ScoreFormat {
  return FORMAT_BY_EXT.get(ext.replace(/^\./, '').toLowerCase()) ?? 'other'
}

/** Lower-case extension without the dot ('' when there is none). */
export function extOf(path: string): string {
  const name = fileBaseName(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** The last segment of a '/' or '\' separated path. */
export function fileBaseName(path: string): string {
  return path.split(/[/\x5c]/).pop() ?? path
}

/** The `pages` URL parameter: a JSON array of relative paths (anything else gives []). */
export function parsePagesParam(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v)
      ? v.filter((p): p is string => typeof p === 'string' && p.length > 0)
      : []
  } catch {
    return []
  }
}

/** Artist text from a tab file, or '' when it is a website advert rather than a name. */
export function cleanArtist(text: string | null | undefined): string {
  const t = (text ?? '').trim()
  if (!t || /www\.|https?:|\.com|\.cn|\.net|吉他谱网/i.test(t)) return ''
  return t
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** A MIDI pitch as a note name with its octave (40 → "E2", the open low string). */
export function noteName(midi: number): string {
  const pc = ((Math.round(midi) % 12) + 12) % 12
  return `${NOTE_NAMES[pc]}${Math.floor(Math.round(midi) / 12) - 1}`
}

const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
}

/** MIME type of an image file (browsers may not show TIFF). */
export function imageMime(ext: string): string {
  return IMAGE_MIME[ext] ?? 'image/png'
}

const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  wma: 'audio/x-ms-wma',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  aac: 'audio/aac',
}

/** MIME type of an audio file. */
export function audioMime(ext: string): string {
  return AUDIO_MIME[ext] ?? 'audio/mpeg'
}
