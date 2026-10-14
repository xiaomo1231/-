import { uuid } from '@/infrastructure/crypto/crypto'
import { getDb } from '@/infrastructure/db/database'
import type { AudioFile, SheetBacking, SongSheet } from '@/entities/types'
import { EMPTY_SYNC, detectStem, roleMix, type PracticeRole, type StemKind, type StemMix, type SyncMap } from '@/songs/backingSync'

export class BackingError extends Error {}

const AUDIO_EXT = /\.(mp3|wav|flac|m4a|aac|ogg|opus|webm)$/i

/** Free browser storage, or null when the browser cannot tell. */
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
 * 原曲伴奏 storage: recordings / stems the student attaches to a sheet, the
 * alignment and the mixer. Audio stays in this browser (IndexedDB) and is not
 * part of the data export.
 */
export const BackingService = {
  /**
   * Attach audio files. Each file's stem comes from its name (UVR / Demucs
   * naming); a new file replaces an existing one of the same stem.
   */
  async addFiles(sheetId: string, files: readonly File[], stemOverride?: StemKind): Promise<SheetBacking> {
    const db = getDb()
    const sheet = await db.songSheets.get(sheetId)
    if (!sheet) throw new BackingError('找不到这份谱子。')
    const audio = files.filter((f) => AUDIO_EXT.test(f.name) || f.type.startsWith('audio/'))
    if (!audio.length) throw new BackingError('没有认出音频文件。支持 mp3、wav、flac、m4a、ogg。')
    const total = audio.reduce((s, f) => s + f.size, 0)
    const free = await freeBytes()
    if (free !== null && free < total * 1.2) {
      throw new BackingError(`存储空间不够：需要约 ${Math.ceil(total / 1048576)} MB，剩余约 ${Math.floor(free / 1048576)} MB。可以只导入要用的几轨，或先删掉不用的谱子音频。`)
    }
    const now = Date.now()
    const rows: AudioFile[] = audio.map((f) => ({ id: uuid(), sheetId, stem: stemOverride ?? detectStem(f.name), name: f.name, size: f.size, type: f.type || 'audio/mpeg', blob: f, createdAt: now }))
    const prev = sheet.backing ?? { stems: [], sync: EMPTY_SYNC }
    const replaced = prev.stems.filter((s) => rows.some((r) => r.stem === s.stem))
    const stems = [...prev.stems.filter((s) => !replaced.includes(s)), ...rows.map((r) => ({ fileId: r.id, stem: r.stem, name: r.name, size: r.size }))]
    const kinds = stems.map((s) => s.stem)
    const role = prev.role ?? 'listen'
    const backing: SheetBacking = { ...prev, stems, mix: roleMix(role, kinds).mix, role }
    try {
      await db.transaction('rw', db.songSheets, db.audioFiles, async () => {
        for (const r of replaced) await db.audioFiles.delete(r.fileId)
        await db.audioFiles.bulkPut(rows)
        await db.songSheets.put({ ...sheet, backing, updatedAt: now })
      })
    } catch (e) {
      if (e instanceof Error && /quota/i.test(e.name + e.message)) throw new BackingError('存储空间已满，音频没有保存。')
      throw e
    }
    return backing
  },

  async removeStem(sheetId: string, fileId: string): Promise<SheetBacking | undefined> {
    const db = getDb()
    let out: SheetBacking | undefined
    await db.transaction('rw', db.songSheets, db.audioFiles, async () => {
      const sheet = await db.songSheets.get(sheetId)
      if (!sheet?.backing) return
      const stems = sheet.backing.stems.filter((s) => s.fileId !== fileId)
      await db.audioFiles.delete(fileId)
      out = stems.length ? { ...sheet.backing, stems, mix: roleMix(sheet.backing.role ?? 'listen', stems.map((s) => s.stem)).mix } : undefined
      const next: SongSheet = { ...sheet, updatedAt: Date.now() }
      if (out) next.backing = out
      else delete next.backing
      await db.songSheets.put(next)
    })
    return out
  },

  async blob(fileId: string): Promise<Blob | null> {
    return (await getDb().audioFiles.get(fileId))?.blob ?? null
  },

  /** Save alignment, mixer or role changes. */
  async update(sheetId: string, patch: Partial<Pick<SheetBacking, 'sync' | 'mix' | 'role' | 'fillTracks' | 'recordingVolume' | 'synthVolume'>>): Promise<SheetBacking | undefined> {
    const db = getDb()
    const sheet = await db.songSheets.get(sheetId)
    if (!sheet?.backing) return undefined
    const backing = { ...sheet.backing, ...patch }
    await db.songSheets.put({ ...sheet, backing })
    return backing
  },

  /** Switch practice role: recompute the stem mix for it. */
  async setRole(sheetId: string, role: PracticeRole, fillTracks?: number[]): Promise<SheetBacking | undefined> {
    const db = getDb()
    const sheet = await db.songSheets.get(sheetId)
    if (!sheet?.backing) return undefined
    const mix = roleMix(role, sheet.backing.stems.map((s) => s.stem)).mix as Partial<Record<StemKind, StemMix>>
    return this.update(sheetId, { role, mix, ...(fillTracks ? { fillTracks } : {}) })
  },

  async setSync(sheetId: string, sync: SyncMap): Promise<SheetBacking | undefined> {
    return this.update(sheetId, { sync })
  },

  /** Total audio stored, for the settings page. */
  async storedBytes(): Promise<number> {
    return (await getDb().audioFiles.toArray()).reduce((s, f) => s + f.size, 0)
  },
}
