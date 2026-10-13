import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderPlus, Loader2, Search, ShieldCheck } from 'lucide-react'
import type { LibrarySong } from '@/entities/types'
import { groupSongs, matchesSearch, useLibrary } from '@/features/library/useLibrary'
import { LibraryService } from '@/services/libraryService'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/Dialog'

/**
 * Pick a song from 歌曲库: grouped by singer, searchable; asks for folder
 * access when needed and hands back the song with its file.
 */
export function LibraryPicker({ open, onClose, onPick, title = '从歌曲库选择' }: { open: boolean; onClose: () => void; onPick: (song: LibrarySong, file: File) => void; title?: string }) {
  const lib = useLibrary()
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const groups = useMemo(() => groupSongs(lib.songs.filter((s) => matchesSearch(s, query))), [lib.songs, query])
  const locked = lib.folders.filter((f) => lib.access[f.id] !== 'granted')

  const pick = async (s: LibrarySong) => {
    setLoading(s.id)
    setError(null)
    try {
      const folder = lib.folders.find((f) => f.id === s.folderId)
      if (folder && lib.access[folder.id] !== 'granted' && (await lib.allow(folder)) !== 'granted') throw new Error('浏览器没有允许读取这个文件夹。')
      onPick(s, await LibraryService.file(s))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>只读取你电脑上的文件，不会上传。</DialogDescription>
        </DialogHeader>
        {!LibraryService.supported() ? (
          <p className="text-sm text-muted-foreground">这个浏览器不支持读取电脑上的文件夹，请用电脑上的 Chrome 或 Edge。</p>
        ) : lib.loaded && lib.folders.length === 0 ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">歌曲库还是空的。先选一个放歌的文件夹：</p>
            <Button onClick={() => void lib.addFolder()}>
              <FolderPlus /> 添加文件夹
            </Button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-col gap-3">
            {locked.map((f) => (
              <div key={f.id} className="flex items-center gap-2 rounded-xl border border-amber/50 bg-amber-soft/20 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">需要允许读取「{f.name}」</span>
                <Button size="sm" onClick={() => void lib.allow(f)}>
                  <ShieldCheck /> 允许访问
                </Button>
              </div>
            ))}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索歌名、演唱者" className="pl-8" aria-label="搜索歌曲" autoFocus />
            </div>
            <div className="max-h-[50vh] space-y-3 overflow-auto pr-1">
              {groups.map((g) => (
                <div key={g.artist || '~'}>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">{g.artist || '未知演唱者'}</div>
                  <ul className="space-y-1">
                    {g.titles.flatMap((t) =>
                      t.versions.map((s, i) => (
                        <li key={s.id}>
                          <button type="button" onClick={() => void pick(s)} disabled={loading !== null} className="focus-ring flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-60">
                            {loading === s.id && <Loader2 className="h-4 w-4 animate-spin" />}
                            <span className="truncate">{s.title}</span>
                            {t.versions.length > 1 && <span className="text-xs text-muted-foreground">版本 {i + 1}</span>}
                            <span className="ml-auto max-w-[45%] truncate text-xs text-muted-foreground">{s.fileName}</span>
                          </button>
                        </li>
                      )),
                    )}
                  </ul>
                </div>
              ))}
              {lib.loaded && groups.length === 0 && <p className="text-sm text-muted-foreground">没有找到。可以到 <Link to="/library" className="text-cyan hover:underline">歌曲库</Link> 重新扫描。</p>}
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
