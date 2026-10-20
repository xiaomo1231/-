/**
 * The General MIDI instruments offered in the 音轨 panel, grouped for picking, with
 * Chinese names. Every GM program has a name (for showing what a file uses); the
 * groups list the useful ones for a band.
 */

export interface InstrumentGroup {
  name: string
  programs: readonly number[]
}

/** All 128 GM programs, in Chinese. */
export const GM_NAMES: readonly string[] = [
  '大钢琴', '明亮钢琴', '电声钢琴', '酒吧钢琴', '电钢琴', '电钢琴 2', '羽管键琴', '击弦古钢琴',
  '钢片琴', '钟琴', '八音盒', '颤音琴', '马林巴', '木琴', '管钟', '扬琴',
  '电风琴', '打击风琴', '摇滚风琴', '管风琴', '簧风琴', '手风琴', '口琴', '探戈手风琴',
  '尼龙弦吉他', '钢弦吉他', '爵士吉他', '清音电吉他', '闷音电吉他', '过载吉他', '失真吉他', '吉他泛音',
  '原声贝斯', '指弹贝斯', '拨片贝斯', '无品贝斯', '击勾贝斯', '击勾贝斯 2', '合成贝斯', '合成贝斯 2',
  '小提琴', '中提琴', '大提琴', '低音提琴', '颤音弦乐', '拨奏弦乐', '竖琴', '定音鼓',
  '弦乐合奏', '慢弦乐', '合成弦乐', '合成弦乐 2', '合唱「啊」', '人声「哦」', '合成人声', '管弦乐齐奏',
  '小号', '长号', '大号', '弱音小号', '圆号', '铜管组', '合成铜管', '合成铜管 2',
  '高音萨克斯', '中音萨克斯', '次中音萨克斯', '上低音萨克斯', '双簧管', '英国管', '大管', '单簧管',
  '短笛', '长笛', '竖笛', '排箫', '吹瓶', '尺八', '口哨', '陶笛',
  '方波主音', '锯齿波主音', '汽笛风琴主音', '吹管主音', '电荷主音', '人声主音', '五度主音', '贝斯主音',
  '新世纪音垫', '温暖音垫', '复音合成', '合唱音垫', '弓弦音垫', '金属音垫', '光环音垫', '扫掠音垫',
  '雨声', '音轨', '水晶', '大气', '明亮', '鬼怪', '回声', '科幻',
  '西塔琴', '班卓琴', '三味线', '十三弦筝', '卡林巴', '风笛', '小提琴（民间）', '唢呐',
  '叮当铃', '阿哥哥鼓', '钢鼓', '木鱼', '太鼓', '通通鼓', '合成鼓', '反向镲',
  '吉他换把噪声', '呼吸声', '海浪', '鸟鸣', '电话铃', '直升机', '掌声', '枪声',
]

export const INSTRUMENT_GROUPS: readonly InstrumentGroup[] = [
  { name: '吉他', programs: [24, 25, 26, 27, 28, 29, 30, 31] },
  { name: '贝斯', programs: [32, 33, 34, 35, 36, 38, 39] },
  { name: '键盘', programs: [0, 1, 2, 4, 5, 6, 16, 17, 18, 19, 21] },
  { name: '弦乐', programs: [40, 41, 42, 43, 45, 46, 48, 49, 50] },
  { name: '管乐', programs: [56, 57, 60, 61, 64, 65, 66, 71, 73, 74, 75, 22] },
  { name: '人声', programs: [52, 53, 54, 85] },
  { name: '合成器', programs: [80, 81, 87, 88, 89, 90, 91, 95] },
  { name: '其他', programs: [8, 11, 12, 13, 14, 15, 104, 105, 107, 108, 114] },
]

/** The Chinese name of a GM program. */
export function instrumentName(program: number): string {
  return GM_NAMES[program] ?? `音色 ${program}`
}
