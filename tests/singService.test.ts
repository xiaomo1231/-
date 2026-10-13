import { beforeEach, describe, expect, it } from 'vitest'
import { GrooveLabDB, getDb, setDbForTests } from '@/infrastructure/db/database'
import type { PitchCurveRow, SingMeta, SingTake, SongSheet, TakeScore } from '@/entities/types'
import { SingError, SingService, singKey } from '@/services/singService'
import { SongService } from '@/services/songService'
import { EMPTY_SYNC } from '@/songs/backingSync'
import { SCORE_VERSION } from '@/songs/singAlong'
import { DEFAULT_MIX } from '@/songs/mixPresets'

let n = 0
beforeEach(() => setDbForTests(new GrooveLabDB(`sing-${Date.now()}-${n++}`)))

const audio = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'audio/wav' })

describe('SingService.create', () => {
  it('requires a vocals stem', async () => {
    await expect(SingService.create({ title: 'X', files: [audio('Song_(Instrumental).wav')] })).rejects.toBeInstanceOf(SingError)
  })

  it('rejects files that are not audio', async () => {
    const txt = new File(['lyrics'], 'lyrics.txt', { type: 'text/plain' })
    await expect(SingService.create({ title: 'X', files: [txt] })).rejects.toBeInstanceOf(SingError)
    await expect(SingService.create({ title: 'X', files: [txt, audio('a_vocals.wav')] })).resolves.toBeDefined()
  })

  it('stores one audioFiles row per stem kind, keyed to the song, with the last file winning', async () => {
    const song = await SingService.create({
      title: 'Song',
      files: [audio('a_vocals.wav'), audio('b_vocals.wav'), audio('x_instrumental.wav')],
    })
    const rows = await getDb().audioFiles.where('sheetId').equals(song.id).toArray()
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.stem).sort()).toEqual(['instrumental', 'vocals'])
    expect(rows.find((r) => r.stem === 'vocals')!.name).toBe('b_vocals.wav')
    expect(song.stems.map((s) => s.stem).sort()).toEqual(['instrumental', 'vocals'])
  })

  it('defaults guideVolume to 0.3 and falls back to the first file name for the title', async () => {
    const song = await SingService.create({ title: '   ', files: [audio('My Song_vocals.wav')] })
    expect(song.title).toBe('My Song vocals')
    expect(song.guideVolume).toBe(0.3)
    expect(song.artist).toBeUndefined()
    const stored = await getDb().singSongs.get(song.id)
    expect(stored?.title).toBe('My Song vocals')
  })

  it('trims the artist and drops it when blank', async () => {
    const a = await SingService.create({ title: 'A', artist: '  Singer  ', files: [audio('a_vocals.wav')] })
    expect(a.artist).toBe('Singer')
    const b = await SingService.create({ title: 'B', artist: '   ', files: [audio('b_vocals.wav')] })
    expect(b.artist).toBeUndefined()
  })
})

describe('SingService.update / list', () => {
  it('updates the title, artist and guide volume', async () => {
    const song = await SingService.create({ title: 'Old', files: [audio('a_vocals.wav')] })
    const next = await SingService.update(song.id, { title: 'New', artist: 'Someone', guideVolume: 0.5 })
    expect(next).toMatchObject({ title: 'New', artist: 'Someone', guideVolume: 0.5 })
    const listed = await SingService.list()
    expect(listed.map((s) => s.title)).toEqual(['New'])
  })

  it('returns undefined when updating a missing song', async () => {
    expect(await SingService.update('nope', { title: 'X' })).toBeUndefined()
  })
})

const K = 'sheet:takes-test'

const score = (s: number): TakeScore => ({ score: s, notesSung: 3, notesTotal: 4, meanAbsCents: 10, biasCents: 0, lagMs: 0, octaveShift: 0, noteCents: [0, null, 5, 10] })

function take(id: string, phrase: number, createdAt: number, s: number | null, extra: Partial<SingTake> = {}, key: string = K): SingTake {
  return { id, key, phrase, createdAt, score: s === null ? null : score(s), sungMs: new Float32Array(2), sungMidi: new Float32Array(2), ...extra }
}

const ids = (ts: SingTake[]) => ts.map((t) => t.id)

describe('SingService meta (跟唱 2.0)', () => {
  it('returns defaults for an unknown source', async () => {
    const m = await SingService.meta(K)
    expect(m).toMatchObject({ key: K, scoreVersion: SCORE_VERSION, phraseBests: {} })
  })

  it('resets phrase bests when the stored scoreVersion differs', async () => {
    const stale: SingMeta = { key: K, scoreVersion: 1, phraseBests: { 1: 80 }, updatedAt: 0 }
    await getDb().singMeta.put(stale)
    const m = await SingService.meta(K)
    expect(m.scoreVersion).toBe(SCORE_VERSION)
    expect(m.phraseBests).toEqual({})
  })

  it('updateMeta merges the patch into the existing row', async () => {
    await SingService.saveTake(take('t1', 0, 1, 70))
    const next = await SingService.updateMeta(K, { lyrics: [] })
    expect(next.lyrics).toEqual([])
    expect(next.phraseBests).toEqual({ 0: 70 })
    const stored = await getDb().singMeta.get(K)
    expect(stored?.lyrics).toEqual([])
    expect(stored?.phraseBests).toEqual({ 0: 70 })
  })

  it('metas() returns only rows of the current scoreVersion', async () => {
    await getDb().singMeta.bulkPut([
      { key: 'song:a', scoreVersion: SCORE_VERSION, phraseBests: { 0: 60 }, updatedAt: 0 },
      { key: 'song:b', scoreVersion: 1, phraseBests: { 0: 60 }, updatedAt: 0 },
    ])
    const out = await SingService.metas(['song:a', 'song:b', 'song:none'])
    expect(Object.keys(out)).toEqual(['song:a'])
    expect(out['song:a']!.phraseBests).toEqual({ 0: 60 })
  })
})

describe('SingService.saveTake pruning', () => {
  it('keeps best + latest + kept per phrase (4 takes, one kept → 3 remain)', async () => {
    await SingService.saveTake(take('a', 1, 1000, 60, { kept: true }))
    await SingService.saveTake(take('b', 1, 2000, 90))
    await SingService.saveTake(take('c', 1, 3000, 50))
    await SingService.saveTake(take('d', 1, 4000, 70))
    const left = await SingService.takes(K, 1)
    expect(left).toHaveLength(3)
    expect(ids(left)).toEqual(['d', 'b', 'a'])
  })

  it('without a kept take keeps only the best and the latest', async () => {
    await SingService.saveTake(take('a', 1, 1000, 60))
    await SingService.saveTake(take('b', 1, 2000, 90))
    await SingService.saveTake(take('c', 1, 3000, 50))
    expect(ids(await SingService.takes(K, 1))).toEqual(['c', 'b'])
  })

  it('keeps the 3 latest full-song takes (phrase −1) plus kept ones', async () => {
    await SingService.saveTake(take('old-kept', -1, 1, null, { kept: true }))
    for (let i = 2; i <= 5; i++) await SingService.saveTake(take(`f${i}`, -1, i, null))
    expect(ids(await SingService.takes(K, -1))).toEqual(['f5', 'f4', 'f3', 'old-kept'])
  })

  it('updates phraseBests only when the new score is better', async () => {
    await SingService.saveTake(take('p1', 0, 1, 70))
    expect((await SingService.meta(K)).phraseBests).toEqual({ 0: 70 })
    await SingService.saveTake(take('p2', 0, 2, 50))
    expect((await SingService.meta(K)).phraseBests).toEqual({ 0: 70 })
    await SingService.saveTake(take('p3', 0, 3, 90))
    expect((await SingService.meta(K)).phraseBests).toEqual({ 0: 90 })
  })

  it('does not touch phraseBests for full-song takes', async () => {
    await SingService.saveTake(take('full', -1, 1, 95))
    expect((await SingService.meta(K)).phraseBests).toEqual({})
  })

  it('sets singSongs.lastPracticedAt for song keys only', async () => {
    const song = await SingService.create({ title: 'S', files: [audio('a_vocals.wav')] })
    const before = (await getDb().singSongs.get(song.id))!
    expect(before.lastPracticedAt).toBeUndefined()
    await SingService.saveTake(take('s1', 0, 1, 60, {}, singKey('song', song.id)))
    const after = await getDb().singSongs.get(song.id)
    expect(typeof after?.lastPracticedAt).toBe('number')
    expect(await getDb().singMeta.get(singKey('song', song.id))).toMatchObject({ phraseBests: { 0: 60 } })
  })
})

describe('SingService.takes / updateTake', () => {
  it('lists takes newest first, optionally by phrase', async () => {
    await SingService.saveTake(take('p0a', 0, 1, 50))
    await SingService.saveTake(take('p1', 1, 2, null))
    await SingService.saveTake(take('p0b', 0, 3, 40))
    expect(ids(await SingService.takes(K))).toEqual(['p0b', 'p1', 'p0a'])
    expect(ids(await SingService.takes(K, 0))).toEqual(['p0b', 'p0a'])
    expect(ids(await SingService.takes(K, 1))).toEqual(['p1'])
  })

  it('updateTake patches kept and nudgeMs; a missing id is a no-op', async () => {
    await SingService.saveTake(take('t', 0, 1, 50))
    await SingService.updateTake('t', { kept: true, nudgeMs: 40 })
    expect(await SingService.takes(K, 0)).toMatchObject([{ id: 't', kept: true, nudgeMs: 40 }])
    await expect(SingService.updateTake('missing', { kept: true })).resolves.toBeUndefined()
  })
})

describe('SingService covers', () => {
  const cover = (title: string) => ({ key: K, title, artist: 'Me', mix: DEFAULT_MIX, blob: new Blob(['x'], { type: 'audio/wav' }), durationMs: 1000 })

  it('saves covers and lists them newest first', async () => {
    const a = await SingService.saveCover(cover('A'))
    expect(a.id).toBeTruthy()
    expect(typeof a.createdAt).toBe('number')
    await new Promise((r) => setTimeout(r, 5))
    const b = await SingService.saveCover(cover('B'))
    expect((await SingService.covers()).map((c) => c.id)).toEqual([b.id, a.id])
  })

  it('removes a cover by id', async () => {
    const a = await SingService.saveCover(cover('A'))
    const b = await SingService.saveCover(cover('B'))
    await SingService.removeCover(a.id)
    expect((await SingService.covers()).map((c) => c.id)).toEqual([b.id])
  })
})

describe('SingService.forget / remove cleanup', () => {
  it('forget deletes takes and meta of the key but keeps covers', async () => {
    await SingService.saveTake(take('t', 0, 1, 50))
    await SingService.saveCover({ key: K, title: 'C', mix: DEFAULT_MIX, blob: new Blob(['x']), durationMs: 1 })
    await SingService.forget(K)
    expect(await SingService.takes(K)).toEqual([])
    expect(await getDb().singMeta.get(K)).toBeUndefined()
    expect(await SingService.covers()).toHaveLength(1)
  })

  it('SingService.remove(song) deletes its takes and meta', async () => {
    const song = await SingService.create({ title: 'S', files: [audio('a_vocals.wav')] })
    const key = singKey('song', song.id)
    await SingService.saveTake(take('t', 0, 1, 50, {}, key))
    await SingService.remove(song.id)
    expect(await SingService.takes(key)).toEqual([])
    expect(await getDb().singMeta.get(key)).toBeUndefined()
  })

  it('SongService.remove(sheet) deletes the takes and meta of sheet:<id>', async () => {
    const now = Date.now()
    await getDb().songSheets.put({ id: 'sh1', title: 'Sh', source: 'chords', createdAt: now, updatedAt: now } as SongSheet)
    await SingService.saveTake(take('t', 0, 1, 50, {}, singKey('sheet', 'sh1')))
    await getDb().singMeta.put({ key: singKey('sheet', 'sh1'), scoreVersion: SCORE_VERSION, phraseBests: {}, updatedAt: now })
    await SongService.remove('sh1')
    expect(await SingService.takes(singKey('sheet', 'sh1'))).toEqual([])
    expect(await getDb().singMeta.get(singKey('sheet', 'sh1'))).toBeUndefined()
  })
})

describe('SingService.source', () => {
  it('reads a 跟唱 song with its defaults', async () => {
    const song = await SingService.create({ title: 'S', artist: 'A', files: [audio('a_vocals.wav')] })
    const src = await SingService.source('song', song.id)
    expect(src).toMatchObject({ kind: 'song', id: song.id, title: 'S', artist: 'A', guideVolume: 0.3 })
    expect(src!.stems).toHaveLength(1)
    expect(await SingService.source('song', 'missing')).toBeNull()
  })

  it('reads a sheet whose 原曲伴奏 has a vocals stem, and returns null without one', async () => {
    const now = Date.now()
    const withVocals: SongSheet = {
      id: 'sheet-v',
      title: 'Sheet V',
      source: 'chords',
      artist: 'Band',
      createdAt: now,
      updatedAt: now,
      backing: { stems: [{ fileId: 'f1', stem: 'vocals', name: 'v.wav', size: 3 }], sync: EMPTY_SYNC },
    } as SongSheet
    const noVocals: SongSheet = {
      id: 'sheet-n',
      title: 'Sheet N',
      source: 'chords',
      createdAt: now,
      updatedAt: now,
      backing: { stems: [{ fileId: 'f2', stem: 'instrumental', name: 'i.wav', size: 3 }], sync: EMPTY_SYNC },
    } as SongSheet
    await getDb().songSheets.bulkPut([withVocals, noVocals])

    const src = await SingService.source('sheet', 'sheet-v')
    expect(src).toMatchObject({ kind: 'sheet', id: 'sheet-v', title: 'Sheet V', artist: 'Band', guideVolume: 0.3 })
    expect(src!.stems).toEqual([{ fileId: 'f1', stem: 'vocals', name: 'v.wav', size: 3 }])
    expect(await SingService.source('sheet', 'sheet-n')).toBeNull()
    expect(await SingService.source('sheet', 'missing')).toBeNull()
  })

  it('sheetsWithVocals lists only sheets with a vocals stem', async () => {
    const now = Date.now()
    const base = { source: 'chords' as const, createdAt: now, updatedAt: now }
    await getDb().songSheets.bulkPut([
      { ...base, id: 'a', title: 'A', backing: { stems: [{ fileId: 'f1', stem: 'vocals', name: 'v.wav', size: 3 }], sync: EMPTY_SYNC } } as SongSheet,
      { ...base, id: 'b', title: 'B', backing: { stems: [{ fileId: 'f2', stem: 'drums', name: 'd.wav', size: 3 }], sync: EMPTY_SYNC } } as SongSheet,
      { ...base, id: 'c', title: 'C' } as SongSheet,
    ])
    expect((await SingService.sheetsWithVocals()).map((s) => s.id)).toEqual(['a'])
  })
})

describe('SingService.remove', () => {
  it('deletes the song, its audioFiles rows and its pitch curves', async () => {
    const song = await SingService.create({ title: 'S', files: [audio('a_vocals.wav'), audio('x_instrumental.wav')] })
    const vocalsId = song.stems.find((s) => s.stem === 'vocals')!.fileId
    const curve: PitchCurveRow = { fileId: vocalsId, version: 1, hop: 0.02, midi: new Float32Array(2), createdAt: 0 }
    await getDb().pitchCurves.put(curve)

    await SingService.remove(song.id)

    expect(await getDb().singSongs.get(song.id)).toBeUndefined()
    expect(await getDb().audioFiles.where('sheetId').equals(song.id).count()).toBe(0)
    expect(await getDb().pitchCurves.get(vocalsId)).toBeUndefined()
  })
})

describe('cleanSongTitle', () => {
  it('drops download hashes, stem tags and extensions', async () => {
    const { cleanSongTitle } = await import('@/services/singService')
    expect(cleanSongTitle('obj_wo3DIMOGwrbDjj7DisKw_28481782371_c34e_f575_a7bf_b321b8e6.mp3')).toBe('未命名歌曲')
    expect(cleanSongTitle('晴天_(Vocals).wav')).toBe('晴天')
    expect(cleanSongTitle('My_Song_(Instrumental)_model_bs_roformer.wav')).toBe('My Song model bs roformer')
    expect(cleanSongTitle('Wonderwall - Live.flac')).toBe('Wonderwall - Live')
  })
})
