import { Button } from '@/shared/ui'
import { MIX_LESSONS, type MixLessonId } from '@/songs/mixLessons'

export interface MixLessonCardProps {
  lessonId: MixLessonId
  /** 「听听看」：开 / 关这个模块各放一遍。省略则不显示按钮。 */
  onListen?: () => void
  /** Which pass is currently playing, if this card's audition is running. */
  playingLabel?: string | null
  disabled?: boolean
}

/** 模块「这是什么」卡片：一句话原理、什么时候用、常见错误、动手试试。 */
export function MixLessonCard({
  lessonId,
  onListen,
  playingLabel,
  disabled,
}: MixLessonCardProps): JSX.Element | null {
  const lesson = MIX_LESSONS.find((l) => l.id === lessonId)
  if (!lesson) return null
  return (
    <div className="space-y-3 rounded-2xl border border-border/80 bg-muted/30 p-4 text-sm">
      <p className="font-medium text-foreground">{lesson.oneLine}</p>
      <div>
        <p className="text-xs font-medium text-muted-foreground">什么时候用</p>
        <p className="mt-1 text-muted-foreground">{lesson.when}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground">常见错误</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
          {lesson.mistakes.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl bg-background/60 p-3">
        <p className="text-xs font-medium text-cyan">动手试试</p>
        <p className="mt-1 text-foreground/90">{lesson.tryIt}</p>
      </div>
      {onListen && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline" onClick={onListen} disabled={disabled}>
            听听看
          </Button>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {playingLabel
              ? `正在播放：${playingLabel}`
              : '先放「不加效果」，再放「加上效果」，同一段音频。'}
          </span>
        </div>
      )}
    </div>
  )
}
