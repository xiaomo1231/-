import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Pause, Play } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'
import { TaskFrame } from './TaskFrame'

const STEPS: ReadonlyArray<{ title: string; how: string; seconds: number }> = [
  { title: '哼鸣', how: '闭上嘴，用舒服的音量哼「嗯——」，感觉鼻子和嘴唇有点麻。换几个高低不同的音。', seconds: 30 },
  { title: '唇颤', how: '嘴唇放松，吹气让嘴唇「噗噜噜」地抖，同时带出声音，从低滑到高再滑回来。', seconds: 30 },
  { title: '往上滑', how: '用「呜——」从最低的舒服音慢慢滑到最高的舒服音，不要用力挤。', seconds: 30 },
  { title: '往下滑', how: '从高处用「啊——」慢慢滑下来，像叹气一样放松。', seconds: 30 },
]

/** 热身：四个小动作各 30 秒，自动往下走；可以暂停或跳过。 */
export function WarmupTask({ onDone }: { onDone: (seconds: number) => void }) {
  const [step, setStep] = useState(0)
  const [left, setLeft] = useState(STEPS[0]!.seconds)
  const [running, setRunning] = useState(false)
  const began = useRef(Date.now())

  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setLeft((s) => s - 1), 1000)
    return () => window.clearInterval(id)
  }, [running])

  useEffect(() => {
    if (left > 0) return
    if (step + 1 >= STEPS.length) {
      setRunning(false)
      onDone((Date.now() - began.current) / 1000)
      return
    }
    setStep((s) => s + 1)
    setLeft(STEPS[step + 1]!.seconds)
  }, [left, step, onDone])

  const cur = STEPS[step]!
  return (
    <TaskFrame title="热身" why="不用麦克风，跟着做两分钟，让声带和气息先活动开。" index={step} total={STEPS.length}>
      <ol className="mb-6 grid grid-cols-4 gap-2">
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            className={cn(
              'rounded-2xl border px-3 py-2 text-sm',
              i === step ? 'border-amber bg-amber-soft/40' : i < step ? 'border-success/50 bg-success/10' : 'border-border/70',
            )}
          >
            {s.title}
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-6">
        <div className="num w-24 text-5xl font-semibold text-amber">{left}</div>
        <div className="flex-1">
          <div className="font-display text-xl">{cur.title}</div>
          <p className="mt-1 text-sm text-muted-foreground">{cur.how}</p>
        </div>
        <div className="flex gap-2">
          <Button size="lg" variant={running ? 'outline' : 'default'} onClick={() => setRunning((r) => !r)}>
            {running ? <Pause /> : <Play />} {running ? '暂停' : step === 0 && left === STEPS[0]!.seconds ? '开始' : '继续'}
          </Button>
          <Button size="lg" variant="ghost" onClick={() => onDone((Date.now() - began.current) / 1000)}>
            跳过 <ArrowRight />
          </Button>
        </div>
      </div>
    </TaskFrame>
  )
}
