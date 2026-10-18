import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { model } from '@coderline/alphatab'
import { useThemeStore } from '@/features/theme/themeStore'
import { clampTranspose, transposedKey } from '@/songs/transpose'
import { AlphaTabView, type StaffMode } from '@/widgets/sheets/AlphaTabView'
import { TransposeControl } from '@/widgets/sheets/TransposeControl'
import { ExportPdfButton } from '@/widgets/sheets/ExportPdfButton'
import { ReadStatus, useLibraryBytes } from '@/widgets/scores/ScoreViewerFiles'
import { cleanArtist, fileBaseName, noteName } from '@/widgets/scores/ScoreViewerFormat'

const STAFF_LABEL: Record<StaffMode, string> = {
  ScoreTab: '五线谱 + 六线谱',
  Tab: '只看六线谱',
  Score: '只看五线谱',
}

/** Show the "cannot read" notice when alphaTab has not produced a score by then. */
const SLOW_MS = 20000

/** A Guitar Pro / MusicXML file from the library, shown and played by alphaTab (read in place). */
export function ScoreViewerScore({ path, fallback }: { path: string; fallback: ReactNode }) {
  const state = useLibraryBytes([path])
  if (state.status !== 'ready') return <ReadStatus state={state} />
  return <ScoreTabs path={path} bytes={state.bytes[0] ?? new Uint8Array()} fallback={fallback} />
}

function ScoreTabs({
  path,
  bytes,
  fallback,
}: {
  path: string
  bytes: Uint8Array
  fallback: ReactNode
}) {
  const theme = useThemeStore((s) => s.mode)
  const [score, setScore] = useState<model.Score | null>(null)
  const [slow, setSlow] = useState(false)
  const [track, setTrack] = useState(0)
  const [staff, setStaff] = useState<StaffMode>('ScoreTab')
  // Transposition is only for this view: nothing is saved (the library is read in place).
  const [transpose, setTranspose] = useState(0)

  useEffect(() => {
    if (score) return
    const timer = window.setTimeout(() => setSlow(true), SLOW_MS)
    return () => window.clearTimeout(timer)
  }, [score])

  const tracks = score?.tracks ?? []
  const current = tracks.find((t) => t.index === track) ?? tracks[0]
  const bars = score?.masterBars.length ?? 0
  const range = useMemo(() => ({ from: 0, to: Math.max(1, bars) }), [bars])

  const keyLabel = useMemo(() => {
    const mb = score?.masterBars[0]
    if (!mb) return undefined
    const minor = Number(mb.keySignatureType) === 1
    const major = (((Number(mb.keySignature) * 7) % 12) + 12) % 12
    const tonic = 60 + (minor ? (major + 9) % 12 : major)
    const mode = minor ? 'minor' : 'major'
    return transpose
      ? `${transposedKey(tonic, mode, transpose)}（原调 ${transposedKey(tonic, mode, 0)}）`
      : `原调 ${transposedKey(tonic, mode, 0)}`
  }, [score, transpose])

  const tuning = [...(current?.staves[0]?.stringTuning.tunings ?? [])]
    .sort((a, b) => a - b)
    .map(noteName)
  const artist = cleanArtist(score?.artist)

  return (
    <div className="space-y-4">
      {score && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {score.title?.trim() && <span className="text-foreground">{score.title.trim()}</span>}
            {artist && <span>{artist}</span>}
            {score.tempo > 0 && <span className="num">♩ = {Math.round(score.tempo)}</span>}
            {tuning.length > 0 && (
              <span className="font-mono text-xs">
                {current?.name ? `${current.name} · ` : ''}调弦 {tuning.join(' ')}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            {tracks.length > 1 && (
              <label className="flex items-center gap-2">
                音轨
                <select
                  value={current?.index ?? 0}
                  onChange={(e) => setTrack(Number(e.target.value))}
                  className="focus-ring h-9 max-w-64 rounded-lg border border-border bg-background px-2"
                >
                  {tracks.map((t) => (
                    <option key={t.index} value={t.index}>
                      {t.name || `音轨 ${t.index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex items-center gap-2">
              谱面
              <select
                value={staff}
                onChange={(e) => setStaff(e.target.value as StaffMode)}
                className="focus-ring h-9 rounded-lg border border-border bg-background px-2"
              >
                {(Object.keys(STAFF_LABEL) as StaffMode[]).map((m) => (
                  <option key={m} value={m}>
                    {STAFF_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
            <ExportPdfButton
              source={{ kind: 'library', path }}
              track={current?.index ?? 0}
              trackCount={tracks.length}
              staff={staff}
              transpose={transpose}
              fileName={score.title?.trim() || fileBaseName(path).replace(/\.[^.]+$/, '')}
            />
          </div>
          <TransposeControl
            value={transpose}
            onChange={(n) => setTranspose(clampTranspose(n))}
            {...(keyLabel ? { keyLabel } : {})}
          />
        </div>
      )}

      <AlphaTabView
        key={theme}
        bytes={bytes}
        track={current?.index ?? 0}
        staff={staff}
        range={range}
        onScore={setScore}
        transpose={transpose}
      />

      {slow && !score && (
        <div className="space-y-3 rounded-2xl border border-destructive/40 p-4">
          <p className="text-sm text-destructive">读不懂这个文件</p>
          {fallback}
        </div>
      )}
    </div>
  )
}
