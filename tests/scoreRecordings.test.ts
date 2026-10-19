// @vitest-environment node
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RecordingInfo } from '../src/songs/scoreServerTypes'
import {
  MAX_PER_SONG,
  MAX_RECORDINGS,
  RecordingError,
  RecordingStore,
  detectAudioType,
  parseRecordingQuery,
  readRecordingBody,
  serveRecording,
} from '../server/recordings'

const ID3 = Buffer.concat([
  Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00', 'latin1'),
  Buffer.alloc(64, 7),
])
const MP3_SYNC = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(64, 7)])
const M4A = Buffer.concat([
  Buffer.from([0, 0, 0, 0x20]),
  Buffer.from('ftypM4A ', 'latin1'),
  Buffer.alloc(32),
])
const WAV = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from('WAVE'),
  Buffer.alloc(32),
])
const OGG = Buffer.concat([Buffer.from('OggS', 'latin1'), Buffer.alloc(32)])
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(32)])
const FLAC = Buffer.concat([Buffer.from('fLaC', 'latin1'), Buffer.alloc(32)])
const NOW = 1_700_000_000_000

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recordings-test-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('audio type detection', () => {
  it('recognises MP3 (ID3 or frame sync), M4A, WAV, OGG, WebM and FLAC', () => {
    expect(detectAudioType(ID3)).toEqual({ ext: 'mp3', type: 'audio/mpeg' })
    expect(detectAudioType(MP3_SYNC)).toEqual({ ext: 'mp3', type: 'audio/mpeg' })
    expect(detectAudioType(M4A)).toEqual({ ext: 'm4a', type: 'audio/mp4' })
    expect(detectAudioType(WAV)).toEqual({ ext: 'wav', type: 'audio/wav' })
    expect(detectAudioType(OGG)).toEqual({ ext: 'ogg', type: 'audio/ogg' })
    expect(detectAudioType(WEBM)).toEqual({ ext: 'webm', type: 'audio/webm' })
    expect(detectAudioType(FLAC)).toEqual({ ext: 'flac', type: 'audio/flac' })
  })

  it('rejects HTML, images, PDF and empty content', () => {
    expect(detectAudioType(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull()
    expect(
      detectAudioType(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)])),
    ).toBeNull()
    expect(
      detectAudioType(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(32)])),
    ).toBeNull()
    expect(detectAudioType(Buffer.from('%PDF-1.4\n'))).toBeNull()
    expect(
      detectAudioType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])),
    ).toBeNull()
    expect(detectAudioType(Buffer.alloc(0))).toBeNull()
  })
})

describe('parseRecordingQuery', () => {
  it('reads songId, label and name', () => {
    const r = parseRecordingQuery(
      new URL('http://x/api/recordings/upload?songId=abc&label=%E4%B8%BB%E5%94%B1&name=a.mp3'),
    )
    expect(r).toEqual({ ok: true, value: { songId: 'abc', label: '主唱', name: 'a.mp3' } })
  })

  it('defaults label and name to empty, and rejects a missing or overlong songId and an overlong label', () => {
    expect(parseRecordingQuery(new URL('http://x/api/recordings/upload?songId=abc'))).toEqual({
      ok: true,
      value: { songId: 'abc', label: '', name: '' },
    })
    expect(parseRecordingQuery(new URL('http://x/api/recordings/upload')).ok).toBe(false)
    expect(
      parseRecordingQuery(new URL(`http://x/api/recordings/upload?songId=${'x'.repeat(65)}`)).ok,
    ).toBe(false)
    expect(
      parseRecordingQuery(
        new URL(`http://x/api/recordings/upload?songId=a&label=${'x'.repeat(61)}`),
      ).ok,
    ).toBe(false)
  })
})

describe('readRecordingBody', () => {
  it('collects the body within the limit', async () => {
    const stream = Readable.from([Buffer.alloc(10, 1), Buffer.alloc(10, 2)])
    const body = await readRecordingBody(stream as unknown as http.IncomingMessage, 100)
    expect(body.length).toBe(20)
    expect(body[19]).toBe(2)
  })

  it('rejects with 413 once over the limit and stops the request', async () => {
    const stream = Readable.from([Buffer.alloc(10), Buffer.alloc(10), Buffer.alloc(10)])
    const err = await readRecordingBody(stream as unknown as http.IncomingMessage, 15).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(RecordingError)
    expect((err as RecordingError).status).toBe(413)
    expect((err as RecordingError).message).toBe('录音太大了（最多 300 MB）。')
    expect(stream.destroyed).toBe(true)
  })
})

describe('RecordingStore', () => {
  it('stores a recording with its label, sanitized name, MIME type and a 16-hex id', async () => {
    const store = await RecordingStore.load(dir)
    const rec = await store.add(
      's1',
      { label: '  10 月 19 日排练  ', fileName: '..\\..\\evil/../a?b.mp3' },
      ID3,
      'u1',
      NOW,
    )
    expect(rec.id).toMatch(/^[0-9a-f]{16}$/)
    expect(rec.label).toBe('10 月 19 日排练')
    expect(rec.fileName).toBe('ab.mp3')
    expect(rec.type).toBe('audio/mpeg')
    expect(rec.size).toBe(ID3.length)
    expect(rec.uploadedBy).toBe('u1')
    expect(rec.songId).toBe('s1')
    const file = store.filePath(rec)
    expect(path.dirname(file)).toBe(path.join(dir, 'recordings'))
    expect(fs.readFileSync(file).equals(ID3)).toBe(true)
  })

  it('uses the default label and a fallback name when none are given', async () => {
    const store = await RecordingStore.load(dir)
    const rec = await store.add('s1', { label: '   ', fileName: '' }, WAV, 'u1', NOW)
    expect(rec.label).toBe('排练录音')
    expect(rec.fileName).toBe('排练录音.wav')
    expect(rec.type).toBe('audio/wav')
  })

  it('refuses a non-audio file and stores nothing', async () => {
    const store = await RecordingStore.load(dir)
    const html = Buffer.from('<html><body>hi</body></html>')
    const err = await store
      .add('s1', { label: '', fileName: 'x.mp3' }, html, 'u1', NOW)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RecordingError)
    expect((err as RecordingError).status).toBe(400)
    expect(store.list('s1')).toEqual([])
  })

  it('lists a song newest first and keeps other songs apart', async () => {
    const store = await RecordingStore.load(dir)
    const a = await store.add('s1', { label: 'A', fileName: 'a.mp3' }, ID3, 'u1', NOW)
    const b = await store.add('s1', { label: 'B', fileName: 'b.ogg' }, OGG, 'u2', NOW + 5)
    await store.add('s2', { label: 'C', fileName: 'c.flac' }, FLAC, 'u1', NOW + 9)
    expect(store.list('s1').map((r) => r.id)).toEqual([b.id, a.id])
    expect(store.list('s2').map((r) => r.label)).toEqual(['C'])
    expect(store.get(a.id)?.label).toBe('A')
    expect(store.get('ffffffffffffffff')).toBeUndefined()
  })

  it('remove deletes the file as well as the metadata', async () => {
    const store = await RecordingStore.load(dir)
    const a = await store.add('s1', { label: 'A', fileName: 'a.mp3' }, ID3, 'u1', NOW)
    const file = store.filePath(a)
    await store.remove(a.id)
    expect(fs.existsSync(file)).toBe(false)
    expect(store.get(a.id)).toBeUndefined()
    await expect(store.remove(a.id)).rejects.toThrow(RecordingError)
  })

  it('removeSong removes only that song’s recordings and their files', async () => {
    const store = await RecordingStore.load(dir)
    const a = await store.add('s1', { label: 'A', fileName: 'a.mp3' }, ID3, 'u1', NOW)
    const b = await store.add('s1', { label: 'B', fileName: 'b.wav' }, WAV, 'u1', NOW)
    const c = await store.add('s2', { label: 'C', fileName: 'c.webm' }, WEBM, 'u1', NOW)
    const fileA = store.filePath(a)
    await store.removeSong('s1')
    expect(store.list('s1')).toEqual([])
    expect(fs.existsSync(fileA)).toBe(false)
    expect(fs.existsSync(store.filePath(c))).toBe(true)
    expect(store.get(b.id)).toBeUndefined()
    await store.removeSong('nothing')
    expect(store.list('s2')).toHaveLength(1)
  })

  it('caps a song at MAX_PER_SONG recordings, but other songs are unaffected', async () => {
    const store = await RecordingStore.load(dir)
    for (let i = 0; i < MAX_PER_SONG; i++)
      await store.add('s1', { label: `${i}`, fileName: 'p.mp3' }, ID3, 'u1', NOW + i)
    await expect(
      store.add('s1', { label: 'x', fileName: 'p.mp3' }, ID3, 'u1', NOW),
    ).rejects.toThrow(/200/)
    await store.add('s2', { label: 'x', fileName: 'p.mp3' }, ID3, 'u1', NOW)
    expect(store.list('s1')).toHaveLength(MAX_PER_SONG)
    expect(store.list('s2')).toHaveLength(1)
  })

  it('drops the oldest recordings with their files when the store is full', async () => {
    fs.mkdirSync(path.join(dir, 'recordings'), { recursive: true })
    const items = []
    for (let i = 0; i < MAX_RECORDINGS; i++) {
      const id = i.toString(16).padStart(16, '0')
      fs.writeFileSync(path.join(dir, 'recordings', `${id}.mp3`), ID3)
      items.push({
        id,
        songId: `s${i % 30}`,
        label: `r${i}`,
        fileName: 'x.mp3',
        size: ID3.length,
        uploadedBy: 'u1',
        uploadedAt: i,
        ext: 'mp3',
      })
    }
    fs.writeFileSync(path.join(dir, 'recordings.json'), JSON.stringify({ version: 1, items }))

    const store = await RecordingStore.load(dir)
    expect(store.list('s0')).toHaveLength(MAX_RECORDINGS / 30)
    await store.add('fresh', { label: 'new', fileName: 'n.mp3' }, ID3, 'u1', NOW + 10_000)
    expect(store.list('s0')).toHaveLength(MAX_RECORDINGS / 30 - 1)
    expect(fs.existsSync(path.join(dir, 'recordings', `${'0'.repeat(16)}.mp3`))).toBe(false)
    expect(store.list('fresh')).toHaveLength(1)
  })

  it('persists across loads and drops metadata whose file is missing', async () => {
    const store = await RecordingStore.load(dir)
    const a = await store.add('s1', { label: 'A', fileName: 'a.mp3' }, ID3, 'u1', NOW)
    const b = await store.add('s1', { label: 'B', fileName: 'b.flac' }, FLAC, 'u2', NOW + 1)

    const reloaded = await RecordingStore.load(dir)
    expect(reloaded.list('s1')).toEqual([b, a])

    fs.rmSync(reloaded.filePath(b))
    const again = await RecordingStore.load(dir)
    expect(again.list('s1')).toEqual([a])
  })

  it('sets a damaged recordings.json aside and starts empty', async () => {
    fs.writeFileSync(path.join(dir, 'recordings.json'), '{not json')
    const store = await RecordingStore.load(dir)
    expect(store.list('s1')).toEqual([])
    const left = fs.readdirSync(dir).filter((n) => n.startsWith('recordings.json.broken-'))
    expect(left).toHaveLength(1)
  })
})

describe('serveRecording', () => {
  const body = Buffer.concat([ID3, Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz')])
  const rec: RecordingInfo = {
    id: '0123456789abcdef',
    songId: 's1',
    label: '排练',
    fileName: '排练.mp3',
    size: body.length,
    type: 'audio/mpeg',
    uploadedBy: 'u1',
    uploadedAt: NOW,
  }

  async function withServer(run: (base: string) => Promise<void>): Promise<void> {
    const file = path.join(dir, 'clip.mp3')
    fs.writeFileSync(file, body)
    const server = http.createServer((req, res) => {
      void serveRecording(req, res, file, rec)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    try {
      await run(`http://127.0.0.1:${port}`)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }

  it('serves the whole file with audio headers', async () => {
    await withServer(async (base) => {
      const res = await fetch(base)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('audio/mpeg')
      expect(res.headers.get('accept-ranges')).toBe('bytes')
      expect(res.headers.get('cache-control')).toBe('private, max-age=86400')
      expect(res.headers.get('content-disposition')).toContain("inline; filename*=UTF-8''")
      expect(Buffer.from(await res.arrayBuffer()).equals(body)).toBe(true)
    })
  })

  it('answers a bytes=a-b range with 206', async () => {
    await withServer(async (base) => {
      const res = await fetch(base, { headers: { Range: 'bytes=2-5' } })
      expect(res.status).toBe(206)
      expect(res.headers.get('content-range')).toBe(`bytes 2-5/${body.length}`)
      expect(Buffer.from(await res.arrayBuffer()).equals(body.subarray(2, 6))).toBe(true)
    })
  })

  it('answers bytes=a- and bytes=-n ranges', async () => {
    await withServer(async (base) => {
      const open = await fetch(base, { headers: { Range: 'bytes=10-' } })
      expect(open.status).toBe(206)
      expect(Buffer.from(await open.arrayBuffer()).equals(body.subarray(10))).toBe(true)

      const suffix = await fetch(base, { headers: { Range: 'bytes=-4' } })
      expect(suffix.status).toBe(206)
      expect(suffix.headers.get('content-range')).toBe(
        `bytes ${body.length - 4}-${body.length - 1}/${body.length}`,
      )
      expect(Buffer.from(await suffix.arrayBuffer()).equals(body.subarray(-4))).toBe(true)
    })
  })

  it('answers an unsatisfiable range with 416', async () => {
    await withServer(async (base) => {
      const res = await fetch(base, { headers: { Range: `bytes=${body.length + 100}-` } })
      expect(res.status).toBe(416)
      expect(res.headers.get('content-range')).toBe(`bytes */${body.length}`)
    })
  })

  it('answers HEAD with the headers and no body', async () => {
    await withServer(async (base) => {
      const res = await fetch(base, { method: 'HEAD' })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-length')).toBe(String(body.length))
      expect(res.headers.get('content-type')).toBe('audio/mpeg')
      expect((await res.arrayBuffer()).byteLength).toBe(0)
    })
  })
})
