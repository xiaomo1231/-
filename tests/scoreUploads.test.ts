import fs from 'node:fs'
import type http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_FILES_PER_SONG,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_SONGS,
  UPLOADS_FILE,
  UploadError,
  UploadStore,
  detectUploadType,
  guessLabel,
  parseNewUploadSong,
  parseUploadQuery,
  readUploadBody,
} from '../server/uploads'

const gp = (version = 'v5.00') =>
  Buffer.concat([
    Buffer.from([30]),
    Buffer.from(`FICHIER GUITAR PRO ${version}`, 'latin1'),
    Buffer.alloc(40),
  ])
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)])
const GPX = Buffer.concat([Buffer.from('BCFZ'), Buffer.alloc(40)])
const MUSICXML = Buffer.from(
  '﻿<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n<score-partwise version="3.1"></score-partwise>',
  'utf8',
)
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
])
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)])
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from('WEBP'),
  Buffer.alloc(32),
])
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(32)])
const NOW = 1_700_000_000_000

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-test-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('detectUploadType', () => {
  it('recognises Guitar Pro 3, 4 and 5 by the version text', () => {
    expect(detectUploadType(gp('v3.00'), 'a.gp3')).toEqual({ kind: 'score', ext: 'gp3' })
    expect(detectUploadType(gp('v4.06'), 'a.gp4')).toEqual({ kind: 'score', ext: 'gp4' })
    expect(detectUploadType(gp('v5.00'), 'a.gp5')).toEqual({ kind: 'score', ext: 'gp5' })
    expect(detectUploadType(gp('v5.10'), 'noext')).toEqual({ kind: 'score', ext: 'gp5' })
  })

  it('recognises GPX, and tells ZIP containers apart by name', () => {
    expect(detectUploadType(GPX, 'a.gpx')).toEqual({ kind: 'score', ext: 'gpx' })
    expect(detectUploadType(ZIP, 'song.mxl')).toEqual({ kind: 'score', ext: 'mxl' })
    expect(detectUploadType(ZIP, 'SONG.MXL')).toEqual({ kind: 'score', ext: 'mxl' })
    expect(detectUploadType(ZIP, 'song.gp')).toEqual({ kind: 'score', ext: 'gp' })
    expect(detectUploadType(ZIP, 'song.zip')).toBeNull()
  })

  it('recognises MusicXML text with a BOM, and needs a score root', () => {
    expect(detectUploadType(MUSICXML, 'x.xml')).toEqual({ kind: 'score', ext: 'musicxml' })
    const timewise = Buffer.from(
      '<?xml version="1.0"?>\n<score-timewise version="3.0"></score-timewise>',
    )
    expect(detectUploadType(timewise, 'x.xml')).toEqual({ kind: 'score', ext: 'musicxml' })
    expect(detectUploadType(Buffer.from('<?xml version="1.0"?><svg></svg>'), 'x.xml')).toBeNull()
  })

  it('recognises PDF, PNG, JPEG and WebP', () => {
    expect(detectUploadType(PDF, 'a.pdf')).toEqual({ kind: 'pdf', ext: 'pdf' })
    expect(detectUploadType(PNG, 'a.png')).toEqual({ kind: 'image', ext: 'png' })
    expect(detectUploadType(JPG, 'a.jpg')).toEqual({ kind: 'image', ext: 'jpg' })
    expect(detectUploadType(WEBP, 'a.webp')).toEqual({ kind: 'image', ext: 'webp' })
  })

  it('rejects HTML, other binaries and empty content whatever the name says', () => {
    expect(
      detectUploadType(Buffer.from('<html><script>alert(1)</script></html>'), 'a.gp5'),
    ).toBeNull()
    expect(detectUploadType(Buffer.from('MZ\x90\x00', 'latin1'), 'a.pdf')).toBeNull()
    expect(detectUploadType(Buffer.alloc(0), 'a.png')).toBeNull()
  })
})

describe('guessLabel', () => {
  it('guesses the part from the file name', () => {
    expect(guessLabel('Bass line.gp5')).toBe('贝斯')
    expect(guessLabel('贝斯.gp')).toBe('贝斯')
    expect(guessLabel('drums.gp5')).toBe('鼓')
    expect(guessLabel('鼓谱.pdf')).toBe('鼓')
    expect(guessLabel('Piano.gp')).toBe('键盘')
    expect(guessLabel('synth pad.gp')).toBe('键盘')
    expect(guessLabel('主唱.pdf')).toBe('主唱')
    expect(guessLabel('vocal take.png')).toBe('主唱')
    expect(guessLabel('简谱.jpg')).toBe('主唱')
    expect(guessLabel('节奏吉他.gp5')).toBe('节奏吉他')
    expect(guessLabel('rhythm guitar.gp')).toBe('节奏吉他')
    expect(guessLabel('主音吉他.gp5')).toBe('主音吉他')
    expect(guessLabel('lead guitar.gp')).toBe('主音吉他')
    expect(guessLabel('solo.gp')).toBe('主音吉他')
    expect(guessLabel('吉他.gp5')).toBe('吉他')
    expect(guessLabel('GTR.gp')).toBe('吉他')
    expect(guessLabel('song.gp')).toBe('其他')
  })
})

describe('parseNewUploadSong', () => {
  it('trims the title and artist and accepts a null band song', () => {
    expect(parseNewUploadSong({ title: '  夜曲 ', artist: ' 周杰伦 ', bandSongId: null })).toEqual({
      ok: true,
      value: { title: '夜曲', artist: '周杰伦', bandSongId: null },
    })
    expect(parseNewUploadSong({ title: 'x', artist: '' })).toMatchObject({
      ok: true,
      value: { bandSongId: null },
    })
  })

  it('checks the title length in code points', () => {
    expect(parseNewUploadSong({ title: '  ', artist: '' })).toEqual({
      ok: false,
      error: '歌名要在 1–80 个字之间。',
    })
    expect(parseNewUploadSong({ title: '字'.repeat(80), artist: '' }).ok).toBe(true)
    expect(parseNewUploadSong({ title: '字'.repeat(81), artist: '' }).ok).toBe(false)
  })

  it('checks the artist and band song id', () => {
    expect(parseNewUploadSong({ title: 'x', artist: '歌'.repeat(81) }).ok).toBe(false)
    expect(parseNewUploadSong({ title: 'x', artist: 3 }).ok).toBe(false)
    expect(parseNewUploadSong({ title: 'x', artist: '', bandSongId: 'a'.repeat(65) }).ok).toBe(
      false,
    )
    expect(parseNewUploadSong({ title: 'x', artist: '', bandSongId: 7 }).ok).toBe(false)
    expect(parseNewUploadSong(null).ok).toBe(false)
  })
})

describe('parseUploadQuery', () => {
  const url = (q: string) => new URL(`http://x/api/uploads/file?${q}`)

  it('accepts a 12-hex song id and defaults the label', () => {
    expect(parseUploadQuery(url('id=0123456789ab&label=%20%20&name=a.gp5'))).toEqual({
      ok: true,
      value: { id: '0123456789ab', label: '其他', name: 'a.gp5' },
    })
    expect(parseUploadQuery(url('id=0123456789ab&label=%20贝斯%20'))).toMatchObject({
      ok: true,
      value: { label: '贝斯' },
    })
  })

  it('refuses a bad id, a long label and a long name', () => {
    expect(parseUploadQuery(url('label=x')).ok).toBe(false)
    expect(parseUploadQuery(url('id=0123456789AB')).ok).toBe(false)
    expect(parseUploadQuery(url('id=0123456789ab&label=' + '字'.repeat(21))).ok).toBe(false)
    expect(parseUploadQuery(url('id=0123456789ab&name=' + 'a'.repeat(201))).ok).toBe(false)
  })
})

describe('readUploadBody', () => {
  it('collects the body', async () => {
    const req = Readable.from([
      Buffer.from('abc'),
      Buffer.from('def'),
    ]) as unknown as http.IncomingMessage
    expect((await readUploadBody(req, 100)).toString()).toBe('abcdef')
  })

  it('rejects with status 413 past the limit', async () => {
    const req = Readable.from([Buffer.alloc(20)]) as unknown as http.IncomingMessage
    const err = await readUploadBody(req, 10).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UploadError)
    expect((err as UploadError).status).toBe(413)
  })
})

describe('UploadStore', () => {
  it('creates a song with a 12-hex id and lists it', async () => {
    const store = await UploadStore.load(dir)
    const song = await store.create({ title: '夜曲', artist: '周杰伦' }, 'u1', NOW)
    expect(song.id).toMatch(/^[0-9a-f]{12}$/)
    expect(song).toMatchObject({ title: '夜曲', artist: '周杰伦', files: [], createdBy: 'u1' })
    expect(store.get(song.id)?.title).toBe('夜曲')
    expect(store.get('ffffffffffff')).toBeUndefined()
    expect(store.list().map((s) => s.id)).toEqual([song.id])
  })

  it('lists newest update first', async () => {
    const store = await UploadStore.load(dir)
    const a = await store.create({ title: 'A', artist: '' }, 'u1', NOW)
    const b = await store.create({ title: 'B', artist: '' }, 'u1', NOW + 1)
    expect(store.list().map((s) => s.id)).toEqual([b.id, a.id])
    await store.update(a.id, { title: 'A2', artist: '' }, NOW + 5)
    expect(store.list().map((s) => s.title)).toEqual(['A2', 'B'])
  })

  it('caps the number of songs', async () => {
    const store = await UploadStore.load(dir)
    for (let i = 0; i < MAX_UPLOAD_SONGS; i++)
      await store.create({ title: `${i}`, artist: '' }, 'u1', NOW)
    const err = await store.create({ title: 'x', artist: '' }, 'u1', NOW).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UploadError)
    expect((err as UploadError).status).toBe(409)
    expect((err as UploadError).message).toBe('上传的歌太多了，请先删掉一些。')
  }, 60_000)

  it('adds a file with its detected type, a cleaned name and a label', async () => {
    const store = await UploadStore.load(dir)
    const song = await store.create({ title: '夜曲', artist: '' }, 'u1', NOW)
    const after = await store.addFile(
      song.id,
      { label: '  贝斯  ', name: '..\\evil/bass?.gp5' },
      gp(),
      'u2',
      NOW + 1,
    )
    expect(after.files).toHaveLength(1)
    const file = after.files[0]!
    expect(file).toMatchObject({
      label: '贝斯',
      kind: 'score',
      ext: 'gp5',
      uploadedBy: 'u2',
      name: 'bass.gp5',
    })
    expect(file.id).toMatch(/^[0-9a-f]{12}$/)
    expect(file.path).toBe(`~uploads/${song.id}/${file.id}.gp5`)
    expect(fs.existsSync(path.join(dir, 'uploads', song.id, `${file.id}.gp5`))).toBe(true)
    expect(after.updatedAt).toBe(NOW + 1)
  })

  it('uses the default label and a fallback name when none are given', async () => {
    const store = await UploadStore.load(dir)
    const song = await store.create({ title: 'x', artist: '' }, 'u1', NOW)
    const after = await store.addFile(song.id, { label: '  ', name: '' }, PDF, 'u1', NOW)
    expect(after.files[0]).toMatchObject({
      label: '其他',
      kind: 'pdf',
      ext: 'pdf',
      name: '乐谱.pdf',
    })
  })

  it('refuses unknown types without writing anything', async () => {
    const store = await UploadStore.load(dir)
    const song = await store.create({ title: 'x', artist: '' }, 'u1', NOW)
    const html = Buffer.from('<html><body>hi</body></html>')
    const err = await store
      .addFile(song.id, { label: '', name: 'a.gp5' }, html, 'u1', NOW)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UploadError)
    expect((err as UploadError).status).toBe(400)
    expect(store.get(song.id)?.files).toEqual([])
    expect(fs.existsSync(path.join(dir, 'uploads', song.id))).toBe(false)
  })

  it('refuses files over 50 MB with status 413', async () => {
    const store = await UploadStore.load(dir)
    const song = await store.create({ title: 'x', artist: '' }, 'u1', NOW)
    const big = Buffer.concat([gp(), Buffer.alloc(MAX_UPLOAD_BYTES)])
    const err = await store
      .addFile(song.id, { label: '', name: 'big.gp5' }, big, 'u1', NOW)
      .catch((e: unknown) => e)
    expect((err as UploadError).status).toBe(413)
    expect((err as UploadError).message).toBe('文件太大了（最多 50 MB）。')
  })

  it('caps a song at 30 files, but other songs are unaffected', async () => {
    const store = await UploadStore.load(dir)
    const a = await store.create({ title: 'a', artist: '' }, 'u1', NOW)
    const b = await store.create({ title: 'b', artist: '' }, 'u1', NOW)
    for (let i = 0; i < MAX_FILES_PER_SONG; i++)
      await store.addFile(a.id, { label: '', name: 'p.png' }, PNG, 'u1', NOW)
    const err = await store
      .addFile(a.id, { label: '', name: 'p.png' }, PNG, 'u1', NOW)
      .catch((e: unknown) => e)
    expect((err as UploadError).status).toBe(409)
    expect((err as UploadError).message).toBe('每首歌最多 30 个文件。')
    await store.addFile(b.id, { label: '', name: 'p.png' }, PNG, 'u1', NOW)
    expect(store.get(a.id)?.files).toHaveLength(MAX_FILES_PER_SONG)
    expect(store.get(b.id)?.files).toHaveLength(1)
  })

  it('returns 404 for an unknown song or file', async () => {
    const store = await UploadStore.load(dir)
    const song = await store.create({ title: 'x', artist: '' }, 'u1', NOW)
    const status = (e: unknown) => (e as UploadError).status
    expect(
      status(
        await store
          .addFile('ffffffffffff', { label: '', name: 'a.gp5' }, gp(), 'u1', NOW)
          .catch((e) => e),
      ),
    ).toBe(404)
    expect(
      (
        (await store
          .update('ffffffffffff', { title: 'x', artist: '' }, NOW)
          .catch((e) => e)) as UploadError
      ).message,
    ).toBe('找不到这首上传的歌。')
    expect(status(await store.relabel(song.id, 'ffffffffffff', 'x', NOW).catch((e) => e))).toBe(404)
    const bad = (await store
      .removeFile(song.id, 'ffffffffffff', NOW)
      .catch((e: unknown) => e)) as UploadError
    expect(bad.message).toBe('找不到这个文件。')
    expect(status(await store.remove('ffffffffffff').catch((e) => e))).toBe(404)
  })

  it('relabels and removes one file, deleting its bytes', async () => {
    const store = await UploadStore.load(dir)
    const song = await store.create({ title: 'x', artist: '' }, 'u1', NOW)
    const s1 = await store.addFile(song.id, { label: '', name: 'a.gp5' }, gp(), 'u1', NOW)
    const s2 = await store.addFile(song.id, { label: '', name: 'b.png' }, PNG, 'u1', NOW)
    const f1 = s2.files[0]!
    const f2 = s2.files[1]!
    expect(s1.files).toHaveLength(1)

    const relabeled = await store.relabel(song.id, f2.id, '  鼓  ', NOW + 2)
    expect(relabeled.files.map((f) => f.label)).toEqual(['其他', '鼓'])

    const f1Path = store.filePath(song.id, f1)
    const after = await store.removeFile(song.id, f1.id, NOW + 3)
    expect(after.files.map((f) => f.id)).toEqual([f2.id])
    expect(fs.existsSync(f1Path)).toBe(false)
    expect(store.get(song.id)?.files).toHaveLength(1)
  })

  it('removes a whole song with its folder', async () => {
    const store = await UploadStore.load(dir)
    const song = await store.create({ title: 'x', artist: '' }, 'u1', NOW)
    await store.addFile(song.id, { label: '', name: 'a.gp5' }, gp(), 'u1', NOW)
    const folder = path.join(dir, 'uploads', song.id)
    expect(fs.existsSync(folder)).toBe(true)
    await store.remove(song.id)
    expect(fs.existsSync(folder)).toBe(false)
    expect(store.get(song.id)).toBeUndefined()
  })

  it('resolves only well-formed, listed upload paths whose bytes exist', async () => {
    const store = await UploadStore.load(dir)
    const song = await store.create({ title: 'x', artist: '' }, 'u1', NOW)
    const after = await store.addFile(song.id, { label: '', name: 'a.gp5' }, gp(), 'u1', NOW)
    const file = after.files[0]!
    const abs = await store.resolve(file.path)
    expect(abs).toBe(store.filePath(song.id, file))
    expect(path.isAbsolute(abs ?? '')).toBe(true)

    expect(await store.resolve(`~uploads/${song.id}/ffffffffffff.gp5`)).toBeNull()
    expect(await store.resolve(`~uploads/${song.id}/${file.id}.pdf`)).toBeNull()
    expect(await store.resolve(`~uploads/ffffffffffff/${file.id}.gp5`)).toBeNull()
    expect(await store.resolve(`~uploads/../x`)).toBeNull()
    expect(await store.resolve(`~uploads/${song.id}/../../secret.gp5`)).toBeNull()
    expect(await store.resolve(`Bach/Prelude.gp5`)).toBeNull()

    fs.rmSync(store.filePath(song.id, file))
    expect(await store.resolve(file.path)).toBeNull()
  })

  it('fileOf finds the song and file behind an upload path', async () => {
    const store = await UploadStore.load(dir)
    const song = await store.create({ title: 'x', artist: '' }, 'u1', NOW)
    const file = (await store.addFile(song.id, { label: '', name: 'a.gp5' }, gp(), 'u1', NOW))
      .files[0]!
    expect(store.fileOf(file.path)?.song.id).toBe(song.id)
    expect(store.fileOf(file.path)?.file.id).toBe(file.id)
    expect(store.fileOf('Bach/Prelude.gp5')).toBeNull()
  })

  it('persists across loads and drops files whose bytes are missing, keeping the song', async () => {
    const store = await UploadStore.load(dir)
    const song = await store.create({ title: '夜曲', artist: '周杰伦' }, 'u1', NOW)
    const withTwo = await store.addFile(song.id, { label: '贝斯', name: 'a.gp5' }, gp(), 'u1', NOW)
    await store.addFile(song.id, { label: '鼓', name: 'b.pdf' }, PDF, 'u1', NOW)
    const gone = withTwo.files[0]!

    const reloaded = await UploadStore.load(dir)
    expect(reloaded.list()).toEqual(store.list())
    expect(reloaded.get(song.id)?.files.map((f) => f.label)).toEqual(['贝斯', '鼓'])

    fs.rmSync(reloaded.filePath(song.id, gone))
    const again = await UploadStore.load(dir)
    expect(again.get(song.id)?.title).toBe('夜曲')
    expect(again.get(song.id)?.files.map((f) => f.label)).toEqual(['鼓'])
    expect(again.get(song.id)?.files[0]?.path).toBe(
      `~uploads/${song.id}/${again.get(song.id)?.files[0]?.id}.pdf`,
    )
  })

  it('sets a damaged uploads.json aside and starts empty', async () => {
    fs.writeFileSync(path.join(dir, UPLOADS_FILE), '{not json')
    const store = await UploadStore.load(dir)
    expect(store.list()).toEqual([])
    const broken = fs.readdirSync(dir).filter((n) => n.startsWith(`${UPLOADS_FILE}.broken-`))
    expect(broken).toHaveLength(1)
    expect(fs.existsSync(path.join(dir, UPLOADS_FILE))).toBe(false)
  })

  it('starts empty when there is no file yet', async () => {
    const store = await UploadStore.load(dir)
    expect(store.list()).toEqual([])
  })
})
