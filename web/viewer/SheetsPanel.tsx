import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  api,
  errorText,
  fileUrl,
  sheetFileUrl,
  type LibraryJianpu,
  type SheetUpload,
} from '../lib/api'
import { buttonClass, cx, PANEL } from '../lib/classes'
import { hrefViewer } from '../lib/route'
import { moveSheet, removeSheet, uploadSheets, useSheets } from '../lib/sheets'
import { useMe } from '../lib/session'
import { Link } from '../components/Link'
import { Notice } from '../components/ui'

const MAX_BYTES = 20 * 1024 * 1024
const MAX_PER_SONG = 60
const DEFAULT_LABEL = '主唱简谱'
const LABEL_MAX = 40
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** Why a picked file cannot be uploaded, or null when it can. */
function checkFile(file: File): string | null {
  const ok = file.type === 'application/pdf' || IMAGE_TYPES.includes(file.type)
  if (!ok) return `「${file.name}」不是 PNG / JPEG / WebP / GIF 图片或 PDF，已跳过。`
  if (file.size > MAX_BYTES) return `「${file.name}」超过 20 MB，已跳过。`
  return null
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const ACTION =
  'inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40'

/** The library 简谱 files of the song this score belongs to (quiet while loading or on failure). */
function useLibraryJianpu(path: string): {
  items: LibraryJianpu[]
  loaded: boolean
  failed: boolean
} {
  const [state, setState] = useState<{
    path: string
    items: LibraryJianpu[] | null
    failed: boolean
  }>({ path, items: null, failed: false })
  useEffect(() => {
    const ctrl = new AbortController()
    api
      .jianpu(path, ctrl.signal)
      .then((items) => {
        if (!ctrl.signal.aborted) setState({ path, items, failed: false })
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ path, items: null, failed: true })
      })
    return () => ctrl.abort()
  }, [path])
  const current = state.path === path ? state : null
  return {
    items: current?.items ?? [],
    loaded: current !== null && (current.items !== null || current.failed),
    failed: current?.failed ?? false,
  }
}

/** 「谱库里的简谱」: the 13-简谱 PDFs in the library; embedded inline on wide screens only. */
function LibraryJianpuList({ items }: { items: LibraryJianpu[] }) {
  const [embedded, setEmbedded] = useState<string | null>(null)
  return (
    <section className="space-y-3">
      <h4 className="m-0 text-sm font-semibold">谱库里的简谱</h4>
      <ol className="m-0 list-none space-y-4 p-0">
        {items.map((j) => {
          const open = embedded === j.path
          return (
            <li key={j.path} className="space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="m-0 break-words text-sm font-medium">{j.label}</p>
                  {j.artist && (
                    <p className="m-0 break-words text-xs text-muted-foreground">{j.artist}</p>
                  )}
                </div>
                <div className="flex items-center">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setEmbedded(open ? null : j.path)}
                    className="hidden min-h-11 items-center rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:text-foreground md:inline-flex"
                  >
                    {open ? '收起' : '在这里看'}
                  </button>
                  <Link
                    href={hrefViewer({
                      path: j.path,
                      format: 'pdf',
                      title: j.title,
                      artist: j.artist,
                    })}
                    className="inline-flex min-h-11 items-center px-1.5 text-[13px] text-primary"
                  >
                    打开 →
                  </Link>
                </div>
              </div>
              {open && (
                <iframe
                  title={`${j.label} PDF`}
                  src={fileUrl(j.path)}
                  className="hidden h-[70vh] w-full rounded-lg border border-border bg-white md:block"
                />
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** The song's uploaded 简谱 / 歌词谱 (photos or PDFs), shown in page order to the whole band. */
export function SheetsPanel({ path }: { path: string }) {
  const { items, loaded, error, reload } = useSheets(path)
  const library = useLibraryJianpu(path)
  const me = useMe()
  const inputRef = useRef<HTMLInputElement>(null)
  const total = items.length + library.items.length

  const [label, setLabel] = useState(DEFAULT_LABEL)
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const busy = uploading !== null || busyId !== null

  const canDelete = (s: SheetUpload) => me !== null && (me.role === 'admin' || s.uploadedBy === me.id)

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (picked.length === 0 || busy) return
    const problems: string[] = []
    const valid: File[] = []
    for (const file of picked) {
      const problem = checkFile(file)
      if (problem) problems.push(problem)
      else valid.push(file)
    }
    setIssues(problems)
    setNotice(null)
    if (valid.length === 0) return
    if (items.length + valid.length > MAX_PER_SONG) {
      setNotice(`每首歌最多 ${MAX_PER_SONG} 个文件，现在已有 ${items.length} 个，请先删除一些。`)
      return
    }
    const name = label.trim() || DEFAULT_LABEL
    setUploading({ done: 0, total: valid.length })
    uploadSheets(path, valid, name, (done, total) => setUploading({ done, total }))
      .catch((err: unknown) => setNotice(errorText(err)))
      .finally(() => setUploading(null))
  }

  const doMove = (id: string, dir: -1 | 1) => {
    if (busy) return
    setBusyId(id)
    setNotice(null)
    moveSheet(path, id, dir)
      .catch((err: unknown) => setNotice(errorText(err)))
      .finally(() => setBusyId(null))
  }

  const doRemove = (id: string) => {
    if (busy) return
    setBusyId(id)
    setNotice(null)
    removeSheet(path, id)
      .then(() => setConfirmId(null))
      .catch((err: unknown) => setNotice(errorText(err)))
      .finally(() => setBusyId(null))
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="m-0 text-base font-semibold">
          简谱 / 歌词谱
          {loaded && total > 0 && (
            <span className="mono ml-2 text-sm font-normal text-muted-foreground">{total}</span>
          )}
        </h3>
      </div>

      {/* library 简谱 */}
      {library.loaded && library.items.length > 0 && <LibraryJianpuList items={library.items} />}
      {!library.loaded && <p className="m-0 text-xs text-muted-foreground">正在查找谱库里的简谱…</p>}
      {library.failed && (
        <p className="m-0 text-xs text-muted-foreground">谱库里的简谱暂时读不到。</p>
      )}

      {library.items.length > 0 && (
        <h4 className="m-0 text-sm font-semibold">大家上传的简谱</h4>
      )}

      {/* uploader */}
      <div className={cx(PANEL, 'space-y-3 p-4')}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1 basis-40">
            <span className="mb-1 block text-xs text-muted-foreground">标签</span>
            <input
              type="text"
              value={label}
              maxLength={LABEL_MAX}
              disabled={uploading !== null}
              onChange={(e) => setLabel(e.target.value)}
              className="h-11 w-full rounded-lg border border-border bg-transparent px-3 text-sm text-foreground focus:border-primary"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className={buttonClass('primary')}
          >
            上传
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,application/pdf"
            className="hidden"
            onChange={onPick}
          />
        </div>

        {uploading && (
          <p className="m-0 text-sm text-muted-foreground" role="status">
            正在上传 {Math.min(uploading.done + 1, uploading.total)} / {uploading.total}…
          </p>
        )}
        {issues.length > 0 && (
          <Notice tone="error">
            <ul className="m-0 list-none space-y-1 p-0">
              {issues.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </Notice>
        )}
        {notice && <Notice tone="error">{notice}</Notice>}

        <p className="m-0 text-xs leading-relaxed text-muted-foreground">
          只上传自己有权分享的谱子；文件保存在这台服务器上，不会改动谱库。
        </p>
      </div>

      {/* list */}
      {!loaded && !error && <p className="text-sm text-muted-foreground">正在读取…</p>}
      {error && (
        <div className="space-y-3">
          <Notice tone="error">{error}</Notice>
          <button type="button" onClick={reload} className={buttonClass()}>
            重试
          </button>
        </div>
      )}
      {loaded && !error && items.length === 0 && (
        <Notice>
          还没有上传的简谱。很多乐队谱没有主唱的简谱，可以拍照或上传图片 / PDF，乐队成员都能看到。
        </Notice>
      )}

      {items.length > 0 && (
        <ol className="m-0 list-none space-y-6 p-0">
          {items.map((s, i) => {
            const url = sheetFileUrl(s.id)
            const isBusy = busyId === s.id
            return (
              <li key={s.id} className="space-y-2">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="m-0 break-words text-sm font-medium">{s.label}</p>
                    <p className="mono m-0 break-all text-xs text-muted-foreground">
                      {s.fileName} · {fmtSize(s.size)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center">
                    <button
                      type="button"
                      aria-label={`上移 ${s.fileName}`}
                      disabled={busy || i === 0}
                      onClick={() => doMove(s.id, -1)}
                      className={ACTION}
                    >
                      上移
                    </button>
                    <button
                      type="button"
                      aria-label={`下移 ${s.fileName}`}
                      disabled={busy || i === items.length - 1}
                      onClick={() => doMove(s.id, 1)}
                      className={ACTION}
                    >
                      下移
                    </button>
                    {canDelete(s) &&
                      (confirmId === s.id ? (
                        <span className="flex flex-wrap items-center">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => doRemove(s.id)}
                            className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-destructive hover:underline disabled:opacity-40"
                          >
                            确认删除
                          </button>
                          <button type="button" onClick={() => setConfirmId(null)} className={ACTION}>
                            取消
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirmId(s.id)}
                          className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-destructive transition-colors hover:underline disabled:opacity-40"
                        >
                          删除
                        </button>
                      ))}
                  </div>
                </div>
                {isBusy && <p className="m-0 text-xs text-muted-foreground">处理中…</p>}

                {s.kind === 'image' ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" title="点开看大图">
                    <img
                      src={url}
                      alt={`${s.label} 第 ${i + 1} 页`}
                      loading="lazy"
                      decoding="async"
                      className="block h-auto w-full rounded-lg border border-border bg-white"
                    />
                  </a>
                ) : (
                  <div className="space-y-3">
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonClass('outline') + ' min-h-12 w-full'}
                    >
                      打开 PDF
                    </a>
                    <iframe
                      title={`${s.label} PDF`}
                      src={url}
                      className="hidden h-[70vh] w-full rounded-lg border border-border bg-white md:block"
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
