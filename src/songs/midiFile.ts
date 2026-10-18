/**
 * Minimal Standard MIDI File (SMF) reader: format 0 and 1, running status, meta
 * events (tempo, time signature kept; the rest skipped), sysex skipped. Pure and
 * dependency-free so it runs in the browser, the score server and build scripts.
 *
 * Only note on / note off events are returned per track; note on with velocity 0
 * is reported as a note off. Anything malformed throws an Error with a clear message.
 */

export interface MidiNoteEvent {
  /** Absolute tick from the start of its track. */
  tick: number
  type: 'on' | 'off'
  /** 0–15. */
  channel: number
  /** MIDI key number 0–127. */
  key: number
  /** 0–127 (0 for note offs written as velocity 0). */
  vel: number
}

export interface MidiTempo {
  tick: number
  usPerQuarter: number
}

export interface MidiTimeSig {
  tick: number
  num: number
  den: number
}

export interface ParsedMidi {
  /** Ticks per quarter note. */
  ppq: number
  /** One entry per MTrk chunk, in file order. */
  tracks: MidiNoteEvent[][]
  /** Tempo changes from all tracks, in file order (usually all in track 0). */
  tempos: MidiTempo[]
  /** Time signature changes from all tracks, in file order. */
  timeSigs: MidiTimeSig[]
}

class ByteReader {
  pos = 0
  readonly bytes: Uint8Array
  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }

  private need(n: number, end: number, what: string): void {
    if (this.pos + n > end) throw new Error(`MIDI: unexpected end of data while reading ${what}`)
  }

  u8(end: number, what = 'byte'): number {
    this.need(1, end, what)
    return this.bytes[this.pos++]
  }

  u16(end: number, what = 'u16'): number {
    this.need(2, end, what)
    const v = (this.bytes[this.pos] << 8) | this.bytes[this.pos + 1]
    this.pos += 2
    return v
  }

  u32(end: number, what = 'u32'): number {
    this.need(4, end, what)
    const b = this.bytes
    const p = this.pos
    this.pos += 4
    return ((b[p] << 24) >>> 0) + ((b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3])
  }

  str(n: number, end: number): string {
    this.need(n, end, 'chunk id')
    let s = ''
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.bytes[this.pos + i])
    this.pos += n
    return s
  }

  skip(n: number, end: number): void {
    this.need(n, end, 'skipped data')
    this.pos += n
  }

  /** Variable-length quantity (1–4 bytes). */
  varLen(end: number): number {
    let value = 0
    for (let i = 0; i < 4; i++) {
      const b = this.u8(end, 'variable-length value')
      value = value * 128 + (b & 0x7f)
      if ((b & 0x80) === 0) return value
    }
    throw new Error('MIDI: variable-length value longer than 4 bytes')
  }
}

/** Parse a Standard MIDI File. Throws `Error` with a readable message on bad data. */
export function parseMidi(bytes: Uint8Array): ParsedMidi {
  if (bytes.length < 14) throw new Error('MIDI: file is too short to be a MIDI file')
  const r = new ByteReader(bytes)
  const fileEnd = bytes.length

  if (r.str(4, fileEnd) !== 'MThd') throw new Error('MIDI: missing MThd header (not a Standard MIDI File)')
  const headerLength = r.u32(fileEnd, 'header length')
  if (headerLength < 6) throw new Error(`MIDI: header length ${headerLength} is shorter than 6`)
  const format = r.u16(fileEnd, 'format')
  const trackCount = r.u16(fileEnd, 'track count')
  const division = r.u16(fileEnd, 'time division')
  if (headerLength > 6) r.skip(headerLength - 6, fileEnd)

  if (format !== 0 && format !== 1) throw new Error(`MIDI: unsupported format ${format} (only 0 and 1 are read)`)
  if (division & 0x8000) throw new Error('MIDI: SMPTE time division is not supported')
  if (division === 0) throw new Error('MIDI: time division is zero')
  if (format === 0 && trackCount !== 1) throw new Error(`MIDI: format 0 must have one track, found ${trackCount}`)

  const tracks: MidiNoteEvent[][] = []
  const tempos: MidiTempo[] = []
  const timeSigs: MidiTimeSig[] = []

  for (let t = 0; t < trackCount; t++) {
    // Skip unknown chunks until the next track chunk.
    let length = 0
    for (;;) {
      if (r.pos + 8 > fileEnd) throw new Error(`MIDI: expected track ${t + 1} of ${trackCount} but the file ends early`)
      const id = r.str(4, fileEnd)
      length = r.u32(fileEnd, 'chunk length')
      if (id === 'MTrk') break
      r.skip(length, fileEnd)
    }
    const end = r.pos + length
    if (end > fileEnd) throw new Error(`MIDI: track ${t + 1} claims ${length} bytes but the file is shorter (truncated?)`)

    const notes: MidiNoteEvent[] = []
    let tick = 0
    let running = 0
    let sawEnd = false
    while (r.pos < end && !sawEnd) {
      tick += r.varLen(end)
      let status = r.u8(end, 'event status')
      if (status & 0x80) {
        if (status < 0xf0) running = status
      } else {
        if (running === 0) throw new Error(`MIDI: track ${t + 1} uses running status before any status byte`)
        r.pos -= 1
        status = running
      }

      if (status === 0xff) {
        // Meta events leave the running status alone.
        const metaType = r.u8(end, 'meta type')
        const len = r.varLen(end)
        r.skip(len, end)
        const at = r.pos - len
        if (metaType === 0x2f) {
          sawEnd = true
        } else if (metaType === 0x51) {
          if (len !== 3) throw new Error(`MIDI: tempo event has length ${len}, expected 3`)
          const us = (bytes[at] << 16) | (bytes[at + 1] << 8) | bytes[at + 2]
          tempos.push({ tick, usPerQuarter: us })
        } else if (metaType === 0x58) {
          if (len < 2) throw new Error(`MIDI: time signature event has length ${len}, expected 4`)
          const num = bytes[at]
          const denPower = bytes[at + 1]
          if (num < 1) throw new Error('MIDI: time signature numerator is zero')
          if (denPower > 7) throw new Error(`MIDI: time signature denominator power ${denPower} is out of range`)
          timeSigs.push({ tick, num, den: 1 << denPower })
        }
        continue
      }

      if (status === 0xf0 || status === 0xf7) {
        running = 0
        const len = r.varLen(end)
        r.skip(len, end)
        continue
      }

      if (status >= 0xf0) {
        // System common / realtime messages: skip their data bytes.
        const dataBytes = status === 0xf2 ? 2 : status === 0xf1 || status === 0xf3 ? 1 : 0
        r.skip(dataBytes, end)
        continue
      }

      const kind = status & 0xf0
      const channel = status & 0x0f
      const dataLength = kind === 0xc0 || kind === 0xd0 ? 1 : 2
      const d1 = r.u8(end, 'event data')
      if (d1 & 0x80) throw new Error('MIDI: expected a data byte but found a status byte (corrupt event)')
      let d2 = 0
      if (dataLength === 2) {
        d2 = r.u8(end, 'event data')
        if (d2 & 0x80) throw new Error('MIDI: expected a data byte but found a status byte (corrupt event)')
      }
      if (kind === 0x90 && d2 > 0) {
        notes.push({ tick, type: 'on', channel, key: d1, vel: d2 })
      } else if (kind === 0x90 || kind === 0x80) {
        notes.push({ tick, type: 'off', channel, key: d1, vel: d2 })
      }
    }
    r.pos = end
    tracks.push(notes)
  }

  return { ppq: division, tracks, tempos, timeSigs }
}
