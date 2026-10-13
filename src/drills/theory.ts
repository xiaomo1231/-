import type { Rng } from '@/music/random'
import { majorKeySignature } from '@/music/keys'
import { LETTERS, letterPitchClass, type Letter } from '@/music/pitch'
import { scaleNotes } from '@/music/scales'
import { spell, spelledName, type Accidental, type SpelledNote } from '@/music/spelling'
import type { TheoryTopic } from './levelsP2'

export interface TheoryItem {
  topic: TheoryTopic
  prompt: string
  answer: string
  options: Array<{ value: string; label: string }>
  explanation: string
  staff?: { clef: 'treble' | 'bass'; notes: SpelledNote[]; keySignature?: string }
}

/** Options from an answer plus distractors (deduplicated, shuffled, max 4). */
function opts(rng: Rng, answer: string, distractors: string[], label: (v: string) => string = (v) => v): TheoryItem['options'] {
  const pool = Array.from(new Set(distractors.filter((d) => d !== answer)))
  const chosen = rng.shuffle(pool).slice(0, 3)
  return rng.shuffle([answer, ...chosen]).map((v) => ({ value: v, label: label(v) }))
}

const pretty = (name: string) => name.replace('#', '♯').replace(/([A-G])b/, '$1♭')

// ---------------------------------------------------------------------------

const DURATIONS: Array<{ name: string; beats: number }> = [
  { name: '全音符', beats: 4 },
  { name: '二分音符', beats: 2 },
  { name: '附点二分音符', beats: 3 },
  { name: '四分音符', beats: 1 },
  { name: '附点四分音符', beats: 1.5 },
  { name: '八分音符', beats: 0.5 },
  { name: '十六分音符', beats: 0.25 },
]

function beatsLabel(b: number): string {
  if (b === 0.5) return '半拍'
  if (b === 0.25) return '四分之一拍'
  if (b === 1.5) return '一拍半'
  return `${b} 拍`
}

function rhythmItem(rng: Rng): TheoryItem {
  const kind = rng.int(0, 3)
  if (kind === 0) {
    const d = rng.pick(DURATIONS)
    return {
      topic: 'rhythm',
      prompt: `在 4/4 拍里，一个${d.name}占几拍？`,
      answer: String(d.beats),
      options: opts(rng, String(d.beats), DURATIONS.map((x) => String(x.beats)), (v) => beatsLabel(Number(v))),
      explanation: `4/4 拍以四分音符为一拍，${d.name}等于${beatsLabel(d.beats)}。附点让音符延长一半。`,
    }
  }
  if (kind === 1) {
    const ts = rng.pick([
      { sig: '4/4', beats: 4, unit: '四分音符' },
      { sig: '3/4', beats: 3, unit: '四分音符' },
      { sig: '2/4', beats: 2, unit: '四分音符' },
      { sig: '6/8', beats: 6, unit: '八分音符' },
    ])
    return {
      topic: 'rhythm',
      prompt: `${ts.sig} 拍每小节有几个${ts.unit}？`,
      answer: String(ts.beats),
      options: opts(rng, String(ts.beats), ['2', '3', '4', '6', '8']),
      explanation: `拍号上面的数字是每小节的拍数，下面的数字是以什么音符为一拍。${ts.sig} 就是每小节 ${ts.beats} 个${ts.unit}。`,
    }
  }
  if (kind === 2) {
    const pairs = [
      { q: '一个附点四分音符等于几个八分音符？', a: '3', e: '附点四分 = 四分 + 八分 = 3 个八分音符。' },
      { q: '一个二分音符等于几个八分音符？', a: '4', e: '二分音符 = 2 拍 = 4 个八分音符。' },
      { q: '一个四分音符等于几个十六分音符？', a: '4', e: '一拍可以分成 4 个十六分音符。' },
      { q: '一个全音符等于几个四分音符？', a: '4', e: '全音符在 4/4 拍里占满整小节，即 4 拍。' },
      { q: '三连音的三个八分音符一共占几拍？', a: '1', e: '八分三连音把一拍平均分成三份，三个加起来正好一拍。' },
    ]
    const p = rng.pick(pairs)
    return { topic: 'rhythm', prompt: p.q, answer: p.a, options: opts(rng, p.a, ['1', '2', '3', '4', '6']), explanation: p.e }
  }
  const items = [
    { q: '流行和摇滚里，军鼓通常打在 4/4 拍的哪两拍？', a: '2 和 4', d: ['1 和 3', '1 和 2', '3 和 4'], e: '军鼓落在第 2、4 拍叫“后拍”（backbeat），是流行摇滚律动的核心。' },
    { q: '“切分”指的是什么？', a: '重音落在弱拍或弱位上', d: ['音符一个接一个连续不断', '速度越来越快', '所有音都一样长'], e: '切分把重音移到本来不强调的位置，制造推动感。' },
    { q: 'BPM 表示什么？', a: '每分钟的拍数', d: ['每小节的音符数', '音量大小', '每秒的音符数'], e: 'BPM = beats per minute，数字越大速度越快。' },
  ]
  const p = rng.pick(items)
  return { topic: 'rhythm', prompt: p.q, answer: p.a, options: opts(rng, p.a, p.d), explanation: p.e }
}

// ---------------------------------------------------------------------------

const NATURAL_STEPS: Array<[Letter, Letter, 'whole' | 'half']> = [
  ['C', 'D', 'whole'],
  ['D', 'E', 'whole'],
  ['E', 'F', 'half'],
  ['F', 'G', 'whole'],
  ['G', 'A', 'whole'],
  ['A', 'B', 'whole'],
  ['B', 'C', 'half'],
]

function pitchItem(rng: Rng): TheoryItem {
  const kind = rng.int(0, 2)
  if (kind === 0) {
    const [a, b, step] = rng.pick(NATURAL_STEPS)
    const ans = step === 'whole' ? '全音' : '半音'
    return {
      topic: 'pitch',
      prompt: `${a} 到 ${b} 是全音还是半音？`,
      answer: ans,
      options: [
        { value: '全音', label: '全音' },
        { value: '半音', label: '半音' },
      ],
      explanation: '白键之间只有 E–F 和 B–C 是半音（中间没有黑键），其余相邻白键都是全音。',
    }
  }
  if (kind === 1) {
    const letter = rng.pick(LETTERS)
    const up = rng.chance(0.5)
    const pc = (letterPitchClass(letter) + (up ? 1 : -1) + 12) % 12
    const answer = spelledName(spell(60 + pc, { preferFlats: !up }))
    const alt = spelledName(spell(60 + pc, { preferFlats: up }))
    const distract = [spelledName(spell(60 + ((pc + 1) % 12))), spelledName(spell(60 + ((pc + 11) % 12))), letter]
    const answers = new Set([answer, alt])
    return {
      topic: 'pitch',
      prompt: `${letter} ${up ? '升高' : '降低'}半音是哪个音？`,
      answer,
      options: opts(rng, answer, distract.filter((d) => !answers.has(d))),
      explanation:
        answer === alt
          ? `${letter} ${up ? '升高' : '降低'}半音正好落在白键 ${answer} 上。`
          : `${letter} ${up ? '升高' : '降低'}半音是 ${answer}（与 ${alt} 是同一个琴键，叫等音）。`,
    }
  }
  const items = [
    { q: '一个八度里有几个半音？', a: '12', d: ['7', '8', '10', '13'], e: '一个八度包含 12 个半音，也就是钢琴上连续的 12 个键（白键 + 黑键）。' },
    { q: '钢琴上一个八度有几个白键？', a: '7', d: ['5', '8', '12'], e: '白键是 C D E F G A B 七个音名。' },
    { q: '一个全音等于几个半音？', a: '2', d: ['1', '3', '4'], e: '全音 = 2 个半音。' },
  ]
  const p = rng.pick(items)
  return { topic: 'pitch', prompt: p.q, answer: p.a, options: opts(rng, p.a, p.d), explanation: p.e }
}

// ---------------------------------------------------------------------------

/** Major keys up to 4 accidentals: tonic MIDI near C4. */
const MAJOR_KEYS = [60, 67, 62, 69, 64, 65, 70, 63, 68]

function keyLabel(tonic: number, minor = false): string {
  return `${spelledName(spell(tonic, { keyTonic: minor ? tonic + 3 : tonic }))} ${minor ? '小调' : '大调'}`
}

function sigLabel(n: number): string {
  if (n === 0) return '没有升降号'
  return n > 0 ? `${n} 个升号` : `${-n} 个降号`
}

function majorItem(rng: Rng): TheoryItem {
  const tonic = rng.pick(MAJOR_KEYS)
  const sig = majorKeySignature(tonic % 12)
  const kind = rng.int(0, 2)
  if (kind === 0) {
    return {
      topic: 'major',
      prompt: `${keyLabel(tonic)}的调号是？`,
      answer: String(sig),
      options: opts(rng, String(sig), ['0', '1', '2', '3', '4', '-1', '-2', '-3', '-4'], (v) => sigLabel(Number(v))),
      explanation: `沿五度圈：C 大调没有升降号，每往上一个纯五度多一个升号（G D A E…），每往下一个纯五度多一个降号（F B♭ E♭ A♭…）。${keyLabel(tonic)}是${sigLabel(sig)}。`,
    }
  }
  if (kind === 1) {
    const degree = rng.int(2, 7)
    const notes = scaleNotes(tonic, 'major', false)
    const target = spelledName(spell(notes[degree - 1]!, { keyTonic: tonic }))
    const others = notes.map((n) => spelledName(spell(n, { keyTonic: tonic })))
    return {
      topic: 'major',
      prompt: `${keyLabel(tonic)}的第 ${degree} 级是什么音？`,
      answer: target,
      options: opts(rng, target, others, pretty),
      explanation: `大调音阶的结构是 全 全 半 全 全 全 半。${keyLabel(tonic)}：${others.map(pretty).join(' ')}，第 ${degree} 级是 ${pretty(target)}。`,
      staff: { clef: 'treble', notes: notes.map((n) => spell(n, { keyTonic: tonic })) },
    }
  }
  const answerKey = keyLabel(tonic)
  return {
    topic: 'major',
    prompt: `哪个大调有${sigLabel(sig)}？`,
    answer: answerKey,
    options: opts(rng, answerKey, MAJOR_KEYS.map((k) => keyLabel(k)), pretty),
    explanation: `${sigLabel(sig)}对应${answerKey}。记忆诀窍：升号调的主音是最后一个升号往上半音；降号调的主音是倒数第二个降号。`,
  }
}

// ---------------------------------------------------------------------------

const QUALITY_BY: Record<number, Record<number, string>> = {
  // letter steps → semitones → name
  0: { 0: '纯一度' },
  1: { 1: '小二度', 2: '大二度' },
  2: { 3: '小三度', 4: '大三度' },
  3: { 5: '纯四度', 6: '增四度' },
  4: { 6: '减五度', 7: '纯五度' },
  5: { 8: '小六度', 9: '大六度' },
  6: { 10: '小七度', 11: '大七度' },
  7: { 12: '纯八度' },
}

export function intervalNameFromSpelling(a: SpelledNote, b: SpelledNote): string | null {
  const steps = b.octave * 7 + LETTERS.indexOf(b.letter) - (a.octave * 7 + LETTERS.indexOf(a.letter))
  const semis = b.midi - a.midi
  return QUALITY_BY[steps]?.[semis] ?? null
}

function intervalItem(rng: Rng): TheoryItem {
  for (let attempt = 0; attempt < 20; attempt++) {
    const aLetter = rng.pick(LETTERS)
    const steps = rng.int(1, 7)
    const aIdx = LETTERS.indexOf(aLetter)
    const bLetter = LETTERS[(aIdx + steps) % 7]!
    const bOct = 4 + Math.floor((aIdx + steps) / 7)
    const accB: Accidental = rng.chance(0.25) ? rng.pick(['#', 'b'] as Accidental[]) : ''
    const a: SpelledNote = { letter: aLetter, accidental: '', octave: 4, midi: 60 + letterPitchClass(aLetter) }
    const bMidi = (bOct + 1) * 12 + letterPitchClass(bLetter) + (accB === '#' ? 1 : accB === 'b' ? -1 : 0)
    const b: SpelledNote = { letter: bLetter, accidental: accB, octave: bOct, midi: bMidi }
    const name = intervalNameFromSpelling(a, b)
    if (!name) continue
    const all = Object.values(QUALITY_BY).flatMap((x) => Object.values(x))
    return {
      topic: 'interval',
      prompt: `${spelledName(a)} 到上方的 ${spelledName(b)} 是什么音程？`,
      answer: name,
      options: opts(rng, name, all),
      explanation: `先数音名得到“度数”（${spelledName(a)} 到 ${b.letter} 共 ${steps + 1} 度），再数半音得到“性质”（${b.midi - a.midi} 个半音），所以是${name}。`,
      staff: { clef: 'treble', notes: [a, b] },
    }
  }
  return majorItem(rng)
}

// ---------------------------------------------------------------------------

function minorItem(rng: Rng): TheoryItem {
  const majorTonic = rng.pick(MAJOR_KEYS)
  const minorTonic = majorTonic - 3
  const kind = rng.int(0, 2)
  if (kind === 0) {
    const ans = keyLabel(majorTonic)
    return {
      topic: 'minor',
      prompt: `${keyLabel(minorTonic, true)}的关系大调是？`,
      answer: ans,
      options: opts(rng, ans, MAJOR_KEYS.map((k) => keyLabel(k)), pretty),
      explanation: `关系大小调共用同一个调号。小调主音往上小三度就是关系大调的主音。`,
    }
  }
  if (kind === 1) {
    const ans = keyLabel(minorTonic, true)
    return {
      topic: 'minor',
      prompt: `${keyLabel(majorTonic)}的关系小调是？`,
      answer: ans,
      options: opts(rng, ans, MAJOR_KEYS.map((k) => keyLabel(k - 3, true)), pretty),
      explanation: `大调主音往下小三度（也就是大调的第 6 级）就是关系小调的主音。`,
    }
  }
  const sig = majorKeySignature(majorTonic % 12)
  return {
    topic: 'minor',
    prompt: `${keyLabel(minorTonic, true)}的调号是？`,
    answer: String(sig),
    options: opts(rng, String(sig), ['0', '1', '2', '3', '4', '-1', '-2', '-3', '-4'], (v) => sigLabel(Number(v))),
    explanation: `${keyLabel(minorTonic, true)}与${keyLabel(majorTonic)}是关系调，调号相同：${sigLabel(sig)}。`,
  }
}

export function generateTheoryItem(topic: TheoryTopic, rng: Rng): TheoryItem {
  switch (topic) {
    case 'rhythm':
      return rhythmItem(rng)
    case 'pitch':
      return pitchItem(rng)
    case 'major':
      return majorItem(rng)
    case 'interval':
      return intervalItem(rng)
    case 'minor':
      return minorItem(rng)
  }
}
