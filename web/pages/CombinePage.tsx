import { useEffect, useState } from 'react'
import { api, errorText, type ComboPart, type ComboRecipe, type SaveComboBody, type SongInfo } from '../lib/api'
import {
  hrefCombine,
  hrefComboViewer,
  loadVersionScore,
  loadVersionScoreFresh,
  useSongCombos,
} from '../lib/combos'
import { buttonClass, cx, PANEL, SELECT } from '../lib/classes'
import { fileBaseName, formatSize } from '../lib/format'
import { hrefSearch, hrefViewer, navigate } from '../lib/route'
import { useLoad, type Loaded } from '../lib/useLoad'
import { Link } from '../components/Link'
import { Notice, PageBar } from '../components/ui'
import { loadAlphaTab, type AlphaTab, type Score } from '../viewer/alphaTab'
import { trackLabels, type TrackLabel } from '../viewer/trackNames'
import {
  barFingerprint,
  combine,
  compareVersions,
  estimateOffset,
  estimateOffsetForScores,
  exportCombined,
  sectionAlign,
  songFingerprint,
  unrollRepeats,
} from '@/songs/combineScores'

type Track = Score['tracks'][number]
type Version = SongInfo['versions'][number]

const OFFSET_LIMIT = 200
const TRANSPOSE_LIMIT = 12

// ---------------------------------------------------------------------------
// score helpers (alignment and comparison come from songs/combineScores)
// ---------------------------------------------------------------------------

/** A version's score for alignment: an unrolled copy is made from a fresh read; cached scores are never changed. */
async function scoreFor(at: AlphaTab, path: string, unroll: boolean): Promise<Score> {
  if (!unroll) return loadVersionScore(path)
  return unrollRepeats(at, await loadVersionScoreFresh(path))
}

/** Where a part sits against the base, in bars (+ = starts later), with the row's note. */
function alignOf(base: Score, part: Score, track: number): { offsetBars: number | null; note: string } {
  const fail = { offsetBars: null, note: '没能自动对齐，请用 − / + 手动调整。' }
  if (!part.tracks[track]) return fail
  // The whole song's rhythm against the whole song (section names break ties); a part
  // that matches badly that way is tried on its own track's rhythm.
  let est = estimateOffsetForScores(base, part)
  if (est.score < 0.3) {
    const own = estimateOffset(songFingerprint(base), barFingerprint(part, track))
    if (own.score > est.score) est = own
  }
  let offsetBars: number | null = est.score >= 0.2 ? est.offsetBars : null
  if (offsetBars === null) offsetBars = sectionAlign(base, part)
  if (offsetBars === null) return fail
  const note =
    offsetBars === 0
      ? '已自动对齐：小节位置一致'
      : offsetBars > 0
        ? `已自动对齐：晚 ${offsetBars} 小节`
        : `已自动对齐：早 ${-offsetBars} 小节`
  return { offsetBars, note }
}

/** Version differences as Chinese warnings. */
function warningsOf(base: Score, part: Score): string[] {
  const r = compareVersions(base, part)
  const out: string[] = []
  if (r.bars[0] !== r.bars[1])
    out.push(`小节数不同（基准 ${r.bars[0]} 小节，此版本 ${r.bars[1]} 小节）。`)
  if (Math.round(r.tempo[0]) !== Math.round(r.tempo[1]))
    out.push(`速度不同（基准 ♩=${Math.round(r.tempo[0])}，此版本 ♩=${Math.round(r.tempo[1])}）。`)
  if (r.timeSignatureMismatches.length > 0)
    out.push(
      `第 ${r.timeSignatureMismatches
        .slice(0, 6)
        .map((b) => b + 1)
        .join('、')}${r.timeSignatureMismatches.length > 6 ? ' 等' : ''} 小节拍号不同。`,
    )
  if (r.hasRepeats[0] !== r.hasRepeats[1])
    out.push('两个版本的反复记号写法不同，建议勾选「展开反复记号」。')
  return out
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** A transposition hint when the part's lowest string sits a different number of semitones from a base track with the same string count. */
function tuningNote(baseTracks: Track[], part: Track | undefined): string | null {
  if (!part) return null
  const tuningOf = (t: Track) => t.staves.find((s) => !s.isPercussion)?.tuning ?? null
  const pt = tuningOf(part)
  if (!pt || pt.length === 0) return null
  const bt = baseTracks.map(tuningOf).find((t) => t && t.length === pt.length)
  if (!bt) return null
  const baseLow = Math.min(...bt)
  const partLow = Math.min(...pt)
  let d = (((baseLow - partLow) % 12) + 12) % 12
  if (d > 6) d -= 12
  if (d === 0) return null
  return `调弦可能不同（基准最低弦 ${NOTE_NAMES[baseLow % 12]}，此版本 ${NOTE_NAMES[partLow % 12]}）。若音高对不上，可把此声部变调 ${d > 0 ? '+' : ''}${d} 半音。`
}

interface Facts {
  bars: number
  tempo: number
  timeSignature: string
  sections: Array<{ bar: number; text: string }>
}

function factsOf(score: Score): Facts {
  const sections: Facts['sections'] = []
  score.masterBars.forEach((mb, i) => {
    if (mb.section) sections.push({ bar: i + 1, text: mb.section.text || mb.section.marker || '段落' })
  })
  const first = score.masterBars[0]
  return {
    bars: score.masterBars.length,
    tempo: Math.round(score.tempo),
    timeSignature: first ? `${first.timeSignatureNumerator}/${first.timeSignatureDenominator}` : '',
    sections,
  }
}

// ---------------------------------------------------------------------------
// editor state
// ---------------------------------------------------------------------------

/** A part as the editor holds it. */
interface PartDraft {
  key: string
  path: string
  track: number
  trackZh: string
  name: string
  offsetBars: number
  transpose: number
  unrollRepeats: boolean
  /** The user typed the offset: automatic alignment leaves it alone. */
  manual: boolean
  /** Signature of the base + part settings the offset and warnings were computed for. */
  alignedWith: string | null
  alignNote: string
  /** null = not compared yet. */
  warnings: string[] | null
  tuning: string | null
}

const baseSig = (base: string, baseUnroll: boolean) => `${base}\u0001${baseUnroll ? 1 : 0}`
const partSig = (base: string, baseUnroll: boolean, p: PartDraft) =>
  `${baseSig(base, baseUnroll)}\u0001${p.path}#${p.track}\u0001${p.unrollRepeats ? 1 : 0}`

const shortLabel = (label: string) => label.split(/[\s（(]/)[0] || label

const versionName = (versions: Version[], path: string) =>
  versions.find((v) => v.path === path)?.label ?? fileBaseName(path)

const offsetText = (n: number) => (n > 0 ? `晚 ${n} 小节` : n < 0 ? `早 ${-n} 小节` : '不移动')
const transposeText = (n: number) => (n > 0 ? `+${n} 半音` : n < 0 ? `${n} 半音` : '不变调')

let keySeq = 0
const newKey = () => `p${++keySeq}`

const clampOf = (n: number, limit: number) => Math.min(limit, Math.max(-limit, n))

function toComboPart(p: PartDraft): ComboPart {
  return {
    path: p.path,
    track: p.track,
    name: p.name.trim() || p.trackZh,
    offsetBars: p.offsetBars,
    transpose: p.transpose,
    unrollRepeats: p.unrollRepeats,
  }
}

function fromSaved(p: ComboPart, base: string, baseUnroll: boolean): PartDraft {
  const draft: PartDraft = {
    key: newKey(),
    path: p.path,
    track: p.track,
    trackZh: p.name,
    name: p.name,
    offsetBars: p.offsetBars,
    transpose: p.transpose,
    unrollRepeats: p.unrollRepeats,
    manual: false,
    alignedWith: null,
    alignNote: '已保存的对齐',
    warnings: null,
    tuning: null,
  }
  draft.alignedWith = partSig(base, baseUnroll, draft)
  return draft
}

interface PreviewResult {
  bars: number
  tracks: number
  kb: number
  warnings: string[]
}

// ---------------------------------------------------------------------------
// page
// ---------------------------------------------------------------------------

/** 组合乐队谱: take parts from several versions of one song and lay them on a base version. */
export function CombinePage({ path, id }: { path: string; id: string }) {
  const info = useLoad((signal) => api.song(path, signal), path)
  const combos = useSongCombos(path)
  const recipe = useLoad(
    (signal) => (id ? api.combo(id, signal) : Promise.resolve<ComboRecipe | null>(null)),
    id,
  )
  const song = info.status === 'ready' ? info.data : null
  const back = song
    ? hrefViewer({ path, format: 'score', title: song.title, artist: song.artist })
    : hrefSearch()

  return (
    <>
      <PageBar
        title="组合乐队谱"
        subtitle={song ? `${song.title}${song.artist ? ` · ${song.artist}` : ''}` : undefined}
        fallback={back}
        back="← 返回"
      />

      {info.status === 'loading' && (
        <p className="max-w-[640px] pt-6 text-sm text-muted-foreground">正在读取这首歌…</p>
      )}
      {info.status === 'error' && (
        <div className="max-w-[640px] pt-6">
          <Notice tone="error">{info.message}</Notice>
        </div>
      )}

      {song && (
        <>
          <RecipeList path={path} versions={song.versions} state={combos.state} onChanged={combos.reload} />

          {song.versions.length < 2 ? (
            <section className="max-w-[640px] pb-24 pt-8">
              <Notice>这首歌只有一个 GP 版本，无法组合。</Notice>
            </section>
          ) : id && recipe.status === 'loading' ? (
            <p className="max-w-[640px] pt-8 text-sm text-muted-foreground">正在读取这个组合…</p>
          ) : id && recipe.status === 'error' ? (
            <section className="max-w-[640px] pb-24 pt-8">
              <Notice tone="error">{recipe.message}</Notice>
              <Link
                href={hrefCombine(path)}
                className="mt-4 inline-flex min-h-11 items-center text-sm text-primary hover:underline"
              >
                ← 新建一个组合
              </Link>
            </section>
          ) : (
            <Editor
              key={id || 'new'}
              path={path}
              song={song}
              initial={id && recipe.status === 'ready' ? recipe.data : null}
              onSaved={combos.reload}
            />
          )}
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// existing recipes
// ---------------------------------------------------------------------------

function RecipeList({
  path,
  versions,
  state,
  onChanged,
}: {
  path: string
  versions: Version[]
  state: Loaded<ComboRecipe[]>
  onChanged: () => void
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async (r: ComboRecipe) => {
    setBusy(true)
    setError(null)
    try {
      await api.removeCombo(r.id)
      setConfirmId(null)
      onChanged()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="combo-list" className="max-w-[640px] pt-8">
      <h2 id="combo-list" className="label m-0">
        已有的组合
      </h2>
      {state.status === 'loading' && <p className="pt-3 text-sm text-muted-foreground">正在读取…</p>}
      {state.status === 'error' && (
        <div className="pt-3">
          <Notice tone="error">{state.message}</Notice>
        </div>
      )}
      {error && (
        <div className="pt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {state.status === 'ready' && state.data.length === 0 && (
        <div className="pt-3">
          <Notice>还没有组合过这首歌。在下面选择基准版本与声部即可。</Notice>
        </div>
      )}
      {state.status === 'ready' && state.data.length > 0 && (
        <ul className="m-0 list-none p-0 pt-2">
          {state.data.map((r) => (
            <li key={r.id} className="border-t border-border py-3 first:border-t-0">
              <p className="m-0 break-words text-base font-bold">{r.title}</p>
              <p className="m-0 break-words pt-0.5 text-xs text-muted-foreground">
                基准：{versionName(versions, r.base)} · 声部：{r.parts.map((p) => p.name).join('、') || '无'}
              </p>
              <p className="mono m-0 pt-0.5 text-[11px] text-muted-foreground">
                {new Date(r.updatedAt).toLocaleString('zh-CN')}
              </p>
              {confirmId === r.id ? (
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <span className="text-sm">删除这个组合？谱子文件不受影响。</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void remove(r)}
                    className="inline-flex min-h-11 items-center rounded-lg bg-destructive px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    确认删除
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(null)}
                    className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm text-muted-foreground hover:text-foreground"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <Link href={hrefComboViewer(r)} className={cx(buttonClass('primary'), 'min-h-11')}>
                    打开
                  </Link>
                  <Link href={hrefCombine(path, r.id)} className={cx(buttonClass('outline'), 'min-h-11')}>
                    编辑
                  </Link>
                  <button
                    type="button"
                    onClick={() => setConfirmId(r.id)}
                    className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-muted-foreground hover:text-destructive"
                  >
                    删除
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// editor: base, parts, preview and save
// ---------------------------------------------------------------------------

function Editor({
  path,
  song,
  initial,
  onSaved,
}: {
  path: string
  song: SongInfo
  initial: ComboRecipe | null
  onSaved: () => void
}) {
  const [id, setId] = useState<string | null>(initial?.id ?? null)
  const [base, setBase] = useState(initial?.base ?? path)
  const [baseUnroll, setBaseUnroll] = useState(initial?.baseUnrollRepeats ?? false)
  const [parts, setParts] = useState<PartDraft[]>(() =>
    initial ? initial.parts.map((p) => fromSaved(p, initial.base, initial.baseUnrollRepeats)) : [],
  )
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null)
  const [notice, setNotice] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)

  const update = (key: string, patch: Partial<PartDraft>) =>
    setParts((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)))

  // Align each part to the base (and check the versions) when it is new or the base changed.
  useEffect(() => {
    const todo = parts.filter((p) => p.alignedWith !== partSig(base, baseUnroll, p) || p.warnings === null)
    if (todo.length === 0) return
    let cancelled = false
    void (async () => {
      const at = await loadAlphaTab().catch((e: unknown) => {
        const message = `乐谱组件没有就绪：${errorText(e)}`
        setParts((prev) =>
          prev.map((x) =>
            todo.some((t) => t.key === x.key)
              ? { ...x, alignedWith: partSig(base, baseUnroll, x), warnings: [message] }
              : x,
          ),
        )
        return null
      })
      if (!at) return
      for (const p of todo) {
        if (cancelled) return
        const sigNow = partSig(base, baseUnroll, p)
        const aligning = p.alignedWith !== sigNow
        try {
          const baseScore = await scoreFor(at, base, baseUnroll)
          const partScore = await scoreFor(at, p.path, p.unrollRepeats)
          const align = aligning ? alignOf(baseScore, partScore, p.track) : null
          const warnings = warningsOf(baseScore, partScore)
          const tuning = tuningNote(baseScore.tracks, partScore.tracks[p.track])
          if (cancelled) return
          setParts((prev) =>
            prev.map((x) =>
              x.key !== p.key
                ? x
                : {
                    ...x,
                    alignedWith: sigNow,
                    alignNote: align ? align.note : x.alignNote,
                    offsetBars:
                      align && align.offsetBars !== null && !x.manual ? align.offsetBars : x.offsetBars,
                    warnings,
                    tuning,
                  },
            ),
          )
        } catch (e) {
          if (cancelled) return
          setParts((prev) =>
            prev.map((x) =>
              x.key !== p.key
                ? x
                : {
                    ...x,
                    alignedWith: sigNow,
                    alignNote: '没能自动对齐，请用 − / + 手动调整。',
                    warnings: [`读不出这个版本：${errorText(e)}`],
                  },
            ),
          )
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [parts, base, baseUnroll])

  const included = (p: string, track: number) => parts.some((x) => x.path === p && x.track === track)

  const toggleTrack = (v: Version, track: number, label: TrackLabel) => {
    if (included(v.path, track)) {
      setParts((prev) => prev.filter((p) => !(p.path === v.path && p.track === track)))
    } else {
      setParts((prev) => [
        ...prev,
        {
          key: newKey(),
          path: v.path,
          track,
          trackZh: label.zh,
          name: `${label.zh}（${shortLabel(v.label)}）`,
          offsetBars: 0,
          transpose: 0,
          unrollRepeats: false,
          manual: false,
          alignedWith: null,
          alignNote: '正在自动对齐…',
          warnings: null,
          tuning: null,
        },
      ])
    }
  }

  const buildCombined = async () => {
    const at = await loadAlphaTab()
    const baseScore = baseUnroll
      ? unrollRepeats(at, await loadVersionScoreFresh(base))
      : await loadVersionScoreFresh(base)
    const inputs = await Promise.all(
      parts.map(async (p) => {
        const s = await loadVersionScoreFresh(p.path)
        return { ...toComboPart(p), score: p.unrollRepeats ? unrollRepeats(at, s) : s }
      }),
    )
    return { at, result: combine(at, baseScore, inputs, { keepBaseTracks: [] }) }
  }

  const runPreview = async () => {
    setBusy('preview')
    setNotice(null)
    setPreview(null)
    try {
      const { at, result } = await buildCombined()
      const bytes = exportCombined(at, result.score)
      setPreview({
        bars: result.score.masterBars.length,
        tracks: result.score.tracks.length,
        kb: Math.max(1, Math.round(bytes.length / 1024)),
        warnings: result.warnings,
      })
    } catch (e) {
      setNotice({ tone: 'error', text: `试看没有成功：${errorText(e)}` })
    } finally {
      setBusy(null)
    }
  }

  const save = async (open: boolean) => {
    if (parts.length === 0) {
      setNotice({ tone: 'error', text: '还没有加入任何声部。' })
      return
    }
    setBusy('save')
    setNotice(null)
    try {
      const body: SaveComboBody = {
        recipe: {
          id,
          songKey: song.songKey,
          title: song.title,
          artist: song.artist,
          base,
          baseUnrollRepeats: baseUnroll,
          parts: parts.map(toComboPart),
        },
      }
      const saved = await api.saveCombo(body)
      setId(saved.id)
      onSaved()
      if (open) navigate(hrefComboViewer(saved))
      else setNotice({ tone: 'ok', text: '已保存。' })
    } catch (e) {
      setNotice({ tone: 'error', text: errorText(e) })
    } finally {
      setBusy(null)
    }
  }

  const setOffset = (key: string, n: number) => update(key, { offsetBars: clampOf(n, OFFSET_LIMIT), manual: true })

  return (
    <>
      <section aria-labelledby="combo-base" className="max-w-[640px] pt-8">
        <h2 id="combo-base" className="label m-0">
          1 基准版本
        </h2>
        <p className="m-0 pt-1 text-xs text-muted-foreground">基准版本决定小节、速度与段落；选定的声部会按它对齐。</p>
        <ul className="m-0 list-none p-0 pt-2.5">
          {song.versions.map((v) => (
            <li key={v.path} className="border-t border-border first:border-t-0">
              <button
                type="button"
                aria-pressed={base === v.path}
                onClick={() => setBase(v.path)}
                className={cx(
                  'flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-left transition-colors',
                  base === v.path ? 'text-primary' : 'hover:text-foreground',
                )}
              >
                <span
                  aria-hidden
                  className={cx(
                    'grid h-4 w-4 shrink-0 place-items-center rounded-full border',
                    base === v.path ? 'border-primary' : 'border-border',
                  )}
                >
                  {base === v.path && <span className="h-2 w-2 rounded-full bg-primary" />}
                </span>
                <span className="min-w-0 flex-1 break-words text-base font-medium">{v.label}</span>
                <VersionMeta v={v} />
              </button>
            </li>
          ))}
        </ul>
        <div className={cx(PANEL, 'mt-3 p-4')}>
          <BaseSummary path={base} unroll={baseUnroll} />
          <label className="mt-3 flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={baseUnroll}
              onChange={(e) => setBaseUnroll(e.target.checked)}
              className="h-5 w-5 accent-primary"
            />
            <span>展开反复记号</span>
          </label>
          <p className="m-0 text-xs text-muted-foreground">
            两个版本写反复的方式不同（例如一个写了反复、另一个全部写出）时勾选，会先把反复展开成完整的小节。
          </p>
        </div>
      </section>

      <section aria-labelledby="combo-parts" className="max-w-[640px] pt-8">
        <h2 id="combo-parts" className="label m-0">
          2 选择声部
        </h2>
        <p className="m-0 pt-1 text-xs text-muted-foreground">
          展开一个版本，勾选需要的音轨。基准版本的音轨也可以加入（例如只取它的鼓）。
        </p>
        <ul className="m-0 list-none p-0 pt-2.5">
          {song.versions.map((v) => {
            const open = openPath === v.path
            const count = parts.filter((p) => p.path === v.path).length
            return (
              <li key={v.path} className="border-t border-border first:border-t-0">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenPath(open ? null : v.path)}
                  className="flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-left"
                >
                  <span className="min-w-0 flex-1 break-words text-base font-medium">
                    {v.label}
                    {v.path === base && <span className="ml-2 text-xs text-primary">基准</span>}
                  </span>
                  {count > 0 && (
                    <span className="mono text-xs text-primary">已选 {count}</span>
                  )}
                  <VersionMeta v={v} />
                  <span aria-hidden className="text-muted-foreground">
                    {open ? '收起 ▴' : '展开 ▾'}
                  </span>
                </button>
                {open && (
                  <VersionTracks
                    path={v.path}
                    isOn={(track) => included(v.path, track)}
                    onToggle={(track, label) => toggleTrack(v, track, label)}
                    disabled={busy !== null}
                  />
                )}
              </li>
            )
          })}
        </ul>

        <h3 className="label mt-7 m-0">已加入的声部（{parts.length}）</h3>
        {parts.length === 0 ? (
          <div className="pt-3">
            <Notice>还没有加入声部。展开上面的版本，勾选需要的音轨。</Notice>
          </div>
        ) : (
          <ul className="m-0 list-none p-0 pt-2">
            {parts.map((p) => (
              <PartRow
                key={p.key}
                part={p}
                sourceName={versionName(song.versions, p.path)}
                disabled={busy !== null}
                onName={(name) => update(p.key, { name })}
                onOffset={(n) => setOffset(p.key, n)}
                onAutoAlign={() => update(p.key, { manual: false, alignedWith: null, alignNote: '正在自动对齐…' })}
                onTranspose={(n) => update(p.key, { transpose: clampOf(n, TRANSPOSE_LIMIT) })}
                onUnroll={(on) => update(p.key, { unrollRepeats: on })}
                onRemove={() => setParts((prev) => prev.filter((x) => x.key !== p.key))}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="combo-save" className="max-w-[640px] pb-24 pt-8">
        <h2 id="combo-save" className="label m-0">
          3 试看与保存
        </h2>
        {notice && (
          <div className="pt-3">
            <Notice tone={notice.tone === 'error' ? 'error' : 'muted'}>{notice.text}</Notice>
          </div>
        )}
        {preview && (
          <div className={cx(PANEL, 'mt-3 p-4 text-sm')}>
            <p className="m-0">
              组合完成：{preview.bars} 小节，{preview.tracks} 个声部，导出约 {preview.kb} KB。
            </p>
            {preview.warnings.length > 0 ? (
              <ul className="m-0 list-none p-0 pt-2 text-muted-foreground">
                {preview.warnings.map((w, i) => (
                  <li key={i} className="pt-1 text-xs">
                    · {w}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 pt-1 text-xs text-muted-foreground">没有需要注意的地方。</p>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-4">
          <button
            type="button"
            onClick={() => void runPreview()}
            disabled={parts.length === 0 || busy !== null}
            className={buttonClass('outline')}
          >
            {busy === 'preview' ? '正在试看…' : '试看'}
          </button>
          <button
            type="button"
            onClick={() => void save(false)}
            disabled={parts.length === 0 || busy !== null}
            className={buttonClass('outline')}
          >
            保存
          </button>
          <button
            type="button"
            onClick={() => void save(true)}
            disabled={parts.length === 0 || busy !== null}
            className={buttonClass('primary')}
          >
            {busy === 'save' ? '正在保存…' : '保存并打开'}
          </button>
        </div>
        {parts.length === 0 && (
          <p className="m-0 pt-2 text-xs text-muted-foreground">加入至少一个声部后才能试看与保存。</p>
        )}
      </section>
    </>
  )
}

// ---------------------------------------------------------------------------
// pieces
// ---------------------------------------------------------------------------

/** Tags and size of one version. */
function VersionMeta({ v }: { v: Version }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {v.tags.map((t) => (
        <span
          key={t}
          className="rounded-full border border-border px-2 py-px text-[11px] leading-5 text-muted-foreground"
        >
          {t}
        </span>
      ))}
      <span className="mono text-[11px] text-muted-foreground">{formatSize(v.size)}</span>
    </span>
  )
}

/** The base version's bars, tempo, time signature and sections (read when shown). */
function BaseSummary({ path, unroll }: { path: string; unroll: boolean }) {
  const facts = useLoad(async () => {
    const at = await loadAlphaTab()
    return factsOf(await scoreFor(at, path, unroll))
  }, `${path}\u0001${unroll ? 1 : 0}`)

  if (facts.status === 'loading') return <p className="m-0 text-sm text-muted-foreground">正在读取基准版本…</p>
  if (facts.status === 'error') return <Notice tone="error">{facts.message}</Notice>
  const f = facts.data
  return (
    <div className="text-sm">
      <p className="m-0 flex flex-wrap gap-x-5 gap-y-1">
        <span>
          小节 <span className="mono font-semibold">{f.bars}</span>
        </span>
        <span>
          速度 <span className="mono font-semibold">♩={f.tempo}</span>
        </span>
        {f.timeSignature && (
          <span>
            拍号 <span className="mono font-semibold">{f.timeSignature}</span>
          </span>
        )}
      </p>
      {f.sections.length > 0 ? (
        <p className="m-0 pt-2 text-xs text-muted-foreground">
          段落：{f.sections.map((s) => `${s.text}（第 ${s.bar} 小节）`).join('、')}
        </p>
      ) : (
        <p className="m-0 pt-2 text-xs text-muted-foreground">这个版本没有段落标记。</p>
      )}
    </div>
  )
}

/** One version's tracks with an 「加入」 checkbox each; read when the version is opened. */
function VersionTracks({
  path,
  isOn,
  onToggle,
  disabled,
}: {
  path: string
  isOn: (track: number) => boolean
  onToggle: (track: number, label: TrackLabel) => void
  disabled: boolean
}) {
  const tracks = useLoad(async () => {
    const score = await loadVersionScore(path)
    return trackLabels(score.tracks)
  }, path)

  if (tracks.status === 'loading') return <p className="m-0 pb-3 text-sm text-muted-foreground">正在读取音轨…</p>
  if (tracks.status === 'error') return <div className="pb-3"><Notice tone="error">读不出这个版本的音轨：{tracks.message}</Notice></div>
  if (tracks.data.length === 0) return <div className="pb-3"><Notice>这个版本没有音轨。</Notice></div>
  return (
    <ul className="m-0 list-none p-0 pb-3">
      {tracks.data.map((label, i) => {
        const on = isOn(i)
        return (
          <li key={i} className="border-t border-border first:border-t-0">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 py-2">
              <input
                type="checkbox"
                checked={on}
                disabled={disabled}
                onChange={() => onToggle(i, label)}
                className="h-5 w-5 shrink-0 accent-primary"
              />
              <span className="min-w-0 flex-1">
                <span className={cx('block break-words text-base', on && 'font-semibold text-primary')}>
                  {label.zh}
                </span>
                {label.original && (
                  <span className="mono block break-words text-xs text-muted-foreground">{label.original}</span>
                )}
              </span>
              <span className="text-xs text-muted-foreground">{on ? '已加入' : '加入'}</span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}

/** A part row: name, alignment (with − / + and a return to automatic), transpose, repeats and warnings. */
function PartRow({
  part,
  sourceName,
  disabled,
  onName,
  onOffset,
  onAutoAlign,
  onTranspose,
  onUnroll,
  onRemove,
}: {
  part: PartDraft
  sourceName: string
  disabled: boolean
  onName: (name: string) => void
  onOffset: (n: number) => void
  onAutoAlign: () => void
  onTranspose: (n: number) => void
  onUnroll: (on: boolean) => void
  onRemove: () => void
}) {
  const stepper = 'grid h-11 w-11 place-items-center rounded-lg border border-border text-lg transition-colors hover:border-foreground disabled:opacity-40'
  return (
    <li className="border-t border-border py-3 first:border-t-0">
      <input
        value={part.name}
        maxLength={40}
        aria-label="声部名称"
        disabled={disabled}
        onChange={(e) => onName(e.target.value)}
        className={cx(SELECT, 'w-full')}
      />
      <p className="m-0 pt-1.5 text-xs text-muted-foreground">
        来自：{sourceName} · 第 {part.track + 1} 音轨
      </p>
      <p className="m-0 pt-0.5 text-xs text-primary">
        {part.alignNote}
        {part.manual ? '（已手动调整）' : ''}
      </p>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-2.5">
        <div className="flex items-center gap-1" role="group" aria-label="对齐">
          <span className="mr-1 text-sm text-muted-foreground">对齐</span>
          <button
            type="button"
            aria-label="提前一小节"
            disabled={disabled || part.offsetBars <= -OFFSET_LIMIT}
            onClick={() => onOffset(part.offsetBars - 1)}
            className={stepper}
          >
            <span aria-hidden>−</span>
          </button>
          <span className="mono w-24 text-center text-sm tabular-nums">{offsetText(part.offsetBars)}</span>
          <button
            type="button"
            aria-label="延后一小节"
            disabled={disabled || part.offsetBars >= OFFSET_LIMIT}
            onClick={() => onOffset(part.offsetBars + 1)}
            className={stepper}
          >
            <span aria-hidden>+</span>
          </button>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="变调">
          <span className="mr-1 text-sm text-muted-foreground">变调</span>
          <button
            type="button"
            aria-label="降半音"
            disabled={disabled || part.transpose <= -TRANSPOSE_LIMIT}
            onClick={() => onTranspose(part.transpose - 1)}
            className={stepper}
          >
            <span aria-hidden>−</span>
          </button>
          <span className="mono w-24 text-center text-sm tabular-nums">{transposeText(part.transpose)}</span>
          <button
            type="button"
            aria-label="升半音"
            disabled={disabled || part.transpose >= TRANSPOSE_LIMIT}
            onClick={() => onTranspose(part.transpose + 1)}
            className={stepper}
          >
            <span aria-hidden>+</span>
          </button>
        </div>
        {part.manual && (
          <button
            type="button"
            disabled={disabled}
            onClick={onAutoAlign}
            className="inline-flex min-h-11 items-center text-sm text-primary hover:underline disabled:opacity-50"
          >
            恢复自动对齐
          </button>
        )}
      </div>

      <label className="mt-2 flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={part.unrollRepeats}
          disabled={disabled}
          onChange={(e) => onUnroll(e.target.checked)}
          className="h-5 w-5 accent-primary"
        />
        <span>展开反复记号</span>
      </label>

      {part.tuning && <p className="m-0 pt-1 text-xs text-muted-foreground">{part.tuning}</p>}
      {part.warnings && part.warnings.length > 0 && (
        <ul className="m-0 list-none p-0 pt-1">
          {part.warnings.map((w, i) => (
            <li key={i} className="text-xs leading-relaxed text-muted-foreground">
              · {w}
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-end pt-1">
        <button
          type="button"
          disabled={disabled}
          onClick={onRemove}
          className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-muted-foreground hover:text-destructive disabled:opacity-50"
        >
          移除
        </button>
      </div>
    </li>
  )
}
