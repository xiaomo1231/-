import { useEffect, useRef, useState } from 'react'
import {
  api,
  type BandSong,
  errorText,
  fetchBytes,
  fileUrl,
  type FillConfig,
  type MemberProgress,
  type SongStatus,
  type UploadSong,
  type UserInfo,
} from '../lib/api'
import {
  addComment,
  removeComment,
  removeSong,
  STATUS_LABELS,
  updateSong,
  useBand,
} from '../lib/band'
import { buttonClass, cx, SELECT } from '../lib/classes'
import { useDrumPart, useDrumStyles } from '../lib/drums'
import { fmtDuration } from '../lib/practice'
import { useRehearsal } from '../lib/rehearsal'
import { HREF_BAND, hrefUpload, hrefViewer, navigate } from '../lib/route'
import { hrefCombine } from '../lib/combos'
import type { ComboRecipe } from '../lib/api'
import { INSTRUMENT_LABELS, useMe } from '../lib/session'
import { fillOf, planFill } from '@/songs/rehearsalFill'
import { Link } from '../components/Link'
import { RecordingsPanel } from '../components/RecordingsPanel'
import { Notice, PageBar, Seg, Staff } from '../components/ui'
import { chooseEncoding, loadAlphaTab } from '../viewer/alphaTab'
import { CommentsPanel } from '../viewer/CommentsPanel'
import { FillPanel } from '../viewer/FillPanel'
import { SheetsPanel } from '../viewer/SheetsPanel'
import { trackLabels } from '../viewer/trackNames'

type Speed = 'own' | 'set'

type Parts = Record<string, string>

const NOTE_MAX = 2000
const SPEED_MIN = 50
const SPEED_MAX = 150
const SPEED_STEP = 5

const STATUS_OPTIONS: ReadonlyArray<readonly [SongStatus, string]> = (
  Object.keys(STATUS_LABELS) as SongStatus[]
).map((s) => [s, STATUS_LABELS[s]] as const)

const SPEED_OPTIONS: ReadonlyArray<readonly [Speed, string]> = [
  ['own', '各自决定'],
  ['set', '统一速度'],
]

type Tracks =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      labels: Array<{ zh: string; original: string }>
      /** Per track, in the same order as `labels`: a drum track. */
      drums: boolean[]
      /** Bars in the score, when known (a combo's bars are not read). */
      bars: number | null
    }

type FillSave = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

const DRUM_NAME = /鼓|drum/i

/** The member's own score files of this band song, or a link to upload them. */
function OwnFiles({ song }: { song: BandSong }) {
  const uploadId = song.uploadId ?? null
  const [upload, setUpload] = useState<UploadSong | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!uploadId) return
    let alive = true
    api.upload(uploadId).then(
      (u) => {
        if (alive) setUpload(u)
      },
      (e: unknown) => {
        if (alive) setError(errorText(e))
      },
    )
    return () => {
      alive = false
    }
  }, [uploadId])

  if (!uploadId) {
    return (
      <div className="space-y-3">
        <p className="m-0 text-sm leading-relaxed text-muted-foreground">
          觉得这首歌的谱不好用？可以上传自己的各声部谱（GP / MusicXML / PDF / 图片），再用「组合乐队谱」和原谱拼在一起。
        </p>
        <Link href={hrefUpload({ band: song.id })} className={buttonClass()}>
          上传自己的谱
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && <Notice tone="error">{error}</Notice>}
      {!upload && !error && <p className="text-sm text-muted-foreground">正在读取…</p>}
      {upload &&
        (upload.files.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">还没有上传文件。</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-border border-y border-border p-0">
            {upload.files.map((f) => (
              <li key={f.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="text-muted-foreground">{f.label}</span>
                  <span className="mx-1.5 text-muted-foreground">·</span>
                  {f.name}
                </span>
                <Link
                  href={hrefViewer({
                    path: f.path,
                    format: f.kind === 'score' ? 'score' : f.kind,
                    title: upload.title,
                    artist: upload.artist,
                  })}
                  className="inline-flex min-h-11 shrink-0 items-center px-2 text-sm text-primary hover:underline"
                >
                  看谱
                </Link>
              </li>
            ))}
          </ul>
        ))}
      <Link
        href={hrefUpload({ id: uploadId })}
        className="inline-flex min-h-11 items-center text-sm text-primary hover:underline"
      >
        管理上传的文件 →
      </Link>
    </div>
  )
}

const clamp = (n: number) => Math.min(SPEED_MAX, Math.max(SPEED_MIN, n))

/** A band song's page: rehearse it, set its status, speed, note, parts and see who practised what. */
export function BandSongPage({ id }: { id: string }) {
  const { state, error, reload } = useBand()
  const me = useMe()
  const song = state?.songs.find((s) => s.id === id)
  const songPath = song?.path ?? ''
  const partsKey = JSON.stringify(song?.parts ?? {})
  const note = song?.note ?? ''

  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState(note)
  const [partsDraft, setPartsDraft] = useState<Parts>(() => song?.parts ?? {})
  const [tracks, setTracks] = useState<Tracks>({ status: 'loading' })
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** 组合乐队谱 of this song (recipes made on the 组合 page). */
  const [combos, setCombos] = useState<ComboRecipe[]>([])
  const comboId = song?.comboId ?? null
  const combo = combos.find((c) => c.id === comboId) ?? null

  const rehearsal = useRehearsal()
  const drumStyles = useDrumStyles()
  // A combo's saved drums live under its base score.
  const savedDrums = useDrumPart(combo ? combo.base : songPath)
  const hasSavedDrums = savedDrums.part !== null

  // 补位 edits: shown at once, saved to the band 600 ms after the last change.
  const [fillEdit, setFillEdit] = useState<FillConfig | null>(null)
  const [fillSave, setFillSave] = useState<FillSave>('idle')
  const fillPending = useRef<{ songId: string; fill: FillConfig } | null>(null)
  const fillTimer = useRef<number | undefined>(undefined)

  // Leaving the page with an unsaved 补位 change still saves it.
  useEffect(
    () => () => {
      const p = fillPending.current
      if (!p) return
      window.clearTimeout(fillTimer.current)
      void updateSong({ id: p.songId, fill: p.fill }).catch(() => undefined)
    },
    [],
  )

  useEffect(() => {
    if (!songPath) return
    let cancelled = false
    api
      .combos(songPath)
      .then((list) => {
        if (!cancelled) setCombos(list)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [songPath])

  // Keep the drafts in step with what the server holds (after a save, or a first read).
  useEffect(() => setNoteDraft(note), [note])
  useEffect(() => setPartsDraft(JSON.parse(partsKey) as Parts), [partsKey])

  // Read the file's tracks in the browser (parsed only, not rendered). With a 组合乐队谱
  // the tracks are the recipe's parts, in order.
  useEffect(() => {
    if (combo) {
      setTracks({
        status: 'ready',
        labels: combo.parts.map((p) => ({ zh: p.name, original: '' })),
        drums: combo.parts.map((p) => DRUM_NAME.test(p.name)),
        bars: null,
      })
      return
    }
    if (!songPath) return
    let cancelled = false
    setTracks({ status: 'loading' })
    void (async () => {
      try {
        const at = await loadAlphaTab()
        const bytes = await fetchBytes(fileUrl(songPath))
        const settings = new at.Settings()
        settings.importer.encoding = chooseEncoding(at, bytes)
        const score = at.importer.ScoreLoader.loadScoreFromBytes(bytes, settings)
        const labels = trackLabels(score.tracks)
        const drums = score.tracks.map((t) => Boolean(t.isPercussion || t.staves[0]?.isPercussion))
        const bars = score.masterBars.length
        if (!cancelled) setTracks({ status: 'ready', labels, drums, bars })
      } catch (e) {
        if (!cancelled)
          setTracks({
            status: 'error',
            message: `读不出这个谱子的音轨：${errorText(e)}`,
          })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [songPath, combo])

  if (!state) {
    return (
      <>
        <PageBar title="排练" fallback={HREF_BAND} back="← 乐队" />
        <Staff />
        <div className="max-w-[640px] py-6">
          {error ? (
            <>
              <Notice tone="error">{error}</Notice>
              <button
                type="button"
                onClick={reload}
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

  if (!song) {
    return (
      <>
        <PageBar title="排练" fallback={HREF_BAND} back="← 乐队" />
        <Staff />
        <div className="max-w-[640px] py-6">
          <Notice>这首歌已经不在歌单里了。</Notice>
          <Link
            href={HREF_BAND}
            className="mt-4 inline-flex min-h-11 items-center text-sm text-primary hover:underline"
          >
            ← 回到乐队歌单
          </Link>
        </div>
      </>
    )
  }

  const memberById = new Map<string, UserInfo>(state.members.map((m) => [m.id, m]))
  const memberLabel = (m: UserInfo) =>
    `${m.displayName}·${m.instrument ? INSTRUMENT_LABELS[m.instrument] : '未设乐器'}`
  const progress: MemberProgress[] = state.progress[song.id] ?? []

  const run = async (key: string, job: () => Promise<void>) => {
    if (busy) return
    setBusy(key)
    setNotice(null)
    try {
      await job()
    } catch (e) {
      setNotice(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const setStatus = (status: SongStatus) => {
    if (status !== song.status) void run('status', () => updateSong({ id: song.id, status }))
  }

  const setSpeed = (pct: number | null) =>
    void run('speed', () => updateSong({ id: song.id, rehearsalSpeedPct: pct }))

  const speedMode: Speed = song.rehearsalSpeedPct === null ? 'own' : 'set'
  const speedValue = song.rehearsalSpeedPct === null ? 100 : clamp(song.rehearsalSpeedPct)

  const changeSpeedMode = (mode: Speed) => {
    if (mode === speedMode) return
    setSpeed(mode === 'own' ? null : 100)
  }

  const noteDirty = noteDraft !== song.note

  const partsDirty = JSON.stringify(partsDraft) !== partsKey

  const setPart = (track: number, userId: string) => {
    setPartsDraft((prev) => {
      const next = { ...prev }
      if (userId) next[String(track)] = userId
      else delete next[String(track)]
      return next
    })
  }

  const saveParts = () => void run('parts', () => updateSong({ id: song.id, parts: partsDraft }))

  const saveNote = () => void run('note', () => updateSong({ id: song.id, note: noteDraft }))

  // 补位
  const saveFillNow = async () => {
    const p = fillPending.current
    if (!p) return
    window.clearTimeout(fillTimer.current)
    setFillSave('saving')
    try {
      await updateSong({ id: p.songId, fill: p.fill })
      if (fillPending.current === p) {
        fillPending.current = null
        setFillEdit(null)
        setFillSave('saved')
      }
    } catch (e) {
      setFillSave('error')
      setNotice(errorText(e))
    }
  }

  const changeFill = (next: FillConfig) => {
    fillPending.current = { songId: song.id, fill: next }
    setFillEdit(next)
    setFillSave('pending')
    window.clearTimeout(fillTimer.current)
    fillTimer.current = window.setTimeout(() => void saveFillNow(), 600)
  }

  const fill = fillEdit ?? fillOf({ fill: song.fill })
  const rehearsing = rehearsal.state?.active === true
  const presentIds = rehearsing
    ? (rehearsal.state?.devices ?? []).map((d) => d.userId)
    : state.members.map((m) => m.id)
  const readyTracks = tracks.status === 'ready' ? tracks : null
  const fillPlan = readyTracks
    ? planFill({
        tracks: readyTracks.labels.map((l, i) => ({
          index: i,
          name: l.zh,
          isDrums: readyTracks.drums[i] ?? false,
        })),
        parts: song.parts,
        present: presentIds,
        members: state.members.map((m) => ({
          id: m.id,
          displayName: m.displayName,
          instrument: m.instrument,
        })),
        fill,
        hasSavedDrums,
      })
    : null
  const fillCaption = rehearsing
    ? '按现在在场的人自动决定'
    : '假设全员到齐；排练时会按实际到场的人自动决定'
  const fillStatusText: Record<FillSave, string> = {
    idle: '',
    pending: '待保存…',
    saving: '正在保存…',
    saved: '已保存',
    error: '保存失败，请再改一次试试',
  }

  const doDelete = () =>
    void run('delete', async () => {
      await removeSong(song.id)
      navigate(HREF_BAND)
    })

  return (
    <>
      <PageBar
        title={song.title || '未识别的曲名'}
        subtitle={song.artist}
        fallback={HREF_BAND}
        back="← 乐队"
      />
      <Staff />

      <div className="max-w-[640px] pt-6">
        <Link
          href={
            combo
              ? hrefViewer({
                  path: combo.base,
                  format: 'score',
                  title: song.title,
                  artist: song.artist,
                  band: song.id,
                }) + `&combo=${encodeURIComponent(combo.id)}`
              : hrefViewer({
                  path: song.path,
                  format: 'score',
                  title: song.title,
                  artist: song.artist,
                  band: song.id,
                })
          }
          className="inline-flex min-h-14 w-full items-center justify-center rounded-lg bg-primary px-6 text-lg font-bold text-primary-foreground transition-colors hover:bg-primary-strong active:opacity-80 sm:w-auto"
        >
          开始排练 →
        </Link>
      </div>

      {/* which score the band rehearses: the setlist file, or a 组合乐队谱 of the song */}
      <section aria-labelledby="song-score" className="max-w-[640px] pt-8">
        <h2 id="song-score" className="label m-0">
          排练用的谱
        </h2>
        <select
          className="mt-3 h-11 w-full rounded-lg border border-border bg-card px-3 text-sm"
          value={comboId ?? ''}
          disabled={busy !== null}
          onChange={(e) => {
            const v = e.target.value || null
            void run('combo', () => updateSong({ id: song.id, comboId: v, parts: {} }))
          }}
        >
          <option value="">歌单里的原谱</option>
          {combos.map((c) => (
            <option key={c.id} value={c.id}>
              组合乐队谱：{c.parts.map((p) => p.name).join(' + ')}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-muted-foreground">
          换谱后声部要重新分配。
          <a
            className="ml-1 underline-offset-4 hover:underline"
            href={hrefCombine(song.path, comboId ?? undefined)}
          >
            {comboId ? '编辑这个组合 →' : '从不同版本组合一份乐队谱 →'}
          </a>
        </p>
      </section>

      {notice && (
        <div className="max-w-[640px] pt-4">
          <Notice tone="error">{notice}</Notice>
        </div>
      )}

      {/* status and speed */}
      <section aria-labelledby="song-status" className="max-w-[640px] pt-8">
        <h2 id="song-status" className="label m-0">
          状态
        </h2>
        <div className="pt-2.5">
          <Seg<SongStatus>
            label="状态"
            value={song.status}
            onChange={setStatus}
            options={STATUS_OPTIONS}
          />
        </div>
      </section>

      <section aria-labelledby="song-speed" className="max-w-[640px] pt-7">
        <h2 id="song-speed" className="label m-0">
          排练速度
        </h2>
        <div className="flex flex-wrap items-center gap-3 pt-2.5">
          <Seg<Speed>
            label="排练速度"
            value={speedMode}
            onChange={changeSpeedMode}
            options={SPEED_OPTIONS}
          />
          {speedMode === 'set' && (
            <div className="inline-flex items-center gap-1" role="group" aria-label="速度">
              <button
                type="button"
                aria-label="慢一点"
                disabled={busy !== null || speedValue <= SPEED_MIN}
                onClick={() => setSpeed(clamp(speedValue - SPEED_STEP))}
                className="grid h-11 w-11 place-items-center rounded-lg border border-border text-lg transition-colors hover:border-foreground disabled:opacity-40"
              >
                <span aria-hidden>−</span>
              </button>
              <span className="mono w-16 text-center text-lg font-semibold tabular-nums">
                {speedValue}%
              </span>
              <button
                type="button"
                aria-label="快一点"
                disabled={busy !== null || speedValue >= SPEED_MAX}
                onClick={() => setSpeed(clamp(speedValue + SPEED_STEP))}
                className="grid h-11 w-11 place-items-center rounded-lg border border-border text-lg transition-colors hover:border-foreground disabled:opacity-40"
              >
                <span aria-hidden>+</span>
              </button>
            </div>
          )}
        </div>
        <p className="pt-2 text-xs text-muted-foreground">
          {speedMode === 'set'
            ? `全队都用 ${speedValue}% 练这首歌（${SPEED_MIN}–${SPEED_MAX}%）。`
            : '每个人自己决定练习速度。'}
        </p>
      </section>

      {/* note */}
      <section aria-labelledby="song-note" className="max-w-[640px] pt-8">
        <h2 id="song-note" className="label m-0">
          排练备注
        </h2>
        <textarea
          id="song-note"
          value={noteDraft}
          maxLength={NOTE_MAX}
          rows={4}
          placeholder="例如：副歌第二遍的和弦换成 Am，第 12 小节注意节奏。"
          onChange={(e) => setNoteDraft(e.target.value)}
          className="mt-2.5 w-full resize-y rounded-lg border border-border bg-transparent p-3 text-base leading-relaxed text-foreground placeholder:text-muted-foreground focus:border-primary"
        />
        <div className="flex items-center justify-between gap-3 pt-2">
          <span className="mono text-xs text-muted-foreground">
            {noteDraft.length} / {NOTE_MAX}
          </span>
          <button
            type="button"
            onClick={saveNote}
            disabled={!noteDirty || busy !== null}
            className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-strong disabled:opacity-50"
          >
            保存备注
          </button>
        </div>
      </section>

      {/* parts */}
      <section aria-labelledby="song-parts" className="max-w-[640px] pt-8">
        <h2 id="song-parts" className="label m-0">
          声部分配
        </h2>
        {tracks.status === 'loading' && (
          <p className="pt-3 text-sm text-muted-foreground">正在读取音轨…</p>
        )}
        {tracks.status === 'error' && (
          <div className="pt-3">
            <Notice tone="error">{tracks.message}</Notice>
          </div>
        )}
        {tracks.status === 'ready' && tracks.labels.length === 0 && (
          <div className="pt-3">
            <Notice>这个谱子里没有音轨。</Notice>
          </div>
        )}
        {tracks.status === 'ready' && tracks.labels.length > 0 && (
          <>
            <ul className="m-0 list-none p-0 pt-2">
              {tracks.labels.map((label, i) => {
                const value = partsDraft[String(i)] ?? ''
                const stale = value !== '' && !memberById.has(value)
                return (
                  <li
                    key={i}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,12rem)] items-center gap-3 border-t border-border py-2.5 first:border-t-0"
                  >
                    <div className="min-w-0">
                      <p className="m-0 break-words text-base font-medium">{label.zh}</p>
                      {label.original && label.original !== label.zh && (
                        <p className="mono m-0 break-words text-xs text-muted-foreground">
                          {label.original}
                        </p>
                      )}
                    </div>
                    <label className="min-w-0">
                      <span className="sr-only">{label.zh} 由谁演奏</span>
                      <select
                        value={value}
                        disabled={busy !== null}
                        onChange={(e) => setPart(i, e.target.value)}
                        className={cx(SELECT, 'w-full', value && 'border-primary text-primary')}
                      >
                        <option value="">未分配</option>
                        {state.members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {memberLabel(m)}
                            {me?.id === m.id ? '（我）' : ''}
                          </option>
                        ))}
                        {stale && <option value={value}>已离开的成员</option>}
                      </select>
                    </label>
                  </li>
                )
              })}
            </ul>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={saveParts}
                disabled={!partsDirty || busy !== null}
                className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-strong disabled:opacity-50"
              >
                保存声部
              </button>
            </div>
          </>
        )}
      </section>

      {/* 补位 */}
      {fillPlan && (
        <section aria-labelledby="song-fill" className="max-w-[640px] pt-8">
          <h2 id="song-fill" className="label m-0">
            补位（排练时音箱放什么）
          </h2>
          <div className="pt-2.5">
            <FillPanel
              plan={fillPlan}
              fill={fill}
              onChange={changeFill}
              nameOf={(userId) => memberById.get(userId)?.displayName ?? '已离开的成员'}
              hasFileDrums={readyTracks?.drums.some(Boolean) ?? false}
              hasSavedDrums={hasSavedDrums}
              drumStyles={drumStyles.styles}
              caption={fillCaption}
            />
            <p aria-live="polite" className="pt-2 text-xs text-muted-foreground">
              {fillStatusText[fillSave]}
            </p>
          </div>
        </section>
      )}

      {/* 主唱简谱 */}
      <section aria-labelledby="song-sheets" className="max-w-[640px] pt-8">
        <h2 id="song-sheets" className="label m-0">
          主唱简谱
        </h2>
        <div className="pt-2.5">
          <SheetsPanel path={song.path} />
        </div>
      </section>

      {/* 自己上传的谱 */}
      <section aria-labelledby="song-own" className="max-w-[640px] pt-8">
        <h2 id="song-own" className="label m-0">
          自己上传的谱
        </h2>
        <div className="pt-2.5">
          <OwnFiles song={song} />
        </div>
      </section>

      {/* 小节留言 */}
      <section aria-labelledby="song-comments" className="max-w-[640px] pt-8">
        <h2 id="song-comments" className="label m-0">
          小节留言
        </h2>
        <div className="pt-2.5">
          <CommentsPanel
            comments={song.comments ?? []}
            members={state.members}
            me={me}
            currentBar={1}
            bars={readyTracks?.bars ?? 999}
            focusBar={null}
            onAdd={(bar, text) => addComment(song.id, bar, text)}
            onRemove={(commentId) => removeComment(song.id, commentId)}
          />
        </div>
      </section>

      {/* 排练录音 */}
      <section aria-labelledby="song-recordings" className="max-w-[640px] pt-8">
        <h2 id="song-recordings" className="label m-0">
          排练录音
        </h2>
        <div className="pt-2.5">
          <RecordingsPanel songId={song.id} members={state.members} />
        </div>
      </section>

      {/* practice */}
      <section aria-labelledby="song-practice" className="max-w-[640px] pt-8">
        <h2 id="song-practice" className="label m-0">
          练习进度
        </h2>
        <div className="overflow-x-auto pt-2.5">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="py-2 pr-2 font-medium">成员</th>
                <th className="py-2 pr-2 font-medium">练习时长</th>
                <th className="py-2 pr-2 font-medium">最高速度</th>
                <th className="py-2 font-medium">最近练习</th>
              </tr>
            </thead>
            <tbody>
              {state.members.map((m) => {
                const p = progress.find((x) => x.userId === m.id)
                return (
                  <tr key={m.id} className="border-b border-border last:border-b-0">
                    <td className="break-words py-2.5 pr-2 font-medium">{m.displayName}</td>
                    <td className="mono py-2.5 pr-2 tabular-nums">
                      {p ? (
                        fmtDuration(p.totalSeconds)
                      ) : (
                        <span className="text-muted-foreground">还没练过</span>
                      )}
                    </td>
                    <td className="mono py-2.5 pr-2 tabular-nums">
                      {p && p.maxSpeedPct ? `${p.maxSpeedPct}%` : '—'}
                    </td>
                    <td className="mono py-2.5 tabular-nums text-muted-foreground">
                      {p ? new Date(p.lastAt).toLocaleDateString('zh-CN') : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* delete */}
      <section className="max-w-[640px] pb-24 pt-10">
        {confirmDelete ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive p-4">
            <p className="m-0 flex-1 basis-56 text-sm leading-relaxed">
              从歌单删除《{song.title}》？这首歌的声部分配和备注会一起删除，谱子文件不受影响。
            </p>
            <button
              type="button"
              onClick={doDelete}
              disabled={busy !== null}
              className="inline-flex min-h-11 items-center rounded-lg bg-destructive px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              确认删除
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm text-muted-foreground hover:text-foreground"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="inline-flex min-h-11 items-center text-sm text-destructive hover:underline"
          >
            从歌单删除这首歌
          </button>
        )}
      </section>
    </>
  )
}
