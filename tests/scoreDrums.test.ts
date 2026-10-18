// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DrumPart, DrumTemplateLibrary, SongBarInfo } from '../src/songs/drumTypes'
import { inRootOf } from '../server/favorites'
import {
  DRUMS_FILE,
  DrumStore,
  MAX_DRUM_PARTS,
  generateDrums,
  parseGenerateBody,
  parseSaveBody,
  styleInfos,
} from '../server/drums'

const song: SongBarInfo[] = [0, 1, 2, 3].map((i) => ({
  num: 4,
  den: 4,
  bpm: 120,
  section: i === 0 ? 'Verse' : null,
  onsets: [{ at: 0, vel: 90 }],
  triplet: false,
}))

vi.mock('../src/songs/drumScore', () => ({
  songBars: () => song,
}))

const part = (rel: string, updatedAt = 0): DrumPart => ({
  version: 1,
  path: rel,
  title: '测试',
  artist: '歌手',
  bars: [{ num: 4, den: 4, stepsPerQuarter: 4, hits: [{ step: 0, piece: 'kick', vel: 2 }] }],
  source: 'template',
  edited: false,
  style: null,
  updatedAt,
  updatedBy: '',
})

let dir: string
let root: string
const inRoot = () => inRootOf(root)

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drums-'))
  root = path.join(dir, 'library')
  fs.mkdirSync(root)
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(dir, { recursive: true, force: true })
})

const dataDir = () => path.join(dir, 'data')
const storeFile = () => path.join(dataDir(), DRUMS_FILE)

describe('DrumStore', () => {
  it('starts empty without a file, then saves, reloads and removes', async () => {
    const store = await DrumStore.load(dataDir(), inRoot())
    expect(store.has('a.gp5')).toBe(false)

    const saved = await store.save(part('a.gp5'), 'user-1', 1234)
    expect(saved.updatedAt).toBe(1234)
    expect(saved.updatedBy).toBe('user-1')
    expect(store.get('a.gp5')?.title).toBe('测试')

    const again = await DrumStore.load(dataDir(), inRoot())
    expect(again.has('a.gp5')).toBe(true)
    expect(again.get('a.gp5')?.updatedBy).toBe('user-1')

    expect(await again.remove('a.gp5')).toBe(true)
    expect(await again.remove('a.gp5')).toBe(false)
    const after = await DrumStore.load(dataDir(), inRoot())
    expect(after.has('a.gp5')).toBe(false)
  })

  it('keeps concurrent saves', async () => {
    const store = await DrumStore.load(dataDir(), inRoot())
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.save(part(`s${i}.gp5`), 'u', i)))
    const reloaded = await DrumStore.load(dataDir(), inRoot())
    for (let i = 0; i < 20; i++) expect(reloaded.has(`s${i}.gp5`)).toBe(true)
  })

  it('sets a damaged file aside and starts empty', async () => {
    fs.mkdirSync(dataDir(), { recursive: true })
    fs.writeFileSync(storeFile(), '{not json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = await DrumStore.load(dataDir(), inRoot())
    expect(store.has('a.gp5')).toBe(false)
    const broken = fs.readdirSync(dataDir()).filter((n) => n.startsWith(`${DRUMS_FILE}.broken-`))
    expect(broken).toHaveLength(1)
    expect(fs.existsSync(storeFile())).toBe(false)
    expect(warn).toHaveBeenCalled()
  })

  it('drops entries that fail validation or leave the library on load', async () => {
    fs.mkdirSync(dataDir(), { recursive: true })
    fs.writeFileSync(
      storeFile(),
      JSON.stringify({
        version: 1,
        parts: {
          good: part('good.gp5'),
          bad: { path: 'bad.gp5', bars: 'nope' },
          outside: part('../escape.gp5'),
        },
      }),
    )
    const store = await DrumStore.load(dataDir(), inRoot())
    expect(store.has('good.gp5')).toBe(true)
    expect(store.has('bad.gp5')).toBe(false)
    expect(store.has('../escape.gp5')).toBe(false)
  })

  it('caps the store at MAX_DRUM_PARTS by dropping the oldest updatedAt', async () => {
    fs.mkdirSync(dataDir(), { recursive: true })
    const parts: Record<string, DrumPart> = {}
    for (let i = 1; i <= MAX_DRUM_PARTS; i++) parts[`p${i}.gp5`] = part(`p${i}.gp5`, i)
    fs.writeFileSync(storeFile(), JSON.stringify({ version: 1, parts }))

    const store = await DrumStore.load(dataDir(), inRoot())
    await store.save(part('new.gp5'), 'u', MAX_DRUM_PARTS + 10)

    expect(store.has('new.gp5')).toBe(true)
    expect(store.has('p1.gp5')).toBe(false)
    expect(store.has(`p${MAX_DRUM_PARTS}.gp5`)).toBe(true)
    const onDisk = JSON.parse(fs.readFileSync(storeFile(), 'utf8'))
    expect(Object.keys(onDisk.parts)).toHaveLength(MAX_DRUM_PARTS)
  })
})

describe('parseGenerateBody', () => {
  const base = {
    path: 'rock/song.gp5',
    title: '曲名',
    artist: '歌手',
    engine: 'template',
    style: null,
    guideTrack: null,
    range: null,
  }

  it('accepts a minimal body and defaults the temperature to 0.7', () => {
    const r = parseGenerateBody(base, inRoot())
    expect(r).toEqual({ ok: true, value: { ...base, temperature: 0.7 } })
  })

  it('accepts every supported score extension, in any case', () => {
    for (const ext of ['.gp', '.gp3', '.gp4', '.gp5', '.gpx', '.musicxml', '.xml', '.mxl']) {
      expect(parseGenerateBody({ ...base, path: `x${ext.toUpperCase()}` }, inRoot()).ok).toBe(true)
    }
  })

  it('rejects paths outside the library or without a score extension', () => {
    expect(parseGenerateBody({ ...base, path: '../x.gp5' }, inRoot()).ok).toBe(false)
    expect(parseGenerateBody({ ...base, path: 'song.mp3' }, inRoot()).ok).toBe(false)
    expect(parseGenerateBody({ ...base, path: '' }, inRoot()).ok).toBe(false)
  })

  it('checks text, engine, style and guide track', () => {
    expect(parseGenerateBody({ ...base, title: 'x'.repeat(301) }, inRoot()).ok).toBe(false)
    expect(parseGenerateBody({ ...base, artist: 5 }, inRoot()).ok).toBe(false)
    expect(parseGenerateBody({ ...base, engine: 'magic' }, inRoot()).ok).toBe(false)
    expect(parseGenerateBody({ ...base, style: 'r'.repeat(41) }, inRoot()).ok).toBe(false)
    expect(parseGenerateBody({ ...base, style: 'rock8' }, inRoot()).ok).toBe(true)
    expect(parseGenerateBody({ ...base, guideTrack: 64 }, inRoot()).ok).toBe(false)
    expect(parseGenerateBody({ ...base, guideTrack: 1.5 }, inRoot()).ok).toBe(false)
    expect(parseGenerateBody({ ...base, guideTrack: 63 }, inRoot()).ok).toBe(true)
  })

  it('checks the bar range', () => {
    expect(parseGenerateBody({ ...base, range: [0, 4000] }, inRoot()).ok).toBe(true)
    expect(parseGenerateBody({ ...base, range: [5, 3] }, inRoot()).ok).toBe(false)
    expect(parseGenerateBody({ ...base, range: [0, 4001] }, inRoot()).ok).toBe(false)
    expect(parseGenerateBody({ ...base, range: [-1, 2] }, inRoot()).ok).toBe(false)
    expect(parseGenerateBody({ ...base, range: [1] }, inRoot()).ok).toBe(false)
    expect(parseGenerateBody({ ...base, range: [1.5, 2] }, inRoot()).ok).toBe(false)
  })

  it('checks the temperature range', () => {
    expect(parseGenerateBody({ ...base, temperature: 0.1 }, inRoot()).ok).toBe(true)
    expect(parseGenerateBody({ ...base, temperature: 1.5 }, inRoot()).ok).toBe(true)
    expect(parseGenerateBody({ ...base, temperature: 0 }, inRoot()).ok).toBe(false)
    expect(parseGenerateBody({ ...base, temperature: 1.6 }, inRoot()).ok).toBe(false)
  })
})

describe('parseSaveBody', () => {
  it('accepts a valid part inside the library and rejects others', () => {
    expect(parseSaveBody({ part: part('a.gp5') }, inRoot()).ok).toBe(true)
    expect(parseSaveBody({ part: part('../a.gp5') }, inRoot()).ok).toBe(false)
    expect(parseSaveBody({ part: { path: 'a.gp5' } }, inRoot()).ok).toBe(false)
  })
})

describe('styleInfos', () => {
  it('lists the styles without their patterns', () => {
    const lib: DrumTemplateLibrary = {
      version: 1,
      source: 's',
      license: 'l',
      styles: [
        {
          id: 'rock8',
          zh: '摇滚 8 分',
          meter: '4/4',
          minBpm: 80,
          maxBpm: 140,
          grooves: [],
          chorus: [],
          fills: [],
        },
      ],
    }
    expect(styleInfos(lib)).toEqual([
      { id: 'rock8', zh: '摇滚 8 分', meter: '4/4', minBpm: 80, maxBpm: 140 },
    ])
  })
})

describe('generateDrums', () => {
  const body = {
    path: 'song.gp5',
    title: '曲名',
    artist: '歌手',
    engine: 'template' as const,
    style: 'rock8',
    guideTrack: null,
    range: null,
    temperature: 0.7,
  }
  const lib: DrumTemplateLibrary = { version: 1, source: '', license: '', styles: [] }
  const bars = [{ num: 4, den: 4, stepsPerQuarter: 4 as const, hits: [] }]
  const readScore = async () => ({}) as never

  it('runs the template engine and reports its source and style', async () => {
    const template = vi.fn((_song: unknown, _opts: { style: string | null; range: unknown; seed: number }) => ({
      first: 0,
      bars,
      style: 'rock8',
    }))
    const out = await generateDrums(body, '/x/song.gp5', { template }, lib, { readScore })
    expect(out).toEqual({ first: 0, bars, source: 'template', style: 'rock8' })
    const opts = template.mock.calls[0]![1]
    expect(opts.style).toBe('rock8')
    expect(opts.range).toBeNull()
    expect(typeof opts.seed).toBe('number')
  })

  it('gives a different seed on each run', async () => {
    const seeds: number[] = []
    const template = vi.fn((_s: SongBarInfo[], o: { seed: number }) => {
      seeds.push(o.seed)
      return { first: 0, bars, style: null }
    })
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValueOnce(1000).mockReturnValueOnce(2000)
    await generateDrums(body, '/x/song.gp5', { template }, lib, { readScore })
    await generateDrums(body, '/x/song.gp5', { template }, lib, { readScore })
    expect(seeds[0]).not.toBe(seeds[1])
  })

  it('runs the drumify engine with temperature and reports its source', async () => {
    const drumify = vi.fn(async (_song: unknown, _opts: Record<string, unknown>) => ({
      first: 1,
      bars,
      style: null,
    }))
    const template = vi.fn()
    const out = await generateDrums(
      { ...body, engine: 'drumify', temperature: 1.2, range: [1, 2] },
      '/x/song.gp5',
      { template, drumify },
      lib,
      { readScore },
    )
    expect(out).toEqual({ first: 1, bars, source: 'drumify', style: null })
    expect(drumify.mock.calls[0]![1]).toMatchObject({
      temperature: 1.2,
      range: [1, 2],
      style: 'rock8',
    })
    expect(template).not.toHaveBeenCalled()
  })

  it('explains when drumify is not available', async () => {
    await expect(
      generateDrums({ ...body, engine: 'drumify' }, '/x/song.gp5', { template: vi.fn() }, lib, {
        readScore,
      }),
    ).rejects.toThrow('智能鼓谱')
  })

  it('explains when the score cannot be read', async () => {
    const failing = async () => {
      throw new Error('bad file')
    }
    await expect(
      generateDrums(body, '/x/song.gp5', { template: vi.fn() }, lib, { readScore: failing }),
    ).rejects.toThrow('读不出这个乐谱文件')
  })

  it('rejects a range beyond the song', async () => {
    await expect(
      generateDrums({ ...body, range: [0, 4] }, '/x/song.gp5', { template: vi.fn() }, lib, {
        readScore,
      }),
    ).rejects.toThrow('超出了曲子')
  })
})
