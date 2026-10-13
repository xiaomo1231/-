/**
 * Embedded song tags (pure, bytes in): ID3v2.2–2.4 and ID3v1 (MP3), FLAC and
 * Ogg Vorbis comments, MP4 / M4A ilst atoms. Only title, artist and album.
 * Reads the head of the file (and the tail for ID3v1 / MP4 files with the
 * index at the end); returns null when nothing usable is found.
 */
import { decodeLegacyText, type SongTags } from '@/songs/libraryNames'

/** Bytes the scanner reads from each end of a file. */
export const HEAD_BYTES = 512 * 1024
export const TAIL_BYTES = 512 * 1024

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n))
const u32 = (b: Uint8Array, at: number) => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0
const syncsafe = (b: Uint8Array, at: number) => (b[at]! << 21) | (b[at + 1]! << 14) | (b[at + 2]! << 7) | b[at + 3]!
const utf8 = (b: Uint8Array) => new TextDecoder('utf-8').decode(b).replace(/\0+$/, '').trim()

function clean(t: SongTags): SongTags | null {
  const out: SongTags = {}
  for (const k of ['title', 'artist', 'album'] as const) {
    const v = t[k]?.replace(/\0/g, '').trim()
    if (v) out[k] = v
  }
  return out.title || out.artist ? out : null
}

/** Text of an ID3v2 text frame (first byte = encoding). */
function id3Text(b: Uint8Array): string {
  const enc = b[0]
  const body = b.subarray(1)
  if (enc === 0) return decodeLegacyText(body)
  if (enc === 3) return utf8(body)
  // UTF-16 with BOM (1) or big-endian (2)
  let le = enc === 1
  let s = body
  if (s[0] === 0xff && s[1] === 0xfe) {
    le = true
    s = s.subarray(2)
  } else if (s[0] === 0xfe && s[1] === 0xff) {
    le = false
    s = s.subarray(2)
  }
  const text = new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(s.subarray(0, s.length - (s.length % 2)))
  return text.split('\0')[0]!.trim()
}

export function parseId3v2(b: Uint8Array): SongTags | null {
  if (b.length < 10 || ascii(b, 0, 3) !== 'ID3') return null
  const major = b[3]!
  const flags = b[5]!
  const size = syncsafe(b, 6)
  const end = Math.min(b.length, 10 + size)
  let at = 10
  if (flags & 0x40 && major >= 3) at += major === 4 ? syncsafe(b, at) : u32(b, at) + 4 // extended header
  const names: Record<string, keyof SongTags> = major === 2 ? { TT2: 'title', TP1: 'artist', TAL: 'album' } : { TIT2: 'title', TPE1: 'artist', TALB: 'album' }
  const idLen = major === 2 ? 3 : 4
  const hdr = major === 2 ? 6 : 10
  const out: SongTags = {}
  while (at + hdr <= end) {
    const id = ascii(b, at, idLen)
    if (!/^[A-Z0-9]+$/.test(id)) break
    const len = major === 2 ? (b[at + 3]! << 16) | (b[at + 4]! << 8) | b[at + 5]! : major === 4 ? syncsafe(b, at + 4) : u32(b, at + 4)
    const data = b.subarray(at + hdr, Math.min(end, at + hdr + len))
    const key = names[id]
    if (key && data.length > 1 && !out[key]) out[key] = id3Text(data)
    at += hdr + len
  }
  return clean(out)
}

export function parseId3v1(tail: Uint8Array): SongTags | null {
  if (tail.length < 128) return null
  const t = tail.subarray(tail.length - 128)
  if (ascii(t, 0, 3) !== 'TAG') return null
  return clean({ title: decodeLegacyText(t.subarray(3, 33)), artist: decodeLegacyText(t.subarray(33, 63)), album: decodeLegacyText(t.subarray(63, 93)) })
}

/** Vorbis comment block (FLAC block body, or the Ogg comment packet after "\x03vorbis"). */
function vorbisComments(b: Uint8Array, at: number): SongTags | null {
  const le32 = (i: number) => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0
  if (at + 8 > b.length) return null
  const vendor = le32(at)
  let p = at + 4 + vendor
  if (p + 4 > b.length) return null
  const n = le32(p)
  p += 4
  const out: SongTags = {}
  for (let i = 0; i < n && p + 4 <= b.length; i++) {
    const len = le32(p)
    const s = utf8(b.subarray(p + 4, Math.min(b.length, p + 4 + len)))
    p += 4 + len
    const eq = s.indexOf('=')
    if (eq < 0) continue
    const k = s.slice(0, eq).toUpperCase()
    const v = s.slice(eq + 1)
    if (k === 'TITLE' && !out.title) out.title = v
    else if (k === 'ARTIST' && !out.artist) out.artist = v
    else if (k === 'ALBUM' && !out.album) out.album = v
  }
  return clean(out)
}

export function parseFlac(b: Uint8Array): SongTags | null {
  if (b.length < 8 || ascii(b, 0, 4) !== 'fLaC') return null
  let at = 4
  while (at + 4 <= b.length) {
    const last = b[at]! & 0x80
    const type = b[at]! & 0x7f
    const len = (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!
    if (type === 4) return vorbisComments(b, at + 4)
    if (last) break
    at += 4 + len
  }
  return null
}

export function parseOgg(b: Uint8Array): SongTags | null {
  if (b.length < 4 || ascii(b, 0, 4) !== 'OggS') return null
  for (const marker of ['\x03vorbis', 'OpusTags']) {
    const m = Array.from(marker, (c) => c.charCodeAt(0))
    for (let i = 0; i + m.length < b.length; i++) {
      let ok = true
      for (let j = 0; j < m.length && ok; j++) ok = b[i + j] === m[j]
      if (ok) return vorbisComments(b, i + m.length)
    }
  }
  return null
}

/** MP4 / M4A: moov › udta › meta › ilst › ©nam / ©ART / ©alb › data. Searches any bytes given (head or tail). */
export function parseMp4(b: Uint8Array): SongTags | null {
  const out: SongTags = {}
  const keys: Record<string, keyof SongTags> = { '©nam': 'title', '©ART': 'artist', aART: 'artist', '©alb': 'album' }
  // Find 'ilst' anywhere (the tail of a file may start mid-atom).
  const find = (name: string, from = 0) => {
    for (let i = from + 4; i + 4 <= b.length; i++) if (b[i] === name.charCodeAt(0) && ascii(b, i, 4) === name) return i - 4
    return -1
  }
  const ilst = find('ilst')
  if (ilst < 0) return null
  const end = Math.min(b.length, ilst + u32(b, ilst))
  let at = ilst + 8
  while (at + 8 <= end) {
    const size = u32(b, at)
    if (size < 8) break
    const name = String.fromCharCode(b[at + 4]!, b[at + 5]!, b[at + 6]!, b[at + 7]!)
    const key = keys[name]
    if (key && !out[key]) {
      const d = at + 8
      if (ascii(b, d + 4, 4) === 'data') out[key] = utf8(b.subarray(d + 16, Math.min(end, d + u32(b, d))))
    }
    at += size
  }
  return clean(out)
}

/** Tags from a file's head and tail bytes, whatever the format. */
export function parseTags(head: Uint8Array, tail: Uint8Array): SongTags | null {
  return parseId3v2(head) ?? parseFlac(head) ?? parseOgg(head) ?? (ascii(head, 4, 4) === 'ftyp' ? (parseMp4(head) ?? parseMp4(tail)) : null) ?? parseId3v1(tail)
}
