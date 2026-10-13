import { useState } from 'react'
import { Archive, Loader2, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { useSing } from '@/features/sing/useSingSession'
import { toast } from '@/features/toast/toastStore'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/Dialog'

const fmtDate = (t: number) => {
  const d = new Date(t)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * 重新开始: start this song fresh — keep the earlier takes as a draft, or
 * delete them — and the drafts kept so far (restore / delete).
 */
export function RestartDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSing()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const drafts = s.meta?.drafts ?? []
  const current = Object.values(s.takes).reduce((n, list) => n + list.length, 0)

  const run = async (label: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(label)
    try {
      await fn()
      toast({ title: done, variant: 'success' })
      onClose()
    } catch (e) {
      toast({ title: '没有成功', description: e instanceof Error ? e.message : String(e), variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const saveAndRestart = () =>
    run(
      'save',
      async () => {
        if (!(await s.saveDraftAndRestart(name))) throw new Error('现在还没有唱过的记录，不需要存草稿。')
        setName('')
      },
      '已存为草稿，可以重新开始了',
    )
  const deleteAndRestart = () => {
    if (!window.confirm(`删除这首歌现在的 ${current} 条演唱记录和评分？删除后不能恢复（草稿不受影响）。`)) return
    void run('delete', () => s.clearAllTakes(), '已清空，可以重新开始了')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && busy === null && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>重新开始</DialogTitle>
          <DialogDescription>现在有 {current} 条演唱记录。重新开始后，每一句的成绩从零算起；作品集里已经保存的翻唱不受影响。</DialogDescription>
        </DialogHeader>

        <section className="space-y-2 rounded-xl border border-border/80 p-3">
          <p className="text-sm font-medium">存为草稿后重新开始（推荐）</p>
          <p className="text-xs text-muted-foreground">之前的录音和评分会整份收进草稿，以后可以随时恢复。</p>
          <div className="flex flex-wrap gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="草稿名称（可不填，默认用日期）" className="h-9 min-w-[12rem] flex-1" aria-label="草稿名称" />
            <Button onClick={() => void saveAndRestart()} disabled={busy !== null || current === 0}>
              {busy === 'save' ? <Loader2 className="animate-spin" /> : <Archive />} 存草稿并重新开始
            </Button>
          </div>
        </section>

        <section className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/40 p-3">
          <div>
            <p className="text-sm font-medium">直接删除并重新开始</p>
            <p className="text-xs text-muted-foreground">删除现在所有的录音和评分，不能恢复。</p>
          </div>
          <Button variant="outline" className="text-destructive" onClick={deleteAndRestart} disabled={busy !== null || current === 0}>
            {busy === 'delete' ? <Loader2 className="animate-spin" /> : <Trash2 />} 删除并重新开始
          </Button>
        </section>

        <section className="space-y-2">
          <p className="text-sm font-medium">草稿（{drafts.length}）</p>
          {drafts.length === 0 ? (
            <p className="text-xs text-muted-foreground">还没有草稿。</p>
          ) : (
            <ul className="space-y-1.5">
              {drafts.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{d.name}</div>
                    <div className="num text-xs text-muted-foreground">
                      {fmtDate(d.createdAt)} · 唱过 {d.phrases} 句 · {d.takes} 条录音{d.avgBest !== undefined ? ` · 平均最好 ${Math.round(d.avgBest * 100)}` : ''}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() => void run(`restore-${d.id}`, () => s.restoreDraft(d.id), current ? '已恢复草稿（刚才的记录也自动存成了草稿）' : '已恢复草稿')}
                  >
                    {busy === `restore-${d.id}` ? <Loader2 className="animate-spin" /> : <Undo2 />} 恢复
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={busy !== null}
                    onClick={() => window.confirm(`删除草稿「${d.name}」？里面的录音会一起删除，不能恢复。`) && void run(`del-${d.id}`, () => s.deleteDraft(d.id), '草稿已删除')}
                    aria-label={`删除草稿 ${d.name}`}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {current > 0 && drafts.length > 0 && <p className="text-xs text-muted-foreground">恢复草稿时，现在的记录会先自动存成一份草稿，不会丢。</p>}
        </section>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy !== null}>
            <RotateCcw /> 关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
