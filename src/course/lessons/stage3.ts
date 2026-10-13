import type { Lesson } from '../types'
import type { ChordSlot, ScoreNote } from '@/music/score'
import { emptyScore } from '@/music/score'
import type { RomanId } from '@/music/keys'

const mel = (notes: Array<[number, number, number, string?]>): ScoreNote[] =>
  notes.map(([start, beats, midi, lyric]) => ({ start, beats, midi, ...(lyric ? { lyric } : {}) }))

/** One chord per bar. */
const bars = (romans: RomanId[]): ChordSlot[] => romans.map((roman, i) => ({ start: i * 4, beats: 4, roman }))

const MOTIF_SONG = emptyScore({
  bars: 4,
  melody: mel([
    [0, 0.5, 64], [0.5, 0.5, 64], [1, 1, 67], [2, 2, 64],
    [4, 0.5, 62], [4.5, 0.5, 62], [5, 1, 67], [6, 2, 62],
    [8, 0.5, 64], [8.5, 0.5, 64], [9, 1, 69], [10, 2, 72],
    [12, 1, 69], [13, 1, 67], [14, 2, 65],
  ]),
  chords: bars(['I', 'V', 'vi', 'IV']),
  accompaniment: { comp: 'block', bass: 'roots', drums: 'pop' },
})

const HOOK_SONG = emptyScore({
  bars: 4,
  melody: mel([
    [0, 0.5, 64], [0.5, 0.5, 64], [1, 1, 60], [2, 2, 64],
    [4, 1, 67], [5, 1, 71], [6, 2, 67],
    [8, 0.5, 64], [8.5, 0.5, 64], [9, 1, 60], [10, 2, 64],
    [12, 1, 65], [13, 1, 69], [14, 2, 72],
  ]),
  chords: bars(['I', 'V', 'vi', 'IV']),
  accompaniment: { comp: 'block', bass: 'roots', drums: 'pop' },
})

const SEQUENCE_SONG = emptyScore({
  bars: 4,
  melody: mel([
    [0, 1, 60], [1, 1, 62], [2, 2, 64],
    [4, 1, 62], [5, 1, 64], [6, 2, 65],
    [8, 1, 64], [9, 1, 65], [10, 2, 67],
    [12, 1, 67], [13, 1, 62], [14, 2, 60],
  ]),
  chords: [...bars(['I', 'ii', 'iii']), { start: 12, beats: 2, roman: 'V' }, { start: 14, beats: 2, roman: 'I' }],
  accompaniment: { comp: 'arpeggio', bass: 'roots', drums: 'off' },
})

const QA_SONG = emptyScore({
  bars: 4,
  melody: mel([
    [0, 1, 64], [1, 1, 65], [2, 1, 67], [3, 1, 64],
    [4, 2, 62], [6, 2, 67],
    [8, 1, 64], [9, 1, 65], [10, 1, 67], [11, 1, 64],
    [12, 1, 62], [13, 1, 59], [14, 2, 60],
  ]),
  chords: [
    { start: 0, beats: 4, roman: 'I' },
    { start: 4, beats: 4, roman: 'V' },
    { start: 8, beats: 4, roman: 'I' },
    { start: 12, beats: 2, roman: 'V' },
    { start: 14, beats: 2, roman: 'I' },
  ],
  accompaniment: { comp: 'block', bass: 'roots', drums: 'off' },
})

const NCT_SONG = emptyScore({
  bars: 2,
  melody: mel([
    [0, 1, 64], [1, 1, 65], [2, 1, 67], [3, 1, 69], [4, 1, 67], [5, 1, 69], [6, 2, 67],
  ]),
  chords: bars(['I', 'I']),
  accompaniment: { comp: 'block', bass: 'roots', drums: 'off' },
})

const LYRIC_SONG = emptyScore({
  bars: 4,
  melody: mel([
    [0, 1, 67, '夜'], [1, 1, 69, '风'], [2, 2, 67, '吹'],
    [4, 1, 65, '过'], [5, 1, 69, '了'], [6, 2, 72, '街'],
    [8, 1, 64, '路'], [9, 1, 67, '灯'], [10, 2, 72, '亮'],
    [12, 1, 71, '起'], [13, 1, 67, '来'], [14, 2, 72, '了'],
  ]),
  chords: [...bars(['I', 'IV', 'I']), { start: 12, beats: 2, roman: 'V' }, { start: 14, beats: 2, roman: 'I' }],
  accompaniment: { comp: 'strum', bass: 'roots', drums: 'pop' },
})

/** Stage 3 · 旋律与歌曲结构 */
export const STAGE3_LESSONS: Lesson[] = [
  {
    id: 'L3-1',
    stage: 3,
    index: 1,
    title: '动机与 riff',
    summary: '一首歌往往从两三个音的小想法长出来。',
    minutes: 11,
    blocks: [
      {
        type: 'text',
        md: '**动机**是旋律里最小的、可以被认出来的单位，通常只有 2–5 个音，带着一个独特的节奏。整首歌都在重复、变化、发展它。\n\n摇滚里的 **riff** 也是同一回事：一段反复出现的短乐句，常常由吉他或贝斯演奏，听两遍就记住了。\n\n写动机的诀窍：**节奏比音高更重要**。先想好一个有特点的节奏型，再给它配音。',
      },
      { type: 'song', title: '一个动机，发展成 4 小节', score: MOTIF_SONG, caption: '第 1、2、3 小节开头都是“短短长”的节奏，第 4 小节收尾。' },
      { type: 'drill', id: 'd1', title: '听写含跳进的乐句', module: 'E8', level: 3, count: 4, pass: 0.6 },
    ],
    creation: {
      kind: 'song',
      title: '你的动机',
      prompt: '和弦已经给好（I V vi IV）。写一个 1 小节的动机，并让它的节奏在后面至少再出现一次。',
      bars: 4,
      bpm: 100,
      tonic: 60,
      mode: 'major',
      givenChords: bars(['I', 'V', 'vi', 'IV']),
      check: { motifRepeat: true, minNotes: 10, maxWarnings: 1 },
    },
  },
  {
    id: 'L3-2',
    stage: 3,
    index: 2,
    title: '重复、变化与对比',
    summary: '重复让人记住，变化让人不腻，对比让人兴奋。',
    minutes: 11,
    blocks: [
      {
        type: 'text',
        md: '发展一个动机的常用手法：\n- **原样重复**：最直接，hook 常用\n- **模进**：整体移高或移低一级再说一遍\n- **节奏不变，音高变**：保持“认得出来”，又有新鲜感\n- **对比**：换一个完全不同的节奏或音区，为下一段做准备\n\n好旋律通常是“重复 + 一点点变化”，太多重复会单调，太多变化会让人抓不住。',
      },
      { type: 'song', title: '模进：同一个形状，每次升高一级', score: SEQUENCE_SONG },
      { type: 'drill', id: 'd1', title: '听写 2 小节', module: 'E8', level: 4, count: 3, pass: 0.5 },
    ],
    creation: {
      kind: 'song',
      title: '模进练习',
      prompt: '和弦是 I IV V I。写一个动机，在后面用重复或模进再说一次，最后回到主音。',
      bars: 4,
      bpm: 96,
      tonic: 60,
      mode: 'major',
      givenChords: bars(['I', 'IV', 'V', 'I']),
      check: { motifRepeat: true, endDegree: 0, minNotes: 10, maxWarnings: 1 },
    },
  },
  {
    id: 'L3-3',
    stage: 3,
    index: 3,
    title: '乐句与呼吸',
    summary: '问句停在半路，答句回到家；中间留给歌手换气。',
    minutes: 12,
    blocks: [
      {
        type: 'text',
        md: '旋律像说话，要分**乐句**。流行歌最常见的是 2 小节或 4 小节一句。\n\n两句配成一对时：\n- **问句**结尾不回主音（常落在 2、5、7 级，和弦停在 V），像在提问\n- **答句**结尾回到主音和 I，像在回答\n\n乐句之间要**留空**。写给人唱的旋律，每一两小节就该有一个换气的地方。',
      },
      { type: 'song', title: '问句（停在 V）+ 答句（回到 I）', score: QA_SONG },
      { type: 'drill', id: 'd1', title: '和声进行', module: 'E6', level: 2, count: 4, pass: 0.5 },
    ],
    creation: {
      kind: 'song',
      title: '一问一答',
      prompt: '8 小节，和弦已给。前 4 小节是问句，第 4 小节结尾不要落在主音；后 4 小节是答句，回到主音。中间至少留一个一拍以上的休止换气。',
      bars: 8,
      bpm: 92,
      tonic: 60,
      mode: 'major',
      givenChords: bars(['I', 'V', 'vi', 'V', 'I', 'IV', 'V', 'I']),
      check: { questionAnswer: { bar: 3 }, needsRest: true, endDegree: 0, minNotes: 14, maxWarnings: 1 },
    },
  },
  {
    id: 'L3-4',
    stage: 3,
    index: 4,
    title: '和弦音与非和弦音',
    summary: '经过音、辅助音、倚音：让旋律流动起来的“不和谐”。',
    minutes: 12,
    blocks: [
      {
        type: 'text',
        md: '旋律里不属于当前和弦的音叫**非和弦音**。用得好，旋律就会流动；用得不好，就会“打架”。常见的几种：\n- **经过音**：在两个和弦音之间级进经过（E–**F**–G）\n- **辅助音**：从和弦音离开一步再回来（G–**A**–G）\n- **倚音**：跳进到非和弦音，再级进解决，常在强拍上，很有表情\n\n规则检查会标出每个非和弦音的类型；“未解决的非和弦音”就是需要注意的地方。',
      },
      { type: 'song', title: 'F 是经过音，A 是辅助音（和弦都是 C）', score: NCT_SONG },
      { type: 'drill', id: 'd1', title: '含变化音的级数', module: 'E3', level: 5, count: 6, pass: 0.5 },
    ],
    creation: {
      kind: 'song',
      title: '流动的旋律',
      prompt: '和弦是 I V vi IV。写 4 小节旋律，至少用一个经过音和一个辅助音，并且不要有未解决的非和弦音。',
      bars: 4,
      bpm: 96,
      tonic: 60,
      mode: 'major',
      givenChords: bars(['I', 'V', 'vi', 'IV']),
      check: { needsNct: ['passing', 'neighbor'], maxWarnings: 0, minNotes: 10 },
    },
  },
  {
    id: 'L3-5',
    stage: 3,
    index: 5,
    title: '旋律轮廓与高点',
    summary: '先上后下的“拱形”，最高音只出现一次。',
    minutes: 11,
    blocks: [
      {
        type: 'text',
        md: '把旋律的音高连成线，就是它的**轮廓**。最常见、最好听的是**拱形**：从中低音区出发，逐渐上升到一个**最高点**，再回落到主音。\n\n高点的位置通常在乐段的后半（大约 2/3 处），而且**只出现一次**，这样它才“特别”。大跳之后反方向级进一步，旋律会更平衡。',
      },
      { type: 'drill', id: 'd1', title: '视唱', module: 'S6', level: 1, count: 2, pass: 0.5 },
    ],
    creation: {
      kind: 'song',
      title: '拱形旋律',
      prompt: '8 小节，和弦已给。写一段拱形旋律：最高音只出现一次，最后回到主音。',
      bars: 8,
      bpm: 92,
      tonic: 60,
      mode: 'major',
      givenChords: bars(['I', 'vi', 'IV', 'V', 'I', 'vi', 'V', 'I']),
      check: { climaxOnce: true, endDegree: 0, minNotes: 16, maxWarnings: 1 },
    },
  },
  {
    id: 'L3-6',
    stage: 3,
    index: 6,
    title: '歌曲结构',
    summary: '前奏、主歌、预副歌、副歌、桥段、尾奏各自的任务。',
    minutes: 12,
    blocks: [
      {
        type: 'text',
        md: '一首流行歌通常由这些段落组成：\n- **前奏**：交代调性和情绪，常用副歌的和弦或 riff\n- **主歌**（Verse）：讲故事，音区偏低，旋律更像说话\n- **预副歌**（Pre-chorus）：铺垫，制造上升的期待\n- **副歌**（Chorus）：全曲最上口的部分，音区高、重复多、歌名常在这里\n- **桥段**（Bridge）：换一种和声或节奏，给耳朵新鲜感\n- **尾奏**：收尾\n\n最常见的排列：前奏 – 主歌 – 预副歌 – 副歌 – 主歌 – 预副歌 – 副歌 – 桥段 – 副歌 – 尾奏。',
      },
      { type: 'progression', title: '主歌：vi – IV – I – V', tonic: 60, mode: 'major', romans: ['vi', 'IV', 'I', 'V'] },
      { type: 'progression', title: '副歌：I – V – vi – IV', tonic: 60, mode: 'major', romans: ['I', 'V', 'vi', 'IV'], caption: '同样四个和弦，从 I 开始更明亮，适合副歌。' },
      { type: 'drill', id: 'd1', title: '听出流行进行', module: 'E6', level: 3, count: 6, pass: 0.55 },
    ],
    creation: {
      kind: 'song',
      title: '一段副歌',
      prompt: '和弦是 I V vi IV 两遍。写一段 8 小节副歌：开头的节奏型要重复出现，最后落在主音。',
      bars: 8,
      bpm: 100,
      tonic: 60,
      mode: 'major',
      givenChords: bars(['I', 'V', 'vi', 'IV', 'I', 'V', 'vi', 'IV']),
      check: { motifRepeat: true, minNotes: 16, endDegree: 0, maxWarnings: 1 },
    },
  },
  {
    id: 'L3-7',
    stage: 3,
    index: 7,
    title: 'Hook 设计',
    summary: '让人听一遍就忘不掉的那一句。',
    minutes: 11,
    blocks: [
      {
        type: 'text',
        md: '**Hook** 是歌里最抓耳的片段，通常就是副歌的第一句。好 hook 的共同点：\n- **短**：1–2 小节\n- **重复**：在副歌里至少出现两次，一字不差\n- **节奏鲜明**：常有切分或特别的长短对比\n- **落在好唱的音区**：不要太高，也不要大跳太多\n\n同一句 hook 放在不同和弦上，会产生微妙的变化。这时要选两个和弦都包含的音。',
      },
      { type: 'song', title: '一个 hook 的例子（第 1、3 小节相同）', score: HOOK_SONG, caption: '同一句放在 C 和 Am 上，因为 C、E 两个音两个和弦都有。' },
      { type: 'drill', id: 'd1', title: '节奏听写', module: 'E9', level: 2, count: 4, pass: 0.6 },
    ],
    creation: {
      kind: 'song',
      title: '你的 hook',
      prompt: '和弦是 I V vi IV。写 4 小节，第 1 小节和第 3 小节要完全相同（提示：I 和 vi 都包含 C 和 E）。',
      bars: 4,
      bpm: 100,
      tonic: 60,
      mode: 'major',
      givenChords: bars(['I', 'V', 'vi', 'IV']),
      check: { repeatBars: [0, 2], minNotes: 8, maxWarnings: 1 },
    },
  },
  {
    id: 'L3-8',
    stage: 3,
    index: 8,
    title: '段落对比',
    summary: '主歌和副歌靠音区、密度和节奏拉开距离。',
    minutes: 11,
    blocks: [
      {
        type: 'text',
        md: '副歌要“炸”，主歌就要先“收”。拉开对比的几个方向：\n- **音区**：主歌低、副歌高（最有效）\n- **密度**：主歌音多、像说话；副歌音少、拉长音\n- **节奏**：主歌多切分；副歌落在强拍上\n- **和声**：主歌从 vi 开始，副歌从 I 开始\n\n编曲上也一样：主歌伴奏少，副歌鼓和吉他全进来。',
      },
      { type: 'drill', id: 'd1', title: '低音线', module: 'E7', level: 2, count: 4, pass: 0.6 },
    ],
    creation: {
      kind: 'song',
      title: '主歌与副歌',
      prompt: '前 4 小节是主歌（vi IV I V），后 4 小节是副歌（I V vi IV）。让副歌的平均音高比主歌高至少 3 个半音。',
      bars: 8,
      bpm: 100,
      tonic: 60,
      mode: 'major',
      givenChords: bars(['vi', 'IV', 'I', 'V', 'I', 'V', 'vi', 'IV']),
      check: { secondHalfHigher: 3, minNotes: 16, maxWarnings: 2 },
    },
  },
  {
    id: 'L3-9',
    stage: 3,
    index: 9,
    title: '歌词与旋律节奏',
    summary: '一字一音、顺着字调走、句尾落在长音上。',
    minutes: 13,
    blocks: [
      {
        type: 'text',
        md: '中文歌词和旋律配合的几条经验：\n- **一字一音**最清楚；需要拖腔时，一个字可以跨两三个音\n- **顺着字调**：普通话一声高平、二声上扬、三声低、四声下降。旋律走向尽量和字调一致，否则容易“倒字”（听成别的字）\n- **重要的字放在强拍或长音上**，虚词（的、了、着）放在弱拍\n- **句尾落在长音**，给歌手收尾和换气\n- 每句字数相近，听起来更整齐',
      },
      { type: 'song', title: '例子：句尾都在长音上', score: LYRIC_SONG, caption: '“吹”“街”“亮”“了”都落在二分音符上；“了”“来”这些虚词放在弱拍。' },
      { type: 'drill', id: 'd1', title: '节奏听写', module: 'E9', level: 3, count: 4, pass: 0.5 },
    ],
    creation: {
      kind: 'song',
      title: '写一句歌词',
      prompt: '和弦是 I IV V I。写 4 小节旋律并填上歌词（每个音一个字），最后一个音至少两拍并回到主音。',
      bars: 4,
      bpm: 88,
      tonic: 60,
      mode: 'major',
      givenChords: bars(['I', 'IV', 'V', 'I']),
      lyrics: true,
      check: { needsLyrics: true, lastNoteBeats: 2, endDegree: 0, minNotes: 8, maxWarnings: 1 },
    },
  },
  {
    id: 'L3-10',
    stage: 3,
    index: 10,
    title: '阶段创作：完整的主歌 + 副歌',
    summary: '16 小节：8 小节主歌、8 小节副歌，和声、旋律、对比、动机一起用上。',
    minutes: 20,
    blocks: [
      {
        type: 'text',
        md: '这一阶段的作品，把学过的都用上：\n- **前 8 小节主歌**，音区偏低\n- **后 8 小节副歌**，音区更高，有一个反复出现的节奏动机\n- 每小节都有和弦，最后回到主音和 I\n- 可以填歌词（推荐，但不强制）\n\n写完后在作曲台里继续改，加长、加伴奏都可以。',
      },
      { type: 'drill', id: 'd1', title: '和声进行复习', module: 'E6', level: 3, count: 4, pass: 0.5 },
    ],
    creation: {
      kind: 'song',
      title: '阶段 3 作品：主歌 + 副歌',
      prompt: '写 16 小节：前 8 小节主歌、后 8 小节副歌。每小节都有和弦，副歌音区更高，第 1 小节的节奏型要再出现，最后回到主音和 I。',
      bars: 16,
      bpm: 100,
      tonic: 60,
      mode: 'major',
      lyrics: true,
      check: { everyBarChord: true, minNotes: 32, secondHalfHigher: 2, endsOnTonicChord: true, endDegree: 0, maxWarnings: 2, motifRepeat: true },
    },
  },
]
