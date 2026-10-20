// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComboRecipe, UserInfo } from '../src/songs/scoreServerTypes'
import { inRootOf } from '../server/favorites'
import { canEditCombo, ComboError, ComboStore, MAX_COMBOS, parseSaveCombo } from '../server/combos'

const ROOT = path.resolve(os.tmpdir(), 'gl-combo-root')
const inRoot = inRootOf(ROOT)

// Versions of two songs: a song key lists its own files.
const VERSIONS: Record<string, string[]> = {
  'artist#song': ['rock/a.gp5', 'rock/b.gp5'],
  'artist#other': ['pop/c.gp5'],
}
const isVersionOf = (p: string, key: string) => (VERSIONS[key] ?? []).includes(p)

const part = (over: Record<string, unknown> = {}) => ({
  path: 'rock/a.gp5',
  track: 1,
  name: '吉他',
  offsetBars: 0,
  transpose: 0,
  unrollRepeats: false,
  ...over,
})

const recipe = (over: Record<string, unknown> = {}) => ({
  id: null,
  songKey: 'artist#song',
  title: '曲名',
  artist: '歌手',
  base: 'rock/b.gp5',
  baseUnrollRepeats: false,
  parts: [part()],
  ...over,
})

const parse = (r: Record<string, unknown>) => parseSaveCombo({ recipe: r }, inRoot, isVersionOf)

const user = (id: string, role: UserInfo['role'] = 'member'): UserInfo => ({
  id,
  username: id,
  displayName: id,
  role,
  libraryAccess: true,
  instrument: null,
  createdAt: 0,
  invitedBy: null,
  disabled: false,
})

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-combo-test-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const readFile = () => JSON.parse(fs.readFileSync(path.join(dir, 'combos.json'), 'utf8'))

describe('parseSaveCombo', () => {
  it('accepts a new recipe and returns the normalized value', () => {
    const r = parse(recipe({ parts: [part({ name: '  吉他  ' })] }))
    expect(r).toEqual({
      ok: true,
      value: {
        id: null,
        songKey: 'artist#song',
        title: '曲名',
        artist: '歌手',
        base: 'rock/b.gp5',
        baseUnrollRepeats: false,
        parts: [part({ name: '吉他' })],
      },
    })
  })

  it('reads the recipe from body.recipe', () => {
    expect(parseSaveCombo({}, inRoot, isVersionOf).ok).toBe(false)
  })

  it('accepts a 12-hex id and rejects other ids', () => {
    expect(parse(recipe({ id: 'a1b2c3d4e5f6' })).ok).toBe(true)
    expect(parse(recipe({ id: 'A1B2C3D4E5F6' })).ok).toBe(false)
    expect(parse(recipe({ id: 'a1b2c3d4e5' })).ok).toBe(false)
    expect(parse(recipe({ id: 12 })).ok).toBe(false)
  })

  it('checks songKey, title and artist lengths', () => {
    // The key is not a real song here, so every path counts as its version.
    const any = (r: Record<string, unknown>) => parseSaveCombo({ recipe: r }, inRoot, () => true)
    expect(any(recipe({ songKey: '' })).ok).toBe(false)
    expect(any(recipe({ songKey: 'k'.repeat(300) })).ok).toBe(true)
    expect(any(recipe({ songKey: 'k'.repeat(301) })).ok).toBe(false)
    expect(parse(recipe({ title: 't'.repeat(301) })).ok).toBe(false)
    expect(parse(recipe({ artist: 3 })).ok).toBe(false)
  })

  it('requires the base to be a version of the song inside the root', () => {
    expect(parse(recipe({ base: 'pop/c.gp5' })).ok).toBe(false)
    expect(parse(recipe({ base: '../escape.gp5' })).ok).toBe(false)
    expect(parse(recipe({ base: '' })).ok).toBe(false)
    expect(parse(recipe({ baseUnrollRepeats: 'no' })).ok).toBe(false)
  })

  it('requires 1–16 parts', () => {
    expect(parse(recipe({ parts: [] })).ok).toBe(false)
    expect(parse(recipe({ parts: Array.from({ length: 16 }, () => part()) })).ok).toBe(true)
    expect(parse(recipe({ parts: Array.from({ length: 17 }, () => part()) })).ok).toBe(false)
    expect(parse(recipe({ parts: 'x' })).ok).toBe(false)
  })

  it('checks each part: same song, path in root, ranges and name', () => {
    expect(parse(recipe({ parts: [part({ path: 'pop/c.gp5' })] })).ok).toBe(false)
    expect(parse(recipe({ parts: [part({ path: '/etc/a.gp5' })] })).ok).toBe(false)
    expect(parse(recipe({ parts: [part({ track: 63 })] })).ok).toBe(true)
    expect(parse(recipe({ parts: [part({ track: 64 })] })).ok).toBe(false)
    expect(parse(recipe({ parts: [part({ track: 1.5 })] })).ok).toBe(false)
    expect(parse(recipe({ parts: [part({ offsetBars: -64 })] })).ok).toBe(true)
    expect(parse(recipe({ parts: [part({ offsetBars: 65 })] })).ok).toBe(false)
    expect(parse(recipe({ parts: [part({ transpose: -12 })] })).ok).toBe(true)
    expect(parse(recipe({ parts: [part({ transpose: 13 })] })).ok).toBe(false)
    expect(parse(recipe({ parts: [part({ unrollRepeats: 1 })] })).ok).toBe(false)
    expect(parse(recipe({ parts: [part({ name: '   ' })] })).ok).toBe(false)
    expect(parse(recipe({ parts: [part({ name: 'n'.repeat(41) })] })).ok).toBe(false)
    expect(parse(recipe({ parts: [part({ name: 'n'.repeat(40) })] })).ok).toBe(true)
  })
})

describe('canEditCombo', () => {
  const item = { createdBy: 'u1' }
  it('lets the creator and an admin edit, and nobody else', () => {
    expect(canEditCombo(item, user('u1'))).toBe(true)
    expect(canEditCombo(item, user('u2'))).toBe(false)
    expect(canEditCombo(item, user('boss', 'admin'))).toBe(true)
  })
})

describe('ComboStore', () => {
  it('starts empty when the file is missing', async () => {
    const store = await ComboStore.load(dir, inRoot)
    expect(store.list('artist#song')).toEqual([])
  })

  it('saves a new recipe with a fresh 12-hex id and createdBy', async () => {
    const store = await ComboStore.load(dir, inRoot)
    const r = parse(recipe())
    if (!r.ok) throw new Error('parse failed')
    const saved = await store.save(r.value, 'u1', 100)
    expect(saved.id).toMatch(/^[0-9a-f]{12}$/)
    expect(saved).toMatchObject({ createdBy: 'u1', updatedAt: 100, title: '曲名', parts: [part()] })
    expect(store.get(saved.id)).toEqual(saved)
    expect(readFile()).toEqual({ version: 1, items: [saved] })
  })

  it('replaces an existing recipe and keeps its createdBy', async () => {
    const store = await ComboStore.load(dir, inRoot)
    const first = parse(recipe())
    if (!first.ok) throw new Error('parse failed')
    const a = await store.save(first.value, 'u1', 100)
    const edit = parse(recipe({ id: a.id, title: '新名字', parts: [part({ transpose: 2 })] }))
    if (!edit.ok) throw new Error('parse failed')
    const b = await store.save(edit.value, 'u2', 200)
    expect(b).toMatchObject({ id: a.id, title: '新名字', createdBy: 'u1', updatedAt: 200 })
    expect(store.list('artist#song')).toHaveLength(1)
    expect(store.get(a.id)?.parts[0].transpose).toBe(2)
    expect(readFile().items).toHaveLength(1)
  })

  it('rejects saving an unknown id with 404', async () => {
    const store = await ComboStore.load(dir, inRoot)
    const r = parse(recipe({ id: 'a1b2c3d4e5f6' }))
    if (!r.ok) throw new Error('parse failed')
    const err = await store.save(r.value, 'u1', 100).catch((e) => e)
    expect(err).toBeInstanceOf(ComboError)
    expect(err.status).toBe(404)
    expect(store.list('artist#song')).toEqual([])
  })

  it('removes a recipe, and reports false for an unknown id', async () => {
    const store = await ComboStore.load(dir, inRoot)
    const r = parse(recipe())
    if (!r.ok) throw new Error('parse failed')
    const saved = await store.save(r.value, 'u1', 100)
    expect(await store.remove('ffffffffffff')).toBe(false)
    expect(await store.remove(saved.id)).toBe(true)
    expect(store.get(saved.id)).toBeUndefined()
    expect(readFile().items).toEqual([])
  })

  it('lists one song newest first', async () => {
    const store = await ComboStore.load(dir, inRoot)
    const mk = (key: string, title: string) => {
      const file = key === 'artist#song' ? 'rock/b.gp5' : 'pop/c.gp5'
      const r = parse(recipe({ songKey: key, title, base: file, parts: [part({ path: file })] }))
      if (!r.ok) throw new Error('parse failed')
      return r.value
    }
    await store.save(mk('artist#song', 'old'), 'u1', 100)
    await store.save(mk('artist#other', 'other'), 'u1', 150)
    await store.save(mk('artist#song', 'new'), 'u1', 300)
    expect(store.list('artist#song').map((x) => x.title)).toEqual(['new', 'old'])
    expect(store.list('artist#other').map((x) => x.title)).toEqual(['other'])
  })

  it('caps the store at 2000 recipes, dropping the oldest by updatedAt', async () => {
    const r = parse(recipe())
    if (!r.ok) throw new Error('parse failed')
    // Seed the file directly: saving 2000 times through the queue is slow.
    const items: ComboRecipe[] = Array.from({ length: MAX_COMBOS }, (_, i) => ({
      ...r.value,
      id: i.toString(16).padStart(12, '0'),
      createdBy: 'u1',
      updatedAt: i + 1,
    }))
    fs.writeFileSync(path.join(dir, 'combos.json'), JSON.stringify({ version: 1, items }))
    const loaded = await ComboStore.load(dir, inRoot)
    expect(loaded.list('artist#song')).toHaveLength(MAX_COMBOS)
    const saved = await loaded.save(r.value, 'u2', MAX_COMBOS + 10)
    const after = loaded.list('artist#song')
    expect(after).toHaveLength(MAX_COMBOS)
    expect(after[0].id).toBe(saved.id)
    expect(loaded.get('000000000000')).toBeUndefined()
    expect(readFile().items).toHaveLength(MAX_COMBOS)
  })

  it('a corrupt file is set aside with a warning and the store starts empty', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fs.writeFileSync(path.join(dir, 'combos.json'), '{ not json')
    const store = await ComboStore.load(dir, inRoot)
    expect(store.list('artist#song')).toEqual([])
    expect(warn).toHaveBeenCalled()
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('combos.json.broken-'))).toHaveLength(1)
    expect(fs.existsSync(path.join(dir, 'combos.json'))).toBe(false)
  })

  it('load drops entries that are malformed or duplicated', async () => {
    const good = {
      id: 'a1b2c3d4e5f6',
      songKey: 'artist#song',
      title: 'ok',
      artist: '',
      base: 'rock/b.gp5',
      baseUnrollRepeats: false,
      parts: [part()],
      createdBy: 'u1',
      updatedAt: 5,
    }
    fs.writeFileSync(
      path.join(dir, 'combos.json'),
      JSON.stringify({
        version: 1,
        items: [
          good,
          { ...good, title: 'dup' },
          { ...good, id: '111111111111', base: '../escape.gp5' },
          { ...good, id: '222222222222', createdBy: '' },
          { ...good, id: null },
        ],
      }),
    )
    const store = await ComboStore.load(dir, inRoot)
    expect(store.list('artist#song').map((x) => x.title)).toEqual(['ok'])
  })
})
