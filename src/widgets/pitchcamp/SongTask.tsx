import { Link } from 'react-router-dom'
import { ArrowRight, Check, Mic } from 'lucide-react'
import { SingService } from '@/services/singService'
import { useAsync } from '@/shared/lib/useAsync'
import { Button } from '@/shared/ui/Button'
import { buttonVariants } from '@/shared/ui/buttonVariants'
import { TaskFrame } from './TaskFrame'

/**
 * 用到歌里：去「跟唱」逐句唱自己导入的歌（音高带、按句评分都在那里），
 * 练够分钟数回来点「练完了」。没有导入过歌时先去导入。
 */
export function SongTask({ minutes, onDone }: { minutes: number; onDone: (seconds: number) => void }) {
  const { data: songs } = useAsync(() => SingService.list(), [])
  return (
    <TaskFrame
      title="用到歌里"
      why={`选一首你在「跟唱」里导入过的歌，逐句唱 ${minutes} 分钟左右：先开着导唱，唱稳了把导唱音量调小，最后关掉。每句看音高带，绿色就是准。`}
    >
      {!songs ? (
        <p className="text-sm text-muted-foreground">正在读取你的歌…</p>
      ) : songs.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">「跟唱」里还没有歌。先导入一首（需要人声轨，可以用「自动分轨」从原曲分出来）。</p>
          <Link to="/sing" className={buttonVariants({ variant: 'outline' })}>
            <Mic /> 去跟唱导入歌曲
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {songs.slice(0, 8).map((s) => (
            <li key={s.id}>
              <Link
                to={`/sing/song/${s.id}`}
                className="focus-ring flex items-center justify-between rounded-2xl border border-border/70 bg-background/50 px-4 py-3 hover:border-cyan/50"
              >
                <span className="min-w-0 truncate">
                  {s.title}
                  {s.artist ? <span className="ml-2 text-xs text-muted-foreground">{s.artist}</span> : null}
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-6 flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">练完点侧边栏的「音准矫正」回来，再点「练完了」。前面做完的部分都记着。</p>
        <Button size="lg" onClick={() => onDone(minutes * 60)}>
          <Check /> 练完了
        </Button>
      </div>
    </TaskFrame>
  )
}
