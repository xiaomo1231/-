import { useEffect, useRef, useState } from 'react'
import type { AlphaTabApi, model } from '@coderline/alphatab'
import { errorText, fetchBytes, fileUrl } from '../lib/api'
import { SELECT, buttonClass } from '../lib/classes'
import { clampTranspose, transposeLabel, TRANSPOSE_MAX, TRANSPOSE_MIN } from '../lib/transpose'
import {
  alphaTabUrls,
  applyTranspose,
  chooseEncoding,
  cleanHeader,
  loadAlphaTab,
  themeResources,
  type AlphaTab,
} from './alphaTab'

export type StaffMode = 'ScoreTab' | 'Tab' | 'Score'

const STAFF_OPTIONS: Array<{ value: StaffMode; label: string }> = [
  { value: 'Tab', label: '六线谱' },
  { value: 'ScoreTab', label: '五线谱 + 六线谱' },
  { value: 'Score', label: '五线谱' },
]
const SPEEDS = [0.5, 0.75, 1, 1.25]
/** After this long without a score, say the file is slow to read. */
const SLOW_MS = 20000

const isNarrow = () => window.matchMedia('(max-width: 767px)').matches

const staveProfileOf = (at: AlphaTab, staff: StaffMode): number =>
  (at.StaveProfile as unknown as Record<StaffMode, number>)[staff] ?? 0

type Phase = 'loading' | 'ready' | 'error'

/** A Guitar Pro / MusicXML file, shown and played by alphaTab (read in place, never saved). */
export function ScoreViewer({ path }: { path: string }) {
  const host = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const api = useRef<AlphaTabApi | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [message, setMessage] = useState('')
  const [slow, setSlow] = useState(false)
  const [score, setScore] = useState<model.Score | null>(null)
  const [track, setTrack] = useState(0)
  const [staff, setStaff] = useState<StaffMode>(() => (isNarrow() ? 'Tab' : 'ScoreTab'))
  const [transpose, setTranspose] = useState(0)
  const [playerReady, setPlayerReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [speed, setSpeed] = useState(1)

  // Event handlers see the latest values without being re-subscribed.
  const staffRef = useRef(staff)
  staffRef.current = staff
  const transposeRef = useRef(transpose)
  transposeRef.current = transpose
  const moved = useRef(false)

  useEffect(() => {
    if (phase !== 'loading') return
    const timer = window.setTimeout(() => setSlow(true), SLOW_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  // Create the viewer once per file.
  useEffect(() => {
    const ac = new AbortController()
    let disposed = false
    const run = async () => {
      try {
        const [bytes, at] = await Promise.all([
          fetchBytes(fileUrl(path), ac.signal),
          loadAlphaTab(),
        ])
        if (disposed || !host.current || !scroller.current) return
        const urls = alphaTabUrls()
        const a = new at.AlphaTabApi(host.current, {
          core: { scriptFile: urls.script, fontDirectory: urls.fonts, useWorkers: true },
          importer: { encoding: chooseEncoding(at, bytes) },
          display: {
            staveProfile: staveProfileOf(at, staffRef.current),
            scale: 1,
            resources: themeResources(),
          },
          player: {
            playerMode: at.PlayerMode.EnabledSynthesizer,
            soundFont: urls.soundFont,
            scrollElement: scroller.current,
            enableCursor: true,
            enableUserInteraction: true,
            scrollOffsetY: -30,
          },
        } as never)
        api.current = a
        a.scoreLoaded.on((s) => {
          cleanHeader(s)
          if (transposeRef.current) applyTranspose(a, s, transposeRef.current)
          setScore(s)
          setPhase('ready')
        })
        a.renderStarted.on(() => setRendering(true))
        a.renderFinished.on(() => setRendering(false))
        a.playerReady.on(() => setPlayerReady(true))
        a.playerStateChanged.on((e) => setPlaying(e.state === 1))
        if (!a.load(bytes, [0])) {
          setMessage('这个文件没能显示出来。可以下载后用电脑上的 Guitar Pro 打开。')
          setPhase('error')
        }
      } catch (e) {
        if (!disposed) {
          setMessage(errorText(e))
          setPhase('error')
        }
      }
    }
    void run()
    return () => {
      disposed = true
      ac.abort()
      api.current?.destroy()
      api.current = null
    }
  }, [path])

  // Track switch.
  useEffect(() => {
    const a = api.current
    const t = score?.tracks[track]
    if (a && t) a.renderTracks([t])
  }, [track, score])

  // Notation mode.
  useEffect(() => {
    const a = api.current
    const at = window.alphaTab
    if (!a || !score || !at) return
    a.settings.display.staveProfile = staveProfileOf(at, staff) as never
    a.updateSettings()
    a.render()
  }, [staff, score])

  // 变调: applied to the staves and the playback; the first load already handled a non-zero value.
  useEffect(() => {
    const a = api.current
    if (!a || !score || (transpose === 0 && !moved.current)) return
    moved.current = transpose !== 0
    applyTranspose(a, score, transpose)
    a.updateSettings()
    a.render()
    a.loadMidiForScore()
  }, [transpose, score])

  useEffect(() => {
    if (api.current) api.current.playbackSpeed = speed
  }, [speed])

  const shift = (d: number) => setTranspose((t) => clampTranspose(t + d))
  const tracks = score?.tracks ?? []
  // Playback controls appear only once the soundfont has loaded (no soundfont = notation only).
  const showPlayer = playerReady

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {tracks.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">音轨</span>
            <select
              className={SELECT}
              value={track}
              onChange={(e) => setTrack(Number(e.target.value))}
            >
              {tracks.map((t, i) => (
                <option key={i} value={i}>
                  {t.name.trim() || `音轨 ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">谱面</span>
          <select
            className={SELECT}
            value={staff}
            onChange={(e) => setStaff(e.target.value as StaffMode)}
          >
            {STAFF_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1 text-sm" role="group" aria-label="变调">
          <span className="mr-1 text-muted-foreground">变调</span>
          <button
            type="button"
            aria-label="降半音"
            onClick={() => shift(-1)}
            disabled={transpose <= TRANSPOSE_MIN}
            className={buttonClass('outline') + ' min-w-11 px-0'}
          >
            −
          </button>
          <span className="num min-w-14 text-center">{transposeLabel(transpose)}</span>
          <button
            type="button"
            aria-label="升半音"
            onClick={() => shift(1)}
            disabled={transpose >= TRANSPOSE_MAX}
            className={buttonClass('outline') + ' min-w-11 px-0'}
          >
            +
          </button>
        </div>

        {showPlayer && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => api.current?.playPause()}
              className={buttonClass('primary')}
              aria-label={playing ? '暂停' : '播放'}
            >
              {playing ? '暂停' : '播放'}
            </button>
            <button
              type="button"
              onClick={() => api.current?.stop()}
              className={buttonClass('outline')}
              aria-label="停止"
            >
              停止
            </button>
            <select
              className={SELECT}
              aria-label="速度"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {Math.round(s * 100)}%
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div
        ref={scroller}
        className="at-surface relative max-h-[72vh] overflow-auto rounded-2xl border border-border/80 bg-card p-3"
      >
        {rendering && (
          <p className="pointer-events-none absolute right-3 top-2 z-10 text-xs text-muted-foreground">
            正在排版…
          </p>
        )}
        <div ref={host} />
      </div>

      {phase === 'loading' && (
        <p role="status" className="py-6 text-center text-sm text-muted-foreground">
          {slow ? '这个文件读得比较慢，请再等一等…' : '正在读取谱子…'}
        </p>
      )}
      {phase === 'error' && (
        <p
          role="alert"
          className="rounded-2xl border border-destructive/50 p-4 text-sm text-destructive"
        >
          {message}
        </p>
      )}
      {phase === 'ready' && (
        <p className="text-xs text-muted-foreground">
          变调只在这里生效，不会改动原文件。可以在谱面上点一下跳到某一处。
        </p>
      )}
    </div>
  )
}
