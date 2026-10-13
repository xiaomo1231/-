/**
 * Built-in song library: public-domain melodies (traditional songs and
 * classical themes, all long out of copyright) and original practice pieces
 * written for this site. Copyrighted songs are not included; students can
 * import their own sheets instead.
 */
import type { Mode, RomanId } from '@/music/keys'
import { emptyScore, type ChordSlot, type Score } from '@/music/score'
import type { ChordTypeId } from '@/music/chords'
import { parseJianpu } from './jianpuParse'

export interface LibrarySong {
  id: string
  title: string
  origin: string
  tags: string[]
  /** MIDI of jianpu "1". */
  doMidi: number
  keyTonic: number
  mode: Mode
  bpm: number
  melody: string
  /** One entry per bar; "IV I" splits the bar in halves. */
  chords: string[]
  lyrics?: string
  /** Colour applied to every chord (e.g. dom7 for the blues). */
  quality?: ChordTypeId
  /** Suggested strumming pattern. */
  pattern: string
  note: string
}

export const LIBRARY: readonly LibrarySong[] = [
  {
    id: 'ode-to-joy',
    title: '欢乐颂',
    origin: '贝多芬《第九交响曲》主题（1824，公有领域）',
    tags: ['古典', '入门', '级进'],
    doMidi: 60,
    keyTonic: 60,
    mode: 'major',
    bpm: 100,
    melody:
      "3 3 4 5 | 5 4 3 2 | 1 1 2 3 | 3. 2/ 2 - | 3 3 4 5 | 5 4 3 2 | 1 1 2 3 | 2. 1/ 1 - | 2 2 3 1 | 2 3/ 4/ 3 1 | 2 3/ 4/ 3 2 | 1 2 5, - | 3 3 4 5 | 5 4 3 2 | 1 1 2 3 | 2. 1/ 1 -",
    chords: ['I', 'V', 'I', 'V', 'I', 'V', 'I', 'V I', 'V', 'V I', 'V I', 'I V', 'I', 'V', 'I', 'V I'],
    pattern: 'quarters',
    note: '几乎全是级进，最适合练第一把位的旋律。',
  },
  {
    id: 'twinkle',
    title: '小星星',
    origin: '法国民歌（18 世纪，公有领域）',
    tags: ['民歌', '入门'],
    doMidi: 60,
    keyTonic: 60,
    mode: 'major',
    bpm: 96,
    melody: '1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - | 5 5 4 4 | 3 3 2 - | 5 5 4 4 | 3 3 2 - | 1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 -',
    chords: ['I', 'IV I', 'IV I', 'V I', 'I IV', 'I V', 'I IV', 'I V', 'I', 'IV I', 'IV I', 'V I'],
    pattern: 'quarters',
    note: '三个和弦就能伴奏，适合练 C、F、G 之间的转换。',
  },
  {
    id: 'two-tigers',
    title: '两只老虎',
    origin: '法国民歌《雅克兄弟》（公有领域），中文为传统儿歌词',
    tags: ['民歌', '入门', '轮唱'],
    doMidi: 60,
    keyTonic: 60,
    mode: 'major',
    bpm: 108,
    melody: '1 2 3 1 | 1 2 3 1 | 3 4 5 - | 3 4 5 - | 5/ 6/ 5/ 4/ 3 1 | 5/ 6/ 5/ 4/ 3 1 | 1 5, 1 - | 1 5, 1 -',
    chords: ['I', 'I', 'I', 'I', 'I', 'I', 'I V', 'I'],
    lyrics: '两只老虎两只老虎跑得快跑得快一只没有眼睛一只没有尾巴真奇怪真奇怪',
    pattern: 'eighths',
    note: '整首只用一个和弦，正好专心练扫弦。也可以两个人轮唱。',
  },
  {
    id: 'mary-lamb',
    title: '玛丽有只小羊羔',
    origin: '美国童谣（1830，公有领域）',
    tags: ['童谣', '入门'],
    doMidi: 60,
    keyTonic: 60,
    mode: 'major',
    bpm: 100,
    melody: '3 2 1 2 | 3 3 3 - | 2 2 2 - | 3 5 5 - | 3 2 1 2 | 3 3 3 3 | 2 2 3 2 | 1 - - -',
    chords: ['I', 'I', 'V', 'I', 'I', 'I', 'V', 'I'],
    pattern: 'quarters',
    note: '只有五个音，最适合第一次找音。',
  },
  {
    id: 'london-bridge',
    title: '伦敦桥',
    origin: '英国童谣（公有领域）',
    tags: ['童谣', '入门'],
    doMidi: 60,
    keyTonic: 60,
    mode: 'major',
    bpm: 100,
    melody: '5. 6/ 5 4 | 3 4 5 - | 2 3 4 - | 3 4 5 - | 5. 6/ 5 4 | 3 4 5 - | 2 - 5 - | 3 1 - -',
    chords: ['I', 'I', 'V', 'I', 'I', 'I', 'V', 'I'],
    pattern: 'folk',
    note: '附点节奏的好例子：“长—短”。',
  },
  {
    id: 'saints',
    title: '圣者进行曲',
    origin: '美国传统灵歌（公有领域）',
    tags: ['爵士', '传统'],
    doMidi: 60,
    keyTonic: 60,
    mode: 'major',
    bpm: 112,
    melody: '0 1 3 4 | 5 - - - | 0 1 3 4 | 5 - - - | 0 1 3 4 | 5 - 3 - | 1 - 3 - | 2 - - - | 0 3 3 2 | 1 - 1 3 | 5 - 5 4 | 4 - - - | 0 3 4 5 | 3 - 1 - | 2 - 2 - | 1 - - -',
    chords: ['I', 'I', 'I', 'I', 'I', 'I', 'I', 'V', 'I', 'I', 'IV', 'IV', 'I', 'I', 'V', 'I'],
    pattern: 'pop',
    note: '每句从弱起开始：先休止一拍，再进入。',
  },
  {
    id: 'jingle-bells',
    title: '铃儿响叮当（副歌）',
    origin: 'J. Pierpont（1857，公有领域）',
    tags: ['节日', '传统'],
    doMidi: 60,
    keyTonic: 60,
    mode: 'major',
    bpm: 120,
    melody: "3 3 3 - | 3 3 3 - | 3 5 1. 2/ | 3 - - - | 4 4 4. 4/ | 4 3 3 3/ 3/ | 3 2 2 3 | 2 - 5 - | 3 3 3 - | 3 3 3 - | 3 5 1. 2/ | 3 - - - | 4 4 4 4 | 4 3 3 3/ 3/ | 5 5 4 2 | 1 - - -",
    chords: ['I', 'I', 'I', 'I', 'IV', 'I', 'II', 'V', 'I', 'I', 'I', 'I', 'IV', 'I', 'V', 'I'],
    pattern: 'eighths',
    note: '第 7 小节的 D 大三和弦是重属和弦（阶段 4 学过的副属）。',
  },
  {
    id: 'farewell',
    title: '送别（旋律）',
    origin: 'J. P. Ordway《梦见家和母亲》（1851，公有领域）',
    tags: ['抒情', '中文经典'],
    doMidi: 60,
    keyTonic: 60,
    mode: 'major',
    bpm: 72,
    melody:
      "5 3/ 5/ 1' - | 6 1'/ 6/ 5 - | 5 1/ 2/ 3 2/ 1/ | 2 - - - | 5 3/ 5/ 1'. 7/ | 6 1' 5 - | 5 2/ 3/ 4. 7,/ | 1 - - - | 6 1' 1' - | 7 6/ 7/ 1' - | 6/ 7/ 1'/ 6/ 6/ 5/ 3/ 1/ | 2 - - - | 5 3/ 5/ 1'. 7/ | 6 1' 5 - | 5 2/ 3/ 4. 7,/ | 1 - - -",
    chords: ['I', 'IV I', 'I', 'V', 'I', 'IV I', 'V', 'I', 'IV', 'V I', 'IV I', 'V', 'I', 'IV I', 'V', 'I'],
    pattern: 'folk',
    note: '慢速抒情，适合练分解和弦或民谣型扫弦。',
  },
  {
    id: 'yankee-doodle',
    title: '洋基歌',
    origin: '美国传统歌曲（公有领域）',
    tags: ['传统', '进行曲'],
    doMidi: 60,
    keyTonic: 60,
    mode: 'major',
    bpm: 120,
    melody: '1 1 2 3 | 1 3 2 5, | 1 1 2 3 | 1 - 7, - | 1 1 2 3 | 4 3 2 1 | 7, 5, 6, 7, | 1 - 1 -',
    chords: ['I', 'I V', 'I', 'V', 'I', 'IV', 'V', 'I'],
    pattern: 'rock8',
    note: '轻快的进行曲，可以用八分下扫配。',
  },
  {
    id: 'mountain-king',
    title: '山魔王的大厅（主题）',
    origin: '格里格《培尔·金特》（1875，公有领域）',
    tags: ['古典', '摇滚 riff', '小调'],
    doMidi: 48,
    keyTonic: 57,
    mode: 'minor',
    bpm: 100,
    melody: "6/ 7/ 1'/ 2'/ 3'/ 1'/ 3' | b3'/ 7/ b3' 2'/ b7/ 2' | 6/ 7/ 1'/ 2'/ 3'/ 1'/ 3'/ 6'/ | 5'/ 3'/ 1'/ 3'/ 5' - | 6/ 7/ 1'/ 2'/ 3'/ 1'/ 3' | b3'/ 7/ b3' 2'/ b7/ 2' | 6/ 7/ 1'/ 2'/ 3'/ 1'/ 3'/ 6'/ | 5'/ 3'/ 1'/ 3'/ 5' -",
    chords: ['i', 'V', 'i', 'III', 'i', 'V', 'i', 'III'],
    pattern: 'rock8',
    note: '古典名曲里最“摇滚”的一段。用失真音色、八分强力和弦，越弹越快。',
  },
  {
    id: 'canon',
    title: '卡农进行',
    origin: '帕赫贝尔《D 大调卡农》低音与和声（约 1700，公有领域）',
    tags: ['古典', '和弦进行'],
    doMidi: 62,
    keyTonic: 62,
    mode: 'major',
    bpm: 72,
    melody: "3' - - - | 2' - - - | 1' - - - | 7 - - - | 6 - - - | 5 - - - | 6 - - - | 7 - - -",
    chords: ['I', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'V'],
    pattern: 'folk',
    note: '无数流行歌借用过的和弦进行。旋律是一条慢慢下行的长音。',
  },
  {
    id: 'orig-blues',
    title: '原创 · A 调十二小节布鲁斯',
    origin: '律动工坊原创练习曲',
    tags: ['原创', '布鲁斯', '属七'],
    doMidi: 57,
    keyTonic: 57,
    mode: 'major',
    bpm: 92,
    melody: "1 b3/ 3/ 5 - | 6 5 b3 1 | 1 b3/ 3/ 5 - | 6 b7 6 5 | 4 6 1' - | b7 6 4 - | 1 b3/ 3/ 5 - | 6 5 b3 1 | 5 - b7 5 | 4 - 6 4 | 1 b3/ 3/ 5 3 | 2 - 5, -",
    chords: ['I', 'I', 'I', 'I', 'IV', 'IV', 'I', 'I', 'V', 'IV', 'I', 'V'],
    quality: 'dom7',
    pattern: 'pop',
    note: '最经典的十二小节布鲁斯，全部是属七和弦。旋律里的 ♭3、♭7 是“蓝调音”。',
  },
  {
    id: 'orig-punk',
    title: '原创 · E 调朋克冲刺',
    origin: '律动工坊原创练习曲',
    tags: ['原创', '朋克', '强力和弦'],
    doMidi: 52,
    keyTonic: 52,
    mode: 'major',
    bpm: 160,
    melody: "5 5 5 6 | 5 - 3 - | 4 4 4 5 | 3 - 1 - | 5 5 5 6 | 1' - 6 - | 5 5 4 3 | 1 - - -",
    chords: ['I', 'I', 'IV', 'I', 'I', 'IV', 'V', 'I'],
    pattern: 'rock8',
    note: '用强力和弦八分下扫，速度快就更要放松右手。',
  },
  {
    id: 'orig-ballad',
    title: '原创 · C 调流行抒情',
    origin: '律动工坊原创练习曲',
    tags: ['原创', '流行', '万能进行'],
    doMidi: 60,
    keyTonic: 60,
    mode: 'major',
    bpm: 80,
    melody: "3 5 5 - | 2 5 5 - | 1 3 6 5 | 4 - - - | 3 5 1' - | 7 5 2' - | 1' 6 4 6 | 5 - 1 -",
    chords: ['I', 'V', 'vi', 'IV', 'I', 'V', 'IV', 'V I'],
    pattern: 'pop',
    note: 'I–V–vi–IV 万能进行，用流行万能型扫弦。',
  },
  {
    id: 'orig-rock-minor',
    title: '原创 · A 小调摇滚抒情',
    origin: '律动工坊原创练习曲',
    tags: ['原创', '摇滚', '小调'],
    doMidi: 60,
    keyTonic: 57,
    mode: 'minor',
    bpm: 84,
    melody: "3 1 6, - | 4 6 1' - | 5 3 1 - | 2 - 5, - | 3 5 6 - | 1' 6 4 - | 5 3 2 1 | 6, - - -",
    chords: ['i', 'VI', 'III', 'VII', 'i', 'VI', 'III', 'i'],
    pattern: 'push',
    note: 'Am–F–C–G 的小调循环，主音线可以用 A 小调五声即兴。',
  },
  {
    id: 'orig-funk',
    title: '原创 · 放克律动',
    origin: '律动工坊原创练习曲',
    tags: ['原创', '放克', '十六分'],
    doMidi: 55,
    keyTonic: 55,
    mode: 'major',
    bpm: 92,
    melody: "6,/ 6,/ 1/ 2/ 3 2/ 1/ | 2 #4/ 6/ 2 - | 6,/ 6,/ 1/ 2/ 3 2/ 1/ | 2 #4/ 6/ 2 - | 6,/ 6,/ 1/ 2/ 3 2/ 1/ | 2 #4/ 6/ 2 - | 3/ 2/ 1/ 6,/ 1 6, | 2 - - -",
    chords: ['vi', 'II', 'vi', 'II', 'vi', 'II', 'vi', 'II'],
    pattern: 'sixteen',
    note: 'Em 和 A 两个和弦来回，用十六分放克扫弦和闷音。',
  },
]

/** Build the score of a library song. */
export function librarySongScore(song: LibrarySong): Score {
  const melody = parseJianpu(song.melody, song.doMidi, song.lyrics ?? '')
  const chords: ChordSlot[] = []
  song.chords.forEach((bar, i) => {
    const parts = bar.trim().split(/\s+/) as RomanId[]
    const len = 4 / parts.length
    parts.forEach((roman, k) => chords.push({ start: i * 4 + k * len, beats: len, roman, ...(song.quality ? { quality: song.quality } : {}) }))
  })
  return emptyScore({
    keyTonic: song.keyTonic,
    mode: song.mode,
    bpm: song.bpm,
    bars: song.chords.length,
    melody,
    chords,
    accompaniment: { comp: song.pattern === 'rock8' ? 'strum' : 'block', bass: 'roots', drums: song.pattern === 'rock8' ? 'rock' : 'pop' },
  })
}

export function librarySong(id: string): LibrarySong | undefined {
  return LIBRARY.find((s) => s.id === id)
}
