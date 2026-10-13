import { uuid } from '@/infrastructure/crypto/crypto'
import { garbleScore, loadScoreDecoded } from '@/audio/alphatabEncoding'
import { getDb } from '@/infrastructure/db/database'
import type { SheetFile, SongSheet } from '@/entities/types'
import type { Score } from '@/music/score'
import type { TabNote } from '@/guitar/scales'
import { ImportError, guessMelodyTrack, midiToScore, parseMidi, type MidiFile } from '@/import/midiImport'
import { musicXmlParts, musicXmlToScore } from '@/import/musicxmlImport'
import { unzipMusicXml } from '@/import/unzip'
import { chordChartToScore } from '@/import/chordChart'
import { parseAsciiTab } from '@/import/asciiTab'
import { defaultTrack, formatFromName, readSheetMeta, trackChordChart, trackToTab, type SheetFormat, type SheetTrackInfo } from '@/import/gpImport'
import { bytesToBase64, base64ToBytes } from '@/shared/lib/base64'
import { loadAlphaTab } from '@/audio/alphatabLoader'

export { ImportError }

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024

export interface ImportPreview {
  source: SongSheet['source']
  format?: SheetFormat
  title: string
  artist?: string
  tabber?: string
  tracks?: SheetTrackInfo[]
  defaultTrack?: number
  bars?: number
  sections?: Array<{ bar: number; name: string }>
  /** Original file, kept so the sheet can be rendered and played as written. */
  file?: { name: string; bytes: Uint8Array }
  score?: Score
  tab?: TabNote[]
  warnings: string[]
  /** MIDI tracks / MusicXML parts the student can switch between. */
  choices?: Array<{ id: string; label: string }>
  chosen?: string
  /** Re-run the import with another track / part. */
  rechoose?: (id: string) => ImportPreview
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, '').slice(0, 40) || '导入的乐谱'

function previewMidi(f: MidiFile, title: string, track: number): ImportPreview {
  const { score, warnings } = midiToScore(f, track)
  return {
    source: 'midi',
    title,
    score,
    warnings,
    choices: f.tracks.map((t) => ({ id: String(t.index), label: `${t.name}（${t.notes.length} 个音${t.drums ? '，鼓' : ''}）` })),
    chosen: String(track),
    rechoose: (id) => previewMidi(f, title, Number(id)),
  }
}

function previewXml(xml: string, part?: string): ImportPreview {
  const parts = musicXmlParts(xml)
  const r = musicXmlToScore(xml, part)
  return {
    source: 'musicxml',
    title: r.title,
    score: r.score,
    warnings: r.warnings,
    choices: parts.map((p) => ({ id: p.id, label: p.name })),
    chosen: part ?? parts[0]?.id ?? '',
    rechoose: (id) => previewXml(xml, id),
  }
}

/**
 * Tab sites write their adverts into the file's texts ("歌手 www.example.cn
 * 某某网为您提供……"): keep what comes before the first web address or
 * advert phrase.
 */
export function stripSiteAds(text: string): string {
  const cut = text.search(/(https?:\/\/|www\.|[a-z0-9-]+\.(?:com|cn|net|org)\b|为您提供|提供优秀|中文娱乐网|吉他谱网|曲谱网|制谱[:：]?)/i)
  const kept = (cut >= 0 ? text.slice(0, cut) : text).replace(/[\s\-—_|·:：,，]+$/, '').trim()
  return kept || text.trim()
}

/**
 * Read a file with alphaTab (Guitar Pro 3–8; MusicXML is read by our own
 * importer too). The preview's tab and chords come from the guitar track
 * alphaTab picks; everything else is shown from the file itself.
 */
async function previewWithAlphaTab(name: string, bytes: Uint8Array, format: SheetFormat): Promise<ImportPreview> {
  const at = await loadAlphaTab()
  let score
  try {
    score = loadScoreDecoded(at, bytes).score
  } catch {
    throw new ImportError('读不懂这个 Guitar Pro 文件：可能已损坏，或者是不支持的版本。可以在 Guitar Pro 里另存为 .gp5 或导出 MusicXML 再试。')
  }
  const meta = readSheetMeta(score)
  meta.title = stripSiteAds(meta.title)
  if (meta.artist) meta.artist = stripSiteAds(meta.artist)
  if (meta.tabber) meta.tabber = stripSiteAds(meta.tabber)
  if (!meta.tracks.length || !meta.bars) throw new ImportError('这个文件里没有音轨或小节。')
  const track = defaultTrack(meta)
  const tab = trackToTab(score, track, 0, Math.min(8, meta.bars))
  const chart = trackChordChart(score, track)
  const chords = chart ? chordChartToScore(chart, { bpm: meta.bpm, maxBars: meta.bars }) : null
  const warnings: string[] = []
  if (chords?.unsupported.length) warnings.push(`这些和弦暂时不能用于扫弦练习：${chords.unsupported.join('、')}。看谱和播放不受影响。`)
  return {
    source: 'gp',
    format,
    title: meta.title || baseName(name),
    ...(meta.artist ? { artist: meta.artist } : {}),
    ...(meta.tabber ? { tabber: meta.tabber } : {}),
    tracks: meta.tracks,
    defaultTrack: track,
    bars: meta.bars,
    sections: meta.sections,
    ...(chords?.score.chords.length ? { score: chords.score } : {}),
    ...(tab.notes.length ? { tab: tab.notes } : {}),
    warnings,
    file: { name, bytes },
  }
}

export const SongService = {
  /** Read a file the student picked: MIDI, MusicXML (.musicxml / .xml / .mxl) or a text chord chart / tab. */
  async importFile(file: File): Promise<ImportPreview> {
    if (file.size > MAX_IMPORT_BYTES) throw new ImportError('文件太大了（超过 5 MB）。乐谱文件一般只有几十 KB，请确认选对了文件。')
    const name = file.name.toLowerCase()
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (name.endsWith('.mid') || name.endsWith('.midi')) {
      const f = parseMidi(bytes)
      return previewMidi(f, baseName(file.name), guessMelodyTrack(f))
    }
    const format = formatFromName(name)
    if (format === 'gp3' || format === 'gp4' || format === 'gp5' || format === 'gpx' || format === 'gp') return previewWithAlphaTab(file.name, bytes, format)
    if (format === 'mxl') return { ...previewXml(await unzipMusicXml(bytes)), format, file: { name: file.name, bytes } }
    if (format === 'musicxml') return { ...previewXml(new TextDecoder().decode(bytes)), format, file: { name: file.name, bytes } }
    if (name.endsWith('.txt')) return { ...this.importText(new TextDecoder().decode(bytes)), title: baseName(file.name) }
    throw new ImportError('不认识这种文件。支持 Guitar Pro（.gp3 / .gp4 / .gp5 / .gpx / .gp）、MusicXML（.musicxml / .xml / .mxl）、MIDI（.mid）和文本（.txt 和弦谱或六线谱）。')
  },

  /** Pasted text: a six-line tab, or a chord chart. */
  importText(text: string, opts: { bpm?: number } = {}): ImportPreview {
    const trimmed = text.trim()
    if (!trimmed) throw new ImportError('先粘贴和弦谱或六线谱。')
    try {
      const tab = parseAsciiTab(trimmed)
      if (tab.notes.length >= 2) return { source: 'tab', title: '导入的六线谱', tab: tab.notes, warnings: tab.warnings }
    } catch {
      // not a tab: try a chord chart
    }
    const r = chordChartToScore(trimmed, opts.bpm ? { bpm: opts.bpm } : {})
    if (!r.score.chords.length) throw new ImportError('没有认出和弦或六线谱。和弦谱写成“| C | G | Am | F |”或“[C]歌词”，六线谱需要连续的 6 行。')
    const warnings: string[] = []
    if (r.unsupported.length) warnings.push(`这些和弦的根音不在这个调的常用级数里，暂时空着：${r.unsupported.join('、')}。`)
    if (r.ignored) warnings.push(`忽略了 ${r.ignored} 个不是和弦的词（歌词或段落名）。`)
    return { source: 'chords', title: '导入的和弦谱', score: r.score, warnings }
  },

  async list(): Promise<SongSheet[]> {
    return (await getDb().songSheets.toArray()).sort((a, b) => b.updatedAt - a.updatedAt)
  },

  async get(id: string): Promise<SongSheet | undefined> {
    return getDb().songSheets.get(id)
  },

  async save(preview: ImportPreview, title: string, extra: { pattern?: string; notes?: string; artist?: string; versionLabel?: string; tags?: string[] } = {}): Promise<SongSheet> {
    const now = Date.now()
    const db = getDb()
    let fileId: string | undefined
    if (preview.file) {
      const row: SheetFile = { id: uuid(), name: preview.file.name, size: preview.file.bytes.length, base64: bytesToBase64(preview.file.bytes), createdAt: now }
      fileId = row.id
      await db.sheetFiles.put(row)
    }
    const artist = (extra.artist ?? preview.artist ?? '').trim().slice(0, 40)
    const versionLabel = extra.versionLabel?.trim().slice(0, 30)
    const sheet: SongSheet = {
      id: uuid(),
      title: title.trim().slice(0, 60) || preview.title,
      source: preview.source,
      ...(preview.format ? { format: preview.format } : {}),
      ...(artist ? { artist } : {}),
      ...(preview.tabber ? { tabber: preview.tabber } : {}),
      ...(versionLabel ? { versionLabel } : {}),
      ...(fileId ? { fileId } : {}),
      ...(preview.tracks ? { tracks: preview.tracks } : {}),
      ...(preview.defaultTrack !== undefined ? { defaultTrack: preview.defaultTrack } : {}),
      ...(preview.bars ? { bars: preview.bars } : {}),
      ...(preview.sections?.length ? { sections: preview.sections } : {}),
      ...(extra.tags?.length ? { tags: extra.tags } : {}),
      ...(preview.score ? { score: preview.score } : {}),
      ...(preview.tab ? { tab: preview.tab } : {}),
      ...(extra.pattern ? { pattern: extra.pattern } : {}),
      ...(extra.notes ? { notes: extra.notes } : {}),
      bpm: preview.score?.bpm ?? 80,
      createdAt: now,
      updatedAt: now,
    }
    await db.songSheets.put(sheet)
    return sheet
  },

  /** Edit what the student can change: title, singer, version name, tags, practice defaults. */
  /**
   * Sheets imported before 0.21.2 kept garbled names (GBK read as UTF-8) and
   * tab-site adverts. Given the score as now read correctly, replace what is
   * still broken in the stored track names, title and artist. Returns the
   * updated sheet, or undefined when nothing needed fixing.
   */
  async repairTexts(id: string, score: { title: string; artist: string; tracks: ReadonlyArray<{ index: number; name: string }> }): Promise<SongSheet | undefined> {
    const db = getDb()
    const s = await db.songSheets.get(id)
    if (!s) return undefined
    const broken = (t: string | undefined) => !!t && garbleScore([t]) > 0
    let changed = false
    const next: SongSheet = { ...s }
    if (s.tracks?.some((t) => broken(t.name))) {
      next.tracks = s.tracks.map((t) => {
        const fresh = score.tracks.find((x) => x.index === t.index)?.name
        return broken(t.name) && fresh && !broken(fresh) ? { ...t, name: fresh } : t
      })
      changed = true
    }
    const title = stripSiteAds(score.title ?? '')
    if (broken(s.title) && title && !broken(title)) {
      next.title = title.slice(0, 60)
      changed = true
    }
    const artist = stripSiteAds(score.artist ?? '')
    if ((broken(s.artist) || (s.artist && stripSiteAds(s.artist) !== s.artist)) && !broken(artist)) {
      next.artist = (artist || stripSiteAds(s.artist ?? '')).slice(0, 40)
      changed = true
    }
    if (!changed) return undefined
    next.updatedAt = Date.now()
    await db.songSheets.put(next)
    return next
  },

  async update(id: string, patch: Partial<Pick<SongSheet, 'title' | 'pattern' | 'bpm' | 'notes' | 'artist' | 'versionLabel' | 'tags' | 'defaultTrack' | 'transpose' | 'transposeWay'>>): Promise<SongSheet | undefined> {
    const db = getDb()
    const s = await db.songSheets.get(id)
    if (!s) return undefined
    const next: SongSheet = { ...s, ...patch, updatedAt: Date.now() }
    if (patch.title !== undefined) next.title = patch.title.trim().slice(0, 60) || s.title
    if (patch.artist !== undefined) next.artist = patch.artist.trim().slice(0, 40)
    if (patch.versionLabel !== undefined) next.versionLabel = patch.versionLabel.trim().slice(0, 30)
    await db.songSheets.put(next)
    return next
  },

  /** Remember which version was opened last (the version picker defaults to it). */
  async markOpened(id: string): Promise<void> {
    const db = getDb()
    const s = await db.songSheets.get(id)
    if (s) await db.songSheets.put({ ...s, lastOpenedAt: Date.now() })
  },

  /** Keep the best score per track and bar range. */
  async recordPractice(id: string, key: string, score: number): Promise<void> {
    const db = getDb()
    const s = await db.songSheets.get(id)
    if (!s) return
    const best = Math.max(score, s.sectionBests?.[key] ?? 0)
    await db.songSheets.put({ ...s, lastPracticedAt: Date.now(), sectionBests: { ...s.sectionBests, [key]: best } })
  },

  /** The original file of a sheet, if it was kept. */
  async fileBytes(fileId: string): Promise<Uint8Array | null> {
    const f = await getDb().sheetFiles.get(fileId)
    return f ? base64ToBytes(f.base64) : null
  },

  /** Singers already used, for the autocomplete. */
  async artists(): Promise<string[]> {
    const rows = await getDb().songSheets.toArray()
    return Array.from(new Set(rows.map((r) => r.artist?.trim()).filter((a): a is string => Boolean(a)))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  },

  async remove(id: string): Promise<void> {
    const db = getDb()
    await db.transaction('rw', [db.songSheets, db.sheetFiles, db.audioFiles, db.singTakes, db.singMeta], async () => {
      const s = await db.songSheets.get(id)
      await db.singTakes.where('key').equals(`sheet:${id}`).delete()
      await db.singMeta.delete(`sheet:${id}`)
      await db.songSheets.delete(id)
      if (s?.fileId) await db.sheetFiles.delete(s.fileId)
      await db.audioFiles.where('sheetId').equals(id).delete()
    })
  },
}
