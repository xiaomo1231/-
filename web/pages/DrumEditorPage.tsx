import { useEffect, useMemo, useState, type ChangeEvent, type MouseEvent } from 'react'
import { api, errorText, fetchBytes, fileUrl } from '../lib/api'
import { changeResolution, clearBars, copyBars, createHistory, current, emptyBar, pasteBars, push, repeatBars, replaceRange, toggleHit, undo, redo, visiblePieces } from '@/songs/drumPart'
import { buildDrumTrack, exportGp, findDrumTrack, partFromTrack } from '@/songs/drumScore'
import { DRUM_PIECES, type DrumBar, type DrumPart, type DrumPiece, type DrumSource, type DrumVelocity } from '@/songs/drumTypes'
import { buttonClass, cx, SELECT } from '../lib/classes'
import { removeDrumPart, saveDrumPart, useDrumPart, useDrumStyles } from '../lib/drums'
import { goBack, hrefViewer, navigate } from '../lib/route'
import { Notice, Seg, Staff } from '../components/ui'
import { chooseEncoding, loadAlphaTab, type Score } from '../viewer/alphaTab'
import { DrumEditorGrid } from '../viewer/DrumEditorGrid'
import { trackLabels, type TrackLabel } from '../viewer/trackNames'

type History = ReturnType<typeof createHistory>
type VelKey = 'accent' | 'normal' | 'ghost'
type Engine = 'template' | 'drumify'
type Leave = { kind: 'back' } | { kind: 'href'; href: string }
type Note = { tone: 'muted' | 'error'; text: string }

const VEL_OPTIONS: ReadonlyArray<readonly [VelKey, string]> = [
  ['accent', '重音'],
  ['normal', '普通'],
  ['ghost', '鬼音'],
]
const VEL_OF: Record<VelKey, DrumVelocity> = { accent: 3, normal: 2, ghost: 1 }

const ENGINE_OPTIONS: ReadonlyArray<readonly [Engine, string]> = [
  ['template', '模板'],
  ['drumify', 'AI（Drumify）'],
]

const SHOW_OPTIONS: ReadonlyArray<readonly ['common' | 'all', string]> = [
  ['common', '常用乐器'],
  ['all', '全部乐器'],
]

const RESOLUTIONS: ReadonlyArray<readonly [4 | 3 | 6, string]> = [
  [4, '16 分'],
  [3, '三连音'],
  [6, '16 分三连音'],
]

const SOURCE_ZH: Record<DrumSource, string> = {
  file: '来自谱子',
  template: '模板生成',
  drumify: 'AI 生成',
  hand: '手写',
}

const ALL_PIECES: DrumPiece[] = DRUM_PIECES.map((p) => p.id)
const COMMON_PIECES: DrumPiece[] = DRUM_PIECES.filter((p) => p.common).map((p) => p.id)

interface ScoreData {
  score: Score
  bytes: Uint8Array
  labels: TrackLabel[]
  /** Track indexes that are not drums (the guide track choices). */
  guides: number[]
  /** Index of the file's drum track, or -1. */
  drumIndex: number
  /** Master bars: meter of each bar. */
  meter: Array<{ num: number; den: number }>
}

type ScoreState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: ScoreData }

const isDrumTrack = (t: Score['tracks'][number]) =>
  Boolean(t.isPercussion) || t.staves.some((s) => Boolean(s.isPercussion))

const timeText = (ms: number) =>
  new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

/**
 * 编辑鼓谱: a drum part for one score file, edited as a step grid. The score file is
 * only read (for its bars and tracks); saving stores the part on the server, and
 * 导出 GP writes a new file with the drum track added.
 */
export function DrumEditorPage({ path, title, artist }: { path: string; title: string; artist: string }) {
  const saved = useDrumPart(path)
  const styles = useDrumStyles()

  const [scoreState, setScoreState] = useState<ScoreState>({ status: 'loading' })
  const [hist, setHist] = useState<History | null>(null)
  /** The part during a pointer drag or a key press; pushed to history when the gesture ends. */
  const [draft, setDraft] = useState<DrumPart | null>(null)
  /** The part object as last saved (or as first opened): the page is unsaved when the live part differs. */
  const [baseline, setBaseline] = useState<DrumPart | null>(null)
  const [initialized, setInitialized] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const [vel, setVel] = useState<VelKey>('normal')
  const [selection, setSelection] = useState<[number, number] | null>(null)
  const [clip, setClip] = useState<DrumBar[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [repeatTo, setRepeatTo] = useState('')

  const [genOpen, setGenOpen] = useState(false)
  const [engine, setEngine] = useState<Engine>('template')
  const [style, setStyle] = useState('')
  const [guide, setGuide] = useState('')
  const [temperature, setTemperature] = useState(0.7)
  const [confirmWhole, setConfirmWhole] = useState(false)

  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [leaveTo, setLeaveTo] = useState<Leave | null>(null)

  // Read the score file in the browser: its bars, tracks and drum track.
  useEffect(() => {
    let cancelled = false
    setScoreState({ status: 'loading' })
    void (async () => {
      try {
        const at = await loadAlphaTab()
        const bytes = await fetchBytes(fileUrl(path))
        const settings = new at.Settings()
        settings.importer.encoding = chooseEncoding(at, bytes)
        const score = at.importer.ScoreLoader.loadScoreFromBytes(bytes, settings)
        const drumTrack = findDrumTrack(score)
        const data: ScoreData = {
          score,
          bytes,
          labels: trackLabels(score.tracks),
          guides: score.tracks.flatMap((t, i) => (isDrumTrack(t) ? [] : [i])),
          drumIndex: typeof drumTrack === 'number' ? drumTrack : -1,
          meter: score.masterBars.map((mb) => ({
            num: mb.timeSignatureNumerator,
            den: mb.timeSignatureDenominator,
          })),
        }
        if (!cancelled) setScoreState({ status: 'ready', data })
      } catch (e) {
        if (!cancelled) setScoreState({ status: 'error', message: `读不出这个谱子：${errorText(e)}` })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [path])

  // Open the saved part once, when the server has answered.
  useEffect(() => {
    if (!saved.loaded || initialized) return
    setInitialized(true)
    if (saved.part) {
      setHist(createHistory(saved.part))
      setBaseline(saved.part)
    }
  }, [saved.loaded, saved.part, initialized])

  const score = scoreState.status === 'ready' ? scoreState.data : null
  const live: DrumPart | null = draft ?? (hist ? current(hist) : null)
  const dirty = live !== null && live !== baseline
  const pieceKey = live ? visiblePieces(live).join(',') : ''
  const pieces = useMemo<DrumPiece[]>(() => {
    if (showAll) return ALL_PIECES
    return pieceKey ? (pieceKey.split(',') as DrumPiece[]) : COMMON_PIECES
  }, [showAll, pieceKey])

  const canUndo = hist !== null && current(undo(hist)) !== current(hist)
  const canRedo = hist !== null && current(redo(hist)) !== current(hist)
  const mismatch = score && live && live.bars.length !== score.meter.length

  /** A finished change: one history step. */
  const commit = (next: DrumPart) => {
    setDraft(null)
    setHist((h) => (h ? push(h, next) : createHistory(next)))
  }
  const commitEdited = (next: DrumPart) => commit({ ...next, edited: true, updatedAt: Date.now() })

  // Cell toggles while a gesture is open accumulate in `draft`; the gesture end pushes one step.
  const onToggle = (bar: number, step: number, piece: DrumPiece) => {
    const base = draft ?? live
    if (!base) return
    const b = base.bars[bar]
    if (!b) return
    const bars = base.bars.slice()
    bars[bar] = toggleHit(b, step, piece, VEL_OF[vel])
    setDraft({ ...base, bars, edited: true, updatedAt: Date.now() })
  }
  const onGestureEnd = () => {
    if (!draft) return
    const d = draft
    setDraft(null)
    setHist((h) => (h ? push(h, d) : createHistory(d)))
  }

  const doUndo = () => {
    if (hist && !draft && canUndo) setHist(undo(hist))
  }
  const doRedo = () => {
    if (hist && !draft && canRedo) setHist(redo(hist))
  }

  const copySelection = () => {
    if (!live || !selection) return
    const bars = copyBars(live, selection[0], selection[1])
    setClip(bars)
    setNote({ tone: 'muted', text: `已复制 ${selection[1] - selection[0] + 1} 小节。` })
  }
  const paste = () => {
    if (!live || !selection || !clip) return
    commitEdited(pasteBars(live, selection[0], clip))
  }
  const clearSelection = () => {
    if (!live || !selection) return
    commitEdited(clearBars(live, selection[0], selection[1]))
  }
  const repeatSelection = () => {
    if (!live || !selection) return
    const until = Number(repeatTo) - 1
    if (!Number.isInteger(until) || until <= selection[1] || until >= live.bars.length) {
      setNote({ tone: 'error', text: `请输入 ${selection[1] + 2} 到 ${live.bars.length} 之间的小节号。` })
      return
    }
    commitEdited(repeatBars(live, selection[0], selection[1], until))
    setNote(null)
  }
  const setResolution = (spq: 4 | 3 | 6) => {
    if (!live || !selection) return
    const bars = live.bars.slice()
    for (let i = selection[0]; i <= selection[1]; i++) {
      const b = bars[i]
      if (b) bars[i] = changeResolution(b, spq)
    }
    commitEdited({ ...live, bars })
  }

  // Keyboard: Ctrl+S, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, Ctrl+C / Ctrl+V on the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && key === 's') {
        e.preventDefault()
        void save()
        return
      }
      if (typing || !mod) return
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        doUndo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        doRedo()
      } else if (key === 'c' && selection && !window.getSelection()?.toString()) {
        e.preventDefault()
        copySelection()
      } else if (key === 'v' && selection && clip) {
        e.preventDefault()
        paste()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Leaving with unsaved changes: the browser's own prompt on reload / close.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const save = async (): Promise<boolean> => {
    if (!live || busy) return false
    const snapshot = live
    setBusy('save')
    setNote(null)
    try {
      const result = await saveDrumPart({ ...snapshot, path })
      setBaseline(snapshot)
      setSavedAt(result.updatedAt || Date.now())
      setNote({ tone: 'muted', text: '已保存。' })
      return true
    } catch (e) {
      setNote({ tone: 'error', text: `保存没有成功：${errorText(e)}` })
      return false
    } finally {
      setBusy(null)
    }
  }

  const leaveNow = (l: Leave) => {
    if (l.kind === 'back') goBack(viewerHref)
    else navigate(l.href)
  }
  const requestLeave = (l: Leave) => {
    if (dirty) setLeaveTo(l)
    else leaveNow(l)
  }
  const saveAndLeave = async () => {
    const target = leaveTo
    if (!target) return
    if (await save()) {
      setLeaveTo(null)
      leaveNow(target)
    }
  }
  const discardAndLeave = () => {
    const target = leaveTo
    setLeaveTo(null)
    if (target) leaveNow(target)
  }

  const remove = async () => {
    setBusy('remove')
    setNote(null)
    try {
      await removeDrumPart(path)
      setHist(null)
      setDraft(null)
      setBaseline(null)
      setSavedAt(null)
      setSelection(null)
      setConfirmRemove(false)
      setNote({ tone: 'muted', text: '已删除鼓谱，谱子本身没有改动。' })
    } catch (e) {
      setNote({ tone: 'error', text: `删除没有成功：${errorText(e)}` })
    } finally {
      setBusy(null)
    }
  }

  const startFromTrack = () => {
    if (!score || score.drumIndex < 0) return
    try {
      const part = partFromTrack(score.score, score.drumIndex, { path, title, artist, updatedBy: '' })
      setHist(createHistory(part))
      setBaseline(null)
      setSavedAt(null)
      setNote(null)
    } catch (e) {
      setNote({ tone: 'error', text: `没能从鼓轨读出鼓谱：${errorText(e)}` })
    }
  }

  const startBlank = () => {
    if (!score) return
    const part: DrumPart = {
      version: 1,
      path,
      title,
      artist,
      bars: score.meter.map((m) => emptyBar(m.num, m.den, 4)),
      source: 'hand',
      edited: false,
      style: null,
      updatedAt: Date.now(),
      updatedBy: '',
    }
    setHist(createHistory(part))
    setBaseline(null)
    setSavedAt(null)
    setNote(null)
  }

  const generate = async (range: [number, number] | null) => {
    if (!score || busy) return
    setBusy('generate')
    setNote(null)
    setConfirmWhole(false)
    try {
      const result = await api.generateDrums({
        path,
        title,
        artist,
        engine,
        style: style || null,
        guideTrack: guide === '' ? null : Number(guide),
        range,
        temperature,
      })
      const cur = draft ?? (hist ? current(hist) : null)
      if (!range || !cur) {
        commit({
          version: 1,
          path,
          title,
          artist,
          bars: result.bars,
          source: result.source,
          edited: false,
          style: result.style,
          updatedAt: Date.now(),
          updatedBy: '',
        })
      } else {
        commitEdited(replaceRange(cur, result.first, result.bars))
      }
      setNote({ tone: 'muted', text: range ? '已重新生成所选小节。' : '已生成整首鼓谱。' })
    } catch (e) {
      setNote({ tone: 'error', text: `生成没有成功：${errorText(e)}` })
    } finally {
      setBusy(null)
    }
  }

  const downloadGp = async () => {
    if (!score || !live || busy) return
    setBusy('export')
    setNote(null)
    try {
      const at = await loadAlphaTab()
      // A fresh copy of the score, so the loaded one stays as it was.
      const settings = new at.Settings()
      settings.importer.encoding = chooseEncoding(at, score.bytes)
      const copy = at.importer.ScoreLoader.loadScoreFromBytes(score.bytes, settings)
      buildDrumTrack(at, copy, live, '鼓')
      const out = exportGp(at, copy)
      const blob = new Blob([out as BlobPart], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${title || '未命名'}（鼓谱）.gp`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNote({ tone: 'muted', text: '已导出 GP 文件；原谱子没有改动。' })
    } catch (e) {
      setNote({ tone: 'error', text: `导出没有成功：${errorText(e)}` })
    } finally {
      setBusy(null)
    }
  }

  const viewerHref = hrefViewer({ path, format: 'score', title, artist })
  const playHref = `${viewerHref}&drums=1`
  const hasSelection = selection !== null
  const panelOpen = genOpen || live === null
  const status = !live
    ? ''
    : dirty
      ? '有未保存的修改'
      : savedAt
        ? `已保存 ${timeText(savedAt)}`
        : baseline
          ? '已保存'
          : '尚未保存'
  const busyAny = busy !== null
  const selectedText = selection
    ? selection[0] === selection[1]
      ? `已选第 ${selection[0] + 1} 小节`
      : `已选第 ${selection[0] + 1}–${selection[1] + 1} 小节`
    : '点小节号选择；Shift+点击扩展选区'

  const header = (
    <header className="flex flex-wrap items-end gap-x-4 gap-y-2 pb-[18px] pt-9">
      <div className="min-w-0 flex-1 basis-64">
        <button
          type="button"
          onClick={() => requestLeave({ kind: 'back' })}
          className="-ml-1 inline-flex min-h-11 items-center self-start px-1 text-sm text-muted-foreground transition-colors hover:text-primary"
        >
          ← 返回
        </button>
        <h1 className="m-0 break-words font-display text-[clamp(36px,7vw,64px)] font-black leading-none tracking-[-0.01em]">
          编辑鼓谱
        </h1>
      </div>
      <div className="flex flex-wrap items-center gap-2 pb-1.5">
        <p className="mono text-xs text-muted-foreground">
          {title || '未识别的曲名'}
          {artist ? ` · ${artist}` : ''}
        </p>
        {live && (
          <span className="mono rounded-[3px] border border-border px-1.5 py-px text-[11px] text-muted-foreground">
            {SOURCE_ZH[live.source]}
          </span>
        )}
        {live?.edited && (
          <span className="mono rounded-[3px] border border-primary px-1.5 py-px text-[11px] text-primary">
            已修改
          </span>
        )}
      </div>
    </header>
  )

  const genPanel = score && (
    <section aria-label="自动生成" className="rounded-lg border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <div>
          <p className="label m-0 pb-2">生成方式</p>
          <Seg<Engine> label="生成方式" value={engine} onChange={setEngine} options={ENGINE_OPTIONS} />
        </div>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          <span className="label">节奏风格</span>
          <select
            value={style}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setStyle(e.target.value)}
            className={cx(SELECT, 'min-w-[11rem]')}
          >
            <option value="">自动选择</option>
            {styles.styles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.zh}（{s.meter}）
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          <span className="label">节奏参考乐器</span>
          <select
            value={guide}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setGuide(e.target.value)}
            className={cx(SELECT, 'min-w-[11rem]')}
          >
            <option value="">自动</option>
            {score.guides.map((i) => (
              <option key={i} value={i} title={score.labels[i]?.original || undefined}>
                {score.labels[i]?.zh ?? `音轨 ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
        {engine === 'drumify' && (
          <label className="flex min-w-[12rem] flex-col gap-1 text-xs text-muted-foreground">
            <span className="label">
              变化程度 <span className="mono text-foreground">{temperature.toFixed(1)}</span>
            </span>
            <input
              type="range"
              min={0.1}
              max={1.5}
              step={0.1}
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
              className="h-11 accent-[hsl(var(--primary))]"
            />
          </label>
        )}
      </div>
      <div className="flex flex-wrap gap-2 pt-4">
        {confirmWhole ? (
          <>
            <button
              type="button"
              disabled={busyAny}
              onClick={() => void generate(null)}
              className={cx(buttonClass('primary'))}
            >
              确认覆盖整首鼓谱
            </button>
            <button type="button" onClick={() => setConfirmWhole(false)} className={buttonClass('ghost')}>
              取消
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busyAny}
            onClick={() => (live ? setConfirmWhole(true) : void generate(null))}
            className={buttonClass('primary')}
          >
            {busy === 'generate' ? '正在生成…' : '生成整首鼓谱'}
          </button>
        )}
        {live && (
          <button
            type="button"
            disabled={busyAny || !hasSelection}
            onClick={() => selection && void generate(selection)}
            className={buttonClass('outline')}
          >
            重新生成所选小节
          </button>
        )}
      </div>
      {!hasSelection && live && <p className="pt-2 text-xs text-muted-foreground">先在网格上选择小节，才能只重新生成它们。</p>}
    </section>
  )

  const renderBody = () => {
    if (scoreState.status === 'loading' || !saved.loaded) {
      return <p className="py-6 text-sm text-muted-foreground">正在读取谱子和鼓谱…</p>
    }
    if (saved.error) {
      return (
        <div className="max-w-[640px] space-y-3 py-6">
          <Notice tone="error">读不出已保存的鼓谱：{saved.error}</Notice>
          <button type="button" onClick={saved.reload} className={buttonClass('outline')}>
            重试
          </button>
        </div>
      )
    }
    if (!live) {
      return (
        <div className="max-w-[760px] space-y-5 py-6">
          <p className="text-sm text-muted-foreground">这首谱子还没有鼓谱。选一种开始方式：</p>
          <div className="flex flex-wrap gap-2">
            {score && score.drumIndex >= 0 && (
              <button type="button" onClick={startFromTrack} className={buttonClass('primary')}>
                从谱子里的鼓轨开始
              </button>
            )}
            <button type="button" disabled={!score} onClick={startBlank} className={buttonClass('outline')}>
              空白开始
            </button>
          </div>
          {genPanel}
          {scoreState.status === 'error' && <Notice tone="error">{scoreState.message}</Notice>}
        </div>
      )
    }
    return (
      <>
        {/* save / export / preview / remove */}
        <div className="flex flex-wrap items-center gap-2 pt-6">
          <button
            type="button"
            disabled={busyAny || (!dirty && baseline !== null)}
            onClick={() => void save()}
            className={buttonClass('primary')}
          >
            {busy === 'save' ? '正在保存…' : '保存'}
          </button>
          <span aria-live="polite" className="mono min-w-[9rem] text-xs text-muted-foreground">
            {status}
          </span>
          <span className="flex-1" />
          <button type="button" disabled={busyAny || !score} onClick={() => void downloadGp()} className={buttonClass('outline')}>
            {busy === 'export' ? '正在导出…' : '导出 GP'}
          </button>
          <a
            href={playHref}
            onClick={(e: MouseEvent<HTMLAnchorElement>) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
              e.preventDefault()
              requestLeave({ kind: 'href', href: playHref })
            }}
            className={buttonClass('outline')}
          >
            试听
          </a>
          {confirmRemove ? (
            <>
              <button type="button" disabled={busyAny} onClick={() => void remove()} className={cx(buttonClass('outline'), 'border-destructive text-destructive')}>
                确认删除鼓谱
              </button>
              <button type="button" onClick={() => setConfirmRemove(false)} className={buttonClass('ghost')}>
                取消
              </button>
            </>
          ) : (
            baseline !== null && (
              <button type="button" disabled={busyAny} onClick={() => setConfirmRemove(true)} className={buttonClass('ghost')}>
                删除鼓谱
              </button>
            )
          )}
        </div>

        {mismatch && score && (
          <div className="pt-4">
            <Notice tone="error">
              鼓谱的小节数（{live.bars.length}）和谱子（{score.meter.length}）不一样，请检查，或重新生成整首鼓谱。
            </Notice>
          </div>
        )}

        {/* editing toolbar */}
        <div className="flex flex-wrap items-center gap-2 pt-5">
          <Seg<VelKey> label="力度" value={vel} onChange={setVel} options={VEL_OPTIONS} />
          <button type="button" disabled={!canUndo || busyAny} onClick={doUndo} className={buttonClass('outline')} title="Ctrl+Z">
            撤销
          </button>
          <button type="button" disabled={!canRedo || busyAny} onClick={doRedo} className={buttonClass('outline')} title="Ctrl+Shift+Z">
            重做
          </button>
          <button type="button" disabled={!hasSelection} onClick={copySelection} className={buttonClass('outline')} title="Ctrl+C">
            复制
          </button>
          <button type="button" disabled={!hasSelection || !clip} onClick={paste} className={buttonClass('outline')} title="Ctrl+V">
            粘贴
          </button>
          <button type="button" disabled={!hasSelection} onClick={clearSelection} className={buttonClass('outline')}>
            清空所选
          </button>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={repeatTo}
              onChange={(e) => setRepeatTo(e.target.value)}
              aria-label="重复到第几小节"
              placeholder="小节"
              className="h-11 w-20 rounded-lg border border-border bg-transparent px-2 text-sm text-foreground focus:border-primary"
            />
            <button type="button" disabled={!hasSelection || !repeatTo} onClick={repeatSelection} className={buttonClass('outline')}>
              重复到…
            </button>
          </div>
          <div role="group" aria-label="网格精度（所选小节）" className="flex flex-wrap gap-1.5">
            {RESOLUTIONS.map(([spq, text]) => (
              <button
                key={spq}
                type="button"
                disabled={!hasSelection}
                onClick={() => setResolution(spq)}
                className={buttonClass('ghost')}
              >
                {text}
              </button>
            ))}
          </div>
          <Seg<'common' | 'all'>
            label="显示乐器"
            value={showAll ? 'all' : 'common'}
            onChange={(v) => setShowAll(v === 'all')}
            options={SHOW_OPTIONS}
          />
          <button type="button" aria-expanded={panelOpen} onClick={() => setGenOpen((o) => !o)} className={buttonClass('outline')}>
            自动生成 {panelOpen ? '▴' : '▾'}
          </button>
        </div>

        {panelOpen && <div className="pt-4">{genPanel}</div>}

        <p className="mono pt-4 text-xs text-muted-foreground">{selectedText}</p>
        <div className="pt-2">
          <DrumEditorGrid
            part={live}
            pieces={pieces}
            selection={selection}
            onSelect={setSelection}
            vel={VEL_OF[vel]}
            onToggle={onToggle}
            onGestureEnd={onGestureEnd}
            playhead={null}
          />
        </div>
        <p className="pt-3 text-xs text-muted-foreground">
          格子：点击或拖动画上 / 擦掉；方向键移动，空格或回车切换。鼓谱与谱子分开保存，谱子本身不会改动。
        </p>
      </>
    )
  }

  return (
    <>
      {header}
      <Staff />

      {note && (
        <div className="pt-4">
          <Notice tone={note.tone}>{note.text}</Notice>
        </div>
      )}

      {leaveTo && (
        <div className="pt-4">
          <Notice tone="error">
            <span className="block text-foreground">有未保存的修改，要先保存吗？</span>
            <span className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={busyAny} onClick={() => void saveAndLeave()} className={buttonClass('primary')}>
                保存并离开
              </button>
              <button type="button" onClick={discardAndLeave} className={buttonClass('outline')}>
                放弃修改并离开
              </button>
              <button type="button" onClick={() => setLeaveTo(null)} className={buttonClass('ghost')}>
                留在这里
              </button>
            </span>
          </Notice>
        </div>
      )}

      {renderBody()}
    </>
  )
}
