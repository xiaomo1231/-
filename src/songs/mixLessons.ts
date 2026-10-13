/**
 * 跟唱 2.0 混音课程文案与耳朵训练题生成（纯数据 + 可复现的伪随机）。
 * 面向第一次翻唱录音的初学者：短句、友好、少术语。
 */
import { cloneMix, MIX_PRESETS } from './mixPresets'
import type { MixSettings } from './singTypes'

export type MixLessonId = 'lowcut' | 'eq' | 'comp' | 'deess' | 'reverb' | 'delay' | 'balance'

export interface MixLesson {
  id: MixLessonId
  title: string
  oneLine: string
  when: string
  mistakes: string[]
  tryIt: string
}

export const MIX_LESSONS: MixLesson[] = [
  {
    id: 'lowcut',
    title: '低切（高通滤波）',
    oneLine: '把人声下面多余的低频轰鸣切掉，让声音更清爽。',
    when: '录音里有“嗡嗡”的低频、喷麦的“噗”声，或伴奏的低音把人声盖住时。',
    mistakes: [
      '切得太高（比如 300 Hz 以上），人声会变薄，像电话里的声音。',
      '不管录音情况一律开很高的低切，唱歌的低音部分会被削掉。',
      '只看曲线不听声音：切完要用耳朵确认字还清楚。',
    ],
    tryIt: '打开低切，从 80 Hz 开始慢慢往上推，直到听出声音变薄，再退回一点。',
  },
  {
    id: 'eq',
    title: '均衡（EQ）',
    oneLine: '调整各个频段的音量，让人声更清楚、更好听。',
    when: '人声发闷时，可以在 2–4 kHz 附近提一点，让咬字更清楚；觉得刺耳时，压一下这一带。',
    mistakes: [
      '为了“亮”一味提高高频，结果出现嘶嘶声和刺耳感。',
      '一次拉得很大（超过 ±6 dB），声音容易失真，应少量多次调整。',
      '把所有频段都动了，反而找不到重点；先只动一两个频段。',
    ],
    tryIt: '在 2–4 kHz 附近加 1–2 dB，听咬字是否更清楚；再在 300 Hz 附近减 1–2 dB，看看闷感是否减轻。',
  },
  {
    id: 'comp',
    title: '压缩（Compressor）',
    oneLine: '把忽大忽小的音量拉得平稳一些，让每一句都听得清。',
    when: '唱得有强弱起伏，弱的字听不见、强的字突然很响时。',
    mistakes: [
      '压得太狠（比例过高、阈值过低），声音会发闷、没有表情。',
      '完全不压，录音里的大声句子容易炸开，小声的字被淹没。',
      '补偿增益（makeup）开得太大，导致总音量过大。',
    ],
    tryIt: '把比例设为 2–3:1，阈值调到让最大的几个音偶尔被压下 2–4 dB，再用补偿把音量补回来。',
  },
  {
    id: 'deess',
    title: '去齿音（De-esser）',
    oneLine: '把 s、sh 这类“丝丝”的齿音压下去一点。',
    when: '“丝丝”声在 5–8 kHz 附近特别刺耳，尤其是近距离录音或用了高频提升之后。',
    mistakes: [
      '压得太多，字会变得含糊，分不清是“s”还是“sh”。',
      '频率设错（例如放在 1 kHz），压到的是人声本身的音色。',
      '没有听录音就默认开启，应先在有齿音的句子上对比。',
    ],
    tryIt: '开启去齿音，在 6–7 kHz 附近试 3–5 dB，只在含 s 的句子上听效果。',
  },
  {
    id: 'reverb',
    title: '混响（Reverb）',
    oneLine: '给人声加上空间感，让它像是在某个房间或大厅里唱。',
    when: '干干的录音听起来“贴在耳边”，想要更自然、更有氛围时。',
    mistakes: [
      '混响加得太多，人声会变得遥远、浑浊，歌词听不清。',
      '每首歌都用同一种很长的混响，风格会单调。',
      '忽略节奏：快歌配很长的尾音，会糊成一片。',
    ],
    tryIt: '混响比例先放在 15–20% 左右，衰减时间约 1–2 秒，然后比较干声与湿声，选出你想要的空间感。',
  },
  {
    id: 'delay',
    title: '延迟（Delay）',
    oneLine: '加入跟着节拍回响的重复声，让演唱更有律动。',
    when: '想在句尾或长音后加一点回响，并且和歌曲节奏对齐时。',
    mistakes: [
      '回授（feedback）太高，回声会一直堆叠，把后面的歌词盖住。',
      '延迟时间和歌曲节奏对不上，听起来像“拖拍”。',
      '延迟比例太大，人声会显得混乱。',
    ],
    tryIt: '打开节拍同步，选 1/8 或附点 1/8，把比例压到 10% 左右，回授保持在 20–30%。',
  },
  {
    id: 'balance',
    title: '音量与声像平衡',
    oneLine: '调整人声与伴奏的相对音量，并决定声音偏左或偏右。',
    when: '每次混音的最后一步：人声要清楚，又不能盖过伴奏，也不能被伴奏淹没。',
    mistakes: [
      '人声开得过大，听起来像“卡拉 OK 的干唱”，与伴奏脱节。',
      '伴奏太响导致人声被掩盖，尤其在副歌部分。',
      '为了“特别”而把人声大幅偏向一侧，戴耳机听会很不舒服。',
    ],
    tryIt: '先把伴奏调到你觉得舒服的音量，再把人声提到能清楚听到歌词、又融入伴奏的位置；声像保持在居中附近。',
  },
]

export interface GuideStep {
  id: 'lowcut' | 'eq' | 'comp' | 'reverb' | 'balance'
  title: string
  text: string
}

/** 第一次混音的五步引导：低切 → EQ → 压缩 → 混响 → 平衡。 */
export const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'lowcut',
    title: '第 1 步：低切',
    text: '先打开低切，把 80–120 Hz 以下的轰鸣和喷麦声去掉，直到人声变干净，同时保留一点胸腔的温暖。',
  },
  {
    id: 'eq',
    title: '第 2 步：均衡',
    text: '用 EQ 让咬字清楚：2–4 kHz 少量提升，300 Hz 附近少量减弱，每次只动 1–2 dB。',
  },
  {
    id: 'comp',
    title: '第 3 步：压缩',
    text: '让音量更平稳：比例 2–3:1，阈值设到大声的字偶尔被压下几 dB，再用补偿把音量补回来。',
  },
  {
    id: 'reverb',
    title: '第 4 步：混响',
    text: '加一点空间感：混响比例 15–20% 左右，衰减 1–2 秒，确认歌词依然清楚。',
  },
  {
    id: 'balance',
    title: '第 5 步：平衡',
    text: '最后调人声与伴奏的音量比例，让人声清楚又融入伴奏，声像保持居中。',
  },
]

export interface EarQuiz {
  prompt: string
  options: string[]
  /** Index into `options` / `variants` of the variant where the effect is on. */
  answer: number
  /** Two vocal settings in the order they are played (the effect is on in `variants[answer]`). */
  variants: MixSettings['vocal'][]
}

/** 可复现的伪随机数（mulberry32），同一个 seed 永远得到同一序列。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 生成耳朵训练题：两段人声只有一个效果的开关不同，其余全部关闭，便于听辨。
 * 播放顺序由 seed 决定。
 */
export function makeEarQuiz(kind: 'lowcut' | 'comp', seed: number): EarQuiz {
  const rand = mulberry32(seed)
  // 原样预设的人声模块全部关闭，只打开被训练的那一个效果
  const off = cloneMix(MIX_PRESETS.raw.settings).vocal
  const on = cloneMix(MIX_PRESETS.raw.settings).vocal

  let prompt: string
  if (kind === 'lowcut') {
    on.lowCut = { on: true, freq: 120 }
    prompt = '听听下面两段人声，哪一段做了低切？（留意低频的“嗡嗡”感是否被削去）'
  } else {
    on.comp = { on: true, thresholdDb: -24, ratio: 4, attackMs: 10, releaseMs: 120, makeupDb: 3 }
    prompt = '听听下面两段人声，哪一段做了压缩？（留意轻声的字是否更容易听清、音量是否更平稳）'
  }

  const onFirst = rand() < 0.5
  return {
    prompt,
    options: ['第一段', '第二段'],
    answer: onFirst ? 0 : 1,
    variants: onFirst ? [on, off] : [off, on],
  }
}
