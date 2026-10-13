/**
 * 歌词 tab (跟唱 2.0 §四): import or paste the student's own lyrics, then line
 * each line up with the recording. Every change is saved to the song or sheet.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSing } from '@/features/sing/useSingSession'
import { lyricsFromSheet } from '@/import/gpLyrics'
import {
  formatLrc,
  mergeWithNext,
  moveText,
  parseLrc,
  setLineStart,
  shiftLine,
  splitLine,
  splitLyricText,
  tapsToStarts,
} from '@/songs/lyrics'
import type { LyricLine } from '@/songs/singTypes'
import { alignLyrics } from '@/songs/phrasing'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'
import { LyricsDisplay } from '@/widgets/sing/LyricsDisplay'

/** Tapping starts this long before the chosen line. */
const TAP_LEAD_MS = 2000
/** ▶ plays from this long before a line. */
const PLAY_LEAD_MS = 1000
const NUDGE_MS = 100

type RowAction = 'earlier' | 'later' | 'here' | 'merge' | 'up' | 'down' | 'delete' | 'play'

/** `m:ss.xx` */
function stamp(ms: number): string {
  const cs = Math.round(Math.max(0, ms) / 10)
  const mm = Math.floor(cs / 6000)
  const ss = Math.floor(cs / 100) % 60
  return `${mm}:${String(ss).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Same line with new text. Word timings belong to the old text, so they go. */
function withText(lines: LyricLine[], i: number, text: string): LyricLine[] {
  return lines.map((l, k) => {
    if (k !== i) return l
    const next: LyricLine = { startMs: l.startMs, text }
    if (l.endMs !== undefined) next.endMs = l.endMs
    return next
  })
}

function fileBaseName(title: string): string {
  return title.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'lyrics'
}

interface RowProps {
  index: number
  line: LyricLine
  total: number
  /** This is the line a tap session will set next. */
  next: boolean
  onText: (i: number, text: string) => void
  onSplit: (i: number, caret: number) => void
  onAct: (i: number, action: RowAction) => void
}

function LyricRow({ index, line, total, next, onText, onSplit, onAct }: RowProps) {
  // The draft follows the saved text when that changes from outside (adjusting state during render).
  const [draft, setDraft] = useState(line.text)
  const [seen, setSeen] = useState(line.text)
  if (seen !== line.text) {
    setSeen(line.text)
    setDraft(line.text)
  }
  const input = useRef<HTMLInputElement>(null)
  // Caret is read on mousedown, before the input loses focus to the button.
  const caret = useRef(0)
  const btn = 'h-7 px-2 text-xs'

  return (
    <li className={cn('flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2', next ? 'border-amber' : 'border-border')}>
      <span className="w-16 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{stamp(line.startMs)}</span>
      <input
        ref={input}
        value={draft}
        aria-label={`第 ${index + 1} 行歌词`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (!draft.trim()) setDraft(line.text)
          else onText(index, draft.trim())
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        className="h-8 min-w-[10rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
      />
      <div className="flex flex-wrap gap-1">
        <Button variant="outline" size="sm" className={btn} onClick={() => onAct(index, 'earlier')}>
          −0.1s
        </Button>
        <Button variant="outline" size="sm" className={btn} onClick={() => onAct(index, 'later')}>
          +0.1s
        </Button>
        <Button variant="outline" size="sm" className={btn} onClick={() => onAct(index, 'here')}>
          设为当前播放位置
        </Button>
        <Button variant="outline" size="sm" className={btn} disabled={index >= total - 1} onClick={() => onAct(index, 'merge')}>
          与下一行合并
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={btn}
          onMouseDown={() => {
            caret.current = input.current?.selectionStart ?? 0
          }}
          onClick={() => onSplit(index, caret.current)}
        >
          拆开
        </Button>
        <Button variant="outline" size="sm" className={btn} disabled={index === 0} onClick={() => onAct(index, 'up')}>
          上移文字
        </Button>
        <Button variant="outline" size="sm" className={btn} disabled={index >= total - 1} onClick={() => onAct(index, 'down')}>
          下移文字
        </Button>
        <Button variant="outline" size="sm" className={btn} aria-label={`从第 ${index + 1} 行前 1 秒播放`} onClick={() => onAct(index, 'play')}>
          ▶
        </Button>
        <Button variant="ghost" size="sm" className={cn(btn, 'text-destructive')} onClick={() => onAct(index, 'delete')}>
          删除
        </Button>
      </div>
    </li>
  )
}

export function LyricsTab() {
  const { source, meta, setMeta, resegment, player, ready, curve, notes, play, pause } = useSing()
  const [lines, setLines] = useState<LyricLine[]>([])
  // Always the latest lines, so quick clicks never build on a stale copy.
  const linesRef = useRef<LyricLine[]>([])
  const loaded = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paste, setPaste] = useState('')
  /** Automatic alignment waiting for the student's OK. */
  const [draft, setDraft] = useState<LyricLine[] | null>(null)
  const [tapFrom, setTapFrom] = useState(0)
  const [tap, setTap] = useState<{ from: number; count: number } | null>(null)
  const tapTimes = useRef<number[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const tapping = tap !== null

  // Load the saved lyrics once; after that this tab is the writer.
  useEffect(() => {
    if (!meta || loaded.current) return
    loaded.current = true
    linesRef.current = meta.lyrics ?? []
    setLines(linesRef.current)
  }, [meta])

  const readPos = useCallback(() => player.current?.positionMs() ?? 0, [player])

  const apply = useCallback(
    (next: LyricLine[]) => {
      linesRef.current = next
      setLines(next)
      setError(null)
      setMeta({ lyrics: next }).catch((e: unknown) => setError(`歌词没能保存：${errorText(e)}`))
    },
    [setMeta],
  )

  /**
   * New timing that the phrases should follow (LRC, a confirmed alignment,
   * tapping): saved as trusted, and hand-made phrase cuts give way to it.
   */
  const applyTimed = useCallback(
    (next: LyricLine[]) => {
      linesRef.current = next
      setLines(next)
      setError(null)
      resegment({ lyrics: next, lyricsTimed: true, phraseCuts: [] }).catch((e: unknown) => setError(`歌词没能保存：${errorText(e)}`))
    },
    [resegment],
  )

  /** Line plain lyric lines up with the singer and show the result for checking. */
  const startAlign = (texts: string[]) => {
    if (!texts.length) return
    if (!curve) {
      setError('原唱的音高线还在分析，稍等一下再试。')
      return
    }
    setError(null)
    setDraft(alignLyrics(texts, curve, notes))
  }

  const confirmDraft = () => {
    if (!draft) return
    pause()
    applyTimed(draft)
    setDraft(null)
    setPaste('')
  }

  // Space records a tap (outside text boxes) with the playback position.
  useEffect(() => {
    if (!tapping) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      e.preventDefault()
      const p = player.current
      if (!p) return
      tapTimes.current.push(p.positionMs())
      setTap((s) => (s ? { ...s, count: s.count + 1 } : s))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tapping, player])

  // ---- Empty state -------------------------------------------------------

  const importFile = async (file: File) => {
    setBusy(true)
    try {
      const text = await file.text()
      const parsed = parseLrc(text)
      if (parsed.lines.length) applyTimed(parsed.lines)
      else {
        const texts = splitLyricText(text)
        if (!texts.length) setError('这个文件里没有找到歌词。')
        else startAlign(texts)
      }
    } catch (e) {
      setError(`读不了这个文件：${errorText(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const usePasted = () => {
    const texts = splitLyricText(paste)
    if (!texts.length) {
      setError('先粘贴歌词。')
      return
    }
    startAlign(texts)
  }

  const fromSheet = async () => {
    setBusy(true)
    try {
      applyTimed(await lyricsFromSheet(source.id))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  // ---- Editing -------------------------------------------------------------

  const commitText = (i: number, text: string) => {
    const cur = linesRef.current
    if (!cur[i] || cur[i]!.text === text) return
    apply(withText(cur, i, text))
  }

  const split = (i: number, caret: number) => {
    const cur = linesRef.current
    const next = splitLine(cur, i, caret)
    if (next.length !== cur.length) apply(next)
  }

  const act = (i: number, action: RowAction) => {
    const cur = linesRef.current
    const line = cur[i]
    if (!line) return
    switch (action) {
      case 'earlier':
        apply(shiftLine(cur, i, -NUDGE_MS))
        break
      case 'later':
        apply(shiftLine(cur, i, NUDGE_MS))
        break
      case 'here': {
        const p = player.current
        if (p) apply(setLineStart(cur, i, p.positionMs()))
        break
      }
      case 'merge':
        apply(mergeWithNext(cur, i))
        break
      case 'up':
        apply(moveText(cur, i, -1))
        break
      case 'down':
        apply(moveText(cur, i, 1))
        break
      case 'delete':
        apply(cur.filter((_, k) => k !== i))
        break
      case 'play':
        play(Math.max(0, line.startMs - PLAY_LEAD_MS))
        break
    }
  }

  // ---- Tap alignment -----------------------------------------------------

  const startTap = () => {
    const cur = linesRef.current
    const from = Math.min(tapFrom, cur.length - 1)
    const line = cur[from]
    if (!line) return
    tapTimes.current = []
    setTap({ from, count: 0 })
    play(Math.max(0, line.startMs - TAP_LEAD_MS))
  }

  const stopTap = (keep: boolean) => {
    if (!tap) return
    pause()
    if (keep && tapTimes.current.length) applyTimed(tapsToStarts(linesRef.current, tap.from, tapTimes.current))
    tapTimes.current = []
    setTap(null)
  }

  // ---- Export / clear ----------------------------------------------------

  const exportLrc = () => {
    const blob = new Blob([formatLrc(linesRef.current)], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileBaseName(source.title)}.lrc`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const clearAll = () => {
    if (!window.confirm('清空这首歌的所有歌词？清空后不能恢复（可以先导出 LRC 备份）。')) return
    if (tap) stopTap(false)
    apply([])
  }

  // ---- Render --------------------------------------------------------------

  if (!meta) return <p className="text-sm text-muted-foreground">正在读取歌词…</p>

  const nextTapIndex = tap ? tap.from + tap.count : -1
  const nextTapLine = tap ? lines[nextTapIndex] : undefined

  if (draft) {
    return (
      <div className="space-y-4">
        <LyricsDisplay lines={draft} positionMs={readPos} />
        <section className="space-y-3 rounded-2xl border border-amber/50 bg-card p-4">
          <div className="space-y-1">
            <h3 className="font-semibold">自动对齐结果</h3>
            <p className="text-sm text-muted-foreground">
              这是根据原唱的音高和停顿估计的每行开始时间，可能有偏差。点 ▶ 听一听每行开头对不对；确认后，跟唱会按这些歌词分句，之后还可以在歌词列表里微调或用打拍对齐。
            </p>
          </div>
          <ol className="max-h-[26rem] space-y-1 overflow-auto">
            {draft.map((line, i) => (
              <li key={i} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-sm">
                <span className="w-16 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{stamp(line.startMs)}</span>
                <span className="min-w-0 flex-1 truncate">{line.text}</span>
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={!ready} aria-label={`从第 ${i + 1} 行前 0.5 秒播放`} onClick={() => play(Math.max(0, line.startMs - 500))}>
                  ▶
                </Button>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button onClick={confirmDraft}>确认，按这些歌词分句</Button>
            <Button variant="outline" onClick={pause}>
              暂停
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                pause()
                setDraft(null)
              }}
            >
              取消
            </Button>
          </div>
        </section>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    )
  }

  if (!lines.length) {
    return (
      <section className="space-y-4 rounded-2xl border border-border bg-card p-4">
        <div className="space-y-1">
          <h3 className="font-semibold">还没有歌词</h3>
          <p className="text-sm text-muted-foreground">
            歌词受版权保护，网站不会自动下载。请导入你自己的 LRC 文件，或粘贴你有权使用的歌词。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
            导入 LRC 文件
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".lrc,.txt,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void importFile(f)
            }}
          />
          {source.kind === 'sheet' && (
            <Button variant="outline" disabled={busy} onClick={() => void fromSheet()}>
              从谱子读取歌词
            </Button>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="lyrics-paste" className="text-sm font-medium">
            粘贴歌词（一行一句，段落名如“主歌”会被忽略）
          </label>
          <textarea
            id="lyrics-paste"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={6}
            className="w-full rounded-md border border-input bg-background p-2 text-sm"
          />
          <Button variant="outline" disabled={busy || !paste.trim()} onClick={usePasted}>
            用粘贴的歌词（先自动对齐，确认后使用）
          </Button>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </section>
    )
  }

  return (
    <div className="space-y-4">
      <LyricsDisplay lines={lines} positionMs={readPos} />

      {!meta.lyricsTimed && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber/50 bg-amber-soft/20 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">这些歌词的时间还没有和原唱对齐（旧版是按停顿平均分配的），所以跟唱暂时按原唱的停顿分句。</span>
          <Button size="sm" onClick={() => startAlign(linesRef.current.map((l) => l.text))} disabled={!curve}>
            自动对齐歌词
          </Button>
        </div>
      )}

      <section className="space-y-2 rounded-xl border border-border bg-card p-3">
        <p className="text-sm font-medium">打拍对齐</p>
        <p className="text-xs text-muted-foreground">
          从选定的一行开始播放，每行开始时按一次空格，各行的开始时间会依次记下。点在文字框里时空格不计入。
        </p>
        {tap === null ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm">
              从第
              <select
                value={tapFrom}
                onChange={(e) => setTapFrom(Number(e.target.value))}
                className="mx-1 h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                {lines.map((_, i) => (
                  <option key={i} value={i}>
                    {i + 1}
                  </option>
                ))}
              </select>
              行开始
            </label>
            <Button size="sm" disabled={!ready} onClick={startTap}>
              开始
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm">
              {nextTapLine
                ? `正在打拍：下一行是第 ${nextTapIndex + 1} 行「${nextTapLine.text}」，已记录 ${tap.count} 次。`
                : `已经到最后一行，已记录 ${tap.count} 次。按“完成”保存。`}
            </p>
            <Button size="sm" onClick={() => stopTap(true)}>
              完成
            </Button>
            <Button size="sm" variant="ghost" onClick={() => stopTap(false)}>
              取消
            </Button>
          </div>
        )}
      </section>

      <ol className="space-y-2">
        {lines.map((line, i) => (
          <LyricRow
            key={i}
            index={i}
            line={line}
            total={lines.length}
            next={tap !== null && i === nextTapIndex}
            onText={commitText}
            onSplit={split}
            onAct={act}
          />
        ))}
      </ol>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => startAlign(linesRef.current.map((l) => l.text))} disabled={!curve || tapping}>
          重新自动对齐
        </Button>
        <Button variant="outline" size="sm" onClick={exportLrc}>
          导出 LRC
        </Button>
        <Button variant="ghost" size="sm" className="text-destructive" onClick={clearAll}>
          清空歌词
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
