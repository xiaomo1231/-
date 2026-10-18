import { useEffect, useState } from 'react'
import { errorText, fetchBytes, fileUrl, type MemberProgress, type SongStatus, type UserInfo } from '../lib/api'
import { removeSong, STATUS_LABELS, updateSong, useBand } from '../lib/band'
import { cx, SELECT } from '../lib/classes'
import { fmtDuration } from '../lib/practice'
import { HREF_BAND, hrefViewer, navigate } from '../lib/route'
import { INSTRUMENT_LABELS, useMe } from '../lib/session'
import { Link } from '../components/Link'
import { Notice, PageBar, Seg, Staff } from '../components/ui'
import { chooseEncoding, loadAlphaTab } from '../viewer/alphaTab'
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
  | { status: 'ready'; labels: Array<{ zh: string; original: string }> }

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

  // Keep the drafts in step with what the server holds (after a save, or a first read).
  useEffect(() => setNoteDraft(note), [note])
  useEffect(() => setPartsDraft(JSON.parse(partsKey) as Parts), [partsKey])

  // Read the file's tracks in the browser (parsed only, not rendered).
  useEffect(() => {
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
        if (!cancelled) setTracks({ status: 'ready', labels })
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
  }, [songPath])

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

  const doDelete = () =>
    void run('delete', async () => {
      await removeSong(song.id)
      navigate(HREF_BAND)
    })

  return (
    <>
      <PageBar title={song.title || '未识别的曲名'} subtitle={song.artist} fallback={HREF_BAND} back="← 乐队" />
      <Staff />

      <div className="max-w-[640px] pt-6">
        <Link
          href={hrefViewer({
            path: song.path,
            format: 'score',
            title: song.title,
            artist: song.artist,
            band: song.id,
          })}
          className="inline-flex min-h-14 w-full items-center justify-center rounded-lg bg-primary px-6 text-lg font-bold text-primary-foreground transition-colors hover:bg-primary-strong active:opacity-80 sm:w-auto"
        >
          开始排练 →
        </Link>
      </div>

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
          <Seg<Speed> label="排练速度" value={speedMode} onChange={changeSpeedMode} options={SPEED_OPTIONS} />
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
                      {p ? fmtDuration(p.totalSeconds) : <span className="text-muted-foreground">还没练过</span>}
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
