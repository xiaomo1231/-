import { useEffect, useState } from 'react'
import type { SingSong } from '@/entities/types'
import { SingService } from '@/services/singService'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/Dialog'

/** Rename a 跟唱 song and set its singer. */
export function SingEditDialog({ song, onClose, onSaved }: { song: SingSong | null; onClose: () => void; onSaved: (s: SingSong) => void }) {
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')

  useEffect(() => {
    if (!song) return
    setTitle(song.title)
    setArtist(song.artist ?? '')
  }, [song])

  const save = async () => {
    if (!song) return
    const next = await SingService.update(song.id, { title: title.trim().slice(0, 60) || song.title, artist: artist.trim().slice(0, 40) })
    if (next) onSaved(next)
    onClose()
  }

  return (
    <Dialog open={song !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑歌曲信息</DialogTitle>
          <DialogDescription>改个好认的名字，方便在列表里找到。</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="sing-edit-title">歌名</Label>
            <Input id="sing-edit-title" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sing-edit-artist">演唱者</Label>
            <Input id="sing-edit-artist" value={artist} maxLength={40} placeholder="可不填" onChange={(e) => setArtist(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button type="submit">保存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
