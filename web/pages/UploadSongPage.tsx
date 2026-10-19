import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, errorText, type UploadFile, type UploadSong } from '../lib/api'
import { buttonClass, cx, SELECT } from '../lib/classes'
import { useBand, reloadBand } from '../lib/band'
import { hrefCombine } from '../lib/combos'
import { formatSize } from '../lib/format'
import { HREF_BAND, hrefBandSong, hrefUpload, hrefViewer, navigate } from '../lib/route'
import { Link } from '../components/Link'
import { Notice, PageBar, Staff } from '../components/ui'

/** The instrument / part names offered for a file. */
const LABELS = ['吉他', '主音吉他', '节奏吉他', '贝斯', '鼓', '键盘', '主唱', '其他'] as const

const ACCEPT = '.gp,.gp3,.gp4,.gp5,.gpx,.musicxml,.xml,.mxl,.pdf,.png,.jpg,.jpeg,.webp'

const INPUT =
  'h-11 min-w-0 w-full rounded-lg border border-border bg-transparent px-3 text-base text-foreground focus:border-primary'

const DANGER_BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-destructive px-4 text-sm font-medium text-destructive transition-colors hover:bg-card disabled:cursor-not-allowed disabled:opacity-50'

/** A file picked but not uploaded yet. */
interface Pending {
  key: number
  file: File
  label: string
  error: string | null
}

/** A local guess of the part from the file name (the user can change it). */
function guessLabel(name: string): string {
  const n = name.toLowerCase()
  if (/贝斯|bass/.test(n)) return '贝斯'
  if (/鼓|drum/.test(n)) return '鼓'
  if (/键盘|钢琴|keys|piano/.test(n)) return '键盘'
  if (/主唱|人声|vocal|简谱/.test(n)) return '主唱'
  if (/节奏|rhythm/.test(n)) return '节奏吉他'
  if (/主音|lead|solo/.test(n)) return '主音吉他'
  if (/吉他|guitar/.test(n)) return '吉他'
  return '其他'
}

/** 上传自己的谱 / 新建歌曲: a new uploaded song, or the own files of a band song (band = its id). */
export function UploadSongPage({ id, band }: { id: string; band: string }) {
  if (id) return <UploadEditor key={id} id={id} />
  return <NewUploadForm band={band} />
}

/** The form that creates an uploaded song (optionally as the own files of a band song). */
function NewUploadForm({ band }: { band: string }) {
  const { state, error: bandError, reload } = useBand()
  const bandSong = band ? state?.songs.find((s) => s.id === band) : undefined
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [prefilled, setPrefilled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // Pre-fill the names from the band song once it is read (only the first time).
  useEffect(() => {
    if (!bandSong || prefilled) return
    setTitle(bandSong.title)
    setArtist(bandSong.artist)
    setPrefilled(true)
  }, [bandSong, prefilled])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    const t = title.trim()
    if (!t || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const song = await api.createUpload({
        title: t,
        artist: artist.trim(),
        bandSongId: band || null,
      })
      navigate(hrefUpload({ id: song.id, band: band || undefined }))
    } catch (err) {
      setNotice(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const heading = band ? '上传自己的谱' : '新建歌曲'
  const backFallback = band ? hrefBandSong(band) : HREF_BAND

  return (
    <>
      <PageBar title={heading} fallback={backFallback} back={band ? '← 排练' : '← 乐队'} />
      <Staff />

      <div className="max-w-[640px] pt-6">
        {band && state && !bandSong ? (
          <Notice tone="error">找不到这首歌，可能已从乐队里移除。</Notice>
        ) : bandError && !state ? (
          <>
            <Notice tone="error">{bandError}</Notice>
            <button
              type="button"
              onClick={reload}
              className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm hover:border-foreground"
            >
              重试
            </button>
          </>
        ) : (
          <>
            <p className="m-0 text-sm leading-relaxed text-muted-foreground">
              {band
                ? '这首歌的谱不好用？自己上传吉他、贝斯、鼓等各个声部的谱，上传的文件只保存在这台服务器上，不会放进谱库。'
                : '觉得谱库里的谱都不合适？自己上传各个乐器的谱来建一首歌：比如吉他用一个 GP，贝斯用另一个 GP，鼓用 PDF。上传的文件只保存在这台服务器上，不会放进谱库。'}
            </p>

            <form onSubmit={create} className="space-y-4 pt-6">
              <div>
                <label htmlFor="upload-title" className="label block">
                  歌名（必填）
                </label>
                <input
                  id="upload-title"
                  value={title}
                  maxLength={120}
                  required
                  autoFocus={!band}
                  onChange={(e) => setTitle(e.target.value)}
                  className={cx(INPUT, 'mt-2')}
                />
              </div>
              <div>
                <label htmlFor="upload-artist" className="label block">
                  歌手（可不填）
                </label>
                <input
                  id="upload-artist"
                  value={artist}
                  maxLength={120}
                  onChange={(e) => setArtist(e.target.value)}
                  className={cx(INPUT, 'mt-2')}
                />
              </div>

              {notice && <Notice tone="error">{notice}</Notice>}

              <button
                type="submit"
                disabled={!title.trim() || busy}
                className={buttonClass('primary')}
              >
                {busy ? '正在创建…' : '创建'}
              </button>
            </form>
          </>
        )}
      </div>
    </>
  )
}

/** The page of one uploaded song: names, its files, and its place in the band. */
function UploadEditor({ id }: { id: string }) {
  const { state: band } = useBand()
  const [song, setSong] = useState<UploadSong | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [titleDraft, setTitleDraft] = useState('')
  const [artistDraft, setArtistDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [uploadPos, setUploadPos] = useState<{ done: number; total: number } | null>(null)
  const nextKey = useRef(0)

  useEffect(() => {
    let alive = true
    setLoadError(null)
    api.upload(id).then(
      (s) => {
        if (alive) setSong(s)
      },
      (e: unknown) => {
        if (alive) setLoadError(errorText(e))
      },
    )
    return () => {
      alive = false
    }
  }, [id, tick])

  // Keep the name drafts in step with the saved song.
  useEffect(() => {
    setTitleDraft(song?.title ?? '')
    setArtistDraft(song?.artist ?? '')
  }, [song?.title, song?.artist])

  /** Runs one change, keeps the song it returns, and shows its error. */
  const run = async (key: string, job: () => Promise<UploadSong>) => {
    if (busy) return
    setBusy(key)
    setNotice(null)
    try {
      setSong(await job())
    } catch (e) {
      setNotice(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  if (!song) {
    return (
      <>
        <PageBar title="上传自己的谱" fallback={HREF_BAND} back="← 乐队" />
        <Staff />
        <div className="max-w-[640px] py-6">
          {loadError ? (
            <>
              <Notice tone="error">{loadError}</Notice>
              <button
                type="button"
                onClick={() => setTick((t) => t + 1)}
                className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm hover:border-foreground"
              >
                重试
              </button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">正在读取…</p>
          )}
        </div>
      </>
    )
  }

  const saveNames = () =>
    void run('names', () => api.updateUpload(song.id, titleDraft.trim(), artistDraft.trim()))

  const namesChanged = titleDraft.trim() !== song.title || artistDraft.trim() !== song.artist
  const scoreCount = song.files.filter((f) => f.kind === 'score').length

  // The band song that uses this upload: a new song made from it (its path is one of the files),
  // or a library band song whose own files these are.
  const used = band?.songs.find((s) => s.uploadId === id) ?? null
  const isOwnSong = used !== null && song.files.some((f) => f.path === used.path)
  // Several score files: the band score combines them; after changes it can be made again.
  const stale = isOwnSong && scoreCount >= 2

  const addToBand = () =>
    void run('band', async () => {
      const next = await api.addUploadToBand(id)
      reloadBand()
      const made = next.songs.find((s) => s.uploadId === id)
      if (made) navigate(hrefBandSong(made.id))
      return song
    })

  const recombine = () =>
    void run('recombine', async () => {
      await api.addUploadToBand(id)
      reloadBand()
      return song
    })

  const removeFile = (f: UploadFile) => {
    if (!window.confirm(`删除文件「${f.name}」？`)) return
    void run(`rm:${f.id}`, () => api.removeUploadFile(song.id, f.id))
  }

  const removeSong = () => {
    if (!window.confirm('删除这首上传的歌？上传的文件会一起删除，不能恢复。')) return
    setBusy('delete')
    setNotice(null)
    api
      .removeUpload(song.id)
      .then(() => navigate(HREF_BAND))
      .catch((e: unknown) => setNotice(errorText(e)))
      .finally(() => setBusy(null))
  }

  const addPicked = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const added = Array.from(files).map((file) => ({
      key: nextKey.current++,
      file,
      label: guessLabel(file.name),
      error: null,
    }))
    setPending((list) => [...list, ...added])
  }

  const uploadPending = async () => {
    if (busy || uploadPos || pending.length === 0) return
    const queue = pending
    const failed: Pending[] = []
    setNotice(null)
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i]
      if (!p) continue
      setUploadPos({ done: i, total: queue.length })
      try {
        setSong(await api.uploadFile({ id: song.id, label: p.label, name: p.file.name }, p.file))
      } catch (e) {
        failed.push({ ...p, error: errorText(e) })
      }
    }
    setPending(failed)
    setUploadPos(null)
  }

  return (
    <>
      <PageBar
        title={song.title || '未命名的歌'}
        subtitle={song.artist || undefined}
        fallback={HREF_BAND}
        back="← 乐队"
      />
      <Staff />

      <div className="max-w-[640px] space-y-8 pt-6">
        {/* names */}
        <section aria-labelledby="upload-names">
          <h2 id="upload-names" className="label m-0">
            歌名与歌手
          </h2>
          <form
            className="grid gap-3 pt-2.5 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (titleDraft.trim() && namesChanged) saveNames()
            }}
          >
            <label className="block min-w-0">
              <span className="sr-only">歌名</span>
              <input
                value={titleDraft}
                maxLength={120}
                placeholder="歌名"
                onChange={(e) => setTitleDraft(e.target.value)}
                className={INPUT}
              />
            </label>
            <label className="block min-w-0">
              <span className="sr-only">歌手</span>
              <input
                value={artistDraft}
                maxLength={120}
                placeholder="歌手（可不填）"
                onChange={(e) => setArtistDraft(e.target.value)}
                className={INPUT}
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={!titleDraft.trim() || !namesChanged || busy !== null}
                className={buttonClass('outline')}
              >
                {busy === 'names' ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        </section>

        {notice && <Notice tone="error">{notice}</Notice>}

        {/* files */}
        <section aria-labelledby="upload-files-title">
          <h2 id="upload-files-title" className="label m-0">
            已上传的文件（{song.files.length}）
          </h2>
          {song.files.length === 0 ? (
            <div className="pt-2.5">
              <Notice>还没有文件。在下面添加吉他、贝斯、鼓等各个声部的谱。</Notice>
            </div>
          ) : (
            <ul className="m-0 mt-2.5 list-none divide-y divide-border border-y border-border p-0">
              {song.files.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <div className="w-full sm:w-36">
                    <LabelSelect
                      value={f.label}
                      disabled={busy !== null}
                      ariaLabel={`「${f.name}」的声部`}
                      onChange={(label) =>
                        void run(`label:${f.id}`, () => api.relabelUploadFile(song.id, f.id, label))
                      }
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <KindBadge file={f} />
                    <span className="min-w-0 flex-1 truncate text-sm" title={f.name}>
                      {f.name}
                    </span>
                    <span className="mono shrink-0 text-xs text-muted-foreground">
                      {formatSize(f.size)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Link
                      href={hrefViewer({
                        path: f.path,
                        format: f.kind === 'score' ? 'score' : f.kind,
                        title: song.title,
                        artist: song.artist,
                      })}
                      className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-primary hover:underline"
                    >
                      看谱
                    </Link>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => removeFile(f)}
                      aria-label={`删除 ${f.name}`}
                      className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-muted-foreground hover:text-destructive disabled:opacity-50"
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* add files */}
        <section aria-labelledby="upload-add">
          <h2 id="upload-add" className="label m-0">
            添加文件
          </h2>
          <div className="pt-2.5">
            <label className={cx(buttonClass(), 'cursor-pointer')}>
              选择文件
              <input
                type="file"
                multiple
                accept={ACCEPT}
                disabled={uploadPos !== null}
                className="sr-only"
                onChange={(e) => {
                  addPicked(e.currentTarget.files)
                  e.currentTarget.value = ''
                }}
              />
            </label>
          </div>

          {pending.length > 0 && (
            <ul className="m-0 mt-3 list-none divide-y divide-border border-y border-border p-0">
              {pending.map((p) => (
                <li key={p.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <div className="w-full sm:w-36">
                    <LabelSelect
                      value={p.label}
                      disabled={uploadPos !== null}
                      ariaLabel={`「${p.file.name}」的声部`}
                      onChange={(label) =>
                        setPending((list) =>
                          list.map((x) => (x.key === p.key ? { ...x, label } : x)),
                        )
                      }
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-sm" title={p.file.name}>
                      {p.file.name}
                    </p>
                    <p className="mono m-0 text-xs text-muted-foreground">
                      {formatSize(p.file.size)}
                      {p.error && <span className="ml-2 text-destructive">{p.error}</span>}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={uploadPos !== null}
                    onClick={() => setPending((list) => list.filter((x) => x.key !== p.key))}
                    aria-label={`移除 ${p.file.name}`}
                    className="inline-flex min-h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          {pending.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 pt-3">
              <button
                type="button"
                disabled={uploadPos !== null}
                onClick={() => void uploadPending()}
                className={buttonClass('primary')}
              >
                {uploadPos
                  ? `正在上传 ${uploadPos.done + 1}/${uploadPos.total}…`
                  : `上传 ${pending.length} 个文件`}
              </button>
            </div>
          )}

          <div className="pt-3">
            <Notice>
              GP 和 MusicXML 能播放、能在排练里同步；PDF 和图片只能看。PDF 可以打开后用「转换成
              GP（实验）」变成可以播放的谱。几个 GP
              会自动组合成一份乐队谱（各声部按小节对齐，不齐的话可以在「组合乐队谱」里调整）。
            </Notice>
          </div>
        </section>

        {/* band */}
        <section aria-labelledby="upload-band">
          <h2 id="upload-band" className="label m-0">
            乐队歌单
          </h2>
          <div className="space-y-3 pt-2.5">
            {!band && <p className="m-0 text-sm text-muted-foreground">正在读取乐队…</p>}

            {used && isOwnSong && (
              <>
                <p className="m-0 text-sm">已在乐队歌单里。</p>
                <div className="flex flex-wrap gap-2">
                  <Link href={hrefBandSong(used.id)} className={buttonClass('outline')}>
                    去排练这首歌 →
                  </Link>
                </div>
                {stale && (
                  <div className="space-y-2">
                    <p className="m-0 text-xs text-muted-foreground">
                      上传、删除或改了声部名之后，点这里按现在的文件重新组合乐队谱（声部分配要重新做）。
                    </p>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={recombine}
                      className={buttonClass('outline')}
                    >
                      {busy === 'recombine' ? '正在组合…' : '重新组合乐队谱'}
                    </button>
                  </div>
                )}
              </>
            )}

            {used && !isOwnSong && (
              <>
                <p className="m-0 text-sm">
                  这些是《{used.title || '未识别的曲名'}》的自己上传的谱。
                </p>
                <div className="flex flex-wrap gap-2">
                  <Link href={hrefBandSong(used.id)} className={buttonClass('outline')}>
                    回到这首歌 →
                  </Link>
                  <Link
                    href={hrefCombine(used.path, used.comboId ?? undefined)}
                    className={buttonClass('outline')}
                  >
                    组合乐队谱 →
                  </Link>
                </div>
                <p className="m-0 text-xs text-muted-foreground">
                  在「组合乐队谱」里可以把这些文件的声部和原谱拼在一起。
                </p>
              </>
            )}

            {band && !used && (
              <>
                <p className="m-0 text-sm text-muted-foreground">
                  加入乐队歌单后，成员就能一起排练这首歌。
                </p>
                <button
                  type="button"
                  disabled={scoreCount === 0 || busy !== null}
                  onClick={addToBand}
                  className={buttonClass('primary')}
                >
                  {busy === 'band' ? '正在加入…' : '加入乐队歌单'}
                </button>
                {scoreCount === 0 && (
                  <p className="m-0 text-xs text-muted-foreground">
                    至少要上传一个 GP 或 MusicXML 文件
                  </p>
                )}
              </>
            )}
          </div>
        </section>

        {/* delete */}
        <section aria-labelledby="upload-danger" className="pb-24">
          <h2 id="upload-danger" className="label m-0">
            删除
          </h2>
          <div className="space-y-2 pt-2.5">
            <button
              type="button"
              disabled={used !== null || busy !== null}
              onClick={removeSong}
              className={DANGER_BUTTON}
            >
              {busy === 'delete' ? '正在删除…' : '删除这首上传的歌'}
            </button>
            {used !== null && (
              <p className="m-0 text-xs text-muted-foreground">
                这首歌已在乐队歌单里，先从歌单里移除后才能删除。
              </p>
            )}
          </div>
        </section>
      </div>
    </>
  )
}

/** The part picker: the usual parts, plus the file's current label when it is something else. */
function LabelSelect({
  value,
  disabled,
  ariaLabel,
  onChange,
}: {
  value: string
  disabled: boolean
  ariaLabel: string
  onChange: (label: string) => void
}) {
  const options: string[] = (LABELS as readonly string[]).includes(value)
    ? [...LABELS]
    : [value, ...LABELS]
  return (
    <select
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className={cx(SELECT, 'w-full')}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

/** GP / XML / PDF / 图片, as a small mono tag. */
function KindBadge({ file }: { file: UploadFile }) {
  const text =
    file.kind === 'pdf'
      ? 'PDF'
      : file.kind === 'image'
        ? '图片'
        : file.ext === 'musicxml' || file.ext === 'mxl'
          ? 'XML'
          : 'GP'
  return (
    <span className="mono shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
      {text}
    </span>
  )
}
