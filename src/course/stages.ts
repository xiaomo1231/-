import type { StageInfo } from './types'
import { STAGE0_LESSONS } from './lessons/stage0'
import { STAGE1_LESSONS } from './lessons/stage1'
import { STAGE2_LESSONS } from './lessons/stage2'
import { STAGE3_LESSONS } from './lessons/stage3'
import { STAGE4_LESSONS } from './lessons/stage4'
import { STAGE5_LESSONS } from './lessons/stage5'

/**
 * Curriculum stages. Requirements are the training thresholds from the plan
 * (§3.5), expressed as "pass level N of module X", which the level system
 * already defines as ≥85 % over the last 10 answers at that level.
 */
export const STAGES: readonly StageInfo[] = [
  {
    stage: 0,
    title: '节奏与声音',
    tagline: '拍号、时值、切分、后拍，五线谱识谱入门。',
    lessons: STAGE0_LESSONS,
    requirements: [],
  },
  {
    stage: 1,
    title: '音高系统',
    tagline: '大小调、五声与布鲁斯、调号与五度圈、音程。',
    lessons: STAGE1_LESSONS,
    requirements: [
      { module: 'E1', level: 3, label: '音高比较 第 3 级（半音）' },
      { module: 'R1', level: 1, label: '跟拍 第 1 级（80 BPM）' },
      { module: 'N1', level: 1, label: '五线谱识谱 第 1 级' },
    ],
  },
  {
    stage: 2,
    title: '和声基础',
    tagline: '三和弦、七和弦、级数与流行套路库、低音线。',
    lessons: STAGE2_LESSONS,
    requirements: [
      { module: 'E2', level: 3, label: '音程听辨 第 3 级' },
      { module: 'E3', level: 2, label: '级数听辨 第 2 级' },
      { module: 'S1', level: 2, label: '单音模仿 第 2 级（±35 音分）' },
    ],
  },
  {
    stage: 3,
    title: '旋律与歌曲结构',
    tagline: '动机与 riff、主歌副歌、Hook、歌词与旋律。',
    lessons: STAGE3_LESSONS,
    requirements: [
      { module: 'E5', level: 3, label: '和弦性质 第 3 级' },
      { module: 'E6', level: 2, label: '和声进行 第 2 级' },
      { module: 'S5', level: 2, label: '级数演唱 第 2 级' },
    ],
  },
  {
    stage: 4,
    title: '进阶和声',
    tagline: '借用和弦、副属、七和弦与挂留、斜线和弦、转调。',
    lessons: STAGE4_LESSONS,
    requirements: [
      { module: 'E6', level: 4, label: '和声进行 第 4 级' },
      { module: 'E8', level: 3, label: '旋律听写 第 3 级' },
      { module: 'S6', level: 1, label: '视唱 第 1 级' },
    ],
  },
  {
    stage: 5,
    title: '编曲',
    tagline: '鼓贝斯锁定、吉他与键盘声部、段落能量、混音与导出。',
    lessons: STAGE5_LESSONS,
    requirements: [
      { module: 'E7', level: 3, label: '低音线 第 3 级' },
      { module: 'E9', level: 4, label: '节奏听写 第 4 级' },
      { module: 'E5', level: 6, label: '和弦性质 第 6 级（转位）' },
    ],
  },
]

export function stageInfo(stage: number): StageInfo | undefined {
  return STAGES.find((s) => s.stage === stage)
}

export function lessonById(id: string) {
  for (const s of STAGES) {
    const l = s.lessons.find((x) => x.id === id)
    if (l) return l
  }
  return undefined
}

export function allLessons() {
  return STAGES.flatMap((s) => s.lessons)
}
