import { useEffect, useMemo, useState } from 'react'
import type { ScoreSearchResult, ScoreVersion } from '@/songs/scoreLibraryTypes'
import {
  api,
  errorText,
  type BandSong,
  type BandState,
  type DailyMemberProgress,
  type MemberProgress,
  type SongStatus,
  type UploadSong,
  type UserInfo,
} from '../lib/api'
import {
  addSong,
  rename,
  reorder,
  setSetlist,
  STATUS_LABELS,
  updateSong,
  useBand,
} from '../lib/band'
import { buttonClass, cx } from '../lib/classes'
import { todayNumber } from '../lib/daily'
import { useRehearsal } from '../lib/rehearsal'
import { openInRehearsal } from '../lib/rehearsalNav'
import { canBrowseLibrary, INSTRUMENT_LABELS, useMe } from '../lib/session'
import { fmtDuration } from '../lib/practice'
import { hrefBandSong, hrefEnsembles, hrefUpload } from '../lib/route'
import { FormatBadge, Notice, PageBar, Seg } from '../components/ui'
import { Link } from '../components/Link'

type Filter = 'all' | SongStatus

const FILTERS: ReadonlyArray<readonly [Filter, string]> = [
  ['all', '全部'],
  ['learning', STATUS_LABELS.learning],
  ['ready', STATUS_LABELS.ready],
  ['maybe', STATUS_LABELS.maybe],
]

/** Tap order of the status chip. */
const NEXT_STATUS: Record<SongStatus, SongStatus> = {
  learning: 'ready',
  ready: 'maybe',
  maybe: 'learning',
}

const STATUS_CLASS: Record<SongStatus, string> = {
  learning: 'border-primary text-primary',
  ready: 'border-foreground text-foreground',
  maybe: 'border-muted-foreground text-muted-foreground',
}

const ICON_BUTTON =
  'grid h-11 w-11 place-items-center rounded-lg border border-border text-base text-muted-foreground transition-colors hover:border-foreground hover:text-foreground disabled:opacity-40'

/** 乐队 page: the band's name and members, the ordered setlist, and adding songs from the library. */
export function BandPage() {
  const { state, error, reload } = useBand()
  const me = useMe()
  const browse = me !== null && canBrowseLibrary(me)
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  // Each member's 每日一练 progress; a failed read just leaves the lines out.
  const [daily, setDaily] = useState<Map<string, DailyMemberProgress> | null>(null)

  useEffect(() => {
    let alive = true
    api.dailyMembers().then(
      (list) => {
        if (alive) setDaily(new Map(list.map((p) => [p.userId, p])))
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [])

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

  if (!state) {
    return (
      <>
        <PageBar title="乐队" fallback="#/" back="← 目录" />
        <div className="max-w-[640px] py-6">
          {error ? (
            <Notice tone="error">{error}</Notice>
          ) : (
            <p className="text-sm text-muted-foreground">正在读取…</p>
          )}
          {error && (
            <button
              type="button"
              onClick={reload}
              className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm hover:border-foreground"
            >
              重试
            </button>
          )}
        </div>
      </>
    )
  }

  const memberById = new Map<string, UserInfo>(state.members.map((m) => [m.id, m]))
  const nameOf = (id: string) => memberById.get(id)?.displayName ?? '已离开的成员'
  const shown = filter === 'all' ? state.songs : state.songs.filter((s) => s.status === filter)

  const move = (index: number, dir: -1 | 1) => {
    const ids = state.songs.map((s) => s.id)
    void run('move', () => reorder(swapped(ids, index, index + dir)))
  }

  const cycleStatus = (song: BandSong) =>
    void run(song.id, () => updateSong({ id: song.id, status: NEXT_STATUS[song.status] }))

  const startRename = () => {
    setNameDraft(state.name)
    setRenaming(true)
  }

  const saveName = () => {
    const name = nameDraft.trim()
    if (!name) return
    void run('name', async () => {
      await rename(name)
      setRenaming(false)
    })
  }

  return (
    <>
      <PageBar
        title={state.name || '乐队'}
        back={browse ? '← 目录' : ''}
        fallback="#/"
        subtitle={`${state.songs.length} 首歌 · ${state.members.length} 位成员`}
      >
        {!renaming && (
          <button
            type="button"
            onClick={startRename}
            className="inline-flex min-h-11 items-center rounded-lg border border-border px-3.5 text-sm text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
          >
            改名
          </button>
        )}
      </PageBar>

      {renaming && (
        <form
          className="flex max-w-[640px] flex-wrap items-center gap-2 pt-4"
          onSubmit={(e) => {
            e.preventDefault()
            saveName()
          }}
        >
          <label className="sr-only" htmlFor="band-name">
            乐队名称
          </label>
          <input
            id="band-name"
            value={nameDraft}
            maxLength={40}
            autoFocus
            onChange={(e) => setNameDraft(e.target.value)}
            className="h-11 min-w-0 flex-1 basis-48 rounded-lg border border-border bg-transparent px-3 text-base text-foreground focus:border-primary"
          />
          <button
            type="submit"
            disabled={!nameDraft.trim() || busy === 'name'}
            className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-strong disabled:opacity-50"
          >
            保存
          </button>
          <button
            type="button"
            onClick={() => setRenaming(false)}
            className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm text-muted-foreground hover:text-foreground"
          >
            取消
          </button>
        </form>
      )}

      <RehearsalSection band={state} meId={me?.id ?? null} />

      {/* members */}
      <section aria-labelledby="band-members" className="max-w-[640px] pt-6">
        <h2 id="band-members" className="label m-0">
          成员
        </h2>
        <ul className="m-0 mt-2.5 flex list-none flex-wrap gap-2 p-0">
          {state.members.map((m) => (
            <li
              key={m.id}
              className="inline-flex min-h-11 flex-col justify-center gap-0.5 rounded-2xl border border-border px-3.5 py-1.5 text-sm"
            >
              <span className="flex items-center gap-2">
                <span className="font-medium">
                  {m.displayName}
                  {me?.id === m.id && <span className="text-muted-foreground">（我）</span>}
                </span>
                <span className="mono text-xs text-muted-foreground">
                  {m.instrument ? INSTRUMENT_LABELS[m.instrument] : '未设乐器'}
                </span>
              </span>
              {daily && (
                <span className="mono text-[11px] text-muted-foreground">
                  {dailyLine(daily.get(m.id))}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* setlist */}
      <section aria-labelledby="band-setlist" className="max-w-[640px] pt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="band-setlist" className="label m-0">
            排练歌单
          </h2>
          {state.songs.length > 0 && (
            <Seg<Filter> label="状态筛选" value={filter} onChange={setFilter} options={FILTERS} />
          )}
        </div>

        {notice && (
          <div className="pt-3">
            <Notice tone="error">{notice}</Notice>
          </div>
        )}

        {state.songs.length === 0 ? (
          <div className="pt-3">
            <Notice>
              {browse
                ? '歌单还是空的。在下面「添加歌曲」里搜索谱子，选一个版本加入，乐队成员就能一起排练它。每首歌可以记录状态、分配声部、设定排练速度和备注。'
                : '歌单还是空的。等管理员或能看谱库的成员把歌加进来，这里就会出现。'}
            </Notice>
          </div>
        ) : shown.length === 0 ? (
          <div className="pt-3">
            <Notice>这个状态下还没有歌。</Notice>
          </div>
        ) : (
          <ol className="m-0 list-none p-0 pt-2">
            {shown.map((song) => {
              const index = state.songs.indexOf(song)
              return (
                <SetlistRow
                  key={song.id}
                  index={index}
                  total={state.songs.length}
                  song={song}
                  progress={state.progress[song.id] ?? []}
                  nameOf={nameOf}
                  busy={busy !== null}
                  onStatus={() => cycleStatus(song)}
                  onMove={(dir) => move(index, dir)}
                />
              )
            })}
          </ol>
        )}
      </section>

      {/* 自己上传的谱: a new uploaded song, and uploads not on the setlist yet. */}
      <section aria-labelledby="band-upload" className="max-w-[640px] pt-10">
        <h2 id="band-upload" className="label m-0">
          自己的谱
        </h2>
        <div className="pt-3">
          <Link href={hrefUpload()} className={buttonClass()}>
            新建歌曲（上传自己的谱）
          </Link>
        </div>
        <p className="m-0 pt-2 text-xs text-muted-foreground">
          谱库里的谱都不合适时，自己上传吉他、贝斯、鼓等各个声部的谱
        </p>
        <UnlistedUploads
          used={new Set(state.songs.flatMap((s) => (s.uploadId ? [s.uploadId] : [])))}
        />
      </section>

      {/* Picking songs needs the library; members who only see the band cannot search it. */}
      {browse && (
        <AddSongs inSetlist={new Set(state.songs.map((s) => s.path))} busy={busy} run={run} />
      )}
    </>
  )
}

/**
 * 排练: today's setlist (edited while no rehearsal runs), starting the rehearsal, and
 * joining or ending the one that runs. Live through the rehearsal stream.
 */
function RehearsalSection({ band, meId }: { band: BandState; meId: string | null }) {
  const rh = useRehearsal()
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [addId, setAddId] = useState('')

  const songById = new Map<string, BandSong>(band.songs.map((s) => [s.id, s]))
  // Unknown ids (songs since removed from the band) are left out of the list.
  const setlist = band.rehearsalSetlist
    .map((id) => songById.get(id))
    .filter((s): s is BandSong => s !== undefined)
  const ids = setlist.map((s) => s.id)
  const inSetlist = new Set(ids)
  const addable = band.songs.filter((s) => !inSetlist.has(s.id))
  const nameOf = (id: string) =>
    band.members.find((m) => m.id === id)?.displayName ?? '已离开的成员'

  const state = rh.state
  const active = state?.active === true
  const currentId = state?.songId ?? null
  const current = currentId ? (songById.get(currentId) ?? null) : null
  const position = currentId ? band.rehearsalSetlist.indexOf(currentId) : -1
  const speaker = state?.speakerDevice
    ? state.devices.find((d) => d.deviceId === state.speakerDevice)
    : undefined
  const leaderPresent = state ? state.devices.some((d) => d.userId === state.leaderId) : false
  const canEnd = active && (state?.leaderId === meId || !leaderPresent)
  const present = state
    ? [...new Set(state.devices.map((d) => d.userId))].map(nameOf).join('、')
    : ''

  const saveSetlist = async (next: string[], key: string) => {
    if (busy) return
    setBusy(key)
    setNotice(null)
    try {
      await setSetlist(next)
    } catch (e) {
      setNotice(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const start = async () => {
    const first = setlist[0]
    if (busy || !first) return
    setBusy('start')
    setNotice(null)
    try {
      await rh.send({ type: 'start', setlist: ids })
      await openInRehearsal(first)
    } catch (e) {
      setNotice(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const join = async () => {
    if (!current) return
    setNotice(null)
    try {
      await openInRehearsal(current)
    } catch (e) {
      setNotice(errorText(e))
    }
  }

  const end = async () => {
    if (busy || !window.confirm('结束这次排练？')) return
    setBusy('end')
    setNotice(null)
    try {
      await rh.send({ type: 'end' })
    } catch (e) {
      setNotice(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const move = (index: number, dir: -1 | 1) =>
    void saveSetlist(swapped(ids, index, index + dir), 'list')
  const remove = (index: number) =>
    void saveSetlist(
      ids.filter((_, i) => i !== index),
      'list',
    )
  const addOne = (id: string) => {
    setAddId('')
    if (id) void saveSetlist([...ids, id], 'list')
  }

  const message = notice ?? rh.error
  const status = !rh.connected && <p className="m-0 text-xs text-muted-foreground">实时连接中…</p>

  return (
    <section aria-labelledby="band-rehearsal" className="max-w-[640px] pt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="band-rehearsal" className="label m-0">
          排练
        </h2>
        {status}
      </div>

      {message && (
        <div className="pt-3">
          <Notice tone="error">{message}</Notice>
        </div>
      )}

      {active ? (
        <div className="pt-3">
          <div className="rounded-2xl border border-primary bg-card p-4">
            <p className="m-0 text-xs font-medium text-primary">排练进行中</p>
            <p className="m-0 mt-1 break-words text-lg font-bold leading-snug">
              {current ? (
                <>
                  {position >= 0 && `第 ${position + 1}/${band.rehearsalSetlist.length} 首`}
                  {position >= 0 ? ' ' : ''}《{current.title || '未识别的曲名'}》
                </>
              ) : currentId ? (
                '（这首歌已从乐队移除）'
              ) : (
                '还没有选定曲目'
              )}
            </p>
            <dl className="m-0 mt-3 grid gap-1.5 text-sm">
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted-foreground">指挥：</dt>
                <dd className="m-0">{state?.leaderId ? nameOf(state.leaderId) : '暂无指挥'}</dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted-foreground">音箱：</dt>
                <dd className="m-0">
                  {speaker ? `${nameOf(speaker.userId)}（${speaker.label}）` : '还没有设备当音箱'}
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted-foreground">在场：</dt>
                <dd className="m-0 break-words">{present || '—'}</dd>
              </div>
            </dl>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void join()}
                disabled={!current || busy !== null}
                className="inline-flex min-h-12 flex-1 items-center justify-center rounded-lg bg-primary px-5 text-base font-medium text-primary-foreground hover:bg-primary-strong disabled:opacity-50"
              >
                加入排练
              </button>
              {canEnd && (
                <button
                  type="button"
                  onClick={() => void end()}
                  disabled={busy !== null}
                  className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                  {busy === 'end' ? '结束中…' : '结束排练'}
                </button>
              )}
            </div>
          </div>

          <h3 className="m-0 pt-5 text-sm font-medium text-muted-foreground">今天的排练歌单</h3>
          {setlist.length === 0 ? (
            <p className="m-0 pt-2 text-sm text-muted-foreground">今天还没有选歌。</p>
          ) : (
            <ol className="m-0 list-none p-0 pt-2">
              {setlist.map((song, i) => (
                <li
                  key={song.id}
                  className="flex items-center gap-2.5 border-t border-border py-2.5 first:border-t-0"
                >
                  <span className="mono w-6 shrink-0 text-right text-sm font-semibold text-muted-foreground">
                    {i + 1}.
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 break-words font-medium leading-snug">
                      {song.title || '未识别的曲名'}
                    </p>
                    {song.artist && (
                      <p className="m-0 truncate text-xs text-muted-foreground">{song.artist}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : (
        <div className="pt-3">
          <h3 className="m-0 text-sm font-medium">今天排练哪些歌</h3>
          <p className="m-0 mt-2 text-xs leading-relaxed text-muted-foreground">
            排练时，一台设备当「音箱」接排练室的音箱，负责放缺席成员的声部（比如缺鼓手就放鼓）；其他人的手机/平板不出声，只看自己的谱，光标和翻页跟着走。
          </p>

          {setlist.length === 0 ? (
            <div className="pt-3">
              <Notice>
                {band.songs.length > 0
                  ? '还没有选歌。可以全部加入，或从下面挑。'
                  : '歌单还是空的，先在下面添加歌曲。'}
              </Notice>
            </div>
          ) : (
            <ol className="m-0 list-none p-0 pt-2">
              {setlist.map((song, i) => (
                <li
                  key={song.id}
                  className="flex items-center gap-2.5 border-t border-border py-2.5 first:border-t-0"
                >
                  <span className="mono w-6 shrink-0 text-right text-sm font-semibold text-muted-foreground">
                    {i + 1}.
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 break-words font-medium leading-snug">
                      {song.title || '未识别的曲名'}
                    </p>
                    {song.artist && (
                      <p className="m-0 truncate text-xs text-muted-foreground">{song.artist}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      aria-label={`上移：${song.title}`}
                      title="上移"
                      disabled={busy !== null || i <= 0}
                      onClick={() => move(i, -1)}
                      className={ICON_BUTTON}
                    >
                      <span aria-hidden>↑</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`下移：${song.title}`}
                      title="下移"
                      disabled={busy !== null || i >= setlist.length - 1}
                      onClick={() => move(i, 1)}
                      className={ICON_BUTTON}
                    >
                      <span aria-hidden>↓</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`从今天的排练中移除：${song.title}`}
                      title="移除"
                      disabled={busy !== null}
                      onClick={() => remove(i)}
                      className={ICON_BUTTON}
                    >
                      <span aria-hidden>✕</span>
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}

          {setlist.length === 0 && band.songs.length > 0 ? (
            <button
              type="button"
              onClick={() =>
                void saveSetlist(
                  band.songs.map((s) => s.id),
                  'all',
                )
              }
              disabled={busy !== null}
              className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
            >
              {busy === 'all' ? '加入中…' : '全部加入'}
            </button>
          ) : (
            addable.length > 0 && (
              <div className="pt-3">
                <label className="sr-only" htmlFor="rehearsal-add">
                  加一首歌到今天的排练
                </label>
                <select
                  id="rehearsal-add"
                  value={addId}
                  disabled={busy !== null}
                  onChange={(e) => addOne(e.target.value)}
                  className="h-11 w-full rounded-lg border border-border bg-card px-3 text-base text-foreground focus:border-primary disabled:opacity-50"
                >
                  <option value="">加一首…</option>
                  {addable.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title || '未识别的曲名'}
                      {s.artist ? ` · ${s.artist}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )
          )}

          <div className="pt-4">
            <button
              type="button"
              onClick={() => void start()}
              disabled={setlist.length === 0 || busy !== null}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-primary px-5 text-base font-medium text-primary-foreground hover:bg-primary-strong disabled:opacity-50"
            >
              {busy === 'start' ? '开始中…' : '开始排练'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function SetlistRow({
  song,
  index,
  total,
  progress,
  nameOf,
  busy,
  onStatus,
  onMove,
}: {
  song: BandSong
  index: number
  total: number
  progress: MemberProgress[]
  nameOf: (id: string) => string
  busy: boolean
  onStatus: () => void
  onMove: (dir: -1 | 1) => void
}) {
  const practice =
    progress.length === 0
      ? '还没有练习记录'
      : progress
          .map(
            (p) =>
              `${nameOf(p.userId)} ${fmtDuration(p.totalSeconds)}${p.maxSpeedPct ? ` · ${p.maxSpeedPct}%` : ''}`,
          )
          .join(' · ')

  const counts = new Map<string, number>()
  for (const userId of Object.values(song.parts)) counts.set(userId, (counts.get(userId) ?? 0) + 1)
  const parts =
    counts.size === 0
      ? '声部未分配'
      : [...counts].map(([userId, n]) => `${nameOf(userId)} ${n} 轨`).join(' · ')

  return (
    <li className="flex items-start gap-2.5 border-t border-border py-3 first:border-t-0">
      <span className="mono w-7 shrink-0 pt-1 text-right text-base font-semibold text-muted-foreground">
        {index + 1}.
      </span>
      <div className="min-w-0 flex-1">
        <Link
          href={hrefBandSong(song.id)}
          className="block break-words text-lg font-bold leading-snug transition-colors hover:text-primary"
        >
          {song.title || '未识别的曲名'}
        </Link>
        <p className="truncate text-sm text-muted-foreground">{song.artist || ' '}</p>
        <p className="mono mt-1 break-words text-[11px] leading-relaxed text-muted-foreground">
          {practice}
        </p>
        <p className="mono break-words text-[11px] leading-relaxed text-muted-foreground">
          声部：{parts}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <button
          type="button"
          onClick={onStatus}
          disabled={busy}
          aria-label={`状态：${STATUS_LABELS[song.status]}，点按切换`}
          className={cx(
            'inline-flex min-h-11 items-center rounded-full border px-3 text-[13px] transition-colors disabled:opacity-50',
            STATUS_CLASS[song.status],
          )}
        >
          {STATUS_LABELS[song.status]}
        </button>
        <div className="flex gap-1.5">
          <button
            type="button"
            aria-label="上移"
            title="上移"
            disabled={busy || index <= 0}
            onClick={() => onMove(-1)}
            className={ICON_BUTTON}
          >
            <span aria-hidden>↑</span>
          </button>
          <button
            type="button"
            aria-label="下移"
            title="下移"
            disabled={busy || index >= total - 1}
            onClick={() => onMove(1)}
            className={ICON_BUTTON}
          >
            <span aria-hidden>↓</span>
          </button>
        </div>
      </div>
    </li>
  )
}

/** Uploaded songs that no band song uses yet (hidden when there are none). */
function UnlistedUploads({ used }: { used: Set<string> }) {
  const [list, setList] = useState<UploadSong[]>([])

  useEffect(() => {
    let alive = true
    api.uploads().then(
      (all) => {
        if (alive) setList(all)
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [])

  const unlisted = list.filter((u) => !used.has(u.id))
  if (unlisted.length === 0) return null
  return (
    <div className="pt-6">
      <h3 className="label m-0">自己上传、还没加入歌单的歌</h3>
      <ul className="m-0 mt-2.5 list-none divide-y divide-border border-y border-border p-0">
        {unlisted.map((u) => (
          <li key={u.id}>
            <Link
              href={hrefUpload({ id: u.id })}
              className="flex min-h-11 items-center gap-3 py-2 text-sm hover:text-primary"
            >
              <span className="min-w-0 flex-1 truncate font-medium">{u.title || '未命名的歌'}</span>
              {u.artist && (
                <span className="shrink-0 text-xs text-muted-foreground">{u.artist}</span>
              )}
              <span className="mono shrink-0 text-xs text-muted-foreground">
                {u.files.length} 个文件
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Search the library for score files and add one version of a song to the setlist. */
function AddSongs({
  inSetlist,
  busy,
  run,
}: {
  inSetlist: Set<string>
  busy: string | null
  run: (key: string, job: () => Promise<void>) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<ScoreSearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  // Waits a moment after the last key, so typing does not search every letter.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(text.trim()), 250)
    return () => window.clearTimeout(t)
  }, [text])

  useEffect(() => {
    if (!query) {
      setFound(null)
      setSearchError(null)
      setSearching(false)
      return
    }
    const ac = new AbortController()
    setSearching(true)
    setSearchError(null)
    api
      .search(query, {}, ac.signal)
      .then(
        (r) => {
          if (!ac.signal.aborted) setFound(r)
        },
        (e: unknown) => {
          if (!ac.signal.aborted) setSearchError(errorText(e))
        },
      )
      .finally(() => {
        if (!ac.signal.aborted) setSearching(false)
      })
    return () => ac.abort()
  }, [query])

  // Only songs with at least one score-format file (GP / MusicXML) can be rehearsed.
  const songs = useMemo(
    () =>
      (found?.songs ?? [])
        .map(({ song, artistName }) => ({
          song,
          artistName,
          versions: song.versions.filter((v) => v.file.format === 'score'),
        }))
        .filter((x) => x.versions.length > 0),
    [found],
  )

  const add = (title: string, artist: string, v: ScoreVersion) =>
    void run(`add:${v.file.path}`, () => addSong({ path: v.file.path, title, artist }))

  return (
    <section aria-labelledby="band-add" className="max-w-[640px] pb-24 pt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="band-add" className="label m-0">
          添加歌曲
        </h2>
        <Link
          href={hrefEnsembles()}
          className="inline-flex min-h-11 items-center text-sm text-primary hover:underline"
        >
          找乐队谱 →
        </Link>
      </div>

      <label className="relative mt-3 block">
        <span className="sr-only">搜索谱库</span>
        <input
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="搜索歌名或歌手，选一个版本加入歌单"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-12 w-full rounded-[14px] border-0 bg-card px-4 text-base text-foreground outline-none ring-inset transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-primary [&::-webkit-search-cancel-button]:appearance-none"
        />
      </label>

      {!query && (
        <p className="pt-3 text-xs text-muted-foreground">输入歌名、歌手或拼音首字母开始搜索。</p>
      )}
      {searching && <p className="pt-3 text-sm text-muted-foreground">正在搜索…</p>}
      {searchError && (
        <div className="pt-3">
          <Notice tone="error">{searchError}</Notice>
        </div>
      )}
      {query && !searching && found && songs.length === 0 && !searchError && (
        <div className="pt-3">
          <Notice>没有找到带乐谱文件（GP / MusicXML）的歌曲。</Notice>
        </div>
      )}

      {songs.length > 0 && (
        <ul className="m-0 list-none p-0 pt-3">
          {songs.map(({ song, artistName, versions }) => {
            const title = song.unknownTitle ? (versions[0]?.label ?? song.title) : song.title
            return (
              <li key={song.id} className="border-t border-border py-3 first:border-t-0">
                <p className="m-0 break-words text-base font-bold">
                  {title || '未识别的曲名'}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {artistName}
                  </span>
                </p>
                <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
                  {versions.map((v) => {
                    const added = inSetlist.has(v.file.path)
                    const key = `add:${v.file.path}`
                    return (
                      <li key={v.file.path}>
                        <div className="flex items-center gap-2">
                          <FormatBadge format={v.file.format} />
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {v.label}
                            {v.tags.length > 0 && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {v.tags.join(' · ')}
                              </span>
                            )}
                          </span>
                          {added ? (
                            <span className="shrink-0 text-xs text-muted-foreground">已在歌单</span>
                          ) : (
                            <button
                              type="button"
                              disabled={busy !== null}
                              onClick={() => add(title, artistName, v)}
                              className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-border px-3 text-sm transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                              aria-label={busy === key ? '正在加入' : `加入歌单：${v.label}`}
                            >
                              {busy === key ? '加入中…' : '加入'}
                            </button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** A member's 每日一练 position and count, as one muted line. */
function dailyLine(p: DailyMemberProgress | undefined): string {
  if (!p || p.startedAt === null) return '还没开始每日一练'
  return `每日一练 第 ${todayNumber(p.startedAt, Date.now())} 天 · 完成 ${p.doneCount}`
}

/** The order with the entries at i and j swapped; the same list when either index is out of range. */
function swapped(ids: string[], i: number, j: number): string[] {
  const next = [...ids]
  const a = next[i]
  const b = next[j]
  if (a === undefined || b === undefined) return ids
  next[i] = b
  next[j] = a
  return next
}
