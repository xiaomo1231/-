import { uuid } from '@/infrastructure/crypto/crypto'
import { getDb } from '@/infrastructure/db/database'
import type { AudioFile, CoverWork, SingDraft, SingKey, SingMeta, SingSong, SingTake, SongSheet } from '@/entities/types'
import { SCORE_VERSION } from '@/songs/singAlong'
import { sameStretch } from '@/songs/phrasing'
import { detectStem, type StemKind } from '@/songs/backingSync'

export class SingError extends Error {}

const AUDIO_EXT = /\.(mp3|wav|flac|m4a|aac|ogg|opus|webm)$/i

/** What a sing-along session needs, whether the song is a 跟唱 song or a sheet with a vocals stem. */
export interface SingSource {
  kind: 'song' | 'sheet'
  id: string
  title: string
  artist: string
  stems: Array<{ fileId: string; stem: StemKind; name: string }>
  /** "song:<id>" / "sheet:<id>": key of its takes and metadata. */
  key: SingKey
  guideVolume: number
}

async function freeBytes(): Promise<number | null> {
  try {
    const est = await navigator.storage?.estimate?.()
    if (!est || est.quota === undefined || est.usage === undefined) return null
    return est.quota - est.usage
  } catch {
    return null
  }
}

/**
 * 跟唱 songs: a vocals stem (needed for the pitch line) plus an instrumental
 * or the full mix to sing over. Audio stays in this browser and is not part
 * of the data export. Sheets with a vocals stem in their 原曲伴奏 can be sung
 * along to as well.
 */
/**
 * A readable song title from a file name: no extension, no stem tags like
 * "_(Vocals)", underscores as spaces. Download-style hash names
 * ("obj_wo3DIMOGwrbDjj7DisKw_2848…") become 未命名歌曲.
 */
export function cleanSongTitle(fileName: string): string {
  let t = fileName.replace(/\.[a-z0-9]{2,5}$/i, '')
  t = t.replace(/[_\s-]*\((vocals?|instrumental|drums|bass|guitar|piano|other|no[_ ]?vocals)\)/gi, '')
  t = t.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim()
  const tokens = t.split(' ')
  const hashy = (w: string) => w.length >= 12 && /[a-z]/i.test(w) && /\d/.test(w) && !/[\u4e00-\u9fff]/.test(w)
  const hexy = (w: string) => /^[0-9a-f]{3,}$/i.test(w) || /^\d{6,}$/.test(w)
  const kept = tokens.filter((w) => !hashy(w) && !hexy(w) && !/^obj$/i.test(w))
  const out = kept.join(' ').trim()
  return out.length >= 2 ? out.slice(0, 60) : '未命名歌曲'
}

/** "10月13日 21:05" */
function defaultDraftName(): string {
  const d = new Date()
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Size and average best score of a set of takes (for the draft list). */
export function draftSummary(takes: readonly SingTake[]): Pick<SingDraft, 'takes' | 'phrases' | 'avgBest'> {
  const best = new Map<number, number>()
  const sung = new Set<number>()
  for (const t of takes) {
    if (t.phrase < 0) continue
    sung.add(t.phrase)
    if (t.score) best.set(t.phrase, Math.max(best.get(t.phrase) ?? 0, t.score.score))
  }
  const scores = [...best.values()]
  return { takes: takes.length, phrases: sung.size, ...(scores.length ? { avgBest: scores.reduce((a, b) => a + b, 0) / scores.length } : {}) }
}

export const SingService = {
  async list(): Promise<SingSong[]> {
    return getDb().singSongs.orderBy('updatedAt').reverse().toArray()
  },

  /** Sheets whose 原曲伴奏 has a vocals stem. */
  async sheetsWithVocals(): Promise<SongSheet[]> {
    return (await getDb().songSheets.toArray()).filter((s) => s.backing?.stems.some((x) => x.stem === 'vocals'))
  },

  async create(input: { title: string; artist?: string; files: readonly File[] }): Promise<SingSong> {
    const db = getDb()
    const files = input.files.filter((f) => AUDIO_EXT.test(f.name) || f.type.startsWith('audio/'))
    if (!files.length) throw new SingError('没有认出音频文件。支持 mp3、wav、flac、m4a、ogg。')
    const stems = files.map((f) => ({ file: f, stem: detectStem(f.name) }))
    if (!stems.some((s) => s.stem === 'vocals')) {
      throw new SingError('需要一条人声轨（文件名里带 vocals 或「人声」）。用 UVR 桌面版把原曲分成人声和伴奏两轨后再导入；完整原曲或伴奏可以一起导入用来伴唱。')
    }
    const total = files.reduce((s, f) => s + f.size, 0)
    const free = await freeBytes()
    if (free !== null && free < total * 1.2) throw new SingError(`存储空间不够：需要约 ${Math.ceil(total / 1048576)} MB，剩余约 ${Math.floor(free / 1048576)} MB。`)
    const now = Date.now()
    const id = uuid()
    // One file per stem kind (the last one wins).
    const byKind = new Map(stems.map((s) => [s.stem, s.file]))
    const rows: AudioFile[] = [...byKind].map(([stem, f]) => ({ id: uuid(), sheetId: id, stem, name: f.name, size: f.size, type: f.type || 'audio/mpeg', blob: f, createdAt: now }))
    const song: SingSong = {
      id,
      title: input.title.trim().slice(0, 60) || cleanSongTitle(files[0]!.name),
      ...(input.artist?.trim() ? { artist: input.artist.trim().slice(0, 40) } : {}),
      stems: rows.map((r) => ({ fileId: r.id, stem: r.stem, name: r.name, size: r.size })),
      guideVolume: 0.3,
      createdAt: now,
      updatedAt: now,
    }
    try {
      await db.transaction('rw', db.singSongs, db.audioFiles, async () => {
        await db.audioFiles.bulkPut(rows)
        await db.singSongs.put(song)
      })
    } catch (e) {
      if (e instanceof Error && /quota/i.test(e.name + e.message)) throw new SingError('存储空间已满，音频没有保存。')
      throw e
    }
    return song
  },

  async update(id: string, patch: Partial<Pick<SingSong, 'title' | 'artist' | 'guideVolume'>>): Promise<SingSong | undefined> {
    const db = getDb()
    const s = await db.singSongs.get(id)
    if (!s) return undefined
    const next = { ...s, ...patch, updatedAt: Date.now() }
    await db.singSongs.put(next)
    return next
  },

  async remove(id: string): Promise<void> {
    const db = getDb()
    await db.transaction('rw', [db.singSongs, db.audioFiles, db.pitchCurves, db.singTakes, db.singMeta], async () => {
      const s = await db.singSongs.get(id)
      await db.singSongs.delete(id)
      await db.singTakes.where('key').equals(singKey('song', id)).delete()
      await db.singMeta.delete(singKey('song', id))
      for (const st of s?.stems ?? []) await db.pitchCurves.delete(st.fileId)
      await db.audioFiles.where('sheetId').equals(id).delete()
    })
  },

  /** The session source for a 跟唱 song or a sheet. */
  async source(kind: 'song' | 'sheet', id: string): Promise<SingSource | null> {
    const db = getDb()
    if (kind === 'song') {
      const s = await db.singSongs.get(id)
      return s ? { kind, id, key: singKey(kind, id), title: s.title, artist: s.artist ?? '', stems: s.stems, guideVolume: s.guideVolume ?? 0.3 } : null
    }
    const sheet = await db.songSheets.get(id)
    if (!sheet?.backing?.stems.some((x) => x.stem === 'vocals')) return null
    return { kind, id, key: singKey(kind, id), title: sheet.title, artist: sheet.artist ?? '', stems: sheet.backing.stems, guideVolume: 0.3 }
  },

  // ---------------------------------------------------------------------------
  // 跟唱 2.0: per-source data, takes, covers
  // ---------------------------------------------------------------------------

  /** Lyrics, full-version plan, mix and phrase bests (bests reset when scoring changed). */
  async meta(key: SingKey): Promise<SingMeta> {
    const m = await getDb().singMeta.get(key)
    if (!m) return { key, scoreVersion: SCORE_VERSION, phraseBests: {}, updatedAt: Date.now() }
    return m.scoreVersion === SCORE_VERSION ? m : { ...m, scoreVersion: SCORE_VERSION, phraseBests: {} }
  },

  async updateMeta(key: SingKey, patch: Partial<Omit<SingMeta, 'key'>>): Promise<SingMeta> {
    const next = { ...(await this.meta(key)), ...patch, updatedAt: Date.now() }
    await getDb().singMeta.put(next)
    return next
  },

  /** Metas of several sources at once (list page counts). */
  async metas(keys: SingKey[]): Promise<Record<SingKey, SingMeta>> {
    const rows = await getDb().singMeta.bulkGet(keys)
    const out: Record<SingKey, SingMeta> = {}
    rows.forEach((r) => {
      if (r && r.scoreVersion === SCORE_VERSION) out[r.key] = r
    })
    return out
  },

  /**
   * Save a take and keep the store small: per stretch of the song (takes
   * that mostly cover the same time, so changing the phrase cuts never mixes
   * phrases up) only the best, the latest and the pinned takes stay
   * (full-song takes: the 3 latest + pinned).
   * Updates the phrase best. Returns the stored take.
   */
  async saveTake(take: SingTake): Promise<SingTake> {
    const db = getDb()
    await db.transaction('rw', db.singTakes, db.singMeta, db.singSongs, async () => {
      await db.singTakes.put(take)
      const all = (
        take.phrase < 0
          ? await db.singTakes.where('[key+phrase]').equals([take.key, take.phrase]).toArray()
          : (await db.singTakes.where('key').equals(take.key).toArray()).filter((t) => t.id === take.id || (t.phrase >= 0 && sameStretch(t, take)))
      ).filter((t) => !t.archive)
      const keep = new Set(all.filter((t) => t.kept).map((t) => t.id))
      const byTime = [...all].sort((a, b) => b.createdAt - a.createdAt)
      if (take.phrase < 0) byTime.slice(0, 3).forEach((t) => keep.add(t.id))
      else {
        keep.add(byTime[0]!.id)
        const best = [...all].filter((t) => t.score).sort((a, b) => b.score!.score - a.score!.score)[0]
        if (best) keep.add(best.id)
      }
      await db.singTakes.bulkDelete(all.filter((t) => !keep.has(t.id)).map((t) => t.id))
      if (take.phrase >= 0 && take.score) {
        const m = await this.meta(take.key)
        const prev = m.phraseBests[take.phrase] ?? 0
        if (take.score.score > prev) await db.singMeta.put({ ...m, phraseBests: { ...m.phraseBests, [take.phrase]: take.score.score }, updatedAt: Date.now() })
      }
      if (take.key.startsWith('song:')) {
        const s = await db.singSongs.get(take.key.slice(5))
        if (s) await db.singSongs.put({ ...s, lastPracticedAt: Date.now() })
      }
    })
    return take
  },

  /** Stored takes of a source (optionally one phrase), newest first. */
  /** The current takes of a source (not the ones put away in drafts), newest first. */
  async takes(key: SingKey, phrase?: number): Promise<SingTake[]> {
    const db = getDb()
    const rows = phrase === undefined ? await db.singTakes.where('key').equals(key).toArray() : await db.singTakes.where('[key+phrase]').equals([key, phrase]).toArray()
    return rows.filter((t) => !t.archive).sort((a, b) => b.createdAt - a.createdAt)
  },

  // ---- 重新开始 / 草稿 ----------------------------------------------------------

  /** Put every current take away in a new draft and start fresh (scores reset). Returns the meta, or null when there was nothing to put away. */
  async saveDraft(key: SingKey, name: string): Promise<SingMeta | null> {
    const db = getDb()
    let out: SingMeta | null = null
    await db.transaction('rw', db.singTakes, db.singMeta, async () => {
      const active = (await db.singTakes.where('key').equals(key).toArray()).filter((t) => !t.archive)
      if (!active.length) return
      const draft: SingDraft = { id: uuid(), name: name.trim().slice(0, 40) || defaultDraftName(), createdAt: Date.now(), ...draftSummary(active) }
      await db.singTakes.bulkPut(active.map((t) => ({ ...t, archive: draft.id })))
      const m = await this.meta(key)
      out = { ...m, drafts: [draft, ...(m.drafts ?? [])], phraseBests: {}, ...(m.comp ? { comp: { ...m.comp, picks: {}, phraseOffsets: {}, fullTakeId: undefined } } : {}), updatedAt: Date.now() }
      await db.singMeta.put(out)
    })
    return out
  },

  /** Delete current takes: all of them, or the given ones (one phrase). Drafts stay. */
  async clearTakes(key: SingKey, ids?: string[]): Promise<SingMeta> {
    const db = getDb()
    let out!: SingMeta
    await db.transaction('rw', db.singTakes, db.singMeta, async () => {
      const active = (await db.singTakes.where('key').equals(key).toArray()).filter((t) => !t.archive && (!ids || ids.includes(t.id)))
      await db.singTakes.bulkDelete(active.map((t) => t.id))
      const m = await this.meta(key)
      out = { ...m, ...(ids ? {} : { phraseBests: {} }), ...(m.comp && !ids ? { comp: { ...m.comp, picks: {}, phraseOffsets: {}, fullTakeId: undefined } } : {}), updatedAt: Date.now() }
      await db.singMeta.put(out)
    })
    return out
  },

  /** Bring a draft back. The current takes (if any) are first put away as a draft of their own, so nothing is lost. */
  async restoreDraft(key: SingKey, draftId: string): Promise<SingMeta> {
    const db = getDb()
    let out!: SingMeta
    await db.transaction('rw', db.singTakes, db.singMeta, async () => {
      const all = await db.singTakes.where('key').equals(key).toArray()
      const m = await this.meta(key)
      let drafts = (m.drafts ?? []).filter((d) => d.id !== draftId)
      const active = all.filter((t) => !t.archive)
      if (active.length) {
        const auto: SingDraft = { id: uuid(), name: `恢复草稿前自动保存（${defaultDraftName()}）`, createdAt: Date.now(), ...draftSummary(active) }
        await db.singTakes.bulkPut(active.map((t) => ({ ...t, archive: auto.id })))
        drafts = [auto, ...drafts]
      }
      const back = all.filter((t) => t.archive === draftId)
      await db.singTakes.bulkPut(back.map(({ archive: _a, ...t }) => t))
      out = { ...m, drafts, phraseBests: {}, ...(m.comp ? { comp: { ...m.comp, picks: {}, phraseOffsets: {}, fullTakeId: undefined } } : {}), updatedAt: Date.now() }
      await db.singMeta.put(out)
    })
    return out
  },

  async deleteDraft(key: SingKey, draftId: string): Promise<SingMeta> {
    const db = getDb()
    let out!: SingMeta
    await db.transaction('rw', db.singTakes, db.singMeta, async () => {
      const gone = (await db.singTakes.where('key').equals(key).toArray()).filter((t) => t.archive === draftId)
      await db.singTakes.bulkDelete(gone.map((t) => t.id))
      const m = await this.meta(key)
      out = { ...m, drafts: (m.drafts ?? []).filter((d) => d.id !== draftId), updatedAt: Date.now() }
      await db.singMeta.put(out)
    })
    return out
  },

  async updateTake(id: string, patch: Partial<Pick<SingTake, 'kept' | 'nudgeMs'>>): Promise<void> {
    const db = getDb()
    const t = await db.singTakes.get(id)
    if (t) await db.singTakes.put({ ...t, ...patch })
  },

  async saveCover(cover: Omit<CoverWork, 'id' | 'createdAt'>): Promise<CoverWork> {
    const row: CoverWork = { ...cover, id: uuid(), createdAt: Date.now() }
    await getDb().covers.put(row)
    return row
  },

  async covers(): Promise<CoverWork[]> {
    return getDb().covers.orderBy('createdAt').reverse().toArray()
  },

  async removeCover(id: string): Promise<void> {
    await getDb().covers.delete(id)
  },

  /** Forget a source's takes and metadata (its covers stay in 作品集). */
  async forget(key: SingKey): Promise<void> {
    const db = getDb()
    await db.transaction('rw', db.singTakes, db.singMeta, async () => {
      await db.singTakes.where('key').equals(key).delete()
      await db.singMeta.delete(key)
    })
  },
}

export const singKey = (kind: 'song' | 'sheet', id: string): SingKey => `${kind}:${id}`
