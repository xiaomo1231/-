import { useEffect, useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
import type { CoverWork } from '@/entities/types'
import { SingService } from '@/services/singService'
import { Button } from '@/shared/ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/Dialog'
import { buttonVariants } from '@/shared/ui/buttonVariants'
import { formatDateShort } from '@/shared/lib/format'

const formatDuration = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** One object URL per cover, revoked when the list changes or unmounts. */
function useCoverUrls(covers: readonly CoverWork[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    const made = covers.map((c) => [c.id, URL.createObjectURL(c.blob)] as const)
    setUrls(Object.fromEntries(made))
    return () => made.forEach(([, u]) => URL.revokeObjectURL(u))
  }, [covers])
  return urls
}

/** 作品集 → 翻唱: finished covers with playback, WAV download and delete. */
export function CoverList({ covers, onChanged }: { covers: CoverWork[]; onChanged: () => void }) {
  const urls = useCoverUrls(covers)
  const [deleting, setDeleting] = useState<CoverWork | null>(null)

  return (
    <>
      <ol className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {covers.map((c) => (
          <li key={c.id} className="rounded-2xl border border-border/80 bg-card p-5 surface-gradient">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="num text-xs text-muted-foreground">
                  {formatDateShort(c.createdAt)} · {formatDuration(c.durationMs)}
                </div>
                <div className="mt-1 truncate font-display text-lg font-semibold">{c.title}</div>
                {c.artist && <div className="text-xs text-muted-foreground">{c.artist}</div>}
              </div>
              <Button size="icon" variant="ghost" onClick={() => setDeleting(c)} aria-label={`删除翻唱「${c.title}」`}>
                <Trash2 />
              </Button>
            </div>
            {urls[c.id] && <audio controls src={urls[c.id]} className="mt-3 w-full" />}
            <div className="mt-2 flex">
              {urls[c.id] && (
                <a href={urls[c.id]} download={`${c.title}-翻唱.wav`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  <Download />
                  下载 WAV
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-muted-foreground">翻唱使用的是原曲伴奏，仅供个人练习，请勿公开发布。</p>

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除翻唱「{deleting?.title}」？</DialogTitle>
            <DialogDescription>删除后无法恢复，录音只保存在这台电脑上。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (deleting) await SingService.removeCover(deleting.id)
                setDeleting(null)
                onChanged()
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
