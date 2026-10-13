import { useRef, useState, type DragEvent } from 'react'
import { FileUp, Loader2, Save, Wand2 } from 'lucide-react'
import type { SongSheet } from '@/entities/types'
import { SongService, ImportError, type ImportPreview } from '@/services/songService'
import { STRUM_PATTERNS } from '@/guitar/strum'
import { normalizeTitle } from '@/import/gpImport'
import { toast } from '@/features/toast/toastStore'
import { ScoreNotation } from '@/widgets/notation/ScoreNotation'
import { LeadTab } from '@/widgets/guitar/LeadTab'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { cn } from '@/shared/lib/utils'
import { slotSymbol } from '@/music/score'
import { INSTRUMENT_ZH, parseTags } from './sheetFields'

const ACCEPT = '.gp,.gp3,.gp4,.gp5,.gpx,.mid,.midi,.musicxml,.xml,.mxl,.txt'
const GP_FILE = /\.(gp3|gp4|gp5|gpx|gp)$/i
const GP_FIRST_TIME = '第一次读取 Guitar Pro 文件需要加载乐谱组件…'

interface SheetImportPanelProps {
  /** All of the student's sheets, to spot a version of a song already in the list. */
  sheets: SongSheet[]
  artists: string[]
  onSaved: (id: string) => void
}

export function SheetImportPanel({ sheets, artists, onSaved }: SheetImportPanelProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [version, setVersion] = useState('')
  const [tags, setTags] = useState('')
  const [pattern, setPattern] = useState('pop')
  const [busy, setBusy] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const show = (p: ImportPreview) => {
    setPreview(p)
    setTitle(p.title)
    setArtist(p.artist ?? '')
    setVersion('')
    setTags('')
    setError(null)
  }
  const fail = (e: unknown) => {
    setPreview(null)
    setError(e instanceof ImportError ? e.message : `读取失败：${e instanceof Error ? e.message : String(e)}`)
  }

  const importFile = async (f: File) => {
    setBusy(GP_FILE.test(f.name) ? GP_FIRST_TIME : '正在读取文件…')
    try {
      show(await SongService.importFile(f))
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f && !busy) void importFile(f)
  }

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (!dragging) setDragging(true)
  }

  const save = async () => {
    if (!preview) return
    setSaving(true)
    setError(null)
    try {
      const s = await SongService.save(preview, title, {
        artist,
        versionLabel: version,
        tags: parseTags(tags),
        ...(preview.score ? { pattern } : {}),
      })
      toast({ title: '已存进“我的谱子”', variant: 'success' })
      setPreview(null)
      setText('')
      onSaved(s.id)
    } catch (err) {
      setError(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const tKey = normalizeTitle(title)
  const aKey = normalizeTitle(artist)
  const duplicate = preview && tKey ? sheets.find((s) => normalizeTitle(s.title) === tKey && normalizeTitle(s.artist ?? '') === aKey) : undefined

  return (
    <section className="rounded-3xl border border-border/80 bg-card p-6 surface-gradient" aria-label="导入谱子">
      <h2 className="text-xl font-semibold">导入谱子</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        支持 Guitar Pro（.gp3 / .gp4 / .gp5 / .gpx / .gp）、MusicXML（.musicxml / .xml / .mxl）和 MIDI（.mid），也可以直接粘贴和弦谱（“| C | G | Am | F |”或“[C]歌词”）或六线谱（连续 6 行）。
      </p>

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <div
            onDragOver={onDragOver}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn('flex flex-col items-start gap-3 rounded-2xl border-2 border-dashed p-4 transition-colors', dragging ? 'border-cyan bg-cyan/10' : 'border-border/70')}
          >
            <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={busy !== null}>
              {busy ? <Loader2 className="animate-spin" /> : <FileUp />} 选择文件
            </Button>
            <p className="text-xs text-muted-foreground">也可以把文件直接拖到这里。</p>
            {busy && (
              <p role="status" className="text-sm text-muted-foreground">
                {busy}
              </p>
            )}
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              className="hidden"
              aria-label="选择乐谱文件"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void importFile(f)
              }}
            />
          </div>
        </div>
        <div className="space-y-2">
          <label htmlFor="paste" className="text-sm font-medium">
            或者粘贴文本
          </label>
          <textarea
            id="paste"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder={'| C | G | Am | F |\n| C | G | F | C |'}
            className="focus-ring w-full rounded-xl border border-input bg-background px-3 py-2 font-mono text-sm"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              try {
                show(SongService.importText(text))
              } catch (err) {
                fail(err)
              }
            }}
          >
            <Wand2 /> 识别
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}

      {preview && (
        <div className="mt-6 space-y-4 rounded-2xl border border-cyan/30 bg-background/40 p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-1">
              <label htmlFor="sheet-title" className="text-xs text-muted-foreground">
                名称
              </label>
              <Input id="sheet-title" value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label htmlFor="sheet-artist" className="text-xs text-muted-foreground">
                演唱者
              </label>
              <Input id="sheet-artist" list="sheet-import-artists" value={artist} maxLength={40} placeholder="可不填" onChange={(e) => setArtist(e.target.value)} />
              <datalist id="sheet-import-artists">
                {artists.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1">
              <label htmlFor="sheet-version" className="text-xs text-muted-foreground">
                版本名（可选）
              </label>
              <Input id="sheet-version" value={version} maxLength={30} placeholder="例如：原版、简化版、某某制谱" onChange={(e) => setVersion(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label htmlFor="sheet-tags" className="text-xs text-muted-foreground">
                标签（用逗号分隔，可选）
              </label>
              <Input id="sheet-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
            </div>
            {preview.rechoose && preview.choices && preview.choices.length > 1 && (
              <div className="space-y-1">
                <label htmlFor="sheet-part" className="text-xs text-muted-foreground">
                  {preview.source === 'midi' ? '旋律音轨' : '声部'}
                </label>
                <select
                  id="sheet-part"
                  value={preview.chosen}
                  onChange={(e) => setPreview(preview.rechoose!(e.target.value))}
                  className="focus-ring h-9 w-full rounded-xl border border-border bg-background px-3 text-sm"
                >
                  {preview.choices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {preview.score && (
              <div className="space-y-1">
                <label htmlFor="sheet-pattern" className="text-xs text-muted-foreground">
                  扫弦节奏型
                </label>
                <select id="sheet-pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} className="focus-ring h-9 w-full rounded-xl border border-border bg-background px-3 text-sm">
                  {STRUM_PATTERNS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {duplicate && (
            <p className="rounded-xl border border-amber/40 bg-amber-soft/30 px-3 py-2 text-sm">
              已有同名谱子「{duplicate.title}」，保存后会作为它的另一个版本，在卡片上用下拉框切换。
            </p>
          )}

          <div className="flex justify-end">
            <Button onClick={save} disabled={saving}>
              <Save /> 保存
            </Button>
          </div>

          {preview.tracks && preview.tracks.length > 0 && (
            <p className="text-sm text-muted-foreground">
              音轨：{preview.tracks.map((t) => `${t.name || '未命名'} · ${INSTRUMENT_ZH[t.instrument]}`).join('、')}
              {preview.bars ? ` · ${preview.bars} 小节` : ''}
            </p>
          )}
          {preview.tabber && <p className="text-sm text-muted-foreground">制谱：{preview.tabber}</p>}
          {preview.warnings.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {preview.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {preview.score && (
            <p className="text-sm text-muted-foreground">
              {preview.score.bars} 小节 · {preview.score.melody.length} 个音 · {preview.score.chords.length} 个和弦 · {preview.score.bpm} BPM
            </p>
          )}
          {preview.score && preview.score.melody.length > 0 && (
            <ScoreNotation score={{ ...preview.score, bars: Math.min(8, preview.score.bars), melody: preview.score.melody.filter((n) => n.start < 32), chords: preview.score.chords.filter((c) => c.start < 32) }} chordLabels="symbol" />
          )}
          {preview.tab && <LeadTab notes={preview.tab.slice(0, 32)} />}
          {preview.score && preview.score.melody.length === 0 && preview.score.chords.length > 0 && (
            <ol className="grid grid-cols-8 gap-1.5" aria-label="和弦预览">
              {Array.from({ length: Math.min(32, preview.score.bars) }, (_, b) => (
                <li key={b} className="rounded-lg border border-border/60 px-2 py-1.5 text-center text-sm">
                  <span className="num block text-[10px] text-muted-foreground">{b + 1}</span>
                  {preview.score!.chords
                    .filter((c) => Math.floor(c.start / 4) === b)
                    .map((c) => slotSymbol(preview.score!, c))
                    .join(' ') || '—'}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  )
}
