import type { RomanId } from '@/music/keys'
import type { StrumSegment } from './strum'
import type { PlaySource } from './scales'

/**
 * Guitar workshop curriculum. Two lines, eight units each; G1 ships rhythm
 * units 1–4, the rest are listed with the phase that will release them.
 */

export type GuitarLine = 'rhythm' | 'lead'

export type GuitarExercise =
  | { id: string; kind: 'chord-check'; title: string; chords: string[]; tip: string }
  | { id: string; kind: 'change'; title: string; chords: [string, string]; seconds: number; target: number; tip: string }
  | {
      id: string
      kind: 'strum'
      title: string
      pattern: string
      /** Key tonic (MIDI) and one chord per bar, repeated to fill `bars`. */
      tonic: number
      romans: RomanId[]
      bars: number
      bpm: number
      /** Score (0–1) needed to pass. */
      pass: number
      tip: string
      /** Suggested monitor preset. */
      preset?: string
      /** Show chords with this suffix instead (e.g. '5' for power chords). */
      chordSuffix?: string
    }
  | { id: string; kind: 'song'; title: string; tonic: number; bpm: number; segments: StrumSegment[]; pass: number; tip: string; preset?: string }
  | { id: string; kind: 'note-name'; title: string; count: number; strings?: number[]; tip: string }
  | { id: string; kind: 'note-find'; title: string; count: number; strings?: number[]; tip: string }
  | { id: string; kind: 'play'; title: string; source: PlaySource; bpm: number; tip: string; preset?: string; legato?: boolean }
  | { id: string; kind: 'target'; title: string; tonic: number; mode: 'major' | 'minor'; romans: RomanId[]; bars: number; bpm: number; pass: number; tip: string; preset?: string }
  | { id: string; kind: 'improv'; title: string; tonic: number; mode: 'major' | 'minor'; romans: RomanId[]; bars: number; bpm: number; tip: string; preset?: string }
  | { id: string; kind: 'bend'; title: string; string: number; fret: number; semitones: 1 | 2; tip: string; preset?: string }
  | { id: string; kind: 'vibrato'; title: string; string: number; fret: number; tip: string; preset?: string }

export interface GuitarUnit {
  id: string
  line: GuitarLine
  index: number
  title: string
  summary: string
  /** Markdown subset (paragraphs, **bold**, "- " bullets, "> " callouts). */
  intro: string
  exercises: GuitarExercise[]
  /** Not playable yet: the phase that releases it. */
  comingIn?: string
}

export const RHYTHM_UNITS: GuitarUnit[] = [
  {
    id: 'R1',
    line: 'rhythm',
    index: 1,
    title: '开放和弦',
    summary: '八个最常用的开放和弦，每根弦都要按清楚。',
    intro:
      '开放和弦是流行、摇滚吉他的基本功。按和弦时注意三件事：\n- **指尖立起来**，用指尖而不是指腹按弦，避免碰到相邻的弦\n- **靠近品丝**按，离品丝越近越省力、越不容易出“嗡嗡”声\n- 打“×”的弦**不弹**\n\n检查方法：按好和弦后，从最粗的弦开始一根一根拨，每根弦让它响清楚。程序会听每一根弦的音高，告诉你哪根没按准。\n\n> 用电吉他时，打开监听、选“干净流行”音色，听得最清楚。',
    exercises: [
      { id: 'R1-1', kind: 'chord-check', title: 'Em 与 Am', chords: ['Em', 'Am'], tip: 'Em 只用两根手指，是最好入门的和弦。Am 和 E 的形状一样，只是整体往细弦移了一根。' },
      { id: 'R1-2', kind: 'chord-check', title: 'E 与 A', chords: ['E', 'A'], tip: 'A 和弦三根手指挤在同一品，可以稍微斜着排。' },
      { id: 'R1-3', kind: 'chord-check', title: 'C 与 G', chords: ['C', 'G'], tip: 'C 的无名指要立起来，别碰到第四弦。G 的低音在第六弦三品。' },
      { id: 'R1-4', kind: 'chord-check', title: 'D 与 Dm', chords: ['D', 'Dm'], tip: 'D 和 Dm 只弹细的四根弦。两者只差第一弦：D 按二品，Dm 按一品。' },
    ],
  },
  {
    id: 'R2',
    line: 'rhythm',
    index: 2,
    title: '换和弦',
    summary: '一分钟换和弦：两个和弦来回换，越快越稳越好。',
    intro:
      '能按出和弦只是第一步，跟上歌曲的关键是**换得快**。\n\n“一分钟换和弦”是吉他老师最常用的练法：两个和弦来回换，每次换好后拨一下这个和弦的**根音弦**（最低的那个音），程序会听根音来计数。\n- 先求准，再求快：手指一起抬、一起落\n- 找“共同手指”：比如 C 换 Am，食指和中指不动\n- 每天练几分钟，换和弦的速度会很快提高\n\n> 根音弦：C 是第五弦，G 是第六弦，D 和 Dm 是第四弦，E 和 Em 是第六弦，A 和 Am 是第五弦。',
    exercises: [
      { id: 'R2-1', kind: 'change', title: 'Em ↔ Am', chords: ['Em', 'Am'], seconds: 60, target: 20, tip: '两个和弦形状一样，整体平移一根弦即可。' },
      { id: 'R2-2', kind: 'change', title: 'C ↔ Am', chords: ['C', 'Am'], seconds: 60, target: 24, tip: '食指和中指不动，只移动无名指。' },
      { id: 'R2-3', kind: 'change', title: 'G ↔ C', chords: ['G', 'C'], seconds: 60, target: 20, tip: '最常见、也最难的一组。先把每根手指要去的位置想好再动。' },
      { id: 'R2-4', kind: 'change', title: 'D ↔ G', chords: ['D', 'G'], seconds: 60, target: 20, tip: '换到 G 时先放无名指的低音，再补其他手指。' },
    ],
  },
  {
    id: 'R3',
    line: 'rhythm',
    index: 3,
    title: '基础扫弦',
    summary: '四分、八分扫弦，右手像钟摆一样一直摆。',
    intro:
      '扫弦的秘诀是**右手一直摆动**：下拍向下、后半拍向上，就算这一下不扫，手也要照样摆，这样拍子才稳。\n- 用手腕带动，不要整条胳膊甩\n- 拨片露出一点点，松松地握\n- 下扫偏重低音弦，上扫偏重高音弦\n\n程序会听每一下扫弦的时间，和伴奏的拍子比较。上扫下扫的方向它听不出来，谱上的箭头请你自己照着做。\n\n> 先在“设备检查”里做一次时间校准，判定会更准。',
    exercises: [
      { id: 'R3-1', kind: 'strum', title: 'Em 四分下扫', pattern: 'quarters', tonic: 55, romans: ['vi'], bars: 4, bpm: 70, pass: 0.75, tip: '每拍一下，和伴奏的底鼓、军鼓对齐。', preset: 'clean-pop' },
      { id: 'R3-2', kind: 'strum', title: 'G – D 八分下上', pattern: 'eighths', tonic: 55, romans: ['I', 'V'], bars: 4, bpm: 70, pass: 0.75, tip: '每拍两下：下、上。换和弦时右手也不要停。', preset: 'clean-pop' },
      { id: 'R3-3', kind: 'strum', title: 'G – C – D – G 八分', pattern: 'eighths', tonic: 55, romans: ['I', 'IV', 'V', 'I'], bars: 4, bpm: 80, pass: 0.75, tip: '每小节换一个和弦。换的时候可以先放掉最后一个上扫，给左手留时间。', preset: 'clean-pop' },
    ],
  },
  {
    id: 'R4',
    line: 'rhythm',
    index: 4,
    title: '扫弦节奏型',
    summary: '流行歌最常用的几种节奏型。',
    intro:
      '节奏型就是一小节里**哪些格子扫、哪些格子空**。手的摆动始终不变，只是有的格子不碰弦。\n\n谱上的符号：\n- **↓** 下扫，**↑** 上扫\n- **·** 手照样摆，但不碰弦\n\n先慢速练熟一个型，再加速。每个练习都配了常见的和弦进行。\n\n> 万能型（下 下上 上下上）几乎能套用在所有流行歌上，值得最先练熟。',
    exercises: [
      { id: 'R4-1', kind: 'strum', title: '流行万能型 · G D Em C', pattern: 'pop', tonic: 55, romans: ['I', 'V', 'vi', 'IV'], bars: 4, bpm: 76, pass: 0.75, tip: '第三拍的下扫空过，紧接着的上扫要轻快。', preset: 'clean-pop' },
      { id: 'R4-2', kind: 'strum', title: '民谣型 · G C G D', pattern: 'folk', tonic: 55, romans: ['I', 'IV', 'I', 'V'], bars: 4, bpm: 80, pass: 0.75, tip: '第二拍和第四拍都是“下上”，听起来像在走路。', preset: 'clean-pop' },
      { id: 'R4-3', kind: 'strum', title: '摇滚八分 · Em C G D', pattern: 'rock8', tonic: 55, romans: ['vi', 'IV', 'I', 'V'], bars: 4, bpm: 90, pass: 0.75, tip: '全部下扫，手腕放松，用手肘带一点力量。', preset: 'rock-rhythm' },
      { id: 'R4-4', kind: 'strum', title: '切分推进 · Em C G D', pattern: 'push', tonic: 55, romans: ['vi', 'IV', 'I', 'V'], bars: 4, bpm: 80, pass: 0.75, tip: '后半小节全在反拍：手向下摆时不碰弦，向上时扫。', preset: 'clean-pop' },
    ],
  },
  {
    id: 'R5',
    line: 'rhythm',
    index: 5,
    title: '强力和弦与闷音',
    summary: '摇滚、朋克的八分强力和弦和右手闷音。',
    intro:
      '**强力和弦**只有根音和五度两个音（写作 E5、A5），没有三音，所以不分大小调，加了失真也很干净。这就是摇滚吉他几乎只弹它的原因。\n- 食指按根音，无名指按高两品的下一根弦\n- 不弹的弦用食指指肚轻轻碰住，防止杂音\n\n**右手闷音**（Palm Mute）：手掌外侧轻轻搭在琴桥附近的弦上再扫，声音变成短促、厚实的“嚓嚓”声。离琴桥越远闷得越重。\n\n> 打开监听，选“摇滚节奏”或“朋克”音色，强力和弦的味道才出得来。',
    exercises: [
      { id: 'R5-1', kind: 'chord-check', title: 'E5 与 A5', chords: ['E5', 'A5'], tip: '空弦强力和弦：E5 弹六、五弦，A5 弹五、四弦。' },
      { id: 'R5-2', kind: 'chord-check', title: 'G5 与 C5', chords: ['G5', 'C5'], tip: '可移动的指型：G5 根音在六弦三品，C5 根音在五弦三品。' },
      { id: 'R5-3', kind: 'strum', title: '八分闷音 · E5 G5 A5 G5', pattern: 'rock8', tonic: 52, romans: ['I', 'bIII', 'IV', 'bIII'], bars: 4, bpm: 100, pass: 0.75, tip: '全部下扫，右手掌轻搭琴桥。每一下都一样重。', preset: 'rock-rhythm', chordSuffix: '5' },
      { id: 'R5-4', kind: 'strum', title: '朋克冲刺 · A5 D5 E5', pattern: 'rock8', tonic: 57, romans: ['I', 'IV', 'V', 'IV'], bars: 4, bpm: 140, pass: 0.7, tip: '速度快时右手更要放松，用手腕的小幅度摆动。', preset: 'punk', chordSuffix: '5' },
    ],
  },
  {
    id: 'R6',
    line: 'rhythm',
    index: 6,
    title: '横按和弦',
    summary: 'E 型、A 型横按，F 与 Bm。',
    intro:
      '横按就是用食指当“活动变调夹”，把开放和弦的形状搬到任何位置。\n- **E 型横按**：把 E 和弦的形状往上移，食指横按整个品。F 就是一品的 E 型\n- **A 型横按**：把 A 和弦的形状往上移，根音在五弦。Bm 就是二品的 Am 型\n\n要点：\n- 食指靠近品丝，用食指偏拇指一侧的侧面压弦\n- 拇指放在琴颈后面中间，不要握得太紧\n- 力量来自手臂往后拉，而不是手指死捏\n\n> 横按刚开始一定会有闷音，这很正常。逐弦检查，找到没按响的那根弦，调整食指的角度。',
    exercises: [
      { id: 'R6-1', kind: 'chord-check', title: 'F（E 型横按）', chords: ['F'], tip: '一品横按，最难的第一个横按和弦。' },
      { id: 'R6-2', kind: 'chord-check', title: 'Bm 与 B（A 型横按）', chords: ['Bm', 'B'], tip: 'Bm 是二品的 Am 型，B 是二品的 A 型。' },
      { id: 'R6-3', kind: 'chord-check', title: 'F#m（E 型小三和弦）', chords: ['F#m'], tip: '二品的 Em 型，食指横按六根弦。' },
      { id: 'R6-4', kind: 'strum', title: 'C Am F G · 流行万能型', pattern: 'pop', tonic: 60, romans: ['I', 'vi', 'IV', 'V'], bars: 4, bpm: 76, pass: 0.75, tip: '从 Am 换到 F：中指、无名指形状不变，食指横按。', preset: 'clean-pop' },
    ],
  },
  {
    id: 'R7',
    line: 'rhythm',
    index: 7,
    title: '风格节奏',
    summary: '雷鬼反拍、放克十六分、切分推进。',
    intro:
      '同样的和弦，换一种节奏就是另一种风格。这个单元单独统计**反拍**的得分，反拍就是拍子之间的“&”。\n- **雷鬼 / 斯卡**：只在反拍上短促地扫，扫完左手立刻放松，让声音变短\n- **放克**：十六分音符的格子，右手一直以十六分摆动，X 是闷音扫弦（左手轻搭琴弦），发出“恰”的一声\n- **切分推进**：后半小节全在反拍上，听起来往前推\n\n> 放克要用干净音色，加一点压缩会更脆。',
    exercises: [
      { id: 'R7-1', kind: 'strum', title: '雷鬼反拍 · A D', pattern: 'island', tonic: 57, romans: ['I', 'IV'], bars: 4, bpm: 84, pass: 0.75, tip: '“嗯嚓 嗯嚓”：正拍手往下空摆，反拍向上扫。', preset: 'rnb' },
      { id: 'R7-2', kind: 'strum', title: '切分推进 · Am F C G', pattern: 'push', tonic: 60, romans: ['vi', 'IV', 'I', 'V'], bars: 4, bpm: 88, pass: 0.75, tip: '后两拍全部在反拍：向下空过、向上扫。', preset: 'clean-pop' },
      { id: 'R7-3', kind: 'strum', title: '放克十六分 · Em A', pattern: 'sixteen', tonic: 55, romans: ['vi', 'II'], bars: 4, bpm: 76, pass: 0.7, tip: '右手一刻不停地以十六分音符摆动，只在谱上标的格子碰弦。', preset: 'rnb' },
    ],
  },
  {
    id: 'R8',
    line: 'rhythm',
    index: 8,
    title: '综合：主歌与副歌',
    summary: '跟一首完整伴奏弹主歌和副歌，段落之间换节奏型。',
    intro:
      '真正的歌里，节奏吉他要在段落之间**换织体**：主歌收着，副歌放开。\n- 主歌用民谣型，力度轻一点\n- 副歌换成万能型，扫得更满\n- 换段落那一小节的第一拍最关键，要准时进来\n\n这个练习会单独统计“**换和弦的那一下**”是否准时，它最能看出左手换得够不够快。\n\n> 弹完一整首，你已经可以给大多数流行歌伴奏了。',
    exercises: [
      {
        id: 'R8-1',
        kind: 'song',
        title: '主歌 + 副歌（G 调）',
        tonic: 55,
        bpm: 84,
        pass: 0.72,
        preset: 'clean-pop',
        tip: '第 5 小节换成副歌的节奏型。',
        segments: [
          { label: '主歌', pattern: 'folk', romans: ['I', 'V', 'vi', 'IV'], bars: 4 },
          { label: '副歌', pattern: 'pop', romans: ['IV', 'I', 'V', 'vi'], bars: 4 },
        ],
      },
      {
        id: 'R8-2',
        kind: 'song',
        title: '摇滚段落（E 调）',
        tonic: 52,
        bpm: 104,
        pass: 0.72,
        preset: 'rock-rhythm',
        tip: '主歌闷音八分，副歌放开，用民谣型扫开放和弦。',
        segments: [
          { label: '主歌', pattern: 'rock8', romans: ['I', 'I', 'bVII', 'IV'], bars: 4 },
          { label: '副歌', pattern: 'folk', romans: ['IV', 'I', 'V', 'I'], bars: 4 },
        ],
      },
    ],
  },
]

export const LEAD_UNITS: GuitarUnit[] = [
  {
    id: 'L1',
    line: 'lead',
    index: 1,
    title: '指板音名',
    summary: '六根弦前 12 品的音名。',
    intro:
      '弹主音之前，先认识指板。记住三个规律就够了：\n- 相邻两品差一个**半音**；12 品是空弦的高八度\n- **E–F、B–C 之间只差一品**，其他相邻音名之间差两品\n- 六弦和一弦都是 E，它们的音名完全一样\n\n先记六弦和五弦：它们是强力和弦、横按和弦的根音所在。\n\n> 先用“认音”练眼睛，再用“找音”练手。',
    exercises: [
      { id: 'L1-1', kind: 'note-name', title: '认音：六弦和五弦', count: 12, strings: [0, 1], tip: '从空弦音名往上数，E–F、B–C 只差一品。' },
      { id: 'L1-2', kind: 'note-find', title: '找音：六弦和五弦', count: 8, strings: [0, 1], tip: '听到正确的音就会进入下一题，不限时间。' },
      { id: 'L1-3', kind: 'note-name', title: '认音：全部六根弦', count: 16, tip: '四弦的音名就是六弦往细弦移两根、高两品的位置。' },
      { id: 'L1-4', kind: 'note-find', title: '找音：全部六根弦', count: 10, tip: '同一个音在不同弦上有好几个位置，按题目指定的弦找。' },
    ],
  },
  {
    id: 'L2',
    line: 'lead',
    index: 2,
    title: '小调五声',
    summary: 'A 小调五声的五个把位。',
    intro:
      '**小调五声音阶**只有五个音（A C D E G），没有半音，怎么弹都不难听，是摇滚、布鲁斯独奏的基础。\n\n它在指板上分成**五个把位**，每根弦两个音，首尾相接覆盖整个指板。先把第一把位（五品）练熟，再一个一个往上连。\n- 一指一品：食指负责最低的一品，小指负责最高的一品\n- 跟着节拍器，上行再下行，每拍一个音\n- 每个音弹完就换下一个，不要让音混在一起\n\n> 判定按每个音所在的节拍窗口测音高，节拍和音准都要对。',
    exercises: [
      { id: 'L2-1', kind: 'play', title: '第一把位（5–8 品）', source: { type: 'box', position: 1 }, bpm: 66, tip: '最常用的把位，根音 A 在六弦五品。', preset: 'clean-pop' },
      { id: 'L2-2', kind: 'play', title: '第二把位（7–10 品）', source: { type: 'box', position: 2 }, bpm: 66, tip: '从六弦八品的 C 开始。', preset: 'clean-pop' },
      { id: 'L2-3', kind: 'play', title: '第三把位（9–13 品）', source: { type: 'box', position: 3 }, bpm: 66, tip: '注意二弦要伸到 13 品。', preset: 'clean-pop' },
      { id: 'L2-4', kind: 'play', title: '第四把位（12–15 品）', source: { type: 'box', position: 4 }, bpm: 66, tip: '从六弦十二品的 E 开始。', preset: 'clean-pop' },
      { id: 'L2-5', kind: 'play', title: '第五把位（14–17 品）', source: { type: 'box', position: 5 }, bpm: 66, tip: '再往上就回到第一把位（17 品）了。', preset: 'clean-pop' },
    ],
  },
  {
    id: 'L3',
    line: 'lead',
    index: 3,
    title: '乐句与经典句型',
    summary: '四个原创的摇滚、布鲁斯句型。',
    intro:
      '独奏不是音阶的上上下下，而是**乐句**：有开头、有方向、有停顿、有落点。\n- **问答**：一句往上“问”，一句往下“答”\n- **重复**：同一个小动机弹两遍，第二遍换结尾，最容易被记住\n- **留白**：句子之间停一下，听众才听得清\n- 句尾落在根音或和弦音上，最有结束感\n\n这几个句型都在第一把位里，是原创编写的，可以直接用进你的独奏。\n\n> 六线谱上的 ~ 是揉弦，弹长音时加上。',
    exercises: [
      { id: 'L3-1', kind: 'play', title: '上行三连', source: { type: 'lick', id: 'lick-climb' }, bpm: 76, tip: '三弦五品开始，八分音符要均匀。', preset: 'lead' },
      { id: 'L3-2', kind: 'play', title: '下行回答', source: { type: 'lick', id: 'lick-answer' }, bpm: 76, tip: '和上一句连起来弹，就是一组问答。', preset: 'lead' },
      { id: 'L3-3', kind: 'play', title: '重复动机', source: { type: 'lick', id: 'lick-repeat' }, bpm: 80, tip: '两遍的前两个音完全一样。', preset: 'lead' },
      { id: 'L3-4', kind: 'play', title: '低音区 riff', source: { type: 'lick', id: 'lick-low' }, bpm: 84, tip: '用失真音色，右手可以加一点闷音。', preset: 'rock-rhythm' },
    ],
  },
  {
    id: 'L4',
    line: 'lead',
    index: 4,
    title: '推弦与揉弦',
    summary: '推准目标音，揉弦有控制。',
    intro:
      '**推弦**让吉他像人声一样“唱”。按住一个音，把弦往上推，音高就升上去。\n- 用无名指推，中指和食指放在后面同一根弦上一起出力\n- 推之前先在心里唱出目标音，推到位就停住\n- 全音推弦（推到高两品的音高）最常用，半音推弦更细腻\n\n**揉弦**是在一个长音上有规律地小幅推放，让音“活”起来。\n- 用手腕转动带动，而不是手指自己抖\n- 常用的幅度约 20–60 音分，速度每秒 4–7 次\n\n> 程序会画出你的音高曲线：推弦看最高点和目标线的距离，揉弦看波动的幅度和速度。',
    exercises: [
      { id: 'L4-1', kind: 'bend', title: '全音推弦：三弦 7 品', string: 3, fret: 7, semitones: 2, tip: '从 D 推到 E。可以先弹一下三弦 9 品，记住目标音。', preset: 'lead' },
      { id: 'L4-2', kind: 'bend', title: '全音推弦：二弦 8 品', string: 4, fret: 8, semitones: 2, tip: '从 G 推到 A（根音），独奏最经典的推弦之一。', preset: 'lead' },
      { id: 'L4-3', kind: 'bend', title: '半音推弦：二弦 5 品', string: 4, fret: 5, semitones: 1, tip: '从 E 推到 F，推得很少，要控制住。', preset: 'lead' },
      { id: 'L4-4', kind: 'vibrato', title: '揉弦：一弦 5 品', string: 5, fret: 5, tip: '弹响 A 音后保持两秒以上，均匀地揉。', preset: 'lead' },
    ],
  },
  {
    id: 'L5',
    line: 'lead',
    index: 5,
    title: '击弦、勾弦、滑音',
    summary: '连奏技巧：少拨弦，让左手来唱。',
    intro:
      '**连奏**（Legato）就是不拨弦也能让音响起来，声音更圆滑、更快。\n- **击弦**（h）：拨响一个音，另一根手指像小锤一样“砸”在更高的品上\n- **勾弦**（p）：两根手指都按好，拨响高的音，再把上面的手指向下“勾”离琴弦\n- **滑音**（/ 或 \\）：按住音，手指不离开琴弦滑到另一个品\n\n判定仍然看每个音的音高和时间。用吉他线时，程序还会数一数你拨了几下弦，提示连奏的音是不是被“拨”出来了（只作提示，不计分）。\n\n> 连奏的音会比拨出来的音小声，加一点压缩或过载能让它们更均匀。',
    exercises: [
      { id: 'L5-1', kind: 'play', title: '击弦三连', source: { type: 'lick', id: 'legato-hammer' }, bpm: 70, tip: '每根弦只拨一下，第二个音用击弦。', preset: 'lead', legato: true },
      { id: 'L5-2', kind: 'play', title: '勾弦下行', source: { type: 'lick', id: 'legato-pull' }, bpm: 70, tip: '两根手指先都按好，勾的时候往地面方向拨一下。', preset: 'lead', legato: true },
      { id: 'L5-3', kind: 'play', title: '滑音连接', source: { type: 'lick', id: 'legato-slide' }, bpm: 70, tip: '滑的时候保持按弦的力度，不然音会断。', preset: 'lead', legato: true },
    ],
  },
  {
    id: 'L6',
    line: 'lead',
    index: 6,
    title: '大调音阶与 CAGED',
    summary: '大调五声、自然大调，以及它们和和弦形状的对应。',
    intro:
      '小调五声和**大调五声**用的是同一组形状：A 小调五声的第一把位，从八品的 C 开始弹，就是 C 大调五声。所以你已经会了。\n\n**CAGED** 是把指板分成五个和弦形状的方法：C、A、G、E、D 五个开放和弦的形状，搬到不同把位都能组成同一个和弦。每个和弦形状周围都“包着”一个音阶把位：\n- E 型横按和弦的位置 ↔ 根音在六弦的音阶把位\n- A 型横按和弦的位置 ↔ 根音在五弦的音阶把位\n\n弹音阶时注意亮色的根音，它们就是那个和弦形状的根音。\n\n> 独奏时先找到当前和弦的形状，再用它周围的音阶，最不容易“迷路”。',
    exercises: [
      { id: 'L6-1', kind: 'play', title: 'C 大调五声（7–10 品）', source: { type: 'scale', name: 'C 大调五声', tonicPc: 0, scale: 'major-penta', lowFret: 7, highFret: 10 }, bpm: 66, tip: '和 A 小调五声第二把位同一个形状，根音换成 C。', preset: 'clean-pop' },
      { id: 'L6-2', kind: 'play', title: 'G 大调音阶（E 型，2–5 品）', source: { type: 'scale', name: 'G 大调音阶', tonicPc: 7, scale: 'major', lowFret: 2, highFret: 5 }, bpm: 60, tip: '围绕三品的 G 横按（E 型）展开，每根弦两到三个音。', preset: 'clean-pop' },
      { id: 'L6-3', kind: 'play', title: 'C 大调音阶（E 型，7–10 品）', source: { type: 'scale', name: 'C 大调音阶', tonicPc: 0, scale: 'major', lowFret: 7, highFret: 10 }, bpm: 60, tip: '和上一题同一个形状，整体移到八品，就变成了 C 大调。', preset: 'clean-pop' },
    ],
  },
  {
    id: 'L7',
    line: 'lead',
    index: 7,
    title: '瞄准和弦音',
    summary: '和弦变化时落在根音、三音上。',
    intro:
      '好听的独奏会**跟着和弦走**：每个小节的第一拍，落在当前和弦的音上（根音、三音或五音），听起来就“对上了”。\n- 先看下一个和弦是什么，提前想好落点\n- 三音最有色彩：Am 的 C、F 的 A、C 的 E、G 的 B\n- 其余的拍子可以自由用五声音阶连接\n\n这个练习只检查**每小节第一拍**弹的音是不是和弦音，其余的拍子你可以随意发挥。\n\n> 第一遍可以只在每小节第一拍弹一个长音，熟悉落点之后再在中间加句子。',
    exercises: [
      { id: 'L7-1', kind: 'target', title: 'Am F C G', tonic: 57, mode: 'minor', romans: ['i', 'VI', 'III', 'VII'], bars: 8, bpm: 76, pass: 0.75, tip: '落点建议：A（或 C）→ A（或 F）→ C（或 E）→ G（或 B）。', preset: 'lead' },
      { id: 'L7-2', kind: 'target', title: 'Am Dm Em Am', tonic: 57, mode: 'minor', romans: ['i', 'iv', 'v', 'i'], bars: 8, bpm: 80, pass: 0.75, tip: 'Dm 的 F、Em 的 G 都在五声里，正好当落点。', preset: 'lead' },
    ],
  },
  {
    id: 'L8',
    line: 'lead',
    index: 8,
    title: '即兴',
    summary: '跟伴奏即兴 8 小节，可以存进作品集。',
    intro:
      '把前面学到的串起来：用 A 小调五声，跟着伴奏即兴 8 小节。\n- 分成四句：问—答—问—答\n- 句子之间留一两拍空白\n- 强拍尽量落在和弦音上\n- 最后一句可以用推弦把高潮推上去，再落回根音\n\n弹完后会显示统计：音阶内的比例、强拍和弦音的比例、留白、乐句数和音域，并给出建议。配置了 AI 还可以请它点评。觉得满意，可以把这段即兴转成旋律存进作品集，在作曲台里继续编。\n\n> 即兴没有标准答案。统计只是帮你看见自己的习惯。',
    exercises: [
      { id: 'L8-1', kind: 'improv', title: '慢摇滚 · Am F C G', tonic: 57, mode: 'minor', romans: ['i', 'VI', 'III', 'VII'], bars: 8, bpm: 84, tip: '先用第一把位，留够空白。', preset: 'lead' },
      { id: 'L8-2', kind: 'improv', title: '小调律动 · Am Dm Am Em', tonic: 57, mode: 'minor', romans: ['i', 'iv', 'i', 'v'], bars: 8, bpm: 92, tip: '试着重复一个短动机，每次换一个结尾。', preset: 'lead' },
    ],
  },
]

export const ALL_UNITS = [...RHYTHM_UNITS, ...LEAD_UNITS]

export function guitarUnit(id: string): GuitarUnit | undefined {
  return ALL_UNITS.find((u) => u.id === id)
}

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** "Em" → { rootPc: 4, suffix: 'm', rootName: 'E' }; supports #, b and the suffixes the shape finder knows. */
export function parseChordSymbol(symbol: string): { rootPc: number; suffix: string; rootName: string } {
  const m = /^([A-G])([#b]?)(.*)$/.exec(symbol)
  if (!m) throw new Error(`bad chord symbol ${symbol}`)
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0
  return { rootPc: (LETTER_PC[m[1]!]! + acc + 12) % 12, suffix: m[3] ?? '', rootName: m[1]! + (m[2] ?? '') }
}
