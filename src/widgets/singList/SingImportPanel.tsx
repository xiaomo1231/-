import { useRef, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, FileUp, Loader2, Save, Scissors, X } from 'lucide-react'
import { SeparateDialog } from '@/widgets/separation/SeparateDialog'
import { SingService, SingError, cleanSongTitle } from '@/services/singService'
import { STEM_LABEL, detectStem } from '@/songs/backingSync'
import { toast } from '@/features/toast/toastStore'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { cn } from '@/shared/lib/utils'

const ACCEPT = 'audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.webm'

/** Adds a 跟唱 song from UVR stems (a vocals track plus an instrumental or the full mix). */
export function SingImportPanel() {
  const navigate = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const sepInput = useRef<HTMLInputElement>(null)
  const [sepFile, setSepFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasVocals = files.some((f) => detectStem(f.name) === 'vocals')

  const addFiles = (list: FileList | File[]) => {
    const picked = Array.from(list)
    if (!picked.length) return
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`))
      return [...prev, ...picked.filter((f) => !seen.has(`${f.name}:${f.size}`))]
    })
    setError(null)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    if (!saving) addFiles(e.dataTransfer.files)
  }

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (!dragging) setDragging(true)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const song = await SingService.create({ title, artist, files })
      toast({ title: '已添加', variant: 'success' })
      navigate(`/sing/song/${song.id}`)
    } catch (err) {
      if (err instanceof SingError) setError(err.message)
      else setError(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-3xl border border-border/80 bg-card p-6 surface-gradient" aria-label="导入跟唱歌曲">
      <h2 className="text-xl font-semibold">添加跟唱歌曲</h2>
      <p className="mt-1 text-sm text-muted-foreground">选择 UVR 分出的人声轨和伴奏（或完整原曲）。文件名里带 vocals / instrumental 或「人声 / 伴奏」会自动认出。</p>

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="sing-title" className="text-xs text-muted-foreground">
                歌名
              </label>
              <Input id="sing-title" value={title} maxLength={60} placeholder="可不填，默认用文件名" onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label htmlFor="sing-artist" className="text-xs text-muted-foreground">
                演唱者
              </label>
              <Input id="sing-artist" value={artist} maxLength={40} placeholder="可不填" onChange={(e) => setArtist(e.target.value)} />
            </div>
          </div>

          <div
            onDragOver={onDragOver}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn('flex flex-col items-start gap-3 rounded-2xl border-2 border-dashed p-4 transition-colors', dragging ? 'border-cyan bg-cyan/10' : 'border-border/70')}
          >
            <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={saving}>
              <FileUp /> 选择文件
            </Button>
            <p className="text-xs text-muted-foreground">也可以把音频文件直接拖到这里。</p>
            <Button variant="ghost" size="sm" onClick={() => sepInput.current?.click()} disabled={saving}>
              <Scissors /> 只有原曲？自动分出人声和伴奏
            </Button>
            <input ref={sepInput} type="file" accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg" className="hidden" aria-label="选择要自动分轨的原曲" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setSepFile(f) }} />
            <SeparateDialog
              file={sepFile}
              onClose={() => setSepFile(null)}
              onDone={(out) => {
                const original = sepFile
                setSepFile(null)
                // Keep the voice and the instrumental (or the six stems when there is no instrumental).
                const wanted = out.filter((f) => ['vocals', 'instrumental'].includes(detectStem(f.name)))
                addFiles(wanted.some((f) => detectStem(f.name) === 'instrumental') ? wanted : out)
                if (!title.trim() && original) setTitle(cleanSongTitle(original.name))
              }}
            />
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              aria-label="选择音频文件"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </div>
        </div>

        <div className="space-y-3">
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有选择文件。</p>
          ) : (
            <ul className="space-y-2" aria-label="已选择的文件">
              {files.map((f) => (
                <li key={`${f.name}:${f.size}`} className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/40 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate" title={f.name}>
                    {f.name}
                  </span>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{STEM_LABEL[detectStem(f.name)]}</span>
                  <button
                    type="button"
                    onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                    disabled={saving}
                    aria-label={`移除 ${f.name}`}
                    className="focus-ring rounded-md p-1 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {files.length > 0 && !hasVocals && (
            <p role="status" className="flex items-start gap-2 text-sm text-amber">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              还没有人声轨。文件名里需要带 vocals 或「人声」，否则无法显示音高对比。
            </p>
          )}

          <div className="flex justify-end">
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />} 保存
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
