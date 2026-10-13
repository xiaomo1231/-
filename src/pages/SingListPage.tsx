import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mic } from 'lucide-react'
import type { SingSong } from '@/entities/types'
import { SingService , singKey } from '@/services/singService'
import { useAsync } from '@/shared/lib/useAsync'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { Button } from '@/shared/ui/Button'
import { toast } from '@/features/toast/toastStore'
import { SingImportPanel } from '@/widgets/singList/SingImportPanel'
import { SingSongCard } from '@/widgets/singList/SingSongCard'
import { SingEditDialog } from '@/widgets/singList/SingEditDialog'

export function SingListPage() {
  const songsQuery = useAsync(() => SingService.list(), [])
  const sheetsQuery = useAsync(() => SingService.sheetsWithVocals(), [])
  const metasQuery = useAsync(async () => SingService.metas((await SingService.list()).map((s) => singKey('song', s.id))), [])
  const [deleting, setDeleting] = useState<SingSong | null>(null)
  const [editing, setEditing] = useState<SingSong | null>(null)

  const songs = songsQuery.data ?? []
  const sheets = sheetsQuery.data ?? []
  const refresh = () => {
    songsQuery.reload()
    sheetsQuery.reload()
  }

  return (
    <div className="space-y-12">
      <header>
        <div className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
          Sing along
        </div>
        <h1 className="mt-2 flex items-center gap-3 text-4xl font-semibold">
          <Mic className="h-9 w-9 text-amber" aria-hidden /> 跟唱
        </h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          跟着原曲唱，实时看自己的音高和原唱差多少，唱完每句都有音准报告。只有原曲也可以：导入时点「自动分轨」分出人声和伴奏；已经用
          UVR 分好的人声和伴奏轨也可以直接导入。音频只保存在这台电脑里。
        </p>
      </header>

      <SingImportPanel />

      <section aria-label="我的跟唱歌曲" className="space-y-6">
        <h2 className="text-2xl font-semibold">我的跟唱歌曲</h2>

        {songsQuery.error && (
          <p role="alert" className="text-sm text-destructive">
            读取跟唱歌曲失败：{songsQuery.error}
          </p>
        )}

        {songsQuery.data && songs.length === 0 && (
          <div className="rounded-3xl border border-dashed border-border/80 bg-card/60 p-10 text-center">
            <h3 className="text-xl font-semibold">还没有跟唱歌曲</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              在上面选择人声轨和伴奏，添加后会出现在这里。
            </p>
          </div>
        )}

        {songs.length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {songs.map((s) => (
              <SingSongCard key={s.id} song={s} onDelete={setDeleting} onEdit={setEditing} scored={Object.keys(metasQuery.data?.[singKey('song', s.id)]?.phraseBests ?? {}).length} />
            ))}
          </div>
        )}
      </section>

      {sheets.length > 0 && (
        <section aria-label="来自我的谱子" className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold">来自我的谱子</h2>
            <p className="text-sm text-muted-foreground">
              在谱子的「原曲伴奏」里附上人声轨的谱子会出现在这里。
            </p>
          </div>
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {sheets.map((s) => (
              <li
                key={s.id}
                className="surface-gradient flex items-center gap-3 rounded-2xl border border-border/80 bg-card p-5"
              >
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-display text-lg font-semibold">{s.title}</h3>
                  {s.artist?.trim() && (
                    <p className="truncate text-sm text-muted-foreground">{s.artist}</p>
                  )}
                </div>
                <Button asChild size="sm">
                  <Link to={`/sing/sheet/${s.id}`}>开始跟唱</Link>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除「{deleting?.title}」？</DialogTitle>
            <DialogDescription>音频也会一起删除，删除后无法恢复。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!deleting) return
                await SingService.remove(deleting.id)
                setDeleting(null)
                toast({ title: '已删除', variant: 'success' })
                refresh()
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SingEditDialog song={editing} onClose={() => setEditing(null)} onSaved={refresh} />
    </div>
  )
}
