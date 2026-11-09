import { generateQuestion } from '@/drills/generators'
import type { PerformQuestion } from '@/drills/types'
import type { SeriesItem, SeriesResult } from '@/widgets/pitchcamp/PerformSeries'
import { meanAbs, ratio, type PitchMetrics } from './plan'

export interface VoiceOpts {
  vocalRange?: { low: number; high: number }
  octaveEquivalence: boolean
}

type SingModule = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7'

const sing = (module: SingModule, level: number, v: VoiceOpts): PerformQuestion =>
  generateQuestion(module, level, {
    ...(v.vocalRange ? { vocalRange: v.vocalRange } : {}),
    octaveEquivalence: v.octaveEquivalence,
  }) as PerformQuestion

/** 同一种唱歌题出 count 道。 */
export function singItems(module: SingModule, level: number, count: number, v: VoiceOpts): SeriesItem[] {
  return Array.from({ length: count }, () => ({ question: sing(module, level, v) }))
}

/**
 * 短旋律三步法：同一句旋律唱三遍。
 *   第 1 步：先听一遍，再跟着琴一起唱；
 *   第 2 步：听一遍，琴停下，自己唱回来（模唱）；
 *   第 3 步：只给第一个音，凭记忆唱出整句。
 */
export function echo3Items(level: number, melodies: number, v: VoiceOpts): SeriesItem[] {
  const out: SeriesItem[] = []
  for (let m = 0; m < melodies; m++) {
    const base = sing('S7', level, v)
    const melody = base.reference.type === 'notes' ? base.reference.notes : []
    const first = melody[0]
    out.push({
      question: {
        ...base,
        id: `${base.id}-1`,
        prompt: '先听一遍这句旋律；4 拍预备后琴会再弹一遍，你跟着它一起唱。',
        revealAfter: false,
        showStaff: false,
      },
      accompany: true,
      caption: `第 ${m + 1} 句 · 第 1 步：跟着琴唱`,
    })
    out.push({ question: { ...base, id: `${base.id}-2` }, caption: `第 ${m + 1} 句 · 第 2 步：听完再唱` })
    if (first)
      out.push({
        question: {
          ...base,
          id: `${base.id}-3`,
          prompt: '只给第一个音，4 拍预备后凭记忆唱出刚才那句。',
          reference: { type: 'notes', notes: [first] },
        },
        caption: `第 ${m + 1} 句 · 第 3 步：只给第一个音`,
      })
  }
  return out
}

/** 一组唱歌结果里，单音类题目的读数 → 平均偏差和命中率（没唱出声算没中）。 */
export function matchMetrics(results: readonly SeriesResult[]): Pick<PitchMetrics, 'matchCents' | 'hitRate'> {
  const cents = results.map((r) => r.notes[0]?.medianCents ?? null)
  const hits = cents.filter((c) => c !== null && Math.abs(c) <= 50).length
  return { matchCents: meanAbs(cents), hitRate: ratio(hits, results.length) }
}

export function driftMetric(results: readonly SeriesResult[]): Pick<PitchMetrics, 'driftCents'> {
  return { driftCents: meanAbs(results.map((r) => r.notes[0]?.driftCents ?? null)) }
}

export function intervalMetric(results: readonly SeriesResult[]): Pick<PitchMetrics, 'intervalHit'> {
  return { intervalHit: ratio(results.filter((r) => r.grade.correct).length, results.length) }
}

/** 旋律：唱对的音占全部音的比例。 */
export function melodyMetric(results: readonly SeriesResult[]): Pick<PitchMetrics, 'melodyHit'> {
  if (!results.length) return { melodyHit: null }
  const credit = results.reduce((s, r) => s + r.grade.credit, 0) / results.length
  return { melodyHit: Math.round(credit * 100) / 100 }
}
