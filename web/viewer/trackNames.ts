/**
 * Chinese display names for Guitar Pro tracks.
 *
 * Pure functions: no DOM, no alphaTab runtime. The track shape is structural
 * so callers can pass alphaTab's `model.Track` (type-only) or plain objects.
 */

export interface TrackLike {
  name: string
  playbackInfo: { program: number }
  isPercussion?: boolean
  staves: ReadonlyArray<{ isPercussion?: boolean; tuning: number[] }>
}

export interface TrackLabel {
  /** What the UI shows first. */
  zh: string
  /** The name as written in the file, when it differs from `zh`; otherwise ''. */
  original: string
}

/** Common English track names (keys are normalized: lower case, single spaces, no punctuation). */
const DICTIONARY: Record<string, string> = {
  guitar: '吉他',
  gtr: '吉他',
  gt: '吉他',
  'electric guitar': '电吉他',
  'e guitar': '电吉他',
  'dist guitar': '电吉他',
  'distortion guitar': '电吉他',
  'distorted guitar': '电吉他',
  overdrive: '电吉他',
  'overdrive guitar': '电吉他',
  acoustic: '木吉他',
  'acoustic guitar': '木吉他',
  nylon: '木吉他',
  'nylon guitar': '木吉他',
  'classical guitar': '木吉他',
  solo: '主音吉他',
  lead: '主音吉他',
  'lead guitar': '主音吉他',
  'solo guitar': '主音吉他',
  rhythm: '节奏吉他',
  'rhythm guitar': '节奏吉他',
  backing: '节奏吉他',
  'backing guitar': '节奏吉他',
  'clean guitar': '清音吉他',
  bass: '贝斯',
  'bass guitar': '贝斯',
  'e bass': '贝斯',
  'electric bass': '贝斯',
  bs: '贝斯',
  drums: '鼓',
  drum: '鼓',
  drumkit: '鼓',
  'drum kit': '鼓',
  percussion: '鼓',
  perc: '鼓',
  dr: '鼓',
  piano: '钢琴',
  keyboard: '键盘',
  keys: '键盘',
  key: '键盘',
  organ: '风琴',
  synth: '合成器',
  synthesizer: '合成器',
  pad: '合成器',
  strings: '弦乐',
  'string ensemble': '弦乐',
  violin: '小提琴',
  cello: '大提琴',
  vocal: '人声',
  vocals: '人声',
  voice: '人声',
  vox: '人声',
  'lead vocal': '人声',
  'lead vocals': '人声',
  melody: '旋律',
  harmony: '和声',
  choir: '合唱',
  brass: '铜管',
  trumpet: '小号',
  sax: '萨克斯',
  saxophone: '萨克斯',
  flute: '长笛',
  intro: '前奏',
  ending: '尾奏',
  outro: '尾奏',
  verse: '主歌',
  chorus: '副歌',
  bridge: '桥段',
  track: '音轨',
}

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 }

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/

/** Lower case, punctuation turned into spaces, runs of spaces collapsed. */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Splits a trailing number ("Guitar 2", "Gtr. II", "Guitar #3") from the name. */
function splitNumber(normalized: string): { base: string; num: number | null } {
  const m = /^(.*?)\s*#?\s*(\d{1,2}|iii|ii|iv|i|v)$/.exec(normalized)
  if (!m || !m[1]) return { base: normalized, num: null }
  const token = m[2] ?? ''
  const num = /^\d+$/.test(token) ? Number(token) : (ROMAN[token] ?? null)
  if (num === null) return { base: normalized, num: null }
  return { base: m[1].trim(), num }
}

/** Instrument from the General MIDI program (what the track sounds like when the name tells us nothing). */
function instrumentOf(program: number, percussion: boolean): string {
  if (percussion) return '鼓'
  const p = Math.max(0, Math.min(127, Math.trunc(program) || 0))
  if (p <= 7) return '钢琴'
  if (p <= 15) return '色彩打击乐'
  if (p <= 23) return '风琴'
  if (p <= 25) return '木吉他'
  if (p <= 31) return '电吉他'
  if (p <= 39) return '贝斯'
  if (p <= 47) return '弦乐'
  if (p >= 52 && p <= 54) return '人声'
  if (p <= 55) return '合奏'
  if (p <= 63) return '铜管'
  if (p <= 71) return '簧管'
  if (p <= 79) return '笛'
  if (p <= 103) return '合成器'
  return '乐器'
}

interface Pending {
  base: string
  num: number | null
  original: string
}

function parseTrack(track: TrackLike): Pending {
  const original = (track.name ?? '').trim()
  if (original === '') {
    const percussion = Boolean(track.isPercussion) || track.staves.some((s) => s.isPercussion)
    return { base: instrumentOf(track.playbackInfo.program, percussion), num: null, original: '' }
  }
  if (CJK.test(original)) {
    // Already Chinese: keep it as is, only lifting a trailing number so duplicates can be told apart.
    const m = /^(.*\S)\s*(\d{1,2})$/.exec(original)
    if (m) return { base: m[1]!, num: Number(m[2]), original: '' }
    return { base: original, num: null, original: '' }
  }
  const { base, num } = splitNumber(normalize(original))
  const hit = DICTIONARY[base]
  if (hit) return { base: hit, num, original }
  const percussion = Boolean(track.isPercussion) || track.staves.some((s) => s.isPercussion)
  return { base: instrumentOf(track.playbackInfo.program, percussion), num, original }
}

/** Labels for every track in one file, in track order (duplicates numbered). */
function computeLabels(tracks: ReadonlyArray<TrackLike>): TrackLabel[] {
  const parsed = tracks.map(parseTrack)

  // Group by the translated base name; a group of two or more needs numbers.
  const groups = new Map<string, number[]>()
  parsed.forEach((p, i) => {
    const list = groups.get(p.base) ?? []
    list.push(i)
    groups.set(p.base, list)
  })

  const zhOf: string[] = parsed.map((p) => (p.num === null ? p.base : `${p.base} ${p.num}`))
  for (const [base, members] of groups) {
    if (members.length < 2) continue
    const nums = members.map((i) => parsed[i]!.num)
    const distinct = nums.every((n) => n !== null) && new Set(nums).size === nums.length
    if (distinct) {
      members.forEach((i) => {
        zhOf[i] = `${base} ${parsed[i]!.num}`
      })
    } else {
      members.forEach((i, k) => {
        zhOf[i] = `${base} ${k + 1}`
      })
    }
  }

  return parsed.map((p, i) => {
    const zh = zhOf[i]!
    const original = p.original && p.original !== zh ? p.original : ''
    return { zh, original }
  })
}

/** The label for one track (index into `tracks`). */
export function trackLabel(tracks: ReadonlyArray<TrackLike>, index: number): TrackLabel {
  const label = computeLabels(tracks)[index]
  return label ?? { zh: `音轨 ${index + 1}`, original: '' }
}

/** Labels for every track, in track order. */
export function trackLabels(tracks: ReadonlyArray<TrackLike>): TrackLabel[] {
  return computeLabels(tracks)
}
