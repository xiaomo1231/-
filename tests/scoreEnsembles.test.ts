// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as at from '@coderline/alphatab'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ENSEMBLE_VERSION,
  EnsembleIndex,
  classifyTrack,
  matchesNeed,
  parseNeed,
  summarize,
  tracksFromBytes,
  type TrackFacts,
} from '../server/ensembles'

const base: TrackFacts = { name: '', program: 0, isPercussion: false, stringCount: 0, lowestMidi: null }
const kind = (over: Partial<TrackFacts>) => classifyTrack({ ...base, ...over })

describe('classifyTrack', () => {
  it('percussion is drums whatever the name says', () => {
    expect(kind({ name: 'Lead Guitar', isPercussion: true })).toBe('drums')
    expect(kind({ name: '', isPercussion: true, program: 0 })).toBe('drums')
  })

  it('name hints, Chinese and English, case-insensitive', () => {
    expect(kind({ name: '架子鼓' })).toBe('drums')
    expect(kind({ name: 'DRUMS' })).toBe('drums')
    expect(kind({ name: 'Percussion' })).toBe('drums')
    expect(kind({ name: 'Bass' })).toBe('bass')
    expect(kind({ name: '贝斯' })).toBe('bass')
    expect(kind({ name: '低音' })).toBe('bass')
    expect(kind({ name: '低音吉他' })).toBe('bass')
    expect(kind({ name: '键盘' })).toBe('keys')
    expect(kind({ name: '钢琴' })).toBe('keys')
    expect(kind({ name: 'Keyboard' })).toBe('keys')
    expect(kind({ name: 'Piano' })).toBe('keys')
    expect(kind({ name: 'Synth Pad' })).toBe('keys')
    expect(kind({ name: '人声' })).toBe('vocal')
    expect(kind({ name: '主唱' })).toBe('vocal')
    expect(kind({ name: 'Vocals' })).toBe('vocal')
    expect(kind({ name: 'Melody' })).toBe('vocal')
    expect(kind({ name: '吉他' })).toBe('guitar')
    expect(kind({ name: 'Gtr 2' })).toBe('guitar')
    expect(kind({ name: 'Lead' })).toBe('guitar')
    expect(kind({ name: 'Rhythm Guitar' })).toBe('guitar')
    expect(kind({ name: '节奏' })).toBe('guitar')
    expect(kind({ name: '主音' })).toBe('guitar')
  })

  it('name order: drums, bass, keys, vocal, guitar', () => {
    expect(kind({ name: 'Bass Drum' })).toBe('drums')
    expect(kind({ name: 'Bass Guitar' })).toBe('bass')
    expect(kind({ name: 'Vocal Solo' })).toBe('vocal')
    expect(kind({ name: 'Keys Solo' })).toBe('keys')
  })

  it('English hints match at a word start only', () => {
    expect(kind({ name: 'Monkey Business', program: 56 })).toBe('other')
    expect(kind({ name: 'Donkey', program: 56 })).toBe('other')
    expect(kind({ name: 'Keyboard', program: 56 })).toBe('keys')
    expect(kind({ name: 'Percussion' })).toBe('drums')
  })

  it('strings are not keys by name', () => {
    expect(kind({ name: 'Strings', program: 48 })).toBe('other')
    expect(kind({ name: 'Strings', program: 48, stringCount: 6, lowestMidi: 40 })).toBe('guitar')
  })

  it('GM programs when the name says nothing', () => {
    for (const p of [24, 27, 31]) expect(kind({ name: 'Track', program: p })).toBe('guitar')
    for (const p of [32, 35, 39]) expect(kind({ name: 'Track', program: p })).toBe('bass')
    for (const p of [0, 4, 7, 16, 19, 23]) expect(kind({ name: 'Track', program: p })).toBe('keys')
    for (const p of [52, 53, 54]) expect(kind({ name: 'Track', program: p })).toBe('vocal')
    expect(kind({ name: 'Track', program: 40 })).toBe('other') // violin
    expect(kind({ name: 'Track', program: 8 })).toBe('other') // celesta
    expect(kind({ name: 'Track', program: 56 })).toBe('other') // trumpet
  })

  it('a stringed track saved with program 0 is a guitar, not keys', () => {
    expect(kind({ name: 'Track', program: 0, stringCount: 6, lowestMidi: 40 })).toBe('guitar')
    expect(kind({ name: 'Track', program: 0, stringCount: 4, lowestMidi: 28 })).toBe('bass')
  })

  it('by strings when the program says nothing: 4–5 low strings are bass, 6–8 guitar', () => {
    expect(kind({ name: 'Track', program: 56, stringCount: 4, lowestMidi: 28 })).toBe('bass')
    expect(kind({ name: 'Track', program: 56, stringCount: 5, lowestMidi: 23 })).toBe('bass')
    expect(kind({ name: 'Track', program: 56, stringCount: 4, lowestMidi: 36 })).toBe('other') // ukulele-like, high
    expect(kind({ name: 'Track', program: 56, stringCount: 6, lowestMidi: 40 })).toBe('guitar')
    expect(kind({ name: 'Track', program: 56, stringCount: 7, lowestMidi: 35 })).toBe('guitar')
    expect(kind({ name: 'Track', program: 56, stringCount: 8, lowestMidi: 30 })).toBe('guitar')
    expect(kind({ name: 'Track', program: 56, stringCount: 3, lowestMidi: 40 })).toBe('other')
    expect(kind({ name: 'Track', program: 56, stringCount: 9, lowestMidi: 30 })).toBe('other')
  })

  it('falls back to other', () => {
    expect(kind({ name: '', program: 56 })).toBe('other')
  })
})

describe('summarize', () => {
  it('counts kinds and detects a band', () => {
    const s = summarize([
      { name: 'a', kind: 'guitar' },
      { name: 'b', kind: 'guitar' },
      { name: 'c', kind: 'bass' },
      { name: 'd', kind: 'drums' },
    ])
    expect(s.counts).toEqual({ guitar: 2, bass: 1, drums: 1 })
    expect(s.band).toBe(true)
  })

  it('keys can stand in for guitar', () => {
    expect(summarize([{ name: 'a', kind: 'keys' }, { name: 'b', kind: 'bass' }, { name: 'c', kind: 'drums' }]).band).toBe(true)
  })

  it('not a band without drums, bass, or a guitar or keys', () => {
    expect(summarize([{ name: 'a', kind: 'guitar' }, { name: 'b', kind: 'bass' }]).band).toBe(false)
    expect(summarize([{ name: 'a', kind: 'drums' }, { name: 'b', kind: 'bass' }]).band).toBe(false)
    expect(summarize([{ name: 'a', kind: 'drums' }, { name: 'b', kind: 'guitar' }]).band).toBe(false)
    expect(summarize([{ name: 'a', kind: 'vocal' }, { name: 'b', kind: 'drums' }, { name: 'c', kind: 'bass' }]).band).toBe(false)
    expect(summarize([]).counts).toEqual({})
  })
})

describe('parseNeed / matchesNeed', () => {
  it('parses comma lists, ignores unknown tokens, defaults to band', () => {
    expect(parseNeed('guitar2,keys')).toEqual(['guitar2', 'keys'])
    expect(parseNeed(' Guitar2 ， vocal ')).toEqual(['guitar2', 'vocal'])
    expect(parseNeed('guitar,guitar')).toEqual(['guitar'])
    expect(parseNeed('')).toEqual(['band'])
    expect(parseNeed('nonsense')).toEqual(['band'])
    expect(parseNeed('nonsense,drums')).toEqual(['drums'])
  })

  it('matches every token against the counts', () => {
    const band = summarize([
      { name: '', kind: 'drums' },
      { name: '', kind: 'bass' },
      { name: '', kind: 'guitar' },
    ])
    const two = summarize([
      { name: '', kind: 'drums' },
      { name: '', kind: 'bass' },
      { name: '', kind: 'guitar' },
      { name: '', kind: 'guitar' },
    ])
    expect(matchesNeed(band, '')).toBe(true)
    expect(matchesNeed(band, 'band')).toBe(true)
    expect(matchesNeed(band, 'guitar2')).toBe(false)
    expect(matchesNeed(two, 'guitar2')).toBe(true)
    expect(matchesNeed(two, 'guitar2,keys')).toBe(false)
    expect(matchesNeed(two, 'guitar2,drums')).toBe(true)
    expect(matchesNeed(band, 'vocal')).toBe(false)
    expect(matchesNeed(band, 'bass')).toBe(true)
  })
})

describe('EnsembleIndex.query', () => {
  const T = (kinds: Array<'drums' | 'bass' | 'guitar' | 'keys' | 'vocal' | 'other'>) =>
    kinds.map((k, i) => ({ name: `t${i}`, kind: k }))
  const e = (p: string, title: string, tracks: ReturnType<typeof T> | null) => ({
    path: p,
    title,
    artist: 'A',
    size: 1,
    mtimeMs: 1,
    tracks,
  })
  const idx = new EnsembleIndex(os.tmpdir(), os.tmpdir())
  idx.seed([
    e('b/solo.gp5', '独奏', T(['guitar'])),
    e('b/full-2g.gp5', 'Zebra', T(['drums', 'bass', 'guitar', 'guitar'])),
    e('b/full-1g.gp5', 'Apple', T(['drums', 'bass', 'guitar'])),
    e('b/full-keys.gp5', '钢琴版', T(['drums', 'bass', 'keys', 'vocal'])),
    e('b/missing.gp5', 'Missing', null),
    e('b/no-band.gp5', 'NoBand', T(['drums', 'guitar'])),
    e('b/bigband.gp5', 'Big', T(['drums', 'bass', 'guitar', 'keys', 'vocal', 'other'])),
  ])

  it('lists band files first, then the ones closest to a 5-track band, then title', () => {
    const r = idx.query({ need: '', offset: 0, limit: 20 })
    // 6, 4 and 4 tracks are one away from 5 and sort by title (钢琴版, Big, Zebra); 3 tracks is two away
    expect(r.items.map((i) => i.path)).toEqual([
      'b/full-keys.gp5',
      'b/bigband.gp5',
      'b/full-2g.gp5',
      'b/full-1g.gp5',
    ])
    expect(r.total).toBe(4)
    expect(r.items[1]!.counts).toEqual({ drums: 1, bass: 1, guitar: 1, keys: 1, vocal: 1, other: 1 })
    expect(r.items[1]!.band).toBe(true)
  })

  it('filters by need', () => {
    expect(idx.query({ need: 'guitar2', offset: 0, limit: 20 }).items.map((i) => i.path)).toEqual(['b/full-2g.gp5'])
    expect(idx.query({ need: 'vocal', offset: 0, limit: 20 }).total).toBe(2)
    // every indexed file with a guitar (no-band included), not the missing one
    expect(idx.query({ need: 'guitar', offset: 0, limit: 20 }).total).toBe(5)
    expect(idx.query({ need: 'guitar2,keys', offset: 0, limit: 20 }).total).toBe(0)
  })

  it('band need on files with no band still returns only band files', () => {
    const r = idx.query({ need: 'band', offset: 0, limit: 20 })
    expect(r.items.every((i) => i.band)).toBe(true)
    expect(r.total).toBe(4)
  })

  it('hides files without a title unless asked, and lists them last', () => {
    const u = new EnsembleIndex(os.tmpdir(), os.tmpdir())
    u.seed([
      e('c/1129121537.gp4', '', T(['drums', 'bass', 'guitar', 'guitar', 'vocal'])),
      e('c/晴天.gp5', '晴天', T(['drums', 'bass', 'guitar'])),
    ])
    const r = u.query({ need: '', offset: 0, limit: 20 })
    expect(r.items.map((i) => i.path)).toEqual(['c/晴天.gp5'])
    expect(r.total).toBe(1)
    expect(r.hiddenUntitled).toBe(1)
    const all = u.query({ need: '', offset: 0, limit: 20, untitled: true })
    expect(all.items.map((i) => i.path)).toEqual(['c/晴天.gp5', 'c/1129121537.gp4'])
    expect(all.hiddenUntitled).toBe(0)
  })

  it('restricts to a set of paths', () => {
    const r = idx.query({ paths: new Set(['b/full-1g.gp5', 'b/solo.gp5', 'b/nope.gp5']), need: 'guitar', offset: 0, limit: 20 })
    expect(r.items.map((i) => i.path)).toEqual(['b/full-1g.gp5', 'b/solo.gp5'])
  })

  it('pages and clamps the limit', () => {
    const page = idx.query({ need: '', offset: 1, limit: 2 })
    expect(page.items.map((i) => i.path)).toEqual(['b/bigband.gp5', 'b/full-2g.gp5'])
    expect(page.total).toBe(4)
    expect(idx.query({ need: '', offset: 0, limit: 0 }).items.length).toBe(1)
    expect(idx.query({ need: '', offset: 0, limit: 9999 }).items.length).toBe(4)
    expect(idx.query({ need: '', offset: 99, limit: 5 }).items.length).toBe(0)
    expect(idx.query({ need: '', offset: -3, limit: 1 }).items[0]!.path).toBe('b/full-keys.gp5')
  })

  it('reports progress from the status', () => {
    const r = idx.query({ need: '', offset: 0, limit: 1 })
    // seeded entries count as indexed; nothing is queued
    expect(r.indexing).toBe(false)
    expect(r.indexed).toBe(7)
    expect(r.toIndex).toBe(0)
  })
})

describe('tracksFromBytes (real alphaTab parse)', () => {
  const TEX = String.raw`\title "Ensemble probe" \tempo 120
\track "Lead"
\tuning (E4 B3 G3 D3 A2 D2)
3.3.4 5.3.4 |
\track "Bass"
\tuning (G2 D2 A1 E1)
3.4.1 | 5.3.1 |
\track "Drum Kit"
3.4.1 | 5.3.1 |
\track "Keys"
\track "Strings"
\tuning (E4 B3 G3 D3 A2 D2)
3.4.1 |`
  let bytes: Uint8Array
  beforeAll(() => {
    bytes = new at.exporter.Gp7Exporter().export(at.importer.ScoreLoader.loadAlphaTex(TEX))
  })
  afterAll(() => {})

  it('reads track names and kinds from a GP 7 file', () => {
    const tracks = tracksFromBytes(bytes)
    expect(tracks).not.toBeNull()
    const byName = Object.fromEntries((tracks ?? []).map((t) => [t.name, t.kind]))
    expect(byName.Lead).toBe('guitar')
    expect(byName.Bass).toBe('bass')
    expect(byName['Drum Kit']).toBe('drums')
  })

  it('returns null for bytes that are not a score', () => {
    expect(tracksFromBytes(new TextEncoder().encode('not a guitar pro file at all'))).toBeNull()
  })
})

describe('EnsembleIndex start (background pass on a real folder)', () => {
  let dir: string
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensembles-'))
  })
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('indexes GP files, skips others, and reuses the cache on a second start', async () => {
    const root = path.join(dir, 'lib')
    const data = path.join(dir, 'data')
    fs.mkdirSync(path.join(root, 'a'), { recursive: true })
    fs.writeFileSync(path.join(root, 'a', 'junk.gp5'), 'not a score')
    fs.writeFileSync(path.join(root, 'a', 'note.txt'), 'hello')
    const gp = new at.exporter.Gp7Exporter().export(
      at.importer.ScoreLoader.loadAlphaTex(String.raw`\title "x"
\track "Lead"
\tuning (E4 B3 G3 D3 A2 D2)
3.3.4 |
\track "Bass"
\tuning (G2 D2 A1 E1)
3.4.1 |`),
    )
    fs.writeFileSync(path.join(root, 'a', 'probe.gp'), gp)

    const list = [
      { path: 'a/junk.gp5', title: 'junk', artist: 'A' },
      { path: 'a/probe.gp', title: 'probe', artist: 'A' },
      { path: 'a/note.txt', title: 'note', artist: 'A' },
    ]
    const idx = new EnsembleIndex(root, data)
    await idx.start(list)
    await waitFor(() => !idx.status().indexing)
    expect(idx.status()).toEqual({ indexed: 2, toIndex: 0, indexing: false })

    const cache = JSON.parse(fs.readFileSync(path.join(data, 'ensembles.json'), 'utf8'))
    expect(cache.version).toBe(ENSEMBLE_VERSION)
    expect(Object.keys(cache.files).sort()).toEqual(['a/junk.gp5', 'a/probe.gp'])
    expect(cache.files['a/junk.gp5'].tracks).toBeNull()
    expect(cache.files['a/probe.gp'].tracks.map((t: { kind: string }) => t.kind).sort()).toEqual(['bass', 'guitar'])

    // Second start: nothing changed, so nothing is read again; the cached tracks are used.
    const again = new EnsembleIndex(root, data)
    await again.start(list)
    await waitFor(() => !again.status().indexing)
    const r = again.query({ need: 'guitar', offset: 0, limit: 10 })
    expect(r.items.map((i) => i.path)).toEqual(['a/probe.gp'])
    expect(r.items[0]!.title).toBe('probe')

    // A dropped file leaves the cache.
    await again.start([list[0]!])
    await waitFor(() => !again.status().indexing)
    const after = JSON.parse(fs.readFileSync(path.join(data, 'ensembles.json'), 'utf8'))
    expect(Object.keys(after.files)).toEqual(['a/junk.gp5'])
  })
})

async function waitFor(cond: () => boolean, timeoutMs = 20_000): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}
