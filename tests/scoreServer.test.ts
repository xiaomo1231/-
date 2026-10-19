// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  attachmentDisposition,
  createRateLimiter,
  createSessionToken,
  decodeText,
  decodeUrlPath,
  mapLimit,
  mimeFor,
  parseRange,
  passwordMatches,
  readCookie,
  resolveInside,
  resolveRealFile,
  verifySessionToken,
} from '../server/util'
import {
  narrowIndex,
  parseCatalogParams,
  parseTopLimit,
  rankByVersions,
  sortResultSongs,
  topSongs,
} from '../server/catalog'
import {
  applyPracticeUpdate,
  loadPracticeByUser,
  progressFor,
  savePracticeByUser,
  type PracticeByUser,
  MAX_ADD_SECONDS,
  MAX_PRACTICE,
  parsePracticePath,
  parsePracticeUpdate,
  removePractice,
  sanitizePractice,
  type PracticeRecord,
} from '../server/practice'
import {
  createSerialQueue,
  inRootOf,
  MAX_FAVORITES,
  parseAlias,
  parseFavoriteInput,
  parseFavoritePath,
  parseRenameInput,
  parseRenameSongInput,
  loadFavoritesByUser,
  removeFavorite,
  renameItems,
  sanitizeFavorites,
  saveFavoritesByUser,
  type FavoritesByUser,
  upsertFavorite,
  type FavoriteItem,
} from '../server/favorites'
import { buildLibrary, buildSearchIndex, PLAIN_TOOLS, search } from '../src/songs/scoreLibrary'

const SECRET = Buffer.from('a'.repeat(64), 'hex')

describe('resolveInside (lexical path safety)', () => {
  const root = path.resolve(os.tmpdir(), 'gl-root')

  it('accepts normal relative paths inside the root', () => {
    const abs = resolveInside(root, '1-华语/男歌手/周杰伦/七里香.gp4')
    expect(abs).toBe(path.resolve(root, '1-华语/男歌手/周杰伦/七里香.gp4'))
  })

  it('rejects traversal, absolute paths, NUL and the root itself', () => {
    expect(resolveInside(root, '../etc/passwd')).toBeNull()
    expect(resolveInside(root, '1/../../etc')).toBeNull()
    expect(resolveInside(root, '../../etc')).toBeNull()
    expect(resolveInside(root, '/etc/passwd')).toBeNull()
    expect(resolveInside(root, 'C:/Windows/win.ini')).toBeNull()
    expect(resolveInside(root, 'a\0b.gp5')).toBeNull()
    expect(resolveInside(root, '')).toBeNull()
    expect(resolveInside(root, '.')).toBeNull()
  })

  it('does not reject names that merely start with two dots', () => {
    expect(resolveInside(root, '..hidden/file.txt')).not.toBeNull()
  })
})

describe('decodeUrlPath', () => {
  it('decodes each segment, so an encoded traversal stays a relative path with ..', () => {
    expect(decodeUrlPath('1-%E5%8D%8E%E8%AF%AD/a%20b.gp5')).toBe('1-华语/a b.gp5')
    expect(decodeUrlPath('..%2F..%2Fetc')).toBe('../../etc')
  })

  it('rejects malformed escapes and NUL bytes', () => {
    expect(decodeUrlPath('%E0%A4%A')).toBeNull()
    expect(decodeUrlPath('a%00b')).toBeNull()
  })
})

describe('resolveRealFile (symlinks)', () => {
  let base: string
  let root: string
  let outside: string

  beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-score-test-'))
    root = path.join(base, 'lib')
    outside = path.join(base, 'secret')
    fs.mkdirSync(path.join(root, 'sub'), { recursive: true })
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(root, 'sub', 'song.txt'), 'hello')
    fs.writeFileSync(path.join(outside, 'key.txt'), 'top secret')
    try {
      fs.symlinkSync(path.join(outside, 'key.txt'), path.join(root, 'link.txt'))
    } catch {
      // Symlinks need privileges on some Windows setups; the test below then checks nothing.
    }
  })

  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true })
  })

  it('finds a regular file and returns its real path', async () => {
    const real = await resolveRealFile(root, fs.realpathSync(root), 'sub/song.txt')
    expect(real).toBe(fs.realpathSync(path.join(root, 'sub', 'song.txt')))
  })

  it('returns null for a directory, a missing file and a traversal', async () => {
    const realRoot = fs.realpathSync(root)
    expect(await resolveRealFile(root, realRoot, 'sub')).toBeNull()
    expect(await resolveRealFile(root, realRoot, 'nope.gp5')).toBeNull()
    expect(await resolveRealFile(root, realRoot, '../secret/key.txt')).toBeNull()
  })

  it('refuses a symlink that points outside the root', async () => {
    if (!fs.existsSync(path.join(root, 'link.txt'))) return
    expect(await resolveRealFile(root, fs.realpathSync(root), 'link.txt')).toBeNull()
  })
})

describe('parseRange', () => {
  it('is full when there is no header or an unsupported one', () => {
    expect(parseRange(undefined, 100)).toEqual({ kind: 'full' })
    expect(parseRange('items=0-1', 100)).toEqual({ kind: 'full' })
    expect(parseRange('bytes=0-1,5-9', 100)).toEqual({ kind: 'full' })
  })

  it('parses start-end, open-ended and suffix ranges', () => {
    expect(parseRange('bytes=0-9', 100)).toEqual({ kind: 'partial', start: 0, end: 9 })
    expect(parseRange('bytes=90-', 100)).toEqual({ kind: 'partial', start: 90, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ kind: 'partial', start: 90, end: 99 })
    expect(parseRange('bytes=0-999', 100)).toEqual({ kind: 'partial', start: 0, end: 99 })
  })

  it('reports unsatisfiable ranges', () => {
    expect(parseRange('bytes=100-', 100)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange('bytes=5-2', 100)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange('bytes=-0', 100)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange('bytes=0-0', 0)).toEqual({ kind: 'unsatisfiable' })
  })
})

describe('sessions and passwords', () => {
  it('verifies a token it created and rejects tampering or another secret', () => {
    const token = createSessionToken(SECRET)
    expect(verifySessionToken(token, SECRET)).toBe(true)
    expect(verifySessionToken(token, Buffer.from('b'.repeat(64), 'hex'))).toBe(false)
    const [random, mac] = token.split('.') as [string, string]
    const flipped = mac.slice(0, -1) + (mac.endsWith('0') ? '1' : '0')
    expect(verifySessionToken(`${random}.${flipped}`, SECRET)).toBe(false)
    expect(verifySessionToken(undefined, SECRET)).toBe(false)
    expect(verifySessionToken('nonsense', SECRET)).toBe(false)
  })

  it('creates a 32-byte hex random part each time', () => {
    const a = createSessionToken(SECRET).split('.')[0]
    const b = createSessionToken(SECRET).split('.')[0]
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
  })

  it('compares passwords exactly', () => {
    expect(passwordMatches('correct horse', 'correct horse')).toBe(true)
    expect(passwordMatches('correct horse ', 'correct horse')).toBe(false)
    expect(passwordMatches('', 'correct horse')).toBe(false)
  })

  it('reads one cookie from a Cookie header', () => {
    expect(readCookie('a=1; gl_session=xyz; b=2', 'gl_session')).toBe('xyz')
    expect(readCookie('gl_sessionx=1', 'gl_session')).toBeUndefined()
    expect(readCookie(undefined, 'gl_session')).toBeUndefined()
  })
})

describe('createRateLimiter', () => {
  it('blocks after the maximum failures inside the window and frees up after it', () => {
    const limiter = createRateLimiter(5, 10 * 60 * 1000)
    const t0 = 1_000_000
    for (let i = 0; i < 5; i++) {
      expect(limiter.isBlocked('1.2.3.4', t0)).toBe(false)
      limiter.recordFailure('1.2.3.4', t0 + i)
    }
    expect(limiter.isBlocked('1.2.3.4', t0 + 10)).toBe(true)
    expect(limiter.isBlocked('5.6.7.8', t0 + 10)).toBe(false)
    expect(limiter.isBlocked('1.2.3.4', t0 + 10 * 60 * 1000 + 5)).toBe(false)
  })

  it('clears a key after a successful login', () => {
    const limiter = createRateLimiter(2, 60_000)
    limiter.recordFailure('ip', 0)
    limiter.recordFailure('ip', 0)
    expect(limiter.isBlocked('ip', 1)).toBe(true)
    limiter.clear('ip')
    expect(limiter.isBlocked('ip', 1)).toBe(false)
  })
})

describe('small helpers', () => {
  it('picks a Content-Type by extension', () => {
    expect(mimeFor('a.PDF')).toBe('application/pdf')
    expect(mimeFor('a.tif')).toBe('image/tiff')
    expect(mimeFor('a.txt')).toBe('text/plain')
    expect(mimeFor('a.gp5')).toBe('application/octet-stream')
    expect(mimeFor('a.gtp')).toBe('application/octet-stream')
    expect(mimeFor('noext')).toBe('application/octet-stream')
  })

  it('builds a download disposition with a UTF-8 name', () => {
    const d = attachmentDisposition('七里香.gp4')
    expect(d).toContain("filename*=UTF-8''%E4%B8%83%E9%87%8C%E9%A6%99.gp4")
    expect(d).toMatch(/filename="[\x20-\x7e]*"/)
  })

  it('decodes UTF-8, then GBK for non-UTF-8 bytes', () => {
    expect(decodeText(new TextEncoder().encode('七里香'))).toBe('七里香')
    // "七里香" in GBK
    const gbk = Uint8Array.from([0xc6, 0xdf, 0xc0, 0xef, 0xcf, 0xe3])
    expect(decodeText(gbk)).toBe('七里香')
  })

  it('maps items with a concurrency limit and keeps the order', async () => {
    let inFlight = 0
    let peak = 0
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return n * 10
    })
    expect(out).toEqual([10, 20, 30, 40, 50, 60])
    expect(peak).toBeLessThanOrEqual(2)
  })
})

describe('favourites (server/favorites.ts)', () => {
  const root = path.resolve(os.tmpdir(), 'gl-root')
  const inRoot = inRootOf(root)
  const body = (over: Record<string, unknown> = {}) => ({
    path: '1-华语/男歌手/周杰伦/七里香.gp5',
    format: 'score',
    pages: [],
    title: '七里香',
    artist: '周杰伦',
    ...over,
  })

  it('accepts a valid favourite and stamps addedAt', () => {
    const r = parseFavoriteInput(body({ pages: ['1-华语/a.png'], format: 'image' }), inRoot, 42)
    expect(r).toEqual({
      ok: true,
      value: {
        path: '1-华语/男歌手/周杰伦/七里香.gp5',
        format: 'image',
        pages: ['1-华语/a.png'],
        title: '七里香',
        artist: '周杰伦',
        addedAt: 42,
      },
    })
  })

  it('rejects paths and pages outside the root', () => {
    expect(parseFavoriteInput(body({ path: '../secret.gp5' }), inRoot, 0).ok).toBe(false)
    expect(parseFavoriteInput(body({ path: '/etc/passwd' }), inRoot, 0).ok).toBe(false)
    expect(parseFavoriteInput(body({ pages: ['../../x.png'] }), inRoot, 0).ok).toBe(false)
    expect(parseFavoriteInput(body({ path: 5 }), inRoot, 0).ok).toBe(false)
  })

  it('rejects unknown formats, too many pages and over-long texts', () => {
    expect(parseFavoriteInput(body({ format: 'exe' }), inRoot, 0).ok).toBe(false)
    const many = Array.from({ length: 201 }, (_, i) => `1/${i}.png`)
    expect(parseFavoriteInput(body({ pages: many }), inRoot, 0).ok).toBe(false)
    expect(parseFavoriteInput(body({ title: 'a'.repeat(301) }), inRoot, 0).ok).toBe(false)
    expect(parseFavoriteInput(body({ artist: 3 }), inRoot, 0).ok).toBe(false)
    expect(parseFavoriteInput(body({ title: '七'.repeat(300) }), inRoot, 0).ok).toBe(true)
  })

  it('validates the remove body', () => {
    expect(parseFavoritePath({ path: '1-华语/a.gp5' }, inRoot)).toEqual({
      ok: true,
      value: '1-华语/a.gp5',
    })
    expect(parseFavoritePath({ path: '../a.gp5' }, inRoot).ok).toBe(false)
    expect(parseFavoritePath({}, inRoot).ok).toBe(false)
  })

  it('upserts by path to the front and removes by path', () => {
    const item = (p: string, addedAt: number): FavoriteItem => ({
      path: p,
      format: 'score',
      pages: [],
      title: p,
      artist: '',
      addedAt,
    })
    let list = upsertFavorite([], item('a', 1))
    list = upsertFavorite(list, item('b', 2))
    list = upsertFavorite(list, item('a', 3))
    expect(list.map((f) => [f.path, f.addedAt])).toEqual([
      ['a', 3],
      ['b', 2],
    ])
    expect(removeFavorite(list, 'a').map((f) => f.path)).toEqual(['b'])
    expect(removeFavorite(list, 'zz')).toHaveLength(2)
  })

  it('caps the list at 2000 entries', () => {
    let list: FavoriteItem[] = []
    for (let i = 0; i < MAX_FAVORITES + 5; i++)
      list = upsertFavorite(list, {
        path: `p${i}`,
        format: 'other',
        pages: [],
        title: '',
        artist: '',
        addedAt: i,
      })
    expect(list).toHaveLength(MAX_FAVORITES)
    expect(list[0]!.path).toBe(`p${MAX_FAVORITES + 4}`)
  })

  it('drops invalid entries from a stored file', () => {
    const kept = sanitizeFavorites(
      [body({ addedAt: 5 }), body({ path: '../x.gp5', addedAt: 6 }), 'junk', null],
      inRoot,
    )
    expect(kept.map((f) => f.addedAt)).toEqual([5])
    expect(sanitizeFavorites({ not: 'array' }, inRoot)).toEqual([])
  })

  it('parses a name: trimmed, 1–60 code points, empty clears', () => {
    expect(parseAlias('  春日影  ')).toEqual({ ok: true, value: '春日影' })
    expect(parseAlias('')).toEqual({ ok: true, value: null })
    expect(parseAlias('   ')).toEqual({ ok: true, value: null })
    expect(parseAlias(null)).toEqual({ ok: true, value: null })
    expect(parseAlias('七'.repeat(60))).toEqual({ ok: true, value: '七'.repeat(60) })
    expect(parseAlias('七'.repeat(61))).toEqual({ ok: false, error: '名字要在 1–60 个字之间。' })
    expect(parseAlias(3).ok).toBe(false)
    expect(parseAlias(undefined).ok).toBe(false)
  })

  it('parses a rename request and rejects an unknown or outside path', () => {
    expect(parseRenameInput({ path: '1-华语/a.gp5', alias: ' 我的版本 ' }, inRoot)).toEqual({
      ok: true,
      value: { path: '1-华语/a.gp5', alias: '我的版本' },
    })
    expect(parseRenameInput({ path: '1-华语/a.gp5', alias: null }, inRoot)).toEqual({
      ok: true,
      value: { path: '1-华语/a.gp5', alias: null },
    })
    expect(parseRenameInput({ path: '../a.gp5', alias: 'x' }, inRoot).ok).toBe(false)
    expect(parseRenameInput({ path: 'a.gp5', alias: 'a'.repeat(61) }, inRoot)).toEqual({
      ok: false,
      error: '名字要在 1–60 个字之间。',
    })
  })

  it('parses a song rename request with at most 500 paths', () => {
    expect(parseRenameSongInput({ paths: ['a', 'b'], songAlias: '春日影' })).toEqual({
      ok: true,
      value: { paths: ['a', 'b'], songAlias: '春日影' },
    })
    expect(parseRenameSongInput({ paths: 'a', songAlias: 'x' }).ok).toBe(false)
    expect(parseRenameSongInput({ paths: [1], songAlias: 'x' }).ok).toBe(false)
    const many = Array.from({ length: 501 }, (_, i) => `p${i}`)
    expect(parseRenameSongInput({ paths: many, songAlias: null }).ok).toBe(false)
    expect(parseRenameSongInput({ paths: ['a'], songAlias: 'x'.repeat(61) }).ok).toBe(false)
  })

  it('renames and clears names on the listed items only', () => {
    const base = (p: string, extra: Partial<FavoriteItem> = {}): FavoriteItem => ({
      path: p,
      format: 'score',
      pages: [],
      title: p,
      artist: '',
      addedAt: 1,
      ...extra,
    })
    const list = [base('a'), base('b', { songAlias: '旧名' }), base('c')]
    const named = renameItems(list, ['a'], 'alias', '我的')
    expect(named[0]!.alias).toBe('我的')
    expect(named[1]).toBe(list[1])
    const song = renameItems(named, ['a', 'b', 'zz'], 'songAlias', '新名')
    expect(song.map((f) => f.songAlias)).toEqual(['新名', '新名', undefined])
    const cleared = renameItems(song, ['a'], 'alias', null)
    expect('alias' in cleared[0]!).toBe(false)
    expect(cleared[0]!.songAlias).toBe('新名')
  })

  it('keeps names when a file is added again, and drops invalid stored names on load', () => {
    const item = (addedAt: number, extra: Partial<FavoriteItem> = {}): FavoriteItem => ({
      path: '1-华语/a.gp5',
      format: 'score',
      pages: [],
      title: 'a',
      artist: '',
      addedAt,
      ...extra,
    })
    const again = upsertFavorite([item(1, { alias: '我的', songAlias: '歌' })], item(9))
    expect(again[0]).toMatchObject({ addedAt: 9, alias: '我的', songAlias: '歌' })

    const kept = sanitizeFavorites(
      [
        { ...body({ addedAt: 5 }), alias: '  好名字 ', songAlias: 'x'.repeat(61) },
        { ...body({ path: '1-华语/b.gp5', addedAt: 6 }), alias: 42 },
      ],
      inRoot,
    )
    expect(kept[0]).toMatchObject({ alias: '好名字' })
    expect('songAlias' in kept[0]!).toBe(false)
    expect(kept[1]!.alias).toBeUndefined()
    expect(kept).toHaveLength(2)
  })

  it('runs queued writes one at a time', async () => {
    const queue = createSerialQueue()
    const order: number[] = []
    await Promise.all([
      queue(async () => {
        await new Promise((r) => setTimeout(r, 20))
        order.push(1)
      }),
      queue(async () => {
        order.push(2)
      }),
      queue(() => Promise.reject(new Error('boom'))).catch(() => {}),
      queue(async () => {
        order.push(3)
      }),
    ])
    expect(order).toEqual([1, 2, 3])
  })
})

describe('catalog filters (server/catalog.ts)', () => {
  const files: Array<[string, number]> = [
    ['1-华语/男歌手/周杰伦/七里香.gp5', 10],
    ['1-华语/男歌手/周杰伦/七里香1.png', 10],
    ['1-华语/男歌手/周杰伦/七里香2.png', 10],
    ['1-华语/男歌手/周杰伦/晴天.gp5', 10],
    ['2-欧美/流行摇滚/Queen/Queen - Bohemian Rhapsody.gp4', 10],
    ['2-欧美/流行摇滚/Queen/Queen - Bohemian Rhapsody.pdf', 10],
  ]
  const lib = buildLibrary(files, PLAIN_TOOLS)
  const index = buildSearchIndex(lib, PLAIN_TOOLS)

  it('parses and validates query parameters', () => {
    expect(parseCatalogParams(new URLSearchParams('')).ok).toBe(true)
    expect(parseCatalogParams(new URLSearchParams('fmt=image&cat=1-华语&sort=ver'))).toEqual({
      ok: true,
      value: { fmt: 'image', cat: '1-华语', sort: 'ver' },
    })
    expect(parseCatalogParams(new URLSearchParams('fmt=exe')).ok).toBe(false)
    expect(parseCatalogParams(new URLSearchParams('sort=random')).ok).toBe(false)
    expect(parseCatalogParams(new URLSearchParams('cat=1/../2')).ok).toBe(false)
  })

  it('clamps the top limit', () => {
    expect(parseTopLimit(null)).toBe(50)
    expect(parseTopLimit('')).toBe(50)
    expect(parseTopLimit('0')).toBe(1)
    expect(parseTopLimit('999')).toBe(200)
    expect(parseTopLimit('abc')).toBe(50)
  })

  it('keeps only songs with the format, and only those versions', () => {
    const r = search(lib, narrowIndex(index, { fmt: 'image' }), '七里香', PLAIN_TOOLS)
    expect(r.songs).toHaveLength(1)
    expect(r.songs[0]!.song.versions.every((v) => v.file.format === 'image')).toBe(true)
    const none = search(lib, narrowIndex(index, { fmt: 'midi' }), '七里香', PLAIN_TOOLS)
    expect(none.songs).toHaveLength(0)
  })

  it('keeps songs and artists under the category', () => {
    const r = search(lib, narrowIndex(index, { cat: '1-华语' }), 'Queen', PLAIN_TOOLS)
    expect(r.songs).toHaveLength(0)
    expect(r.artists).toHaveLength(0)
    const q = search(lib, narrowIndex(index, { cat: '2-欧美' }), 'Queen', PLAIN_TOOLS)
    expect(q.artists.map((a) => a.name)).toEqual(['Queen'])
    const wrong = search(lib, narrowIndex(index, { cat: '1-华语' }), '七里香', PLAIN_TOOLS)
    expect(wrong.songs.length).toBeGreaterThan(0)
    const none = search(lib, narrowIndex(index, { cat: '2-欧美' }), '七里香', PLAIN_TOOLS)
    expect(none.songs).toHaveLength(0)
  })

  it('applies the filter before the 200-song limit', () => {
    const many: Array<[string, number]> = []
    for (let i = 0; i < 260; i++) many.push([`2-欧美/流行摇滚/Band/Love Song ${i}.gp5`, 1])
    for (let i = 0; i < 3; i++) many.push([`1-华语/男歌手/某人/爱情故事${i}.png`, 1])
    const big = buildLibrary(many, PLAIN_TOOLS)
    const bigIndex = buildSearchIndex(big, PLAIN_TOOLS)
    // 爱情故事0/1/2 are one song (the trailing digit is a version).
    const unfiltered = search(big, bigIndex, '爱情', PLAIN_TOOLS)
    expect(unfiltered.songs).toHaveLength(1)
    const cat = search(big, narrowIndex(bigIndex, { cat: '1-华语' }), '爱情故事', PLAIN_TOOLS)
    expect(cat.songs.length).toBe(1)
    const loveAll = search(big, narrowIndex(bigIndex, { cat: '2-欧美' }), 'love', PLAIN_TOOLS)
    expect(loveAll.songs).toHaveLength(200)
    expect(loveAll.moreSongs).toBe(true)
    const loveWrongCat = search(big, narrowIndex(bigIndex, { cat: '1-华语' }), 'love', PLAIN_TOOLS)
    expect(loveWrongCat.songs).toHaveLength(0)
    const loveNone = search(big, narrowIndex(bigIndex, { fmt: 'pdf' }), 'love', PLAIN_TOOLS)
    expect(loveNone.songs).toHaveLength(0)
    expect(loveNone.moreSongs).toBe(false)
  })

  it('sorts results by name, and keeps the count for version sort', () => {
    const r = search(lib, index, '七里香', PLAIN_TOOLS)
    const first = r.songs[0]!
    const byName = sortResultSongs(
      [
        { ...first, song: { ...first.song, title: '晴天' } },
        { ...first, song: { ...first.song, title: '七里香' } },
      ],
      'name',
    )
    expect(byName.map((x) => x.song.title)).toEqual(['七里香', '晴天'])
    expect(sortResultSongs([...r.songs], 'ver')).toHaveLength(r.songs.length)
  })

  it('ranks songs by version count and filters the top list', () => {
    const ranked = rankByVersions(lib)
    expect(ranked[0]!.song.title).toBe('七里香')
    expect(ranked.every((r) => !r.song.unknownTitle)).toBe(true)
    const top = topSongs(ranked, { cat: '2-欧美' }, 50)
    expect(top.songs.every((s) => s.song.artistId.startsWith('2-欧美/'))).toBe(true)
    expect(top.moreSongs).toBe(false)
    const one = topSongs(ranked, {}, 1)
    expect(one.songs).toHaveLength(1)
    expect(one.moreSongs).toBe(true)
    const img = topSongs(ranked, { fmt: 'image' }, 50)
    expect(img.songs.every((s) => s.song.versions.every((v) => v.file.format === 'image'))).toBe(
      true,
    )
  })
})

describe('practice records (server/practice.ts)', () => {
  const root = path.resolve(os.tmpdir(), 'gl-root')
  const inRoot = inRootOf(root)
  const P = '1-华语/男歌手/周杰伦/七里香.gp5'
  const body = (over: Record<string, unknown> = {}) => ({
    path: P,
    title: '七里香',
    artist: '周杰伦',
    ...over,
  })
  const rec = (over: Partial<PracticeRecord> = {}): PracticeRecord => ({
    path: P,
    title: '七里香',
    artist: '周杰伦',
    speedPct: 100,
    loopBars: null,
    muted: [],
    totalSeconds: 0,
    maxSpeedPct: 0,
    firstAt: 0,
    lastAt: 0,
    ...over,
  })

  describe('parsePracticeUpdate', () => {
    it('accepts a valid full body', () => {
      const r = parsePracticeUpdate(
        body({
          speedPct: 80,
          loopBars: [2, 4],
          muted: [3, 1],
          addSeconds: 12.5,
          playedSpeedPct: 90,
        }),
        inRoot,
      )
      expect(r).toEqual({
        ok: true,
        value: {
          path: P,
          title: '七里香',
          artist: '周杰伦',
          speedPct: 80,
          loopBars: [2, 4],
          muted: [1, 3],
          addSeconds: 12.5,
          playedSpeedPct: 90,
        },
      })
    })

    it('accepts a body with only the required fields', () => {
      expect(parsePracticeUpdate(body(), inRoot)).toEqual({
        ok: true,
        value: { path: P, title: '七里香', artist: '周杰伦' },
      })
    })

    it('rejects a path outside the root, empty, or not a string', () => {
      expect(parsePracticeUpdate(body({ path: '../x.gp5' }), inRoot).ok).toBe(false)
      expect(parsePracticeUpdate(body({ path: '/etc/passwd' }), inRoot).ok).toBe(false)
      expect(parsePracticeUpdate(body({ path: '' }), inRoot).ok).toBe(false)
      expect(parsePracticeUpdate(body({ path: 5 }), inRoot).ok).toBe(false)
    })

    it('rejects over-long titles and artists', () => {
      expect(parsePracticeUpdate(body({ title: 'a'.repeat(301) }), inRoot).ok).toBe(false)
      expect(parsePracticeUpdate(body({ artist: 'a'.repeat(301) }), inRoot).ok).toBe(false)
      expect(parsePracticeUpdate(body({ title: '七'.repeat(300) }), inRoot).ok).toBe(true)
    })

    it('rejects speeds outside 15–175 or not integers', () => {
      for (const speedPct of [14, 176, 1.5])
        expect(parsePracticeUpdate(body({ speedPct }), inRoot).ok).toBe(false)
      expect(parsePracticeUpdate(body({ speedPct: 15 }), inRoot).ok).toBe(true)
      expect(parsePracticeUpdate(body({ speedPct: 175 }), inRoot).ok).toBe(true)
    })

    it('rejects bad loop bars', () => {
      for (const loopBars of [[3, 2], [0, 1], [1], 'x'])
        expect(parsePracticeUpdate(body({ loopBars }), inRoot).ok).toBe(false)
      expect(parsePracticeUpdate(body({ loopBars: null }), inRoot)).toEqual({
        ok: true,
        value: { path: P, title: '七里香', artist: '周杰伦', loopBars: null },
      })
    })

    it('rejects bad muted tracks', () => {
      expect(parsePracticeUpdate(body({ muted: [-1] }), inRoot).ok).toBe(false)
      expect(parsePracticeUpdate(body({ muted: [64] }), inRoot).ok).toBe(false)
      expect(parsePracticeUpdate(body({ muted: 'x' }), inRoot).ok).toBe(false)
      expect(parsePracticeUpdate(body({ muted: 3 }), inRoot).ok).toBe(false)
    })

    it('dedupes and sorts muted tracks', () => {
      const r = parsePracticeUpdate(body({ muted: [5, 1, 5, 0] }), inRoot)
      expect(r.ok && r.value.muted).toEqual([0, 1, 5])
    })

    it('rejects a negative or non-finite addSeconds and clamps large ones', () => {
      expect(parsePracticeUpdate(body({ addSeconds: -1 }), inRoot).ok).toBe(false)
      expect(parsePracticeUpdate(body({ addSeconds: NaN }), inRoot).ok).toBe(false)
      const r = parsePracticeUpdate(body({ addSeconds: 9999 }), inRoot)
      expect(r.ok && r.value.addSeconds).toBe(MAX_ADD_SECONDS)
    })

    it('rejects a bad playedSpeedPct', () => {
      expect(parsePracticeUpdate(body({ playedSpeedPct: 14 }), inRoot).ok).toBe(false)
      expect(parsePracticeUpdate(body({ playedSpeedPct: 200 }), inRoot).ok).toBe(false)
    })
  })

  it('validates the remove body', () => {
    expect(parsePracticePath({ path: P }, inRoot)).toEqual({ ok: true, value: P })
    expect(parsePracticePath({ path: '../a.gp5' }, inRoot).ok).toBe(false)
    expect(parsePracticePath({}, inRoot).ok).toBe(false)
  })

  describe('applyPracticeUpdate', () => {
    it('creates a new record with defaults', () => {
      const { list, record } = applyPracticeUpdate([], { path: P, title: 't', artist: 'a' }, 100)
      expect(record).toEqual({
        path: P,
        title: 't',
        artist: 'a',
        speedPct: 100,
        loopBars: null,
        muted: [],
        totalSeconds: 0,
        maxSpeedPct: 0,
        firstAt: 100,
        lastAt: 100,
      })
      expect(list).toEqual([record])
    })

    it('keeps fields the update does not give', () => {
      const old = rec({ speedPct: 80, loopBars: [1, 2], muted: [3] })
      const { record } = applyPracticeUpdate([old], { ...body(), addSeconds: 5 }, 50)
      expect(record.speedPct).toBe(80)
      expect(record.loopBars).toEqual([1, 2])
      expect(record.muted).toEqual([3])
    })

    it('clears the loop when loopBars is null', () => {
      const old = rec({ loopBars: [1, 2] })
      const { record } = applyPracticeUpdate([old], { ...body(), loopBars: null }, 50)
      expect(record.loopBars).toBeNull()
    })

    it('overwrites title and artist, keeps firstAt, sets lastAt', () => {
      const old = rec({ title: 'old', artist: 'old', firstAt: 10, lastAt: 20 })
      const { record } = applyPracticeUpdate([old], { path: P, title: 'new', artist: 'new' }, 500)
      expect(record.title).toBe('new')
      expect(record.artist).toBe('new')
      expect(record.firstAt).toBe(10)
      expect(record.lastAt).toBe(500)
    })

    it('accumulates totalSeconds', () => {
      const first = applyPracticeUpdate([], { ...body(), addSeconds: 10 }, 1)
      const { record } = applyPracticeUpdate(first.list, { ...body(), addSeconds: 20 }, 2)
      expect(record.totalSeconds).toBe(30)
    })

    it('updates maxSpeedPct only when time was added', () => {
      const idle = applyPracticeUpdate([], { ...body(), playedSpeedPct: 150 }, 1)
      expect(idle.record.maxSpeedPct).toBe(0)
      const played = applyPracticeUpdate(
        idle.list,
        { ...body(), addSeconds: 10, playedSpeedPct: 150 },
        2,
      )
      expect(played.record.maxSpeedPct).toBe(150)
      const slower = applyPracticeUpdate(
        played.list,
        { ...body(), addSeconds: 10, playedSpeedPct: 120 },
        3,
      )
      expect(slower.record.maxSpeedPct).toBe(150)
    })

    it('sorts the list by lastAt, newest first', () => {
      const list = [rec({ path: 'a', lastAt: 5 }), rec({ path: 'b', lastAt: 9 })]
      const { list: next } = applyPracticeUpdate(list, { path: 'c', title: '', artist: '' }, 7)
      expect(next.map((r) => r.path)).toEqual(['b', 'c', 'a'])
    })

    it('caps the list at MAX_PRACTICE, dropping the oldest', () => {
      const list: PracticeRecord[] = []
      for (let i = 0; i < MAX_PRACTICE; i++) list.push(rec({ path: `p${i}`, lastAt: i + 1 }))
      const { list: next } = applyPracticeUpdate(list, { path: 'new', title: '', artist: '' }, 1e9)
      expect(next).toHaveLength(MAX_PRACTICE)
      expect(next[0]!.path).toBe('new')
      expect(next.some((r) => r.path === 'p0')).toBe(false)
    })
  })

  it('removes a record by path', () => {
    const list = [rec({ path: 'a' }), rec({ path: 'b' })]
    expect(removePractice(list, 'a').map((r) => r.path)).toEqual(['b'])
    expect(removePractice(list, 'zz')).toHaveLength(2)
  })

  describe('sanitizePractice', () => {
    it('returns an empty list for a non-array', () => {
      expect(sanitizePractice({ not: 'array' }, inRoot)).toEqual([])
    })

    it('drops invalid entries and fills defaults for missing fields', () => {
      const out = sanitizePractice(
        [
          { ...body(), path: 'a.gp5', lastAt: 5, totalSeconds: 7, speedPct: 90, muted: [2, 0] },
          { ...body(), path: '../x.gp5', lastAt: 6 },
          { ...body(), path: 'b.gp5', speedPct: 14 },
          { ...body(), path: 'c.gp5', lastAt: 9 },
          'junk',
          null,
        ],
        inRoot,
      )
      expect(out.map((r) => r.path)).toEqual(['c.gp5', 'a.gp5'])
      expect(out[0]).toEqual({
        path: 'c.gp5',
        title: '七里香',
        artist: '周杰伦',
        speedPct: 100,
        loopBars: null,
        muted: [],
        totalSeconds: 0,
        maxSpeedPct: 0,
        firstAt: 0,
        lastAt: 9,
      })
      expect(out[1]).toMatchObject({ path: 'a.gp5', totalSeconds: 7, speedPct: 90, muted: [0, 2] })
    })

    it('clamps negative totals and resets an invalid maxSpeedPct', () => {
      const out = sanitizePractice(
        [
          { ...body(), path: 'a.gp5', totalSeconds: -4, maxSpeedPct: 300 },
          { ...body(), path: 'b.gp5', totalSeconds: 3, maxSpeedPct: 150 },
        ],
        inRoot,
      )
      const a = out.find((r) => r.path === 'a.gp5')!
      const b = out.find((r) => r.path === 'b.gp5')!
      expect(a.totalSeconds).toBe(0)
      expect(a.maxSpeedPct).toBe(0)
      expect(b.totalSeconds).toBe(3)
      expect(b.maxSpeedPct).toBe(150)
    })
  })
})

describe('per-user persistence (favourites and practice)', () => {
  const root = path.resolve(os.tmpdir(), 'gl-root')
  const inRoot = inRootOf(root)
  const dirs: string[] = []
  const freshDir = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-persist-'))
    dirs.push(d)
    return d
  }
  afterAll(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
  })

  const fav = (p: string, addedAt: number): FavoriteItem => ({
    path: p,
    format: 'score',
    pages: [],
    title: p,
    artist: '',
    addedAt,
  })
  const prac = (p: string, over: Partial<PracticeRecord> = {}): PracticeRecord => ({
    path: p,
    title: p,
    artist: '',
    speedPct: 100,
    loopBars: null,
    muted: [],
    totalSeconds: 0,
    maxSpeedPct: 0,
    firstAt: 0,
    lastAt: 0,
    ...over,
  })

  describe('favourites', () => {
    it('migrates an old single-list file to the admin account', async () => {
      const dir = freshDir()
      fs.writeFileSync(
        path.join(dir, 'favorites.json'),
        JSON.stringify([fav('1-华语/a.gp5', 5), { not: 'valid' }]),
      )
      const map = await loadFavoritesByUser(dir, inRoot, 'admin-1')
      expect([...map.keys()]).toEqual(['admin-1'])
      expect(map.get('admin-1')!.map((f) => f.path)).toEqual(['1-华语/a.gp5'])
      // Nothing is rewritten until the next save.
      expect(JSON.parse(fs.readFileSync(path.join(dir, 'favorites.json'), 'utf8'))).toHaveLength(2)

      await saveFavoritesByUser(dir, map)
      const stored = JSON.parse(fs.readFileSync(path.join(dir, 'favorites.json'), 'utf8'))
      expect(stored.version).toBe(2)
      expect(Object.keys(stored.users)).toEqual(['admin-1'])
      expect(stored.users['admin-1']).toHaveLength(1)
    })

    it('returns an empty map when the file is missing', async () => {
      const map = await loadFavoritesByUser(freshDir(), inRoot, 'admin-1')
      expect(map.size).toBe(0)
    })

    it('sets a corrupt file aside and starts empty', async () => {
      const dir = freshDir()
      fs.writeFileSync(path.join(dir, 'favorites.json'), '{ broken')
      const map = await loadFavoritesByUser(dir, inRoot, 'admin-1')
      expect(map.size).toBe(0)
      expect(fs.existsSync(path.join(dir, 'favorites.json'))).toBe(false)
      expect(fs.readdirSync(dir).some((n) => n.startsWith('favorites.json.broken-'))).toBe(true)
    })

    it('round-trips the v2 map and keeps each user isolated', async () => {
      const dir = freshDir()
      const map: FavoritesByUser = new Map([
        ['admin-1', [fav('a.gp5', 2), fav('b.gp5', 1)]],
        ['user-2', [fav('b.gp5', 3)]],
      ])
      await saveFavoritesByUser(dir, map)
      const back = await loadFavoritesByUser(dir, inRoot, 'admin-1')
      expect(back.get('admin-1')).toEqual(map.get('admin-1'))
      expect(back.get('user-2')).toEqual(map.get('user-2'))

      // Removing from one user leaves the other user's copy of the same score.
      back.set('admin-1', removeFavorite(back.get('admin-1')!, 'b.gp5'))
      expect(back.get('admin-1')!.map((f) => f.path)).toEqual(['a.gp5'])
      expect(back.get('user-2')!.map((f) => f.path)).toEqual(['b.gp5'])
    })

    it('drops invalid entries per user and ignores unknown versions', async () => {
      const dir = freshDir()
      fs.writeFileSync(
        path.join(dir, 'favorites.json'),
        JSON.stringify({
          version: 2,
          users: { u1: [fav('ok.gp5', 1), fav('../bad.gp5', 2)], u2: 'junk' },
        }),
      )
      const map = await loadFavoritesByUser(dir, inRoot, 'admin-1')
      expect(map.get('u1')!.map((f) => f.path)).toEqual(['ok.gp5'])
      expect(map.get('u2')).toEqual([])

      fs.writeFileSync(path.join(dir, 'favorites.json'), JSON.stringify({ version: 9, users: {} }))
      expect((await loadFavoritesByUser(dir, inRoot, 'admin-1')).size).toBe(0)
    })
  })

  describe('practice', () => {
    const P = 'a.gp5'

    it('migrates an old single-list file to the admin account', async () => {
      const dir = freshDir()
      fs.writeFileSync(
        path.join(dir, 'practice.json'),
        JSON.stringify([{ ...prac(P), title: 't', totalSeconds: 9, lastAt: 4 }]),
      )
      const map = await loadPracticeByUser(dir, inRoot, 'admin-1')
      expect([...map.keys()]).toEqual(['admin-1'])
      expect(map.get('admin-1')![0]).toMatchObject({ path: P, totalSeconds: 9 })

      await savePracticeByUser(dir, map)
      const stored = JSON.parse(fs.readFileSync(path.join(dir, 'practice.json'), 'utf8'))
      expect(stored.version).toBe(2)
      expect(Object.keys(stored.users)).toEqual(['admin-1'])
    })

    it('returns an empty map when the file is missing and sets a corrupt one aside', async () => {
      const dir = freshDir()
      expect((await loadPracticeByUser(dir, inRoot, 'admin-1')).size).toBe(0)
      fs.writeFileSync(path.join(dir, 'practice.json'), 'nope[')
      expect((await loadPracticeByUser(dir, inRoot, 'admin-1')).size).toBe(0)
      expect(fs.readdirSync(dir).some((n) => n.startsWith('practice.json.broken-'))).toBe(true)
    })

    it('round-trips the v2 map and keeps each user isolated', async () => {
      const dir = freshDir()
      const map: PracticeByUser = new Map([
        ['admin-1', [prac(P, { totalSeconds: 30, lastAt: 10 })]],
        ['user-2', [prac(P, { totalSeconds: 5, lastAt: 20 }), prac('b.gp5', { lastAt: 1 })]],
      ])
      await savePracticeByUser(dir, map)
      const back = await loadPracticeByUser(dir, inRoot, 'admin-1')
      expect(back.get('admin-1')).toEqual(map.get('admin-1'))
      expect(back.get('user-2')!.map((r) => r.path)).toEqual(['a.gp5', 'b.gp5'])
      expect(back.get('user-2')![0]!.totalSeconds).toBe(5)
    })
  })

  describe('progressFor', () => {
    it('lists only the users with a record for the path, most recent first', () => {
      const byUser: PracticeByUser = new Map([
        ['u1', [prac('x.gp5', { totalSeconds: 60, maxSpeedPct: 120, lastAt: 100 })]],
        ['u2', [prac('y.gp5', { lastAt: 999 })]],
        ['u3', [prac('x.gp5', { totalSeconds: 5, maxSpeedPct: 80, lastAt: 300 })]],
        ['u4', []],
      ])
      expect(progressFor(byUser, 'x.gp5')).toEqual([
        { userId: 'u3', totalSeconds: 5, maxSpeedPct: 80, lastAt: 300 },
        { userId: 'u1', totalSeconds: 60, maxSpeedPct: 120, lastAt: 100 },
      ])
    })

    it('returns an empty list when nobody practised the path', () => {
      expect(progressFor(new Map([['u1', [prac('y.gp5')]]]), 'x.gp5')).toEqual([])
      expect(progressFor(new Map(), 'x.gp5')).toEqual([])
    })
  })
})
