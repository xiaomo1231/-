import type { Lesson } from '../types'
import type { ChordSlot, Score, ScoreNote, Section } from '@/music/score'
import { emptyScore } from '@/music/score'
import type { RomanId } from '@/music/keys'
import { STYLES, applyStyle, setSection, withTracks, type StyleTemplate } from '@/music/arrangement'

const mel = (notes: Array<[number, number, number, string?]>): ScoreNote[] =>
  notes.map(([start, beats, midi, lyric]) => ({ start, beats, midi, ...(lyric ? { lyric } : {}) }))

/** One chord per bar. */
const bars = (romans: RomanId[]): ChordSlot[] => romans.map((roman, i) => ({ start: i * 4, beats: 4, roman }))

/** The song every stage-5 lesson arranges: 4 bars of verse, 4 bars of chorus. */
const MELODY = mel([
  [0, 1, 64], [1, 1, 67], [2, 2, 72],
  [4, 1, 71], [5, 1, 67], [6, 2, 62],
  [8, 1, 69], [9, 1, 72], [10, 2, 69],
  [12, 1, 65], [13, 1, 69], [14, 2, 72],
  [16, 1, 72], [17, 1, 67], [18, 2, 76],
  [20, 1, 74], [21, 1, 71], [22, 2, 74],
  [24, 1, 77], [25, 1, 72], [26, 2, 69],
  [28, 1, 67], [29, 1, 64], [30, 2, 72],
])
const CHORDS = bars(['I', 'V', 'vi', 'IV', 'I', 'V', 'IV', 'I'])
const VERSE_CHORUS: Section[] = [
  { start: 0, bars: 4, label: 'verse', energy: 1 },
  { start: 4, bars: 4, label: 'chorus', energy: 3 },
]
const FLAT: Section[] = [
  { start: 0, bars: 4, label: 'verse', energy: 2 },
  { start: 4, bars: 4, label: 'chorus', energy: 2 },
]

const style = (id: StyleTemplate['id']) => STYLES.find((s) => s.id === id)!

function example(id: StyleTemplate['id'], sections: Section[] = VERSE_CHORUS): Score {
  let s = withTracks(emptyScore({ bars: 8, melody: MELODY, chords: CHORDS }))
  s = applyStyle(s, style(id))
  for (const sec of sections) s = setSection(s, sec)
  return s
}

const POP = example('pop')
const ROCK = example('rock')
const PUNK = example('punk')
const RNB = example('rnb')
const BARE = { ...withTracks(emptyScore({ bars: 8, bpm: 100, melody: MELODY, chords: CHORDS, accompaniment: { comp: 'off', bass: 'off', drums: 'off' } })) }

/** Shared fields of the stage-5 arrangement tasks. */
const base = {
  kind: 'arrange' as const,
  bars: 8,
  bpm: 100,
  tonic: 60,
  mode: 'major' as const,
  givenMelody: MELODY,
  givenChords: CHORDS,
}

export const STAGE5_LESSONS: Lesson[] = [
  {
    id: 'L5-1',
    stage: 5,
    index: 1,
    title: '编曲是什么：每件乐器的角色',
    summary: '鼓管时间、贝斯管根基、和声乐器管颜色、旋律管故事。',
    minutes: 12,
    blocks: [
      {
        type: 'text',
        md: '**作曲**决定旋律与和弦，**编曲**决定“谁在什么时候弹什么”。同一首歌，编曲不同，听起来可以完全是两首歌。\n\n流行摇滚乐队的四个基本角色：\n- **鼓**：时间与律动。底鼓和军鼓是骨架，镲片是“流动感”\n- **贝斯**：低频与和声根基。它把鼓的节奏和和弦的根音连在一起\n- **和声乐器**（键盘、节奏吉他）：铺满和弦，决定歌的颜色\n- **主旋律**（人声或主音吉他）：讲故事的那个人\n\n> 好编曲的第一原则：**每件乐器都有自己的位置**，不抢别人的音区和节奏。',
      },
      { type: 'song', title: '只有旋律', score: BARE, caption: '没有伴奏，只有一条线。' },
      { type: 'song', title: '同一首歌，加上乐队', score: POP, caption: '流行风格：钢琴、分解吉他、贝斯和鼓。注意副歌比主歌更满。' },
      { type: 'drill', id: 'd1', title: '节奏听写', module: 'E9', level: 2, count: 4, pass: 0.5 },
    ],
    creation: {
      ...base,
      title: '组一支乐队',
      prompt: '现在所有伴奏都关着。到“编曲”页打开至少三件乐器（含鼓和贝斯），让这首歌有完整的乐队。可以试试不同的风格模板。',
      accompaniment: { comp: 'off', bass: 'off', drums: 'off' },
      exampleStyle: 'pop',
      check: { minVoices: 4, needsTracks: ['drums', 'bass'] },
    },
  },
  {
    id: 'L5-2',
    stage: 5,
    index: 2,
    title: '鼓：律动的骨架',
    summary: '底鼓、军鼓、踩镲各管一件事。',
    minutes: 14,
    blocks: [
      {
        type: 'text',
        md: '一套最简单的流行摇滚鼓只需要三件：\n- **底鼓**（Kick）：通常在 1、3 拍，推动身体\n- **军鼓**（Snare）：在 2、4 拍，也就是“后拍”，你会想在这里拍手\n- **踩镲**（Hi-hat）：八分音符一直走，是时间的“秒针”\n\n变化来自底鼓：在 3 拍前加一个“3 前的八分”（2 拍的后半拍），律动马上就活了。段落结尾的**过门**（fill）告诉听众“要换段了”，镲片（Crash）标出新段落的第一拍。',
      },
      { type: 'rhythm', title: '底鼓：1 · 2& · 3', onsets: [0, 1.5, 2], beats: 4, bpm: 96, caption: '流行最常见的底鼓型之一。' },
      { type: 'rhythm', title: '军鼓：2 · 4', onsets: [1, 3], beats: 4, bpm: 96 },
      { type: 'song', title: '摇滚鼓', score: ROCK, caption: '摇滚：底鼓更密，副歌开头有一记镲。' },
      { type: 'drill', id: 'd1', title: '节奏模仿', module: 'R2', level: 3, count: 4, pass: 0.5 },
    ],
    creation: {
      ...base,
      title: '写你自己的鼓',
      prompt: '在“编曲”页选中鼓轨，点“转为手动”，在鼓格子里改出你自己的律动：底鼓、军鼓、踩镲都要有。',
      exampleStyle: 'rock',
      check: { needsManual: 'drums', minVoices: 3 },
    },
  },
  {
    id: 'L5-3',
    stage: 5,
    index: 3,
    title: '贝斯与底鼓锁在一起',
    summary: '低频的秘诀：贝斯跟着底鼓走。',
    minutes: 12,
    blocks: [
      {
        type: 'text',
        md: '贝斯和底鼓都在低频。它们同时落下时，听起来是一个结实的“咚”；各走各的，低频就会糊成一团。\n\n所以职业编曲的第一件事往往是**让贝斯跟着底鼓**：\n- 底鼓在哪里，贝斯就在哪里落音\n- 每小节第一拍一定一起\n- 贝斯可以比底鼓多一些音，但重音要对齐\n\n摇滚里最直接的做法是贝斯弹**八分根音**，配上底鼓打 1、3 拍和中间的八分。',
      },
      { type: 'song', title: '锁定：摇滚贝斯 + 底鼓', score: ROCK, caption: '只听低频：贝斯和底鼓像一个乐器。' },
      { type: 'tip', md: '编曲检查里的“贝斯和底鼓”一项会告诉你有多少底鼓同时有贝斯。六成以上就算锁住了。' },
      { type: 'drill', id: 'd1', title: '听低音线', module: 'E7', level: 3, count: 5, pass: 0.6 },
    ],
    creation: {
      ...base,
      title: '锁住低频',
      prompt: '换贝斯和鼓的模式，或把贝斯转为手动，让贝斯和底鼓锁在一起。',
      accompaniment: { comp: 'block', bass: 'fifths', drums: 'halftime' },
      exampleStyle: 'rock',
      check: { bassKickLock: true, needsTracks: ['bass', 'drums'] },
    },
  },
  {
    id: 'L5-4',
    stage: 5,
    index: 4,
    title: '节奏吉他：扫弦与强力和弦',
    summary: '分解、扫弦、八分强力和弦、反拍切音。',
    minutes: 12,
    blocks: [
      {
        type: 'text',
        md: '节奏吉他有四种最常用的织体：\n- **分解**（arpeggio）：一个音一个音地弹，安静的主歌\n- **扫弦**（strum）：原声吉他的标准做法\n- **八分强力和弦**（power8）：失真音色、只弹根音和五音，摇滚和朋克的发动机\n- **反拍切音**（offbeat）：只在反拍上短促地弹，放克、雷鬼、R&B 常用\n\n> 强力和弦没有三音，所以失真后依然干净。这就是为什么摇滚吉他几乎只弹它。',
      },
      { type: 'song', title: '朋克：一路冲', score: PUNK, caption: '失真吉他八分强力和弦，速度 168。' },
      { type: 'chord', title: 'C5（强力和弦）', root: 48, quality: 'power', caption: '只有 C 和 G。' },
      { type: 'drill', id: 'd1', title: '强力 / 挂留和弦', module: 'E5', level: 2, count: 5, pass: 0.6 },
    ],
    creation: {
      ...base,
      title: '给歌加一把吉他',
      prompt: '打开吉他轨，选一种适合的织体和音色（干净或失真），而且不能超出吉他的音域。',
      exampleStyle: 'rock',
      check: { needsTracks: ['guitar'], noRangeWarnings: true, minVoices: 4 },
    },
  },
  {
    id: 'L5-5',
    stage: 5,
    index: 5,
    title: '属于你的 riff 和过门',
    summary: '把自动生成的声部改成自己的。',
    minutes: 15,
    blocks: [
      {
        type: 'text',
        md: '自动生成的声部是很好的起点，但让一首歌被记住的，往往是一段**手写的 riff** 或一个**过门**。\n\n做法：\n- 选中一轨，点“转为手动”，自动声部会变成可以编辑的音符\n- 在乐句结尾的空隙里加几个音，就是过门（fill）\n- 用小调五声或布鲁斯音阶写 riff，最不容易出错\n- 主旋律在唱的时候，伴奏要“让路”；旋律长音的时候，伴奏可以“说话”',
      },
      { type: 'scale', title: 'C 小调五声音阶', tonic: 60, scale: 'pentatonic_minor', caption: '摇滚 riff 的首选材料。' },
      { type: 'tip', md: '“问答”也适用于编曲：旋律唱一句，吉他接一句。主旋律的长音就是留给你的位置。' },
      { type: 'drill', id: 'd1', title: '旋律听写', module: 'E8', level: 2, count: 4, pass: 0.5 },
    ],
    creation: {
      ...base,
      title: '手写一轨',
      prompt: '把吉他、键盘或贝斯中的一轨转为手动，并改出你自己的 riff 或过门。',
      exampleStyle: 'pop',
      check: { needsManual: true, noRangeWarnings: true },
    },
  },
  {
    id: 'L5-6',
    stage: 5,
    index: 6,
    title: '键盘：铺底、分解与切音',
    summary: '同样的和弦，四种弹法，四种情绪。',
    minutes: 12,
    blocks: [
      {
        type: 'text',
        md: '键盘可以做四件事：\n- **柱式**（block）：每拍弹和弦，最稳\n- **分解**（arpeggio）：流动，适合抒情\n- **铺底**（pad）：长音铺满，像背景的“空气”，风琴或合成器常用\n- **切音**（stabs）：短促的和弦点，R&B 和放克的味道\n\n声位（voicing）也很重要：和弦放在 **C3 以上**，别和贝斯抢低频；也别和主旋律挤在一个音区。',
      },
      { type: 'song', title: '轻 R&B：电钢琴切音 + 行走贝斯', score: RNB, caption: '电钢琴短促的和弦点和 R&B 鼓的十六分音。' },
      { type: 'drill', id: 'd1', title: '七和弦听辨', module: 'E5', level: 4, count: 5, pass: 0.6 },
    ],
    creation: {
      ...base,
      title: '换一种键盘织体',
      prompt: '打开键盘轨，试试四种织体和三种音色（钢琴、电钢琴、风琴），选一个最适合这首歌的，并保持在常用音域里。',
      exampleStyle: 'rnb',
      check: { needsTracks: ['keys'], changedFrom: { kind: 'keys', pattern: 'block', timbre: 'piano' }, noRangeWarnings: true, minVoices: 4 },
    },
  },
  {
    id: 'L5-7',
    stage: 5,
    index: 7,
    title: '音域与频段：别打架',
    summary: '低频给贝斯，中频给和声，高频给旋律和镲。',
    minutes: 12,
    blocks: [
      {
        type: 'text',
        md: '把声音想象成一栋楼：\n- **地下室（C1–C3）**：贝斯、底鼓\n- **一楼到二楼（C3–C5）**：吉他、键盘、人声的主体\n- **楼顶（C5 以上）**：镲片、旋律的高点、键盘的点缀\n\n两件乐器挤在同一层，就会互相遮住。常见问题：\n- 键盘左手弹得太低，和贝斯一起“发闷”\n- 吉他和人声在同一个音区，旋律听不清\n- 贝斯写得太高，失去了低频的支撑\n\n编曲检查会提示“超出常用音域”“低于 C3”和“挤在同一个音区”。',
      },
      { type: 'tip', md: '解决“打架”最简单的三个办法：移八度、换更稀疏的织体、让其中一件乐器在这一段休息。' },
      { type: 'drill', id: 'd1', title: '音程听辨（八度）', module: 'E2', level: 4, count: 5, pass: 0.6 },
    ],
    creation: {
      ...base,
      title: '一栋整齐的楼',
      prompt: '现在的贝斯被写到了高八度，跑出了贝斯的音域，还和旋律挤在一起。把它改回低音区（或恢复自动），并让编曲检查里没有任何“需要注意”。',
      trackPatch: {
        bass: {
          source: 'manual',
          notes: [72, 67, 69, 65, 72, 67, 65, 72].map((midi, i) => ({ start: i * 4, beats: 4, midi })),
        },
      },
      exampleStyle: 'pop',
      check: { minVoices: 4, noRangeWarnings: true, maxArrangeWarnings: 0 },
    },
  },
  {
    id: 'L5-8',
    stage: 5,
    index: 8,
    title: '段落与能量曲线',
    summary: '主歌收、副歌放：用能量画出一首歌的形状。',
    minutes: 14,
    blocks: [
      {
        type: 'text',
        md: '一首歌的能量不是一条直线。最常见的形状是：\n- **前奏**：中等，告诉听众歌的风格\n- **主歌**：收着，留出空间给歌词\n- **预副歌**：逐渐升高\n- **副歌**：最满、最响\n- **尾奏**：慢慢退下\n\n在编曲页给每个段落设定能量（1 稀疏 · 2 正常 · 3 饱满），自动声部会跟着变密或变疏：主歌的鼓可能只有底鼓和踩镲，副歌的吉他从分解变成扫弦。',
      },
      { type: 'song', title: '主歌能量 1 → 副歌能量 3', score: POP },
      { type: 'tip', md: '对比来自两边：与其一味把副歌加满，不如先把主歌**减**下来。' },
      { type: 'drill', id: 'd1', title: '节奏听写', module: 'E9', level: 3, count: 4, pass: 0.5 },
    ],
    creation: {
      ...base,
      title: '画出能量曲线',
      prompt: '在“编曲”页把前 4 小节设为主歌、后 4 小节设为副歌，并让能量从主歌到副歌升高、副歌明显比主歌饱满。',
      exampleSections: VERSE_CHORUS,
      check: { needsSections: ['verse', 'chorus'], chorusFuller: true, energyRises: true },
    },
  },
  {
    id: 'L5-9',
    stage: 5,
    index: 9,
    title: '乐器的进与出',
    summary: '让某件乐器在主歌休息，副歌再进来。',
    minutes: 12,
    blocks: [
      {
        type: 'text',
        md: '最有效的编曲手法之一是**让乐器休息**：\n- 主歌只有钢琴和人声，副歌鼓和贝斯才进来，那一下“砸进来”的感觉无可替代\n- 桥段突然只剩吉他，听众会竖起耳朵\n- 结尾一件件退出，比一起停更有余味\n\n在编曲页的段落设置里，勾选“休息的乐器”，这件乐器就会在这一段静音。',
      },
      { type: 'tip', md: '第一次进来的乐器，最好在段落的第一拍进来，再配一记镲：听众会清楚地感到“新段落开始了”。' },
      { type: 'drill', id: 'd1', title: '和声进行', module: 'E6', level: 3, count: 4, pass: 0.5 },
    ],
    creation: {
      ...base,
      title: '让鼓晚一点进来',
      prompt: '设置主歌和副歌两个段落，在主歌里让至少一件乐器休息，副歌再进来。',
      givenSections: FLAT,
      exampleSections: [
        { start: 0, bars: 4, label: 'verse', energy: 1, off: ['drums', 'guitar'] },
        { start: 4, bars: 4, label: 'chorus', energy: 3 },
      ],
      check: { needsSections: ['verse', 'chorus'], needsDropout: true, chorusFuller: true },
    },
  },
  {
    id: 'L5-10',
    stage: 5,
    index: 10,
    title: '风格分析：流行、摇滚、朋克、R&B',
    summary: '同一首歌，换四种风格，听出差别在哪里。',
    minutes: 15,
    blocks: [
      {
        type: 'text',
        md: '风格是一组**编曲选择**的组合：\n\n- **流行**：约 100 BPM；底鼓 1、3 拍加变化；贝斯弹根音；钢琴加分解吉他\n- **摇滚**：约 120 BPM；底鼓更密；八分根音贝斯；失真强力和弦\n- **朋克**：160 BPM 以上；八分底鼓；八分根音贝斯；失真强力和弦一路冲\n- **轻 R&B**：约 84 BPM；十六分踩镲、松弛；行走或切分贝斯；电钢琴七和弦\n\n下面四个例子是**同一首歌**，只换了风格模板。',
      },
      { type: 'song', title: '流行', score: POP },
      { type: 'song', title: '摇滚', score: ROCK },
      { type: 'song', title: '朋克', score: PUNK },
      { type: 'song', title: '轻 R&B', score: RNB },
      { type: 'drill', id: 'd1', title: '节奏听写', module: 'E9', level: 4, count: 4, pass: 0.5 },
    ],
    creation: {
      ...base,
      title: '选一种风格，再改成你的',
      prompt: '套用一个风格模板，然后至少改一处（换织体、换音色或手写一轨），让副歌比主歌饱满，并且没有“需要注意”。',
      givenSections: FLAT,
      exampleStyle: 'rock',
      exampleSections: VERSE_CHORUS,
      check: { minVoices: 4, chorusFuller: true, maxArrangeWarnings: 0 },
    },
  },
  {
    id: 'L5-11',
    stage: 5,
    index: 11,
    title: '混音概念：音量与声像',
    summary: '把乐器摆在左右两边，给人声和贝斯留出中间。',
    minutes: 12,
    blocks: [
      {
        type: 'text',
        md: '混音是把所有声部调成一个整体。最基础的两个旋钮：\n- **音量**：主旋律最清楚，鼓和贝斯是地基，和声乐器在它们之间\n- **声像**（pan）：左右摆位。**人声、贝斯、底鼓、军鼓放中间**；吉他和键盘一左一右，整个声音就宽了\n\n其他混音概念（以后在专业软件里会遇到）：\n- **均衡**（EQ）：削掉每件乐器不需要的频段，比如吉他的低频\n- **压缩**：让音量更平均\n- **混响**：给声音一个“房间”\n\n> 用耳机听一下：声像拉开后，每件乐器都更清楚了。',
      },
      { type: 'tip', md: '在编曲页每一轨都有音量和声像滑块。试着先把所有伴奏音量调低，只把主旋律调到最清楚，再一件件加回来。' },
      { type: 'drill', id: 'd1', title: '音高比较', module: 'E1', level: 4, count: 4, pass: 0.5 },
    ],
    creation: {
      ...base,
      title: '把声音摆开',
      prompt: '在“编曲”页把吉他和键盘分别往左右两边摆（声像各至少 40%），两件乐器都要在演奏。',
      accompaniment: { comp: 'strum', bass: 'roots', drums: 'pop' },
      check: { needsTracks: ['guitar', 'keys'], needsWidePan: true },
    },
  },
  {
    id: 'L5-12',
    stage: 5,
    index: 12,
    title: '阶段创作：完整编曲并导出',
    summary: '四轨以上、主歌副歌、鼓贝斯锁定、一轨手写。',
    minutes: 25,
    blocks: [
      {
        type: 'text',
        md: '最后一课，把整个阶段用起来，完成一首可以导出的编曲：\n- 至少 **4 件伴奏乐器 + 主旋律**\n- **主歌和副歌**两个段落，副歌更饱满\n- **贝斯和底鼓锁定**\n- 至少**一轨手写**的声部\n- 所有乐器都在常用音域里\n\n保存后，在作品集里打开它，进入作曲台的“导出”页，可以导出 **MIDI**（拖进任何编曲软件）、**MusicXML**（用 MuseScore 打开看谱）和 **WAV**（直接发给朋友听）。\n\n> 从这里开始，你已经可以独立写一首歌、编一首歌。之后就是写更多。',
      },
      { type: 'song', title: '参考：流行编曲', score: POP },
      { type: 'drill', id: 'd1', title: '综合：和声进行', module: 'E6', level: 5, count: 5, pass: 0.6 },
    ],
    creation: {
      ...base,
      title: '阶段 5 作品：完整编曲',
      prompt: '至少 4 件伴奏乐器加主旋律，设置主歌和副歌，副歌更饱满，贝斯和底鼓锁定，至少一轨手写，所有声部在常用音域里。',
      accompaniment: { comp: 'strum', bass: 'roots', drums: 'pop' },
      exampleStyle: 'pop',
      exampleSections: VERSE_CHORUS,
      check: {
        minVoices: 5,
        needsSections: ['verse', 'chorus'],
        chorusFuller: true,
        bassKickLock: true,
        needsManual: true,
        noRangeWarnings: true,
      },
    },
  },
]
