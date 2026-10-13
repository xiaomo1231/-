import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileMusic } from 'lucide-react'
import type { SongSheet } from '@/entities/types'
import { SongService } from '@/services/songService'
import { groupSheets, matchesSearch, type SheetSort } from '@/songs/sheetGroups'
import { useAsync } from '@/shared/lib/useAsync'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/Dialog'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { cn } from '@/shared/lib/utils'
import { toast } from '@/features/toast/toastStore'
import { SheetImportPanel } from '@/widgets/sheetList/SheetImportPanel'
import { SongCard } from '@/widgets/sheetList/SongCard'
import { SheetEditDialog } from '@/widgets/sheetList/SheetEditDialog'

const SORT_LABEL: Record<SheetSort, string> = { recent: '最近练习', title: '名称', created: '导入时间' }

const chipClass = (active: boolean) => cn('focus-ring rounded-full border px-3 py-1 text-xs', active ? 'border-amber/70 bg-amber-soft/40' : 'border-border')

export function SheetsPage() {
  const navigate = useNavigate()
  const sheetsQuery = useAsync(() => SongService.list(), [])
  const artistsQuery = useAsync(() => SongService.artists(), [])
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SheetSort>('recent')
  const [artistKey, setArtistKey] = useState<string | null>(null)
  const [editing, setEditing] = useState<SongSheet | null>(null)
  const [deleting, setDeleting] = useState<SongSheet | null>(null)

  const all = sheetsQuery.data ?? []
  const artists = artistsQuery.data ?? []
  const refresh = () => {
    sheetsQuery.reload()
    artistsQuery.reload()
  }

  const groups = groupSheets(
    all.filter((s) => matchesSearch(s, q)),
    sort,
  )
  const shown = artistKey ? groups.filter((g) => g.key === artistKey) : groups

  return (
    <div className="space-y-12">
      <header>
        <div className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">My sheets</div>
        <h1 className="mt-2 flex items-center gap-3 text-4xl font-semibold">
          <FileMusic className="h-9 w-9 text-amber" aria-hidden /> 我的谱子
        </h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">你自己导入的谱子，只保存在这台电脑里。支持 Guitar Pro、MusicXML、MIDI，也可以粘贴和弦谱或六线谱。</p>
      </header>

      <SheetImportPanel
        sheets={all}
        artists={artists}
        onSaved={(id) => {
          refresh()
          navigate(`/sheets/${id}`)
        }}
      />

      <section aria-label="我的谱子列表" className="space-y-8">
        {sheetsQuery.error && (
          <p role="alert" className="text-sm text-destructive">
            读取谱子失败：{sheetsQuery.error}
          </p>
        )}

        {sheetsQuery.data && all.length === 0 && (
          <div className="rounded-3xl border border-dashed border-border/80 bg-card/60 p-10 text-center">
            <h2 className="text-xl font-semibold">还没有自己的谱子</h2>
            <p className="mt-2 text-sm text-muted-foreground">在上面选择一个文件，或者粘贴一段和弦谱，导入后会出现在这里。</p>
          </div>
        )}

        {all.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <Input aria-label="搜索谱子" placeholder="搜索名称、演唱者、版本或标签" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
            <select aria-label="排序方式" value={sort} onChange={(e) => setSort(e.target.value as SheetSort)} className="focus-ring h-9 rounded-xl border border-border bg-background px-3 text-sm">
              {(Object.keys(SORT_LABEL) as SheetSort[]).map((s) => (
                <option key={s} value={s}>
                  {SORT_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
        )}

        {all.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="按演唱者筛选">
            <button type="button" onClick={() => setArtistKey(null)} aria-pressed={artistKey === null} className={chipClass(artistKey === null)}>
              全部
            </button>
            {groups.map((g) => (
              <button key={g.key} type="button" onClick={() => setArtistKey(g.key)} aria-pressed={artistKey === g.key} className={chipClass(artistKey === g.key)}>
                {g.artist} · {g.songs.length}
              </button>
            ))}
          </div>
        )}

        {all.length > 0 && shown.length === 0 && <p className="text-sm text-muted-foreground">没有符合条件的谱子。</p>}

        {shown.map((a, i) => (
          <section key={a.key} aria-labelledby={`artist-${i}`} className="space-y-4">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 id={`artist-${i}`} className="text-2xl font-semibold">
                {a.artist}
              </h2>
              <span className="num text-sm text-muted-foreground">{a.songs.length} 首</span>
              {!a.known && <span className="text-xs text-muted-foreground">编辑谱子可以补上演唱者</span>}
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {a.songs.map((g) => (
                <SongCard key={g.key} group={g} onEdit={setEditing} onDelete={setDeleting} />
              ))}
            </div>
          </section>
        ))}
      </section>

      <SheetEditDialog
        sheet={editing}
        artists={artists}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          refresh()
        }}
      />

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除「{deleting?.title}」的这个版本？</DialogTitle>
            <DialogDescription>原文件也会一起删除，删除后无法恢复。同一首歌的其它版本不受影响。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!deleting) return
                await SongService.remove(deleting.id)
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
    </div>
  )
}
