import { useState } from 'react'
import { History, Play, RotateCcw, Square } from 'lucide-react'
import * as engine from '@/audio/engine'
import type { Composition, CompositionVersion } from '@/entities/types'
import { CompositionService } from '@/services/courseService'
import { useAsync } from '@/shared/lib/useAsync'
import { toast } from '@/features/toast/toastStore'
import { Button } from '@/shared/ui/Button'
import { formatDateTime } from '@/shared/lib/format'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/Dialog'


/** Version history of a song: replay any saved version, or make it current again. */
export function VersionHistoryButton({ composition, onRestored }: { composition: Composition; onRestored?: (c: Composition) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="icon" variant="ghost" onClick={() => setOpen(true)} aria-label="版本历史" title="版本历史">
        <History />
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) engine.stopArrangement() }}>
        <DialogContent className="max-w-lg">
          {open && (
            <VersionList
              composition={composition}
              onRestored={(c) => {
                setOpen(false)
                onRestored?.(c)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function VersionList({ composition, onRestored }: { composition: Composition; onRestored: (c: Composition) => void }) {
  const { data } = useAsync(() => CompositionService.versions(composition.id), [composition.id])
  const [playing, setPlaying] = useState<string | null>(null)

  const play = async (v: CompositionVersion) => {
    await engine.ensureAudio()
    engine.stopArrangement()
    if (playing === v.id) {
      setPlaying(null)
      return
    }
    setPlaying(v.id)
    const { endAt } = await engine.playScore(v.score)
    engine.onAudioTime(endAt, () => setPlaying((p) => (p === v.id ? null : p)))
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>「{composition.title}」的版本</DialogTitle>
        <DialogDescription>每次保存都会留下一个版本（最多保留 40 个）。恢复旧版本会另存为最新版本，不会丢失任何一版。</DialogDescription>
      </DialogHeader>
      <ol className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
        {data?.map((v, i) => (
          <li key={v.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-2 text-sm">
            <div>
              <div className="num">
                {formatDateTime(v.createdAt)} {i === 0 && <span className="ml-1 text-xs text-amber">当前</span>}
              </div>
              <div className="text-xs text-muted-foreground">
                {v.score.bars} 小节 · {v.score.melody.length} 个音 · {v.score.chords.length} 个和弦{v.note ? ` · ${v.note}` : ''}
              </div>
            </div>
            <div className="flex gap-1">
              <Button size="icon" variant="outline" onClick={() => void play(v)} aria-label={playing === v.id ? '停止' : `播放 ${formatDateTime(v.createdAt)} 的版本`}>
                {playing === v.id ? <Square /> : <Play />}
              </Button>
              {i > 0 && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`恢复 ${formatDateTime(v.createdAt)} 的版本`}
                  onClick={async () => {
                    engine.stopArrangement()
                    const c = await CompositionService.restore(v.id)
                    if (c) {
                      toast({ title: '已恢复这个版本', description: '它现在是最新版本，之前的版本都还在。', variant: 'success' })
                      onRestored(c)
                    }
                  }}
                >
                  <RotateCcw />
                </Button>
              )}
            </div>
          </li>
        ))}
        {data?.length === 0 && <li className="text-sm text-muted-foreground">这个作品是在版本历史功能上线前保存的，再保存一次就会开始记录。</li>}
      </ol>
    </>
  )
}
