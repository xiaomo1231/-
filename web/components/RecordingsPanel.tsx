import { useEffect, useRef, useState } from 'react'
import { api, errorText, recordingFileUrl, type RecordingInfo } from '../lib/api'
import { buttonClass, cx, PANEL } from '../lib/classes'
import { useMe } from '../lib/session'
import { Notice } from './ui'

const MAX_BYTES = 300 * 1024 * 1024
const LABEL_MAX = 60
const ACCEPT = 'audio/*,.mp3,.m4a,.wav,.ogg,.webm,.flac'

/** 「10 月 19 日排练」 as the default label. */
function defaultLabel(): string {
  const d = new Date()
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日排练`
}

function fmtSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Rehearsal recordings of one band song: anyone can upload and play, the uploader or an admin can delete. */
export function RecordingsPanel({
  songId,
  members,
}: {
  songId: string
  members: Array<{ id: string; displayName: string }>
}) {
  const me = useMe()
  const [items, setItems] = useState<RecordingInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [label, setLabel] = useState(defaultLabel)
  const [file, setFile] = useState<File | null>(null)
  const [fileKey, setFileKey] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const busy = uploading || busyId !== null

  useEffect(() => {
    const ctrl = new AbortController()
    setItems(null)
    setError(null)
    api
      .recordings(songId, ctrl.signal)
      .then((list) => {
        if (!ctrl.signal.aborted) setItems(list)
      })
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) setError(errorText(err))
      })
    return () => ctrl.abort()
  }, [songId])

  const nameOf = (uploadedBy: string) =>
    members.find((m) => m.id === uploadedBy)?.displayName ?? '乐队成员'

  const canDelete = (r: RecordingInfo) =>
    me !== null && (me.role === 'admin' || r.uploadedBy === me.id)

  const onPick = (picked: File | null) => {
    setNotice(null)
    if (picked && picked.size > MAX_BYTES) {
      setFile(null)
      setNotice(`「${picked.name}」超过 300 MB，无法上传。`)
      return
    }
    setFile(picked)
  }

  const upload = () => {
    if (!file || busy) return
    setUploading(true)
    setNotice(null)
    api
      .uploadRecording({ songId, label: label.trim() || defaultLabel(), name: file.name }, file)
      .then((list) => {
        setItems(list)
        setFile(null)
        setFileKey((k) => k + 1)
        if (inputRef.current) inputRef.current.value = ''
      })
      .catch((err: unknown) => setNotice(errorText(err)))
      .finally(() => setUploading(false))
  }

  const remove = (r: RecordingInfo) => {
    if (busy) return
    if (!window.confirm(`删除「${r.label}」？删除后不能恢复。`)) return
    setBusyId(r.id)
    setNotice(null)
    api
      .removeRecording(r.id)
      .then((list) => setItems(list))
      .catch((err: unknown) => setNotice(errorText(err)))
      .finally(() => setBusyId(null))
  }

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h3 className="m-0 text-base font-semibold">
          排练录音
          {items && items.length > 0 && (
            <span className="mono ml-2 text-sm font-normal text-muted-foreground">
              {items.length}
            </span>
          )}
        </h3>
        <p className="m-0 text-xs leading-relaxed text-muted-foreground">
          排练时用手机或录音笔录下来，上传到这里，大家都能回放。
        </p>
      </div>

      {/* uploader */}
      <div className={cx(PANEL, 'space-y-3 p-4')}>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">录音名称</span>
          <input
            type="text"
            value={label}
            maxLength={LABEL_MAX}
            disabled={uploading}
            onChange={(e) => setLabel(e.target.value)}
            className="h-11 w-full rounded-lg border border-border bg-transparent px-3 text-sm text-foreground focus:border-primary"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">录音文件</span>
          <input
            key={fileKey}
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            disabled={uploading}
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-border file:bg-transparent file:px-3 file:text-sm file:text-foreground"
          />
        </label>
        {file && (
          <p className="m-0 break-all text-xs text-muted-foreground">
            {file.name} · {fmtSize(file.size)}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!file || busy}
            onClick={upload}
            className={buttonClass('primary')}
          >
            {uploading ? '正在上传…' : '上传录音'}
          </button>
        </div>
        {notice && <Notice tone="error">{notice}</Notice>}
        <p className="m-0 text-xs leading-relaxed text-muted-foreground">
          支持 MP3、M4A、WAV、OGG、WebM、FLAC，单个文件最大 300 MB。
        </p>
      </div>

      {/* list */}
      {!items && !error && <p className="m-0 text-sm text-muted-foreground">正在读取…</p>}
      {error && <Notice tone="error">{error}</Notice>}
      {items && items.length === 0 && <Notice>还没有录音。</Notice>}

      {items && items.length > 0 && (
        <ol className="m-0 list-none space-y-4 p-0">
          {items.map((r) => {
            const url = recordingFileUrl(r.id)
            return (
              <li key={r.id} className={cx(PANEL, 'space-y-3 p-4')}>
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="m-0 break-words text-sm font-medium">{r.label}</p>
                    <p className="m-0 break-words text-xs text-muted-foreground">
                      {nameOf(r.uploadedBy)} · {new Date(r.uploadedAt).toLocaleDateString('zh-CN')}{' '}
                      · {fmtSize(r.size)}
                    </p>
                  </div>
                  <div className="flex items-center">
                    <a
                      href={url}
                      download={r.fileName}
                      className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      下载
                    </a>
                    {canDelete(r) && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => remove(r)}
                        className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-destructive transition-colors hover:underline disabled:opacity-40"
                      >
                        {busyId === r.id ? '删除中…' : '删除'}
                      </button>
                    )}
                  </div>
                </div>
                <audio controls preload="none" src={url} className="block w-full">
                  你的浏览器不支持播放录音。
                </audio>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
