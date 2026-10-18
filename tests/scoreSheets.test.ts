import fs from 'node:fs'
import type http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ScoreArtist, ScoreSong, ScoreVersion } from '../src/songs/scoreLibraryTypes'
import type { ScoreLibraryData } from '../src/songs/scoreLibrary'
import type { LoadedLibrary } from '../server/library'
import {
  MAX_SHEET_BYTES,
  MAX_SHEETS_PER_SONG,
  SheetError,
  SheetStore,
  canEditSheet,
  cleanFileName,
  detectSheetType,
  parseUploadQuery,
  readUploadBody,
  sheetContentType,
} from '../server/sheets'
import { buildSongIndex, songInfo } from '../server/songs'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(32)])
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(32)])
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(32)])
const NOW = 1_700_000_000_000

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheets-test-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('magic-byte detection', () => {
  it('accepts PNG, JPEG, WebP, GIF and PDF by their first bytes', () => {
    expect(detectSheetType(PNG)).toEqual({ kind: 'image', ext: 'png' })
    expect(detectSheetType(JPG)).toEqual({ kind: 'image', ext: 'jpg' })
    expect(detectSheetType(WEBP)).toEqual({ kind: 'image', ext: 'webp' })
    expect(detectSheetType(GIF)).toEqual({ kind: 'image', ext: 'gif' })
    expect(detectSheetType(PDF)).toEqual({ kind: 'pdf', ext: 'pdf' })
  })

  it('rejects HTML, SVG, EXE and WAV content, whatever the name says', () => {
    expect(detectSheetType(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull()
    expect(detectSheetType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull()
    expect(detectSheetType(Buffer.from('MZ\x90\x00\x03\x00', 'latin1'))).toBeNull()
    expect(detectSheetType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]))).toBeNull()
    expect(detectSheetType(Buffer.alloc(0))).toBeNull()
  })

  it('rejects an HTML file named like an image when stored', async () => {
    const store = await SheetStore.load(dir)
    const html = Buffer.from('<html><body>hi</body></html>')
    await expect(store.add('s1', { label: '', fileName: 'x.png' }, html, 'u1', NOW)).rejects.toThrow(SheetError)
    expect(store.list('s1')).toEqual([])
  })
})

describe('SheetStore', () => {
  it('stores an upload with its label, sanitized name and a 16-hex id', async () => {
    const store = await SheetStore.load(dir)
    const item = await store.add('s1', { label: '  主唱简谱  ', fileName: '..\\..\\evil/../a?b.png' }, PNG, 'u1', NOW)
    expect(item.id).toMatch(/^[0-9a-f]{16}$/)
    expect(item.label).toBe('主唱简谱')
    expect(item.fileName).toBe('ab.png')
    expect(item.kind).toBe('image')
    expect(item.size).toBe(PNG.length)
    expect(item.order).toBe(0)
    expect(fs.existsSync(store.filePath(item))).toBe(true)
    expect(path.dirname(store.filePath(item))).toBe(path.join(dir, 'sheets'))
  })

  it('uses the default label and a fallback name when none are given', async () => {
    const store = await SheetStore.load(dir)
    const item = await store.add('s1', { label: '   ', fileName: '' }, PDF, 'u1', NOW)
    expect(item.label).toBe('简谱')
    expect(item.kind).toBe('pdf')
    expect(item.fileName).toBe('简谱.pdf')
  })

  it('refuses a file over 20 MB with status 413', async () => {
    const store = await SheetStore.load(dir)
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_SHEET_BYTES)])
    const err = await store.add('s1', { label: '', fileName: 'big.png' }, big, 'u1', NOW).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SheetError)
    expect((err as SheetError).status).toBe(413)
    expect(store.list('s1')).toEqual([])
  })

  it('caps a song at 60 files, but other songs are unaffected', async () => {
    const store = await SheetStore.load(dir)
    for (let i = 0; i < MAX_SHEETS_PER_SONG; i++) await store.add('s1', { label: `${i}`, fileName: 'p.png' }, PNG, 'u1', NOW)
    await expect(store.add('s1', { label: 'x', fileName: 'p.png' }, PNG, 'u1', NOW)).rejects.toThrow(/60/)
    await store.add('s2', { label: 'x', fileName: 'p.png' }, PNG, 'u1', NOW)
    expect(store.list('s1')).toHaveLength(MAX_SHEETS_PER_SONG)
    expect(store.list('s2')).toHaveLength(1)
  })

  it('lists a song in page order and reorders only with a permutation', async () => {
    const store = await SheetStore.load(dir)
    const a = await store.add('s1', { label: 'A', fileName: 'a.png' }, PNG, 'u1', NOW)
    const b = await store.add('s1', { label: 'B', fileName: 'b.jpg' }, JPG, 'u1', NOW + 1)
    const c = await store.add('s1', { label: 'C', fileName: 'c.pdf' }, PDF, 'u1', NOW + 2)
    expect(store.list('s1').map((x) => x.id)).toEqual([a.id, b.id, c.id])

    await store.reorder('s1', [c.id, a.id, b.id])
    expect(store.list('s1').map((x) => x.label)).toEqual(['C', 'A', 'B'])
    expect(store.list('s1').map((x) => x.order)).toEqual([0, 1, 2])

    await expect(store.reorder('s1', [a.id, b.id])).rejects.toThrow(SheetError)
    await expect(store.reorder('s1', [a.id, a.id, b.id])).rejects.toThrow(SheetError)
    await expect(store.reorder('s1', [a.id, b.id, 'ffffffffffffffff'])).rejects.toThrow(SheetError)
    expect(store.list('s1').map((x) => x.label)).toEqual(['C', 'A', 'B'])
  })

  it('remove deletes the file as well as the metadata', async () => {
    const store = await SheetStore.load(dir)
    const a = await store.add('s1', { label: 'A', fileName: 'a.png' }, PNG, 'u1', NOW)
    const file = store.filePath(a)
    expect(fs.existsSync(file)).toBe(true)
    await store.remove(a.id)
    expect(fs.existsSync(file)).toBe(false)
    expect(store.get(a.id)).toBeUndefined()
    await expect(store.remove(a.id)).rejects.toThrow(SheetError)
  })

  it('persists across loads and drops metadata whose file is missing', async () => {
    const store = await SheetStore.load(dir)
    const a = await store.add('s1', { label: 'A', fileName: 'a.png' }, PNG, 'u1', NOW)
    const b = await store.add('s1', { label: 'B', fileName: 'b.gif' }, GIF, 'u1', NOW)
    await store.reorder('s1', [b.id, a.id])

    const reloaded = await SheetStore.load(dir)
    expect(reloaded.list('s1').map((x) => x.label)).toEqual(['B', 'A'])

    fs.rmSync(reloaded.filePath(b))
    const again = await SheetStore.load(dir)
    expect(again.list('s1').map((x) => x.label)).toEqual(['A'])
    expect(again.list('s1')[0].order).toBe(0)
  })

  it('ignores orphan files on disk that have no metadata', async () => {
    fs.mkdirSync(path.join(dir, 'sheets'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'sheets', '0123456789abcdef.png'), PNG)
    const store = await SheetStore.load(dir)
    expect(store.list('s1')).toEqual([])
  })
})

describe('readUploadBody', () => {
  it('collects the body when it is within the limit', async () => {
    const stream = Readable.from([Buffer.alloc(10, 1), Buffer.alloc(10, 2)])
    const body = await readUploadBody(stream as unknown as http.IncomingMessage, 100)
    expect(body.length).toBe(20)
    expect(body[0]).toBe(1)
    expect(body[19]).toBe(2)
  })

  it('rejects with status 413 as soon as the limit is exceeded and stops the request', async () => {
    const stream = Readable.from([Buffer.alloc(10), Buffer.alloc(10), Buffer.alloc(10)])
    const err = await readUploadBody(stream as unknown as http.IncomingMessage, 15).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SheetError)
    expect((err as SheetError).status).toBe(413)
    expect((err as SheetError).message).toBe('文件太大了（最多 20 MB）。')
    expect(stream.destroyed).toBe(true)
  })
})

describe('parseUploadQuery', () => {
  it('requires a path and reads optional label and name', () => {
    const ok = parseUploadQuery(new URL('http://x/api/sheets/upload?path=a%2Fb.gp&label=%E4%B8%BB%E5%94%B1&name=s.png'))
    expect(ok).toEqual({ ok: true, value: { path: 'a/b.gp', label: '主唱', name: 's.png' } })
    const bare = parseUploadQuery(new URL('http://x/api/sheets/upload?path=a.gp'))
    expect(bare).toEqual({ ok: true, value: { path: 'a.gp', label: '', name: '' } })
  })

  it('rejects a missing path and an overlong label', () => {
    expect(parseUploadQuery(new URL('http://x/api/sheets/upload?label=x')).ok).toBe(false)
    const long = 'x'.repeat(41)
    expect(parseUploadQuery(new URL(`http://x/api/sheets/upload?path=a.gp&label=${long}`)).ok).toBe(false)
  })
})

describe('helpers', () => {
  it('sheetContentType maps the stored types', () => {
    expect(sheetContentType('image', 'png')).toBe('image/png')
    expect(sheetContentType('image', 'jpg')).toBe('image/jpeg')
    expect(sheetContentType('image', 'webp')).toBe('image/webp')
    expect(sheetContentType('image', 'gif')).toBe('image/gif')
    expect(sheetContentType('pdf', 'pdf')).toBe('application/pdf')
  })

  it('cleanFileName keeps only the last segment and drops reserved characters', () => {
    expect(cleanFileName('C:\\x\\y.png', 'png')).toBe('y.png')
    expect(cleanFileName('a<b>.png', 'png')).toBe('ab.png')
    expect(cleanFileName('x'.repeat(200), 'png')).toHaveLength(120)
  })

  it('canEditSheet allows the uploader and admins only', () => {
    const item = { uploadedBy: 'u1' } as Parameters<typeof canEditSheet>[0]
    expect(canEditSheet(item, { id: 'u1', role: 'member' })).toBe(true)
    expect(canEditSheet(item, { id: 'u2', role: 'admin' })).toBe(true)
    expect(canEditSheet(item, { id: 'u2', role: 'member' })).toBe(false)
  })
})

describe('songInfo', () => {
  const version = (p: string, format: ScoreVersion['file']['format'], label: string, tags: string[]): ScoreVersion => ({
    file: { path: p, size: 100, format, ext: p.split('.').pop() ?? '' },
    tags,
    label,
    size: 100,
  })

  const artist: ScoreArtist = {
    id: '1-华语/男歌手/周杰伦',
    name: '周杰伦',
    groupId: '1-华语/男歌手',
    files: 2,
    songs: 1,
    initial: 'Z',
  }
  const song: ScoreSong = {
    id: '1-华语/男歌手/周杰伦#七里香',
    title: '七里香',
    artistId: artist.id,
    versions: [
      version('1-华语/男歌手/周杰伦/七里香.gp4', 'score', '七里香.gp4', []),
      version('1-华语/男歌手/周杰伦/七里香 指弹.pdf', 'pdf', '七里香 指弹.pdf', ['指弹']),
      version('1-华语/男歌手/周杰伦/七里香 独奏.gp5', 'score', '七里香 独奏.gp5', ['独奏']),
    ],
  }
  const lib = {
    lib: {
      categories: [],
      artists: new Map(),
      artistById: new Map([[artist.id, artist]]),
      songs: new Map([[artist.id, [song]]]),
      files: 3,
    } as ScoreLibraryData,
    index: undefined,
    scannedAt: NOW,
    files: [],
  } as unknown as LoadedLibrary

  it('maps each version path to its song and the artist name', () => {
    const index = buildSongIndex(lib)
    expect(index.songOf('1-华语/男歌手/周杰伦/七里香.gp4')?.song).toBe(song)
    expect(index.songOf('1-华语/男歌手/周杰伦/七里香 指弹.pdf')?.artistName).toBe('周杰伦')
    expect(index.songOf('nope.gp')).toBeNull()
  })

  it('caches the index per library object', () => {
    expect(buildSongIndex(lib)).toBe(buildSongIndex(lib))
  })

  it('songInfo lists only the score-format versions, in library order', () => {
    const index = buildSongIndex(lib)
    const info = songInfo(index, '1-华语/男歌手/周杰伦/七里香 独奏.gp5')
    expect(info).toEqual({
      songKey: song.id,
      title: '七里香',
      artist: '周杰伦',
      versions: [
        { path: '1-华语/男歌手/周杰伦/七里香.gp4', label: '七里香.gp4', tags: [], size: 100 },
        { path: '1-华语/男歌手/周杰伦/七里香 独奏.gp5', label: '七里香 独奏.gp5', tags: ['独奏'], size: 100 },
      ],
    })
    expect(songInfo(index, 'missing.gp')).toBeNull()
  })
})
