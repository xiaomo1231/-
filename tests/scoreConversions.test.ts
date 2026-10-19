// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONVERSIONS_DIR,
  CONVERSIONS_FILE,
  ConversionError,
  ConversionQueue,
  ConversionStore,
  type ConverterTool,
  conversionStatus,
  convertPdf,
  isGp5,
  MAX_CONVERSIONS,
  resolvePdf2gp,
  runConverter,
} from '../server/conversions'

// A stand-in for the Python CLI: run as `node fake.mjs <input> <output>`. The
// behaviour depends on the input file name.
const FAKE_SCRIPT = [
  "import fs from 'node:fs'",
  "import path from 'node:path'",
  'const [input, output] = process.argv.slice(2)',
  'const name = path.basename(input)',
  "const print = (o) => process.stdout.write(JSON.stringify(o) + '\\n')",
  "const gp5 = Buffer.concat([Buffer.from([0x17]), Buffer.from('FICHIER GUITAR PRO v5.10'), Buffer.alloc(100)])",
  "const okResult = { ok: true, bars: 12, tracks: ['吉他 1'], warnings: ['第 3 小节有点模糊'], title: '测试曲', artist: '测试歌手' }",
  "const fail = (kind, message) => { print({ ok: false, kind, message }); process.exitCode = 2 }",
  "if (name.includes('sleep')) { setInterval(() => {}, 1000) }",
  "else if (name.includes('flood')) { process.stdout.write('x'.repeat(100 * 1024)) }",
  "else if (name.includes('junk')) { process.stdout.write('not json at all\\n') }",
  "else if (name.includes('image')) fail('image', '这份 PDF 是扫描图片，请换一份文字版 PDF。')",
  "else if (name.includes('notab')) fail('no-tab', '没有找到乐谱的谱表。')",
  "else if (name.includes('invalid')) fail('invalid', 'PDF 文件无法读取。')",
  "else if (name.includes('big')) fail('too-big', '这份 PDF 页数太多。')",
  "else if (name.includes('boom')) fail('error', '转换组件内部错误。')",
  "else if (name.includes('weird')) fail('weird', '奇怪的错误。')",
  "else if (name.includes('nofile')) print(okResult)",
  "else if (name.includes('badgp')) { fs.writeFileSync(output, 'hello world'); print(okResult) }",
  "else { fs.writeFileSync(output, gp5); print(okResult) }",
].join('\n')

const GP5 = Buffer.concat([Buffer.from([0x17]), Buffer.from('FICHIER GUITAR PRO v5.10'), Buffer.alloc(100)])
const NOW = 1_700_000_000_000
const TIMEOUT = '转换超时（超过 2 分钟），这份 PDF 可能太复杂。'

let dir: string
let tool: ConverterTool

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-test-'))
  const script = path.join(dir, 'fake-convert.mjs')
  fs.writeFileSync(script, FAKE_SCRIPT)
  tool = { python: process.execPath, script }
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(dir, { recursive: true, force: true })
})

const meta = (songKey = 'song-a', sourcePath = 'a/score.pdf') => ({
  songKey,
  sourcePath,
  title: '标题',
  artist: '歌手',
  bars: 8,
  tracks: ['吉他'],
  warnings: [],
})

describe('resolvePdf2gp / conversionStatus', () => {
  it('finds the venv python and script under a pdf2gp folder', () => {
    const base = path.join(dir, 'app')
    const py =
      process.platform === 'win32'
        ? path.join(base, 'pdf2gp', '.venv', 'Scripts', 'python.exe')
        : path.join(base, 'pdf2gp', '.venv', 'bin', 'python')
    fs.mkdirSync(path.dirname(py), { recursive: true })
    fs.writeFileSync(py, '')
    fs.writeFileSync(path.join(base, 'pdf2gp', 'convert_cli.py'), '')
    const found = resolvePdf2gp([path.join(dir, 'nowhere'), base])
    expect(found).toEqual({ python: py, script: path.join(base, 'pdf2gp', 'convert_cli.py') })
  })

  it('returns null when a folder is incomplete', () => {
    fs.mkdirSync(path.join(dir, 'pdf2gp'), { recursive: true })
    expect(resolvePdf2gp([dir])).toBeNull()
  })

  it('reports availability and the Chinese reason', () => {
    expect(conversionStatus(tool)).toEqual({ available: true, reason: null })
    const off = conversionStatus(null)
    expect(off.available).toBe(false)
    expect(off.reason).toBe('服务器还没装 PDF 转换组件：请在服务器上安装 Python 3.11+ 并运行 pdf2gp/setup.sh。')
  })
})

describe('runConverter', () => {
  it('returns the parsed success result', async () => {
    const r = await runConverter(tool, 'ok.pdf', path.join(dir, 'out.gp5'))
    expect(r).toEqual({
      ok: true,
      bars: 12,
      tracks: ['吉他 1'],
      warnings: ['第 3 小节有点模糊'],
      title: '测试曲',
      artist: '测试歌手',
    })
  })

  it.each([
    ['image.pdf', 'image', '这份 PDF 是扫描图片，请换一份文字版 PDF。'],
    ['notab.pdf', 'no-tab', '没有找到乐谱的谱表。'],
    ['invalid.pdf', 'invalid', 'PDF 文件无法读取。'],
    ['big.pdf', 'too-big', '这份 PDF 页数太多。'],
    ['boom.pdf', 'error', '转换组件内部错误。'],
  ])('maps a %s failure to kind %s', async (file, kind, message) => {
    const r = await runConverter(tool, file, path.join(dir, 'out.gp5'))
    expect(r).toEqual({ ok: false, kind, message })
  })

  it('treats an unknown failure kind as error', async () => {
    const r = await runConverter(tool, 'weird.pdf', path.join(dir, 'out.gp5'))
    expect(r).toEqual({ ok: false, kind: 'error', message: '奇怪的错误。' })
  })

  it('kills a process that runs past the timeout', async () => {
    const r = await runConverter(tool, 'sleep.pdf', path.join(dir, 'out.gp5'), 300)
    expect(r).toEqual({ ok: false, kind: 'error', message: TIMEOUT })
  })

  it('reports non-JSON output as error', async () => {
    const r = await runConverter(tool, 'junk.pdf', path.join(dir, 'out.gp5'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.kind).toBe('error')
  })

  it('reports output over the 64 KB cap as error', async () => {
    const r = await runConverter(tool, 'flood.pdf', path.join(dir, 'out.gp5'))
    expect(r).toEqual({ ok: false, kind: 'error', message: '转换组件输出过长，已停止。' })
  })

  it('reports a python that cannot start as error', async () => {
    const r = await runConverter({ python: path.join(dir, 'no-such-python'), script: tool.script }, 'ok.pdf', 'x')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.kind).toBe('error')
  })
})

describe('ConversionQueue', () => {
  it('runs tasks one at a time in FIFO order', async () => {
    const queue = new ConversionQueue()
    let active = 0
    let maxActive = 0
    const order: number[] = []
    const task = (i: number) => async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 15))
      active--
      order.push(i)
      return i
    }
    const results = await Promise.all([0, 1, 2, 3].map((i) => queue.run(task(i))))
    expect(maxActive).toBe(1)
    expect(order).toEqual([0, 1, 2, 3])
    expect(results).toEqual([0, 1, 2, 3])
  })

  it('refuses the 7th request while one runs and five wait', async () => {
    const queue = new ConversionQueue()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const running = queue.run(() => gate)
    const waiting = [1, 2, 3, 4, 5].map((i) => queue.run(async () => i))
    await expect(queue.run(async () => 6)).rejects.toMatchObject({
      status: 429,
      message: '正在转换其他谱子，请稍后再试。',
    })
    release()
    await running
    await expect(Promise.all(waiting)).resolves.toEqual([1, 2, 3, 4, 5])
  })

  it('keeps going after a failed task', async () => {
    const queue = new ConversionQueue()
    await expect(queue.run(async () => Promise.reject(new Error('x')))).rejects.toThrow('x')
    await expect(queue.run(async () => 'next')).resolves.toBe('next')
  })
})

describe('ConversionStore', () => {
  it('adds, lists newest first, gets and finds by source', async () => {
    const store = await ConversionStore.load(dir)
    expect(store.list('song-a')).toEqual([])
    const first = await store.add(meta(), GP5, 'u1', NOW)
    const second = await store.add(meta('song-a', 'a/other.pdf'), GP5, 'u1', NOW + 1000)
    await store.add(meta('song-b', 'b/x.pdf'), GP5, 'u2', NOW + 2000)

    expect(store.list('song-a').map((i) => i.id)).toEqual([second.id, first.id])
    expect(store.get(first.id)?.createdBy).toBe('u1')
    expect(store.findBySource('a/score.pdf')?.id).toBe(first.id)
    expect(store.findBySource('none.pdf')).toBeUndefined()
    expect(fs.readFileSync(store.filePath(first.id)).equals(GP5)).toBe(true)
    expect(store.filePath(first.id)).toBe(path.join(dir, CONVERSIONS_DIR, `${first.id}.gp5`))
  })

  it('computes the average, count and myRating per user, and clears on 0', async () => {
    const store = await ConversionStore.load(dir)
    const item = await store.add(meta(), GP5, 'u1', NOW)
    await store.rate(item.id, 'u1', 5)
    await store.rate(item.id, 'u2', 4)
    await store.rate(item.id, 'u3', 4)

    const rec = store.toRecord(store.get(item.id)!, 'u2')
    expect(rec.rating).toEqual({ average: 4.3, count: 3 })
    expect(rec.myRating).toBe(4)
    expect(store.toRecord(store.get(item.id)!, 'nobody').myRating).toBeNull()
    expect(rec).not.toHaveProperty('ratings')

    await store.rate(item.id, 'u2', 0)
    const cleared = store.toRecord(store.get(item.id)!, 'u2')
    expect(cleared.rating).toEqual({ average: 4.5, count: 2 })
    expect(cleared.myRating).toBeNull()
  })

  it('rejects stars outside 0–5 and non-integers, and unknown ids', async () => {
    const store = await ConversionStore.load(dir)
    const item = await store.add(meta(), GP5, 'u1', NOW)
    await expect(store.rate(item.id, 'u1', 6)).rejects.toMatchObject({ status: 400 })
    await expect(store.rate(item.id, 'u1', 1.5)).rejects.toMatchObject({ status: 400 })
    await expect(store.rate('000000000000', 'u1', 3)).rejects.toMatchObject({ status: 404 })
  })

  it('removes the metadata and the file', async () => {
    const store = await ConversionStore.load(dir)
    const item = await store.add(meta(), GP5, 'u1', NOW)
    const file = store.filePath(item.id)
    await store.remove(item.id)
    expect(store.list('song-a')).toEqual([])
    expect(fs.existsSync(file)).toBe(false)
    await expect(store.remove(item.id)).rejects.toBeInstanceOf(ConversionError)
  })

  it('caps a song at 20 conversions', async () => {
    const store = await ConversionStore.load(dir)
    for (let i = 0; i < 20; i++) await store.add(meta(), GP5, 'u1', NOW + i)
    await expect(store.add(meta(), GP5, 'u1', NOW + 99)).rejects.toMatchObject({
      status: 400,
      message: '这首歌的转换版太多了，请先删掉一些。',
    })
    await store.add(meta('song-other'), GP5, 'u1', NOW)
    expect(store.list('song-a')).toHaveLength(20)
  })

  it('caps the store at 3000 by dropping the oldest', async () => {
    // Write 3000 rows (150 songs x 20) straight to disk, with their files.
    const rows = []
    const gdir = path.join(dir, CONVERSIONS_DIR)
    fs.mkdirSync(gdir, { recursive: true })
    for (let i = 0; i < MAX_CONVERSIONS; i++) {
      const id = i.toString(16).padStart(12, '0')
      fs.writeFileSync(path.join(gdir, `${id}.gp5`), GP5)
      rows.push({
        id,
        songKey: `song-${Math.floor(i / 20)}`,
        sourcePath: `p/${i}.pdf`,
        title: '',
        artist: '',
        createdBy: 'u1',
        createdAt: NOW + i,
        bars: 1,
        tracks: [],
        warnings: [],
        ratings: {},
      })
    }
    fs.writeFileSync(path.join(dir, CONVERSIONS_FILE), JSON.stringify({ version: 1, items: rows }))

    const store = await ConversionStore.load(dir)
    const added = await store.add(meta('song-new'), GP5, 'u1', NOW + 100000)
    const oldest = '000000000000'
    expect(store.get(oldest)).toBeUndefined()
    expect(fs.existsSync(path.join(gdir, `${oldest}.gp5`))).toBe(false)
    expect(store.get(added.id)).toBeDefined()
    expect(store.list('song-new')).toHaveLength(1)
    expect(store.list('song-0').length).toBe(19)
  })

  it('refuses bytes that are not GP5', async () => {
    const store = await ConversionStore.load(dir)
    await expect(store.add(meta(), Buffer.from('hello world'), 'u1', NOW)).rejects.toMatchObject({ status: 422 })
  })

  it('survives a reload with ratings intact', async () => {
    const store = await ConversionStore.load(dir)
    const item = await store.add(meta(), GP5, 'u1', NOW)
    await store.rate(item.id, 'u2', 3)
    const again = await ConversionStore.load(dir)
    expect(again.get(item.id)?.ratings).toEqual({ u2: 3 })
  })

  it('sets aside a corrupt file and starts empty', async () => {
    fs.writeFileSync(path.join(dir, CONVERSIONS_FILE), '{not json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = await ConversionStore.load(dir)
    expect(store.list('song-a')).toEqual([])
    expect(warn).toHaveBeenCalled()
    const kept = fs.readdirSync(dir).filter((f) => f.startsWith(`${CONVERSIONS_FILE}.broken-`))
    expect(kept).toHaveLength(1)
  })

  it('drops rows whose GP5 file is missing on load', async () => {
    const store = await ConversionStore.load(dir)
    const item = await store.add(meta(), GP5, 'u1', NOW)
    fs.rmSync(store.filePath(item.id))
    const again = await ConversionStore.load(dir)
    expect(again.list('song-a')).toEqual([])
  })

  it('starts empty when the file does not exist', async () => {
    const store = await ConversionStore.load(path.join(dir, 'fresh'))
    expect(store.list('x')).toEqual([])
  })
})

describe('convertPdf', () => {
  const opts = (store: ConversionStore, absPdf: string, tmpDir: string, queue = new ConversionQueue()) => ({
    tool,
    queue,
    store,
    absPdf,
    sourcePath: 'a/score.pdf',
    songKey: 'song-a',
    title: '',
    artist: '',
    userId: 'u1',
    tmpDir,
    now: NOW,
  })

  it('converts, stores, returns the record and leaves no temp file', async () => {
    const store = await ConversionStore.load(dir)
    const tmp = path.join(dir, 'tmp')
    const rec = await convertPdf(opts(store, path.join(dir, 'ok.pdf'), tmp))
    expect(rec.songKey).toBe('song-a')
    expect(rec.sourcePath).toBe('a/score.pdf')
    expect(rec.title).toBe('测试曲')
    expect(rec.artist).toBe('测试歌手')
    expect(rec.bars).toBe(12)
    expect(rec.tracks).toEqual(['吉他 1'])
    expect(rec.warnings).toEqual(['第 3 小节有点模糊'])
    expect(rec.rating).toEqual({ average: 0, count: 0 })
    expect(rec.myRating).toBeNull()
    expect(rec.createdBy).toBe('u1')
    expect(fs.readdirSync(tmp)).toEqual([])
    expect(store.findBySource('a/score.pdf')?.id).toBe(rec.id)
  })

  it.each([
    ['image.pdf', 422, '这份 PDF 是扫描图片，请换一份文字版 PDF。'],
    ['notab.pdf', 422, '没有找到乐谱的谱表。'],
    ['invalid.pdf', 422, 'PDF 文件无法读取。'],
    ['big.pdf', 422, '这份 PDF 页数太多。'],
    ['boom.pdf', 422, '转换组件内部错误。'],
    ['junk.pdf', 422, '转换组件没有返回可识别的结果，请稍后再试。'],
    ['nofile.pdf', 422, '转换没有生成乐谱文件，请换一份 PDF 再试。'],
    ['badgp.pdf', 422, '转换生成的文件不是有效的 Guitar Pro 乐谱，请换一份 PDF 再试。'],
  ])('maps %s to 422 and cleans the temp dir', async (file, status, message) => {
    const store = await ConversionStore.load(dir)
    const tmp = path.join(dir, 'tmp')
    await expect(convertPdf(opts(store, path.join(dir, file), tmp))).rejects.toMatchObject({ status, message })
    expect(fs.existsSync(tmp) ? fs.readdirSync(tmp) : []).toEqual([])
    expect(store.list('song-a')).toEqual([])
  })

  it('passes the queue busy error through', async () => {
    const store = await ConversionStore.load(dir)
    const queue = new ConversionQueue(0)
    let release!: () => void
    const busy = queue.run(() => new Promise<void>((r) => (release = r)))
    await expect(convertPdf(opts(store, path.join(dir, 'ok.pdf'), path.join(dir, 'tmp'), queue))).rejects.toMatchObject({
      status: 429,
    })
    release()
    await busy
  })
})

describe('isGp5', () => {
  it('checks the header at offset 1', () => {
    expect(isGp5(GP5)).toBe(true)
    expect(isGp5(Buffer.from('FICHIER GUITAR PRO'))).toBe(false)
    expect(isGp5(Buffer.from('<html>'))).toBe(false)
  })
})
