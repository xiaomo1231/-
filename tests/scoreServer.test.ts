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
