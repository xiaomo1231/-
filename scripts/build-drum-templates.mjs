// Build src/songs/drumTemplates.json: drum-pattern templates for the drum part generator.
//
// Run:    node scripts/build-drum-templates.mjs
// Input:  server-assets/gmd/groove-midionly.zip (Groove MIDI Dataset, CC BY 4.0, Google LLC;
//         gitignored, never copied into git-tracked places)
// Output: src/songs/drumTemplates.json (DrumTemplateLibrary, compact JSON)
//
// Runs on Node 24 with its built-in TypeScript type stripping, so the parser and the
// drum types are imported straight from src/songs/*.ts (no duplicated copy). Both files
// use only erasable TypeScript syntax (no enums, no parameter properties).
//
// Pipeline: read zip (store / deflate entries, no dependencies) -> parse each .mid ->
// map GM/TD-11 keys to drum pieces -> quantize to a 16th grid -> cut beats into 1- and
// 2-bar windows (drop sparse or off-grid windows) -> per file keep its most repeated
// window as a groove -> fills = last bar of each fill file -> group by style and tempo ->
// merge thin styles into rock -> add hand-written basics for meters the dataset barely
// covers (3/4, 6/8, 12/8, shuffle) -> write JSON.

import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMidi } from '../src/songs/midiFile.ts'
import { DRUM_PIECES, barSteps } from '../src/songs/drumTypes.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ZIP_PATH = join(ROOT, 'server-assets', 'gmd', 'groove-midionly.zip')
const OUT_PATH = join(ROOT, 'src', 'songs', 'drumTemplates.json')

const SOURCE = 'Groove MIDI Dataset (Magenta, Google LLC) + hand-written basics'
const LICENSE = 'CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/'

const STEPS_PER_QUARTER = 4
const OFF_GRID_STEP = 0.3 // a hit farther than this (in steps) from the grid is off-grid
const MIN_WINDOW_HITS = 4
const MIN_FILL_HITS = 2
const MAX_GROOVES = 12
const MAX_CHORUS = 8
const MAX_FILLS = 12
const MIN_GROOVES_PER_STYLE = 3
const MIN_FILLS_PER_STYLE = 2
const SUPPORTED_METERS = new Set(['4-4', '3-4', '6-8'])

// ---------------------------------------------------------------------------
// zip reader (central directory + stored / deflated entries)
// ---------------------------------------------------------------------------

function openZip(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('zip: end of central directory not found')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: bad central directory entry')
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const nlen = buf.readUInt16LE(p + 28)
    const elen = buf.readUInt16LE(p + 30)
    const clen = buf.readUInt16LE(p + 32)
    const lho = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nlen)
    if (csize === 0xffffffff || lho === 0xffffffff) throw new Error('zip64 archives are not supported')
    entries.set(name, { method, csize, lho })
    p += 46 + nlen + elen + clen
  }
  return {
    names: [...entries.keys()],
    read(name) {
      const e = entries.get(name)
      if (!e) throw new Error(`zip: no entry ${name}`)
      const lh = e.lho
      if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error(`zip: bad local header for ${name}`)
      const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28)
      const raw = buf.subarray(start, start + e.csize)
      if (e.method === 0) return raw
      if (e.method === 8) return inflateRawSync(raw)
      throw new Error(`zip: unsupported compression method ${e.method} for ${name}`)
    },
  }
}

// ---------------------------------------------------------------------------
// drum key mapping: DRUM_PIECES first (primary GM key wins over alsoMidi), then TD-11 extras
// ---------------------------------------------------------------------------

const KEY_MAP = new Map()
for (const piece of DRUM_PIECES) KEY_MAP.set(piece.midi, piece.id)
for (const piece of DRUM_PIECES) for (const k of piece.alsoMidi) if (!KEY_MAP.has(k)) KEY_MAP.set(k, piece.id)
// Roland TD-11 edge / bell variants and the Magenta mapping's extra keys.
for (const [k, id] of [
  [22, 'hihatClosed'],
  [26, 'hihatOpen'],
  [58, 'tomFloor'],
]) if (!KEY_MAP.has(k)) KEY_MAP.set(k, id)

const PIECE_ORDER = new Map(DRUM_PIECES.map((p, i) => [p.id, i]))
const PIECE_BY_ABBR = new Map(DRUM_PIECES.map((p) => [p.abbr, p.id]))
const RIDE_LIKE = new Set(['ride', 'rideBell', 'hihatOpen'])

function velLevel(raw) {
  return raw < 50 ? 1 : raw > 105 ? 3 : 2
}

function compareHits(a, b) {
  return a.step - b.step || PIECE_ORDER.get(a.piece) - PIECE_ORDER.get(b.piece)
}

// ---------------------------------------------------------------------------
// quantize one file's drum notes onto the 16th grid of its bar
// ---------------------------------------------------------------------------

function quantizeFile(parsed, num, den) {
  const steps = barSteps({ num, den, stepsPerQuarter: STEPS_PER_QUARTER })
  const barTicks = ((num * 4) / den) * parsed.ppq
  const stepTicks = barTicks / steps
  const byKey = new Map()
  for (const track of parsed.tracks) {
    for (const e of track) {
      if (e.type !== 'on') continue
      const piece = KEY_MAP.get(e.key)
      if (!piece) continue
      const pos = e.tick / stepTicks
      let bar = Math.floor(pos / steps)
      const rel = pos - bar * steps
      let q = Math.round(rel)
      const off = Math.abs(rel - q) > OFF_GRID_STEP
      if (q === steps) {
        bar += 1
        q = 0
      }
      const key = `${bar}|${q}|${piece}`
      const prev = byKey.get(key)
      if (!prev) byKey.set(key, { bar, step: q, piece, raw: e.vel, off })
      else {
        prev.raw = Math.max(prev.raw, e.vel)
        prev.off = prev.off && off
      }
    }
  }
  const entries = [...byKey.values()]
  let nBars = 0
  for (const e of entries) nBars = Math.max(nBars, e.bar + 1)
  return { steps, entries, nBars }
}

/** Hits of bars [start, start + count) as a window; null when too sparse or mostly off-grid. */
function makeWindow(q, num, den, start, count, minHits) {
  const sel = q.entries.filter((e) => e.bar >= start && e.bar < start + count)
  if (sel.length < minHits) return null
  const offCount = sel.filter((e) => e.off).length
  if (offCount * 2 > sel.length) return null
  const bars = []
  for (let i = 0; i < count; i++) {
    const hits = sel
      .filter((e) => e.bar === start + i)
      .map((e) => ({ step: e.step, piece: e.piece, vel: velLevel(e.raw) }))
      .sort(compareHits)
    bars.push({ num, den, stepsPerQuarter: STEPS_PER_QUARTER, hits })
  }
  const sig = sel
    .map((e) => `${(e.bar - start) * q.steps + e.step}:${e.piece}`)
    .sort()
    .join(' ')
  return { bars, hits: sel.length, sig: `${count}|${sig}` }
}

function barFeatures(bars) {
  let kickCrash = 0
  let ridey = false
  let hits = 0
  for (const bar of bars) {
    for (const h of bar.hits) {
      hits++
      if (h.piece === 'kick' || h.piece === 'crash') kickCrash++
      if (RIDE_LIKE.has(h.piece)) ridey = true
    }
  }
  return { kickCrash: kickCrash / bars.length, ridey, hits }
}

// ---------------------------------------------------------------------------
// style grouping
// ---------------------------------------------------------------------------

const KEEP_STYLES = new Set(['rock-slow', 'rock', 'rock-fast', 'pop', 'funk', 'hiphop', 'soul', 'jazz', 'latin', 'reggae', 'afrobeat'])
const DATASET_TO_STYLE = {
  pop: 'pop',
  funk: 'funk',
  neworleans: 'funk',
  hiphop: 'hiphop',
  soul: 'soul',
  jazz: 'jazz',
  latin: 'latin',
  reggae: 'reggae',
  afrocuban: 'afrobeat',
  afrobeat: 'afrobeat',
  highlife: 'afrobeat',
}

/** Style key of a dataset row, before thin-style merging. */
function styleKeyOf(styleField, bpm) {
  const first = styleField.split('/')[0]
  if (first === 'punk') return 'rock-fast'
  if (first === 'rock') return bpm < 85 ? 'rock-slow' : bpm <= 140 ? 'rock' : 'rock-fast'
  return DATASET_TO_STYLE[first] ?? 'other'
}

const STYLE_META = {
  'rock-slow': { zh: '摇滚慢歌', minBpm: 50, maxBpm: 84 },
  rock: { zh: '摇滚 8 分', minBpm: 85, maxBpm: 140 },
  'rock-fast': { zh: '快摇滚 / 朋克', minBpm: 141, maxBpm: 240 },
  pop: { zh: '流行' },
  funk: { zh: '放克 16 分' },
  hiphop: { zh: '嘻哈' },
  soul: { zh: '灵魂乐' },
  jazz: { zh: '爵士（摇摆）' },
  latin: { zh: '拉丁' },
  reggae: { zh: '雷鬼' },
  afrobeat: { zh: '非洲节奏' },
}

// ---------------------------------------------------------------------------
// hand-written basics (strings: "ABBR pattern|ABBR pattern"; x = normal, X = accent,
// o = ghost, - = empty; one character per step; each pattern must fill the bar)
// ---------------------------------------------------------------------------

const HAND_STYLES = [
  {
    id: 'ballad-34', zh: '慢歌 3/4', num: 3, den: 4, spq: 4, minBpm: 60, maxBpm: 110,
    grooves: [
      'HH x-x-x-x-x-x-|SD ----x-------|BD x-----------',
      'HH x---x---x---|SD ----x-------|BD x-------x---',
      'HH x---x-o-x---|SD ----x-------|BD x-----------',
    ],
    chorus: [
      'RD x-x-x-x-x-x-|SD ----X-------|BD x-------x---',
      'CR X-----------|HH x-x-x-x-x-x-|SD ----X-------|BD x-----------',
    ],
    fills: [
      'T1 ----xx------|T2 ------xx----|FT --------xxxx',
      'SD ----x-x-x-x-|BD x-----------',
      'T1 ------xx----|FT ----------xx',
    ],
  },
  {
    id: 'waltz-34', zh: '华尔兹 3/4', num: 3, den: 4, spq: 4, minBpm: 80, maxBpm: 150,
    grooves: [
      'HH x---x---x---|SD ----x---x---|BD x-----------',
      'RD x-x-x-x-x-x-|SD ----x---x---|BD x-------x---',
      'HH x-x-x-x-x-x-|SD ----x---o---|BD x-----------',
    ],
    chorus: [
      'CR X-----------|RD x-x-x-x-x-x-|SD ----x---x---|BD x-----------',
      'OH x---x---x---|SD ----x---x---|BD x-------x---',
    ],
    fills: [
      'SD ------x-x-x-|BD x-----------',
      'T1 ----xx------|FT ----------xx',
      'SD ------xxxxxx',
    ],
  },
  {
    id: 'ballad-68', zh: '6/8 慢摇', num: 6, den: 8, spq: 4, minBpm: 60, maxBpm: 100,
    grooves: [
      'HH x-x-x-x-x-x-|SD ------x-----|BD x-----------',
      'HH x---x---x---|SD ------x-----|BD x-----x-----',
      'HH x-x-o-x-x-o-|SD ------x-----|BD x-----x-----',
    ],
    chorus: [
      'RD x-x-x-x-x-x-|SD ------X-----|BD x-----x-----',
      'OH x---x---x---|SD ------X-----|BD x-----x-----|CR X-----------',
    ],
    fills: [
      'SD ------xxxxxx',
      'T1 ------xx----|FT ----------xx',
      'SD ----x-x-x-x-',
    ],
  },
  {
    id: 'blues-shuffle', zh: '12/8 布鲁斯摇摆', num: 12, den: 8, spq: 4, minBpm: 70, maxBpm: 130,
    grooves: [
      'HH x---x-x---x-x---x-x---x-|SD ------x-----------x-----|BD x-----------x-----------',
      'RD x---x-x---x-x---x-x---x-|SD ------x-----------x-----|BD x-----x-----x-----------',
    ],
    chorus: [
      'RD x---x-x---x-x---x-x---x-|OH x---x-x---x-x---x-x---x-|SD ------x-----------x-----|BD x-----x-----x-----------',
    ],
    fills: [
      'SD ------------xxxxxxxxxxxx',
      'T1 ------xxxxxx------------',
      'FT ------------xxxxxx------',
    ],
  },
  {
    id: 'shuffle-44', zh: '4/4 摇摆（三连）', num: 4, den: 4, spq: 3, minBpm: 80, maxBpm: 140,
    grooves: [
      'HH x-xx-xx-xx-x|SD ---x-----x--|BD x-----x-----',
      'RD x-xx-xx-xx-x|SD ---x-----x--|BD x-x---x-x---',
    ],
    chorus: [
      'RD x-xx-xx-xx-x|SD ---X-----X--|BD x-x---x-x---',
      'OH x-xx-xx-xx-x|CR X-----------|SD ---X-----X--|BD x-----x-----',
    ],
    fills: [
      'SD ----xxxxxxxx',
      'T1 ---xx-xx-xx-',
      'FT ------xxxxxx',
    ],
  },
]

function parseHandBar(text, num, den, spq, where) {
  const steps = barSteps({ num, den, stepsPerQuarter: spq })
  const hits = []
  for (const token of text.split('|')) {
    const trimmed = token.trim()
    const space = trimmed.indexOf(' ')
    const abbr = trimmed.slice(0, space)
    const pattern = trimmed.slice(space + 1).replace(/\s+/g, '')
    const piece = PIECE_BY_ABBR.get(abbr)
    if (!piece) throw new Error(`${where}: unknown drum abbreviation "${abbr}"`)
    if (pattern.length !== steps) {
      throw new Error(`${where}: ${abbr} pattern has ${pattern.length} steps, bar has ${steps}: "${text}"`)
    }
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i]
      if (c === '-') continue
      const vel = c === 'x' ? 2 : c === 'X' ? 3 : c === 'o' ? 1 : null
      if (vel === null) throw new Error(`${where}: bad character "${c}" in "${text}"`)
      hits.push({ step: i, piece, vel })
    }
  }
  hits.sort(compareHits)
  return { num, den, stepsPerQuarter: spq, hits }
}

function handEntries(style) {
  const build = (list) => list.map((text, i) => ({
    bars: [parseHandBar(text, style.num, style.den, style.spq, `${style.id}[${i}]`)],
    weight: 1,
  }))
  return { grooves: build(style.grooves), chorus: build(style.chorus), fills: build(style.fills) }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  const header = lines[0].split(',')
  return lines.slice(1).map((line) => {
    const cells = line.split(',')
    const row = Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']))
    return row
  })
}

function main() {
  const zip = openZip(readFileSync(ZIP_PATH))
  const midiByPath = new Map()
  for (const name of zip.names) {
    if (name.endsWith('.mid')) midiByPath.set(name.replace(/^groove\//, ''), name)
  }
  const csvEntry = zip.names.find((n) => n.endsWith('info.csv'))
  if (!csvEntry) throw new Error('zip: groove/info.csv not found')
  const rows = parseCsv(Buffer.from(zip.read(csvEntry)).toString('utf8'))

  // pools[styleKey|meter] = { grooves: Map sig -> {bars, weight}, fills: Map, bpms: [] }
  const pools = new Map()
  const poolOf = (key) => {
    if (!pools.has(key)) pools.set(key, { grooves: new Map(), fills: new Map(), bpms: [] })
    return pools.get(key)
  }
  const stats = { files: rows.length, parsed: 0, skippedMeter: 0, skippedError: 0, skippedNoWindow: 0 }
  const errors = []

  for (const row of rows) {
    const meterCsv = row.time_signature
    if (!SUPPORTED_METERS.has(meterCsv)) {
      stats.skippedMeter++
      continue
    }
    const entryName = midiByPath.get(row.midi_filename)
    if (!entryName) {
      stats.skippedError++
      errors.push(`missing ${row.midi_filename}`)
      continue
    }
    let parsed
    try {
      parsed = parseMidi(zip.read(entryName))
    } catch (err) {
      stats.skippedError++
      errors.push(`${row.midi_filename}: ${err.message}`)
      continue
    }
    stats.parsed++
    const [num, den] = meterCsv.split('-').map(Number)
    const bpm = Number(row.bpm)
    const isFill = row.beat_type === 'fill'
    const key = `${styleKeyOf(row.style, bpm)}|${num}/${den}`
    const pool = poolOf(key)
    pool.bpms.push(bpm)

    const q = quantizeFile(parsed, num, den)
    if (q.nBars === 0) {
      stats.skippedNoWindow++
      continue
    }

    if (isFill) {
      const last = makeWindow(q, num, den, q.nBars - 1, 1, MIN_FILL_HITS)
      if (last) addCandidate(pool.fills, last.sig, last.bars, 1)
      continue
    }

    // beats: most repeated 2-bar window of the file, else most repeated 1-bar window
    const best = (windows) => {
      const counts = new Map()
      for (const w of windows) {
        const c = counts.get(w.sig)
        if (c) c.n++
        else counts.set(w.sig, { w, n: 1 })
      }
      let top = null
      for (const c of counts.values()) if (!top || c.n > top.n) top = c
      return top
    }
    const two = []
    for (let b = 0; b + 1 < q.nBars; b += 2) {
      const w = makeWindow(q, num, den, b, 2, MIN_WINDOW_HITS)
      if (w) two.push(w)
    }
    let top = best(two)
    if (!top || top.n < 2) {
      const one = []
      for (let b = 0; b < q.nBars; b++) {
        const w = makeWindow(q, num, den, b, 1, MIN_WINDOW_HITS)
        if (w) one.push(w)
      }
      top = best(one)
    }
    if (!top) {
      stats.skippedNoWindow++
      continue
    }
    addCandidate(pool.grooves, top.w.sig, top.w.bars, top.n)
  }

  function addCandidate(map, sig, bars, weight) {
    const prev = map.get(sig)
    if (prev) prev.weight += weight
    else map.set(sig, { bars, weight })
  }

  // thin styles: keep only KEEP_STYLES with enough material; others merge into rock (4/4) or drop
  const merged = []
  const dropped = []
  for (const [key, pool] of [...pools.entries()]) {
    const [style, meter] = key.split('|')
    const enough = pool.grooves.size >= MIN_GROOVES_PER_STYLE && pool.fills.size >= MIN_FILLS_PER_STYLE
    if (KEEP_STYLES.has(style) && enough) continue
    pools.delete(key)
    if (meter === '4/4') {
      const target = poolOf('rock|4/4')
      for (const [sig, c] of pool.grooves) addCandidate(target.grooves, sig, c.bars, c.weight)
      for (const [sig, c] of pool.fills) addCandidate(target.fills, sig, c.bars, c.weight)
      target.bpms.push(...pool.bpms)
      merged.push(`${key} (${pool.grooves.size}g/${pool.fills.size}f)`)
    } else {
      dropped.push(`${key} (${pool.grooves.size}g/${pool.fills.size}f)`)
    }
  }

  const styles = []
  const orderOf = (id) => ['rock-slow', 'rock', 'rock-fast', 'pop', 'funk', 'hiphop', 'soul', 'jazz', 'latin', 'reggae', 'afrobeat'].indexOf(id)
  const datasetKeys = [...pools.keys()].sort((a, b) => orderOf(a.split('|')[0]) - orderOf(b.split('|')[0]))
  for (const key of datasetKeys) {
    const [style, meter] = key.split('|')
    const pool = pools.get(key)
    if (!pool) continue
    const meta = STYLE_META[style]
    const grooveList = [...pool.grooves.values()]
    const medianCK = median(grooveList.map((c) => barFeatures(c.bars).kickCrash))
    const busy = (c) => {
      const f = barFeatures(c.bars)
      return f.ridey || f.kickCrash > medianCK
    }
    const byWeight = (a, b) => b.weight - a.weight
    const chorus = grooveList.filter(busy).sort(byWeight).slice(0, MAX_CHORUS)
    let grooves = grooveList.filter((c) => !busy(c)).sort(byWeight).slice(0, MAX_GROOVES)
    if (grooves.length === 0) grooves = [...grooveList].sort(byWeight).slice(0, MAX_GROOVES)
    const fills = [...pool.fills.values()].sort(byWeight).slice(0, MAX_FILLS)
    const minBpm = meta.minBpm ?? Math.floor(Math.min(...pool.bpms))
    const maxBpm = meta.maxBpm ?? Math.ceil(Math.max(...pool.bpms))
    styles.push({
      id: style === 'rock' && meter === '4/4' ? 'rock' : `${style}${meter === '4/4' ? '' : '-' + meter.replace('/', '')}`,
      zh: meta.zh,
      meter,
      minBpm,
      maxBpm,
      grooves,
      chorus,
      fills,
    })
  }

  for (const hand of HAND_STYLES) {
    const e = handEntries(hand)
    styles.push({
      id: hand.id,
      zh: hand.zh,
      meter: `${hand.num}/${hand.den}`,
      minBpm: hand.minBpm,
      maxBpm: hand.maxBpm,
      grooves: e.grooves,
      chorus: e.chorus,
      fills: e.fills,
    })
  }

  const library = { version: 1, source: SOURCE, license: LICENSE, styles }
  const json = JSON.stringify(library)
  writeFileSync(OUT_PATH, json + '\n', 'utf8')

  console.log(`Read ${stats.files} rows: ${stats.parsed} parsed, ${stats.skippedMeter} other meters, ${stats.skippedError} unreadable, ${stats.skippedNoWindow} without usable bars`)
  for (const s of styles) {
    console.log(`  ${s.id.padEnd(16)} ${s.zh.padEnd(14)} ${s.meter.padEnd(5)} ${String(s.minBpm).padStart(3)}-${String(s.maxBpm).padEnd(3)} grooves ${s.grooves.length}  chorus ${s.chorus.length}  fills ${s.fills.length}`)
  }
  if (merged.length) console.log(`Merged into rock (thin): ${merged.join(', ')}`)
  if (dropped.length) console.log(`Dropped (thin, other meter): ${dropped.join(', ')}`)
  if (errors.length) console.log(`Unreadable files (${errors.length}): ${errors.slice(0, 5).join('; ')}${errors.length > 5 ? ' ...' : ''}`)
  console.log(`Wrote ${OUT_PATH}: ${(statSync(OUT_PATH).size / 1024).toFixed(1)} KB`)
}

function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

main()
