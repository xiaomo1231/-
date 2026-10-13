/**
 * ASCII guitar tab → tab notes (pure).
 *
 *   e|-----5-7-|-8p5------|
 *   B|---------|----8-5~--|
 *   ...
 *   E|---------|----------|
 *
 * Systems of six lines (high e on top) are read column by column. Two-digit
 * frets are supported; h / p / b / / / \ / ~ after a fret mark the
 * technique. Rhythm comes from the spacing: the most common gap becomes an
 * eighth note. When several strings sound in the same column only the
 * highest note is kept (lead lines).
 */
import type { TabNote, Technique } from '@/guitar/scales'
import { ImportError } from './midiImport'

const LINE = /^\s*([eEBGDAa1-6])?\s*[|:]?([-0-9hpb/\\~|xX.rs()\s]+)$/

const TECH: Record<string, Technique> = { h: 'hammer', p: 'pull', b: 'bend', '/': 'slide', '\\': 'slide', '~': 'vibrato' }

export interface TabImport {
  notes: TabNote[]
  warnings: string[]
}

export function parseAsciiTab(text: string, strings = 6): TabImport {
  const lines = text.split(/\r?\n/)
  const systems: string[][] = []
  let block: string[] = []
  for (const raw of lines) {
    const m = LINE.exec(raw)
    if (m && /[-0-9]/.test(m[2]!) && raw.replace(/[^-]/g, '').length >= 3) {
      block.push(m[2]!)
      if (block.length === strings) {
        systems.push(block)
        block = []
      }
    } else if (block.length) block = []
  }
  if (!systems.length) throw new ImportError('没有找到六线谱。每个系统需要连续的 6 行，从高音 e 弦到低音 E 弦。')
  const events: Array<{ col: number; string: number; fret: number; tech?: Technique }> = []
  let base = 0
  for (const sys of systems) {
    const width = Math.max(...sys.map((l) => l.length))
    for (let row = 0; row < strings; row++) {
      const line = sys[row]!
      const string = strings - 1 - row
      for (let c = 0; c < line.length; c++) {
        const ch = line[c]!
        if (!/[0-9]/.test(ch) || /[0-9]/.test(line[c - 1] ?? '')) continue
        let s = ch
        if (/[0-9]/.test(line[c + 1] ?? '')) s += line[c + 1]
        const fret = Number(s)
        const after = line[c + s.length] ?? ''
        events.push({ col: base + c, string, fret, ...(TECH[after] ? { tech: TECH[after] } : {}) })
      }
    }
    base += width + 4
  }
  const byCol = new Map<number, (typeof events)[number]>()
  for (const e of events) {
    const prev = byCol.get(e.col)
    if (!prev || e.string > prev.string) byCol.set(e.col, e)
  }
  const cols = [...byCol.keys()].sort((a, b) => a - b)
  if (!cols.length) throw new ImportError('六线谱里没有品位数字。')
  const gaps = cols.slice(1).map((c, i) => c - cols[i]!).filter((g) => g > 0 && g < 20)
  const counts = new Map<number, number>()
  for (const g of gaps) counts.set(g, (counts.get(g) ?? 0) + 1)
  const unit = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 2
  const snap = (b: number) => [0.25, 0.5, 0.75, 1, 1.5, 2].reduce((best, x) => (Math.abs(x - b) < Math.abs(best - b) ? x : best), 0.5)
  const notes: TabNote[] = cols.map((c, i) => {
    const e = byCol.get(c)!
    const gap = cols[i + 1] !== undefined ? cols[i + 1]! - c : unit * 2
    return { string: e.string, fret: e.fret, beats: snap((gap / unit) * 0.5), ...(e.tech ? { tech: e.tech } : {}) }
  })
  const warnings: string[] = []
  if (events.length > notes.length) warnings.push('有些位置同时弹了几根弦（和弦），只保留了最高的那个音。')
  warnings.push('节奏是按谱面间距估计的，可能和原曲不同。')
  if (notes.length > 64) warnings.push(`一共 ${notes.length} 个音，只保留了前 64 个。`)
  return { notes: notes.slice(0, 64), warnings }
}
