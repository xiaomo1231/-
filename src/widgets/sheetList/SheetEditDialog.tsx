import { useState, type FormEvent } from 'react'
import type { SongSheet } from '@/entities/types'
import { ImportError, SongService } from '@/services/songService'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/Dialog'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { toast } from '@/features/toast/toastStore'
import { parseTags } from './sheetFields'

interface SheetEditDialogProps {
  sheet: SongSheet | null
  artists: string[]
  onClose: () => void
  onSaved: () => void
}

export function SheetEditDialog({ sheet, artists, onClose, onSaved }: SheetEditDialogProps) {
  return (
    <Dialog open={sheet !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {sheet && <EditForm key={sheet.id} sheet={sheet} artists={artists} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  )
}

function EditForm({ sheet, artists, onClose, onSaved }: Omit<SheetEditDialogProps, 'sheet'> & { sheet: SongSheet }) {
  const [title, setTitle] = useState(sheet.title)
  const [artist, setArtist] = useState(sheet.artist ?? '')
  const [version, setVersion] = useState(sheet.versionLabel ?? '')
  const [tags, setTags] = useState((sheet.tags ?? []).join('，'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listId = `sheet-edit-artists-${sheet.id}`

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await SongService.update(sheet.id, { title, artist, versionLabel: version, tags: parseTags(tags) })
      toast({ title: '已保存', variant: 'success' })
      onSaved()
    } catch (err) {
      setError(err instanceof ImportError ? err.message : `保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>编辑谱子</DialogTitle>
        <DialogDescription>这些信息只用来显示和分组，不会改动原文件。</DialogDescription>
      </DialogHeader>
      <div className="space-y-1">
        <label htmlFor={`${listId}-title`} className="text-xs text-muted-foreground">
          名称
        </label>
        <Input id={`${listId}-title`} value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${listId}-artist`} className="text-xs text-muted-foreground">
          演唱者
        </label>
        <Input id={`${listId}-artist`} list={listId} value={artist} maxLength={40} placeholder="例如：周杰伦（可不填）" onChange={(e) => setArtist(e.target.value)} />
        <datalist id={listId}>
          {artists.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${listId}-version`} className="text-xs text-muted-foreground">
          版本名（可选）
        </label>
        <Input id={`${listId}-version`} value={version} maxLength={30} placeholder="例如：原版、简化版、某某制谱" onChange={(e) => setVersion(e.target.value)} />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${listId}-tags`} className="text-xs text-muted-foreground">
          标签（用逗号分隔，可选）
        </label>
        <Input id={`${listId}-tags`} value={tags} onChange={(e) => setTags(e.target.value)} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button type="submit" disabled={saving}>
          保存
        </Button>
      </DialogFooter>
    </form>
  )
}
