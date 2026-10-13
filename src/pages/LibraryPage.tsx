import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, FolderOpen, FolderPlus, Loader2, Mic, Pencil, Play, RefreshCw, Search, ShieldCheck, Square, Trash2, Wand2 } from 'lucide-react'
import type { LibrarySong } from '@/entities/types'
import { useLibrary, groupSongs, matchesSearch } from '@/features/library/useLibrary'
import { LibraryService } from '@/services/libraryService'
import { tidyFileName } from '@/songs/libraryNames'
import { toast } from '@/features/toast/toastStore'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/Dialog'
import { cn } from '@/shared/lib/utils'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * 歌曲库: songs in folders the student chose on this computer, with tidy
 * names; new files show up by themselves while the page is open. Nothing is
 * downloaded or uploaded.
 */
export function LibraryPage() {
  const navigate = useNavigate()
  const lib = useLibrary({
    watch: true,
    onNew: (r, f) => toast({ title: f.kind === 'lyrics' ? `「${f.name}」里新增 ${r.added} 个歌词文件` : `「${f.name}」里新增 ${r.added} 首歌`, variant: 'info' }),
  })
  const [query, setQuery] = useState('')
  const [onlyReview, setOnlyReview] = useState(false)
  const [editing, setEditing] = useState<LibrarySong | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [batchArtist, setBatchArtist] = useState('')
  const [playing, setPlaying] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const supported = LibraryService.supported()

  const visible = useMemo(() => lib.songs.filter((s) => matchesSearch(s, query) && (!onlyReview || s.needsReview)), [lib.songs, query, onlyReview])
  const groups = useMemo(() => groupSongs(visible), [visible])
  const reviewCount = lib.songs.filter((s) => s.needsReview).length

  useEffect(
    () => () => {
      audio.current?.pause()
      if (audio.current?.src) URL.revokeObjectURL(audio.current.src)
    },
    [],
  )

  const play = async (s: LibrarySong) => {
    if (playing === s.id) {
      audio.current?.pause()
      setPlaying(null)
      return
    }
    try {
      const file = await LibraryService.file(s)
      audio.current?.pause()
      if (audio.current?.src) URL.revokeObjectURL(audio.current.src)
      const el = new Audio(URL.createObjectURL(file))
      el.onended = () => setPlaying(null)
      audio.current = el
      await el.play()
      setPlaying(s.id)
    } catch (e) {
      toast({ title: '放不了这首歌', description: errText(e), variant: 'error' })
    }
  }

  const writeBack = async (s: LibrarySong) => {
    const name = tidyFileName(s, s.fileName)
    if (name === s.fileName) {
      toast({ title: '文件名已经是这个样子了', variant: 'info' })
      return
    }
    if (!window.confirm(`把硬盘上的文件改名？\n\n${s.fileName}\n→ ${name}\n\n浏览器会再问一次是否允许修改这个文件夹。`)) return
    try {
      const next = await LibraryService.renameOnDisk(s)
      lib.replaceSong(s.id, next)
      toast({ title: '文件名已改好', variant: 'success' })
    } catch (e) {
      toast({ title: '没能改文件名', description: errText(e), variant: 'error' })
    }
  }

  const applyBatch = async () => {
    const artist = batchArtist.trim()
    if (!artist || !picked.size) return
    for (const id of picked) await lib.rename(id, { artist })
    setPicked(new Set())
    setBatchArtist('')
    toast({ title: `已把 ${picked.size} 首歌的演唱者设为「${artist}」`, variant: 'success' })
  }

  const toggle = (id: string) => setPicked((p) => {
    const n = new Set(p)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-semibold">歌曲库</h1>
          <p className="mt-1 text-sm text-muted-foreground">列出你选的文件夹里已有的歌，并整理歌名。网站只读取这些文件，不会下载或上传任何歌曲。</p>
        </div>
        {supported && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void lib.addFolder('lyrics').catch((e) => toast({ title: '没能添加歌词文件夹', description: errText(e), variant: 'error' }))}>
              <FileText /> 添加歌词文件夹
            </Button>
            <Button onClick={() => void lib.addFolder().catch((e) => toast({ title: '没能添加文件夹', description: errText(e), variant: 'error' }))}>
              <FolderPlus /> 添加文件夹
            </Button>
          </div>
        )}
      </header>

      {!supported && (
        <p className="rounded-2xl border border-amber/50 bg-amber-soft/20 p-4 text-sm">这个浏览器不支持读取电脑上的文件夹。请用电脑上的 Chrome 或 Edge 打开。</p>
      )}

      {lib.folders.length > 0 && (
        <section className="space-y-2 rounded-3xl border border-border/80 bg-card p-4" aria-label="文件夹">
          {lib.folders.map((f) => {
            const a = lib.access[f.id]
            const lyrics = f.kind === 'lyrics'
            const count = lyrics ? (f.lyricFiles?.length ?? 0) : lib.songs.filter((s) => s.folderId === f.id).length
            return (
              <div key={f.id} className="flex flex-wrap items-center gap-2 text-sm">
                {lyrics ? <FileText className="h-4 w-4 text-amber" aria-hidden /> : <FolderOpen className="h-4 w-4 text-cyan" aria-hidden />}
                <span className="font-medium">{f.name}</span>
                {lyrics && <span className="rounded-full bg-amber-soft/40 px-2 py-0.5 text-[11px]">歌词</span>}
                <span className="text-xs text-muted-foreground">
                  {lyrics ? `${count} 个歌词文件${a === 'granted' ? ' · 跟唱时自动配上' : ''}` : `${count} 首${a === 'granted' ? ' · 打开时会自动发现新歌' : ''}`}
                </span>
                <span className="ml-auto flex flex-wrap gap-1">
                  {a !== 'granted' ? (
                    <Button size="sm" onClick={() => void lib.allow(f)}>
                      <ShieldCheck /> 允许访问
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => void lib.scan(f)} disabled={lib.scanning !== null}>
                      {lib.scanning === f.id ? <Loader2 className="animate-spin" /> : <RefreshCw />} 重新扫描
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => window.confirm(`从歌曲库移除「${f.name}」？（只是不再列出，硬盘上的文件不会动。）`) && void lib.removeFolder(f.id)}>
                    <Trash2 /> 移除
                  </Button>
                </span>
              </div>
            )
          })}
          {Object.values(lib.access).some((a) => a !== 'granted') && (
            <p className="text-xs text-muted-foreground">浏览器每次重新打开后，需要点一下「允许访问」才能读文件夹，这是浏览器的规定。</p>
          )}
          {!lib.folders.some((f) => f.kind === 'lyrics') && (
            <p className="text-xs text-muted-foreground">
              有自己下载的歌词（.lrc / .srt / .ass，例如用 LDDC 下的）？点「添加歌词文件夹」选放歌词的文件夹，跟唱时会按歌名和演唱者自动配上。网站不会联网找歌词。
            </p>
          )}
        </section>
      )}

      {supported && lib.loaded && lib.folders.length === 0 && (
        <section className="rounded-3xl border border-dashed border-border/80 p-8 text-center">
          <FolderOpen className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden />
          <p className="mt-3 text-sm text-muted-foreground">选一个放歌的文件夹（比如浏览器的下载文件夹）。以后放进这个文件夹的歌会自动出现在这里。</p>
        </section>
      )}

      {lib.songs.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[14rem] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索歌名、演唱者、文件名" className="pl-8" aria-label="搜索歌曲" />
            </div>
            <div className="flex rounded-xl border border-border/80 p-0.5 text-xs" role="radiogroup" aria-label="筛选">
              {[false, true].map((v) => (
                <button key={String(v)} type="button" role="radio" aria-checked={onlyReview === v} onClick={() => setOnlyReview(v)} className={cn('focus-ring rounded-lg px-3 py-1.5', onlyReview === v ? 'bg-amber-soft/50' : 'text-muted-foreground')}>
                  {v ? `待整理（${reviewCount}）` : `全部（${lib.songs.length}）`}
                </button>
              ))}
            </div>
          </div>

          {picked.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber/50 bg-amber-soft/20 px-3 py-2 text-sm">
              已选 {picked.size} 首，演唱者设为
              <Input value={batchArtist} onChange={(e) => setBatchArtist(e.target.value)} className="h-8 w-40" aria-label="批量设置演唱者" />
              <Button size="sm" onClick={() => void applyBatch()} disabled={!batchArtist.trim()}>
                设置
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
                取消选择
              </Button>
            </div>
          )}

          {groups.map((g) => (
            <div key={g.artist || '~'} className="rounded-3xl border border-border/80 bg-card p-4">
              <h2 className="mb-2 text-sm font-semibold">{g.artist || '未知演唱者'}</h2>
              <ul className="divide-y divide-border/60">
                {g.titles.map((t) => (
                  <SongRow
                    key={t.key}
                    versions={t.versions}
                    picked={picked}
                    onToggle={toggle}
                    playing={playing}
                    onPlay={(s) => void play(s)}
                    onEdit={setEditing}
                    onSing={(s) => navigate('/sing', { state: { librarySongId: s.id } })}
                    onWriteBack={LibraryService.canRenameOnDisk() ? (s) => void writeBack(s) : undefined}
                  />
                ))}
              </ul>
            </div>
          ))}
          {groups.length === 0 && <p className="text-sm text-muted-foreground">没有符合条件的歌。</p>}
        </section>
      )}

      <EditDialog song={editing} onClose={() => setEditing(null)} onSave={(p) => editing && void lib.rename(editing.id, p).then(() => setEditing(null))} />
    </div>
  )
}

function SongRow({
  versions,
  picked,
  onToggle,
  playing,
  onPlay,
  onEdit,
  onSing,
  onWriteBack,
}: {
  versions: LibrarySong[]
  picked: Set<string>
  onToggle: (id: string) => void
  playing: string | null
  onPlay: (s: LibrarySong) => void
  onEdit: (s: LibrarySong) => void
  onSing: (s: LibrarySong) => void
  onWriteBack: ((s: LibrarySong) => void) | undefined
}) {
  const [idx, setIdx] = useState(0)
  const s = versions[Math.min(idx, versions.length - 1)]!
  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <input type="checkbox" checked={picked.has(s.id)} onChange={() => onToggle(s.id)} aria-label={`选择 ${s.title}`} className="h-4 w-4 accent-[hsl(var(--amber))]" />
      <button type="button" onClick={() => onPlay(s)} aria-label={playing === s.id ? '停止试听' : '试听'} className="focus-ring rounded-full border border-border/80 p-1.5 text-muted-foreground hover:text-foreground">
        {playing === s.id ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{s.title}</span>
          {s.needsReview && <span className="rounded border border-amber/60 px-1 text-[10px] text-amber">待整理</span>}
        </div>
        <div className="truncate text-xs text-muted-foreground" title={s.path}>
          {s.fileName}
        </div>
      </div>
      {versions.length > 1 && (
        <select value={idx} onChange={(e) => setIdx(Number(e.target.value))} className="focus-ring h-8 max-w-[12rem] rounded-lg border border-border bg-background px-2 text-xs" aria-label="选择版本">
          {versions.map((v, i) => (
            <option key={v.id} value={i}>
              版本 {i + 1} · {v.fileName}
            </option>
          ))}
        </select>
      )}
      <Button size="sm" variant="ghost" onClick={() => onEdit(s)}>
        <Pencil /> 改名
      </Button>
      {onWriteBack && (
        <Button size="sm" variant="ghost" onClick={() => onWriteBack(s)} title="把硬盘上的文件名改成「歌手 - 歌名」">
          <Wand2 /> 写回文件名
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={() => onSing(s)}>
        <Mic /> 跟唱
      </Button>
    </li>
  )
}

function EditDialog({ song, onClose, onSave }: { song: LibrarySong | null; onClose: () => void; onSave: (p: { title: string; artist: string }) => void }) {
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  useEffect(() => {
    setTitle(song?.title ?? '')
    setArtist(song?.artist ?? '')
  }, [song])
  return (
    <Dialog open={song !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="overflow-hidden">
        <DialogHeader>
          <DialogTitle>改歌名</DialogTitle>
          <DialogDescription className="break-all">{song?.fileName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">歌名</span>
            <Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">演唱者</span>
            <Input value={artist} maxLength={60} onChange={(e) => setArtist(e.target.value)} />
          </label>
          <p className="text-xs text-muted-foreground">只改网站里显示的名字，重新扫描也不会被覆盖；硬盘上的文件名不变（可以用「写回文件名」）。</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => onSave({ title, artist })} disabled={!title.trim()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
