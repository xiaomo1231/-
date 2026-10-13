import { clearAllData, getDb, type GrooveLabDB } from '@/infrastructure/db/database'

export const EXPORT_VERSION = 2

/**
 * Tables included in an export / import. The AI settings (with the encrypted
 * key) and the device key are never exported; a backup can be shared safely.
 */
const TABLES = [
  'profile',
  'skillMastery',
  'moduleProgress',
  'drillSessions',
  'drillAttempts',
  'confusions',
  'dailyPlans',
  'placements',
  'badges',
  'reviewItems',
  'lessonProgress',
  'compositions',
  'compositionVersions',
  'critiques',
  'generatedExercises',
  'advice',
  'guitarProgress',
  'songSheets',
  'sheetFiles',
  'singMeta',
] as const satisfies ReadonlyArray<keyof GrooveLabDB>

type TableName = (typeof TABLES)[number]

export interface ExportFile {
  app: 'groovelab'
  version: number
  exportedAt: string
  data: Partial<Record<TableName, unknown[]>>
}

/** Export everything the student produced as JSON. */
export async function exportAllData(): Promise<string> {
  const db = getDb()
  const rows = await Promise.all(TABLES.map((t) => db.table(t).toArray()))
  const data = Object.fromEntries(TABLES.map((t, i) => [t, rows[i]])) as ExportFile['data']
  const file: ExportFile = { app: 'groovelab', version: EXPORT_VERSION, exportedAt: new Date().toISOString(), data }
  return JSON.stringify(file, null, 2)
}

export class ImportError extends Error {}

/** Check a backup before anything is written. Returns the row count per table. */
export function parseBackup(json: string): { file: ExportFile; counts: Partial<Record<TableName, number>> } {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new ImportError('这个文件不是有效的 JSON。请选择从「导出练习数据」得到的 .json 文件。')
  }
  const f = parsed as Partial<ExportFile>
  if (!f || typeof f !== 'object' || f.app !== 'groovelab' || typeof f.data !== 'object' || f.data === null) {
    throw new ImportError('这不是律动工坊的备份文件。')
  }
  if (typeof f.version !== 'number' || f.version > EXPORT_VERSION) {
    throw new ImportError('这个备份来自更新版本的律动工坊，请先更新网站再导入。')
  }
  const counts: Partial<Record<TableName, number>> = {}
  for (const t of TABLES) {
    const rows = (f.data as Record<string, unknown>)[t]
    if (rows === undefined) continue
    if (!Array.isArray(rows) || rows.some((r) => typeof r !== 'object' || r === null)) throw new ImportError(`备份里的「${t}」数据格式不对，没有导入任何内容。`)
    counts[t] = rows.length
  }
  if (!counts.profile) throw new ImportError('备份里没有学生档案，没有导入任何内容。')
  return { file: f as ExportFile, counts }
}

/**
 * Replace all practice data with a backup, in one transaction: either every
 * table is restored or nothing changes. AI settings stay as they are.
 */
export async function importAllData(json: string): Promise<Partial<Record<TableName, number>>> {
  const { file, counts } = parseBackup(json)
  const db = getDb()
  const tables = TABLES.map((t) => db.table(t))
  await db.transaction('rw', tables, async () => {
    for (const t of TABLES) {
      await db.table(t).clear()
      const rows = file.data[t]
      if (rows?.length) await db.table(t).bulkPut(rows)
    }
  })
  return counts
}

export async function resetAllData(): Promise<void> {
  await clearAllData()
}
