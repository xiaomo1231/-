import { useMemo } from 'react'
import type { FeedbackMode, PitchMetrics, SessionBlock } from '@/pitchcamp/plan'
import { echo3Items, matchMetrics, singItems, type VoiceOpts } from '@/pitchcamp/questions'
import { DiscriminationTask } from './DiscriminationTask'
import { DroneTask } from './DroneTask'
import { PerformSeries } from './PerformSeries'
import { SelfCheckTask } from './SelfCheckTask'
import { SirenTask } from './SirenTask'
import { SongTask } from './SongTask'
import { TestRunner } from './TestRunner'
import { WarmupTask } from './WarmupTask'

const DEFAULT_RANGE = { low: 50, high: 67 }

/** 按练习块的种类放对应的练习；做完把用时和量到的指标交回去。 */
export function BlockRunner({
  block,
  voice,
  feedback,
  latestDisc,
  onDone,
}: {
  block: SessionBlock
  voice: VoiceOpts
  feedback: FeedbackMode
  /** 最近一次测到的分辨力：日常听辨从它的两倍开始。 */
  latestDisc: number | null
  onDone: (seconds: number, metrics?: Partial<PitchMetrics>) => void
}) {
  const range = voice.vocalRange ?? DEFAULT_RANGE
  // 每个块的题目只在打开时出一次。
  const items = useMemo(() => {
    switch (block.kind) {
      case 'match':
        return singItems('S1', block.level, block.count, voice)
      case 'sustain':
        return singItems('S2', block.level, block.count, voice)
      case 'interval':
        return singItems('S3', block.level, block.count, voice)
      case 'scale':
        return singItems('S4', block.level, block.count, voice)
      case 'sight':
        return singItems('S6', block.level, block.count, voice)
      case 'echo3':
        return echo3Items(block.level, block.count, voice)
      case 'quick':
        return singItems('S1', 1, block.count, { ...voice, octaveEquivalence: true })
      default:
        return []
    }
  }, [block, voice])

  switch (block.kind) {
    case 'warmup':
      return <WarmupTask onDone={(s) => onDone(s)} />
    case 'test':
      return <TestRunner voice={voice} onDone={(m, s) => onDone(s, m)} />
    case 'discrimination':
      return (
        <DiscriminationTask
          trials={block.count}
          start={latestDisc ? Math.min(150, Math.max(20, latestDisc * 2)) : 100}
          why={block.why}
          onDone={(r) => onDone(r.seconds)}
        />
      )
    case 'selfcheck':
      return <SelfCheckTask rounds={block.count} range={range} why={block.why} onDone={(r) => onDone(r.seconds)} />
    case 'siren':
      return <SirenTask rounds={block.count} range={range} feedback={feedback} why={block.why} onDone={(r) => onDone(r.seconds)} />
    case 'drone':
      return <DroneTask rounds={block.count} level={block.level} range={range} feedback={feedback} why={block.why} onDone={(r) => onDone(r.seconds)} />
    case 'song':
      return <SongTask minutes={Math.max(3, Math.round(block.minutes))} onDone={(s) => onDone(s)} />
    case 'quick':
      return (
        <PerformSeries
          title={block.title}
          why="三个单音，不看音准表，记进进步曲线。"
          items={items}
          feedback="score"
          onDone={(r, s) => onDone(s, matchMetrics(r))}
        />
      )
    default:
      return <PerformSeries title={block.title} why={block.why} items={items} feedback={feedback} onDone={(_, s) => onDone(s)} />
  }
}
