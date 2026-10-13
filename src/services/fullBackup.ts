/**
 * 完整备份 (0.23.0): everything, recordings and imported audio included, in
 * one file — for moving to the app (or another computer). The practice-data
 * JSON export stays as it is for small backups.
 *
 * File layout: "GLFB" + uint32 format version + uint32 header length + the
 * header (UTF-8 JSON: table rows, with every Blob / ArrayBuffer / typed array
 * replaced by a reference) + the binary parts one after another. Built and
 * read with Blob slices, so a backup of a few GB never becomes one string.
 *
 * Not included: AI settings and the device key (secrets), and 歌曲库 folders
 * (a folder permission cannot move; add the folders again).
 */
import { getDb, type GrooveLabDB } from '@/infrastructure/db/database'

const MAGIC = 'GLFB'
const FORMAT = 1
const SKIP = new Set(['aiSettings', 'cryptoKeys', 'libraryFolders', 'librarySongs'])

type Ref =
  | { __gl: 'blob'; i: number; type: string }
  | { __gl: 'ab'; i: number }
  | { __gl: 'ta'; i: number; kind: string }

interface Header {
  app: 'groovelab'
  format: number
  appVersion: string
  exportedAt: string
  tables: Record<string, unknown[]>
  parts: number[]
}

export class FullBackupError extends Error {}

/** Tables that go into a full backup (every table except the ones above). */
function tableNames(): string[] {
  return getDb()
    .tables.map((t) => t.name)
    .filter((n) => !SKIP.has(n))
}

const isPlain = (v: object) =>
  Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null

function encode(value: unknown, parts: Blob[]): unknown {
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Blob) {
    parts.push(value)
    return { __gl: 'blob', i: parts.length - 1, type: value.type } satisfies Ref
  }
  if (value instanceof ArrayBuffer) {
    parts.push(new Blob([value]))
    return { __gl: 'ab', i: parts.length - 1 } satisfies Ref
  }
  if (ArrayBuffer.isView(value)) {
    parts.push(new Blob([new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice()]))
    return { __gl: 'ta', i: parts.length - 1, kind: value.constructor.name } satisfies Ref
  }
  if (Array.isArray(value)) return value.map((v) => encode(v, parts))
  if (value instanceof Date) return value.toISOString()
  if (!isPlain(value)) return null
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) out[k] = encode(v, parts)
  return out
}

const TYPED: Record<string, new (b: ArrayBuffer) => ArrayBufferView> = {
  Uint8Array,
  Int8Array,
  Uint16Array,
  Int16Array,
  Uint32Array,
  Int32Array,
  Float32Array,
  Float64Array,
  Uint8ClampedArray,
}

async function decode(value: unknown, part: (i: number) => Blob): Promise<unknown> {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return Promise.all(value.map((v) => decode(v, part)))
  const ref = value as Partial<Ref>
  if (ref.__gl === 'blob' && typeof ref.i === 'number')
    return part(ref.i).slice(0, undefined, (ref as { type: string }).type)
  if (ref.__gl === 'ab' && typeof ref.i === 'number') return part(ref.i).arrayBuffer()
  if (ref.__gl === 'ta' && typeof ref.i === 'number') {
    const Ctor = TYPED[(ref as { kind: string }).kind] ?? Uint8Array
    return new Ctor(await part(ref.i).arrayBuffer())
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) out[k] = await decode(v, part)
  return out
}

/** The whole backup as one Blob (save it as groovelab-完整备份-<date>.glbackup). */
export async function exportFullBackup(appVersion: string): Promise<Blob> {
  const db = getDb()
  const parts: Blob[] = []
  const tables: Record<string, unknown[]> = {}
  for (const name of tableNames())
    tables[name] = (await db.table(name).toArray()).map((r) => encode(r, parts))
  const header: Header = {
    app: 'groovelab',
    format: FORMAT,
    appVersion,
    exportedAt: new Date().toISOString(),
    tables,
    parts: parts.map((p) => p.size),
  }
  const json = new TextEncoder().encode(JSON.stringify(header))
  const head = new Uint8Array(12)
  head.set(new TextEncoder().encode(MAGIC), 0)
  const view = new DataView(head.buffer)
  view.setUint32(4, FORMAT, true)
  view.setUint32(8, json.byteLength, true)
  return new Blob([head, json, ...parts], { type: 'application/octet-stream' })
}

/** Is this file a full backup (not the practice-data JSON)? */
export async function isFullBackup(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  return new TextDecoder().decode(head) === MAGIC
}

export interface FullBackupSummary {
  appVersion: string
  exportedAt: string
  counts: Record<string, number>
  bytes: number
}

async function readHeader(file: Blob): Promise<{ header: Header; dataStart: number }> {
  if (!(await isFullBackup(file))) throw new FullBackupError('这不是律动工坊的完整备份文件。')
  const view = new DataView(await file.slice(0, 12).arrayBuffer())
  const format = view.getUint32(4, true)
  if (format > FORMAT) throw new FullBackupError('这个备份来自更新版本的律动工坊，请先更新再恢复。')
  const len = view.getUint32(8, true)
  let header: Header
  try {
    header = JSON.parse(
      new TextDecoder().decode(await file.slice(12, 12 + len).arrayBuffer()),
    ) as Header
  } catch {
    throw new FullBackupError('备份文件已损坏（读不出内容目录），没有恢复任何内容。')
  }
  if (
    header.app !== 'groovelab' ||
    typeof header.tables !== 'object' ||
    !Array.isArray(header.parts)
  )
    throw new FullBackupError('备份文件已损坏，没有恢复任何内容。')
  const total = 12 + len + header.parts.reduce((a, b) => a + b, 0)
  if (file.size < total)
    throw new FullBackupError('备份文件不完整（可能没有下载或复制完），没有恢复任何内容。')
  return { header, dataStart: 12 + len }
}

export async function summarizeFullBackup(file: Blob): Promise<FullBackupSummary> {
  const { header } = await readHeader(file)
  const counts: Record<string, number> = {}
  for (const [k, rows] of Object.entries(header.tables))
    counts[k] = Array.isArray(rows) ? rows.length : 0
  if (!counts.profile) throw new FullBackupError('备份里没有学生档案，没有恢复任何内容。')
  return { appVersion: header.appVersion, exportedAt: header.exportedAt, counts, bytes: file.size }
}

/**
 * Replace everything with the backup, in one transaction (all or nothing).
 * AI settings and 歌曲库 folders on this computer stay as they are.
 */
export async function restoreFullBackup(file: Blob): Promise<void> {
  const { header, dataStart } = await readHeader(file)
  const offsets: number[] = []
  let at = dataStart
  for (const size of header.parts) {
    offsets.push(at)
    at += size
  }
  const part = (i: number) => {
    const start = offsets[i]
    if (start === undefined)
      throw new FullBackupError('备份文件已损坏（缺少音频部分），没有恢复任何内容。')
    return file.slice(start, start + header.parts[i]!)
  }
  const db = getDb() as GrooveLabDB
  const known = new Set(tableNames())
  // Decode first (reading binary parts is async; a Dexie transaction must not wait on other work).
  const decoded: Record<string, unknown[]> = {}
  for (const [name, rows] of Object.entries(header.tables)) {
    if (!known.has(name) || !Array.isArray(rows)) continue
    decoded[name] = (await decode(rows, part)) as unknown[]
  }
  const names = [...known]
  await db.transaction(
    'rw',
    names.map((n) => db.table(n)),
    async () => {
      for (const n of names) {
        await db.table(n).clear()
        const rows = decoded[n]
        if (rows?.length) await db.table(n).bulkPut(rows)
      }
    },
  )
}
