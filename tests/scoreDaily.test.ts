import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DailyProgressStore,
  dailyState,
  isDailyPath,
  loadDailyProgram,
  parseTempos,
} from '../server/daily'

const REAL_LIBRARY = 'F:\\吉他谱\\吉他谱库'
const CAT = '12-每日一练'

let tmp: string
let lib: string
let warn: ReturnType<typeof vi.spyOn>

function write(rel: string, content: string | Buffer = 'x'): void {
  const abs = path.join(lib, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

/** A small program folder mirroring the real layout. Day 2's image is missing; day 1 has everything. */
function buildProgram(indexText?: string): void {
  const index = indexText ?? JSON.stringify({
    天数: 365,
    伴奏库: [
      { 曲目: 1, 风格: '摇滚布鲁斯', 风格_英文: 'Rock', bpm: 40, 文件: '01_摇滚布鲁斯_40bpm.mp3' },
      { 曲目: 2, 风格: '摇滚布鲁斯', 风格_英文: 'Rock', bpm: 48, 文件: '02_摇滚布鲁斯_48bpm.mp3' },
      { 曲目: 3, 风格: '金属', 风格_英文: 'Metal', bpm: 56, 文件: '03_金属_56bpm.mp3' },
    ],
    每日: [
      {
        天: 1, 周: 1, 星期: '周一', 技巧: '交替拨弦', 伴奏风格: '金属', CD2曲目: '9-16',
        '伴奏速度(bpm)': '40/48/56/66', '示范时长(秒)': 11.2,
        文件夹: '第01周\\第001天_周一_交替拨弦',
      },
      {
        天: 2, 周: 1, 星期: '周二', 技巧: '跨弦', 伴奏风格: '摇滚布鲁斯', CD2曲目: '1-8',
        '伴奏速度(bpm)': '40/48', '示范时长(秒)': null,
        文件夹: '第01周\\第002天_周二_跨弦',
      },
    ],
  })
  write(`${CAT}/每日练习索引.json`, '\uFEFF' + index)
  write(`${CAT}/伴奏库/01_摇滚布鲁斯_40bpm.mp3`)
  write(`${CAT}/伴奏库/02_摇滚布鲁斯_48bpm.mp3`)
  // 03 is listed in the index but the file is absent.
  write(`${CAT}/第01周/第001天_周一_交替拨弦/练习谱.png`)
  write(`${CAT}/第01周/第001天_周一_交替拨弦/练习谱_英文.png`)
  write(`${CAT}/第01周/第001天_周一_交替拨弦/示范.mp3`)
  // Day 1: 56 is missing on disk, 60 escapes the program folder, the rest are out of order.
  write(
    `${CAT}/第01周/第001天_周一_交替拨弦/练习信息.json`,
    '\uFEFF' +
      JSON.stringify({
        天: 1,
        周: 1,
        星期: '周一',
        技巧: '交替拨弦',
        伴奏风格: '金属',
        伴奏: [
          { bpm: 56, 文件: '../../伴奏库/03_金属_56bpm_不存在.mp3' },
          { bpm: 48, 文件: '../../伴奏库/02_摇滚布鲁斯_48bpm.mp3' },
          { bpm: 40, 文件: '../../伴奏库/01_摇滚布鲁斯_40bpm.mp3' },
          { bpm: 60, 文件: '../../../../etc/passwd' },
        ],
        书页: { 中文版: 8, 英文版: 8 },
        练法: '先听示范，再跟伴奏从最慢速度开始，每个速度弹10遍，逐级加速。',
      }),
  )
  // Day 2: a list with one usable track, and no pages or method.
  write(
    `${CAT}/第01周/第002天_周二_跨弦/练习信息.json`,
    JSON.stringify({
      天: 2,
      伴奏: [{ bpm: 40, 文件: '../../伴奏库/01_摇滚布鲁斯_40bpm.mp3' }],
      书页: { 中文版: null, 英文版: null },
      练法: '  ',
    }),
  )
  write(`${CAT}/第01周/第002天_周二_跨弦/练习谱.png`)
  write(`${CAT}/第01周/第002天_周二_跨弦/练习谱_英文.png`)
  write(`${CAT}/全书/Guitar Aerobics(英文原版).pdf`)
  write(`${CAT}/全书/有氧吉他训练(中文版).pdf`)
  write(`${CAT}/全书/示范音频(整周)/第02周示范.mp3`)
  write(`${CAT}/全书/示范音频(整周)/第01周示范.mp3`)
  write(`${CAT}/全书/调音音频(E-A-D-G-B-E).mp3`)
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-'))
  lib = path.join(tmp, 'lib')
  fs.mkdirSync(lib, { recursive: true })
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warn.mockRestore()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('loadDailyProgram', () => {
  it('maps days, backing and extras to library-relative paths', async () => {
    buildProgram()
    const p = await loadDailyProgram(lib)
    expect(p.category).toBe(CAT)
    expect(p.days.map((d) => d.day)).toEqual([1, 2])

    const d1 = p.days[0]
    expect(d1).toMatchObject({
      day: 1,
      week: 1,
      weekday: '周一',
      technique: '交替拨弦',
      backingStyle: '金属',
      demoSeconds: 11.2,
    })
    expect(d1.imageZh).toBe(`${CAT}/第01周/第001天_周一_交替拨弦/练习谱.png`)
    expect(d1.imageEn).toBe(`${CAT}/第01周/第001天_周一_交替拨弦/练习谱_英文.png`)
    expect(d1.demo).toBe(`${CAT}/第01周/第001天_周一_交替拨弦/示范.mp3`)
    expect(d1.imageZh).not.toContain('\\')
    expect(d1.backingList).toEqual([
      { bpm: 40, path: `${CAT}/伴奏库/01_摇滚布鲁斯_40bpm.mp3` },
      { bpm: 48, path: `${CAT}/伴奏库/02_摇滚布鲁斯_48bpm.mp3` },
    ])
    expect(d1.bookPage).toEqual({ zh: 8, en: 8 })
    expect(d1.method).toBe('先听示范，再跟伴奏从最慢速度开始，每个速度弹10遍，逐级加速。')

    expect(p.backing).toEqual([
      { track: 1, style: '摇滚布鲁斯', bpm: 40, path: `${CAT}/伴奏库/01_摇滚布鲁斯_40bpm.mp3` },
      { track: 2, style: '摇滚布鲁斯', bpm: 48, path: `${CAT}/伴奏库/02_摇滚布鲁斯_48bpm.mp3` },
    ])
  })

  it('lists extras: PDFs, weekly demos sorted by week, tuning audio', async () => {
    buildProgram()
    const p = await loadDailyProgram(lib)
    expect(p.extras).toEqual([
      { label: '有氧吉他训练（中文版）', path: `${CAT}/全书/有氧吉他训练(中文版).pdf` },
      { label: 'Guitar Aerobics（英文原版）', path: `${CAT}/全书/Guitar Aerobics(英文原版).pdf` },
      { label: '第 1 周示范', path: `${CAT}/全书/示范音频(整周)/第01周示范.mp3` },
      { label: '第 2 周示范', path: `${CAT}/全书/示范音频(整周)/第02周示范.mp3` },
      { label: '调音（E-A-D-G-B-E）', path: `${CAT}/全书/调音音频(E-A-D-G-B-E).mp3` },
    ])
  })

  it('missing day files become null, not errors', async () => {
    buildProgram()
    const p = await loadDailyProgram(lib)
    const d2 = p.days[1]
    expect(d2.imageZh).toBe(`${CAT}/第01周/第002天_周二_跨弦/练习谱.png`)
    expect(d2.imageEn).toBe(`${CAT}/第01周/第002天_周二_跨弦/练习谱_英文.png`)
    expect(d2.demo).toBeNull()
    expect(d2.demoSeconds).toBeNull()
  })

  it('练习信息 per day: a bad file gives empty fields, a half-filled one keeps what is valid', async () => {
    buildProgram()
    const [, d2] = (await loadDailyProgram(lib)).days
    expect(d2).toMatchObject({
      backingList: [{ bpm: 40, path: `${CAT}/伴奏库/01_摇滚布鲁斯_40bpm.mp3` }],
      bookPage: null,
      method: null,
    })
    write(`${CAT}/第01周/第002天_周二_跨弦/练习信息.json`, '{bad')
    const bad = (await loadDailyProgram(lib)).days[1]
    expect(bad).toMatchObject({ backingList: [], bookPage: null, method: null })
    fs.rmSync(path.join(lib, CAT, '第01周', '第001天_周一_交替拨弦', '练习信息.json'))
    const gone = (await loadDailyProgram(lib)).days[0]
    expect(gone).toMatchObject({ backingList: [], bookPage: null, method: null, imageZh: expect.any(String) })
  })

  it('a day whose folder is missing has no images or demo', async () => {
    buildProgram()
    fs.rmSync(path.join(lib, CAT, '第01周', '第002天_周二_跨弦'), { recursive: true, force: true })
    const d2 = (await loadDailyProgram(lib)).days[1]
    expect(d2).toMatchObject({ imageZh: null, imageEn: null, demo: null })
  })

  it('a missing folder gives an empty program with one warning', async () => {
    const p = await loadDailyProgram(lib)
    expect(p).toEqual({ category: null, days: [], backing: [], extras: [] })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('bad JSON gives an empty program with category null', async () => {
    write(`${CAT}/每日练习索引.json`, '{ not json')
    const p = await loadDailyProgram(lib)
    expect(p).toEqual({ category: null, days: [], backing: [], extras: [] })
    expect(warn).toHaveBeenCalled()
  })

  it('an index without a 每日 list is treated as bad', async () => {
    write(`${CAT}/每日练习索引.json`, JSON.stringify({ 天数: 1 }))
    expect((await loadDailyProgram(lib)).category).toBeNull()
  })

  it('never throws for a root that does not exist', async () => {
    const p = await loadDailyProgram(path.join(tmp, 'nowhere'))
    expect(p.category).toBeNull()
  })
})

describe('parseTempos', () => {
  it('parses the slash-separated ladder', () => {
    expect(parseTempos('40/48/56/66/76/88/100/112')).toEqual([40, 48, 56, 66, 76, 88, 100, 112])
    expect(parseTempos(' 40 / 48 ')).toEqual([40, 48])
  })
  it('drops junk and tolerates bad input', () => {
    expect(parseTempos('40/abc/0/-5/60')).toEqual([40, 60])
    expect(parseTempos(undefined)).toEqual([])
    expect(parseTempos(42)).toEqual([])
  })
})

describe('isDailyPath', () => {
  it('accepts files under the program folder', () => {
    expect(isDailyPath(CAT, `${CAT}/第01周/第001天_周一_交替拨弦/练习谱.png`)).toBe(true)
    expect(isDailyPath(CAT, `${CAT}\\伴奏库\\01_摇滚布鲁斯_40bpm.mp3`)).toBe(true)
  })
  it('rejects other folders, the folder itself, traversal and absolute paths', () => {
    expect(isDailyPath(CAT, '1-华语/a.gp5')).toBe(false)
    expect(isDailyPath(CAT, `${CAT}`)).toBe(false)
    expect(isDailyPath(CAT, `${CAT}/../1-华语/a.gp5`)).toBe(false)
    expect(isDailyPath(CAT, `${CAT}/..`)).toBe(false)
    expect(isDailyPath(CAT, `/${CAT}/a.png`)).toBe(false)
    expect(isDailyPath(CAT, `D:/${CAT}/a.png`)).toBe(false)
    expect(isDailyPath(CAT, `${CAT}/a\0.png`)).toBe(false)
  })
  it('is false when there is no program', () => {
    expect(isDailyPath(null, `${CAT}/a.png`)).toBe(false)
  })
})

describe('DailyProgressStore', () => {
  let dataDir: string
  beforeEach(() => {
    dataDir = path.join(tmp, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
  })

  it('starts an account once; later starts keep the first time', async () => {
    const s = await DailyProgressStore.load(dataDir)
    expect(s.get('u1')).toEqual({ startedAt: null, done: {}, bpm: {} })
    await s.start('u1', 1000)
    await s.start('u1', 5000)
    expect(s.get('u1').startedAt).toBe(1000)
  })

  it('marks and unmarks days; marking twice keeps the first time', async () => {
    const s = await DailyProgressStore.load(dataDir)
    await s.mark('u1', 3, true, 2000)
    await s.mark('u1', 3, true, 9000)
    expect(s.get('u1').done).toEqual({ '3': 2000 })
    await s.mark('u1', 3, false, 9500)
    expect(s.get('u1').done).toEqual({})
  })

  it('marking starts the program implicitly when it was not started', async () => {
    const s = await DailyProgressStore.load(dataDir)
    await s.mark('u1', 1, true, 777)
    expect(s.get('u1')).toEqual({ startedAt: 777, done: { '1': 777 }, bpm: {} })
  })

  it('rejects days outside 1..365', async () => {
    const s = await DailyProgressStore.load(dataDir)
    await expect(s.mark('u1', 0, true, 1)).rejects.toThrow()
    await expect(s.mark('u1', 366, true, 1)).rejects.toThrow()
    await expect(s.mark('u1', 1.5, true, 1)).rejects.toThrow()
  })

  it('get returns copies, not the stored object', async () => {
    const s = await DailyProgressStore.load(dataDir)
    await s.mark('u1', 1, true, 1)
    s.get('u1').done['2'] = 99
    expect(s.get('u1').done).toEqual({ '1': 1 })
  })

  it('persists across loads and drops a user', async () => {
    const s = await DailyProgressStore.load(dataDir)
    await s.mark('u1', 1, true, 10)
    await s.mark('u2', 2, true, 20)
    const again = await DailyProgressStore.load(dataDir)
    expect(again.get('u1')).toEqual({ startedAt: 10, done: { '1': 10 }, bpm: {} })
    await again.dropUser('u1')
    const third = await DailyProgressStore.load(dataDir)
    expect(third.get('u1')).toEqual({ startedAt: null, done: {}, bpm: {} })
    expect(third.get('u2').done).toEqual({ '2': 20 })
  })

  it('members: counts, latest done day and time, in the order given', async () => {
    const s = await DailyProgressStore.load(dataDir)
    await s.mark('a', 5, true, 100)
    await s.mark('a', 2, true, 300)
    await s.mark('a', 9, true, 200)
    await s.mark('b', 1, true, 50)
    const m = s.members(['a', 'b', 'c', 'a'])
    expect(m).toEqual([
      { userId: 'a', startedAt: 100, doneCount: 3, lastDay: 2, lastDoneAt: 300 },
      { userId: 'b', startedAt: 50, doneCount: 1, lastDay: 1, lastDoneAt: 50 },
      { userId: 'c', startedAt: null, doneCount: 0, lastDay: null, lastDoneAt: null },
    ])
  })

  it('a corrupt file is set aside with a warning and the store starts empty', async () => {
    fs.writeFileSync(path.join(dataDir, 'daily.json'), '{{{ broken')
    const s = await DailyProgressStore.load(dataDir)
    expect(s.get('u1')).toEqual({ startedAt: null, done: {}, bpm: {} })
    expect(warn).toHaveBeenCalled()
    const kept = fs.readdirSync(dataDir).filter((f) => f.startsWith('daily.json.broken-'))
    expect(kept).toHaveLength(1)
    expect(fs.existsSync(path.join(dataDir, 'daily.json'))).toBe(false)
  })

  it('a missing file loads as empty without a warning', async () => {
    const s = await DailyProgressStore.load(dataDir)
    expect(s.members(['x'])[0].doneCount).toBe(0)
    expect(warn).not.toHaveBeenCalled()
  })

  it('writes the documented envelope', async () => {
    const s = await DailyProgressStore.load(dataDir)
    await s.mark('u1', 4, true, 40)
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'daily.json'), 'utf8'))
    expect(raw).toEqual({ version: 1, users: { u1: { startedAt: 40, done: { '4': 40 }, bpm: {} } } })
  })

  it('markBpm keeps the highest tempo per day and starts the program implicitly', async () => {
    const s = await DailyProgressStore.load(dataDir)
    await s.markBpm('u1', 4, 48, 500)
    expect(s.get('u1')).toEqual({ startedAt: 500, done: {}, bpm: { '4': 48 } })
    await s.markBpm('u1', 4, 40, 900)
    expect(s.get('u1').bpm).toEqual({ '4': 48 })
    await s.markBpm('u1', 4, 56, 950)
    expect(s.get('u1').bpm).toEqual({ '4': 56 })
    expect(s.get('u1').startedAt).toBe(500)
  })

  it('markBpm rejects days outside 1..365 and tempos outside 20..300 or not whole', async () => {
    const s = await DailyProgressStore.load(dataDir)
    await expect(s.markBpm('u1', 0, 40, 1)).rejects.toThrow()
    await expect(s.markBpm('u1', 366, 40, 1)).rejects.toThrow()
    await expect(s.markBpm('u1', 1, 19, 1)).rejects.toThrow()
    await expect(s.markBpm('u1', 1, 301, 1)).rejects.toThrow()
    await expect(s.markBpm('u1', 1, 40.5, 1)).rejects.toThrow()
    expect(s.get('u1')).toEqual({ startedAt: null, done: {}, bpm: {} })
  })

  it('persists bpm, and loads an old file that has no bpm field', async () => {
    const s = await DailyProgressStore.load(dataDir)
    await s.markBpm('u1', 2, 66, 10)
    const again = await DailyProgressStore.load(dataDir)
    expect(again.get('u1').bpm).toEqual({ '2': 66 })
    fs.writeFileSync(
      path.join(dataDir, 'daily.json'),
      JSON.stringify({ version: 1, users: { u9: { startedAt: 5, done: { '1': 5 } } } }),
    )
    const old = await DailyProgressStore.load(dataDir)
    expect(old.get('u9')).toEqual({ startedAt: 5, done: { '1': 5 }, bpm: {} })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('dailyState', () => {
  it('is available only when there are days', () => {
    const progress = { startedAt: 1, done: { '1': 1 }, bpm: { '1': 56 } }
    expect(dailyState({ category: null, days: [], backing: [], extras: [] }, progress).available).toBe(false)
    const s = dailyState(
      {
        category: CAT,
        days: [{ day: 1, week: 1, weekday: '周一', technique: 'x', backingStyle: 'y', tempos: [40], demoSeconds: null, imageZh: null, imageEn: null, demo: null, backingList: [], bookPage: null, method: null }],
        backing: [],
        extras: [],
      },
      progress,
    )
    expect(s.available).toBe(true)
    expect(s.startedAt).toBe(1)
    expect(s.done).toEqual({ '1': 1 })
    expect(s.bpm).toEqual({ '1': 56 })
  })
})

const realExists = fs.existsSync(REAL_LIBRARY)

describe.skipIf(!realExists)('real score library (read-only)', () => {
  it('finds the 365-day program with 48 backing tracks and day 1 files', async () => {
    const p = await loadDailyProgram(REAL_LIBRARY)
    expect(p.category).toMatch(/^\d+-每日一练$/)
    expect(p.days).toHaveLength(365)
    expect(p.backing).toHaveLength(48)
    const d1 = p.days[0]
    expect(d1.imageZh).not.toBeNull()
    expect(d1.imageEn).not.toBeNull()
    expect(d1.demo).not.toBeNull()
    expect(d1.backingList.map((b) => b.bpm)).toEqual([40, 48, 56, 66, 76, 88, 100, 112])
    expect(d1.backingList.every((b) => fs.existsSync(path.join(REAL_LIBRARY, ...b.path.split('/'))))).toBe(true)
  })
})
