import { useEffect, useRef, useState } from 'react'
import type { AlphaTabApi } from '@coderline/alphatab'
import { buildDrumTrack } from '@/songs/drumScore'
import type { DrumPart } from '@/songs/drumTypes'
import { alphaTabUrls, loadAlphaTab, type AlphaTab } from './alphaTab'
import { loadPrefs, sheetResources, staveProfileOf } from './scorePrefs'

/** Edits are coalesced: the preview redraws this long after the last change. */
const DEBOUNCE_MS = 250
/** Most bars the preview draws at once. */
const MAX_BARS = 4
const PREVIEW_SCALE = 0.9

interface Props {
  part: DrumPart
  /** First bar shown (0-based index into part.bars). */
  first: number
  /** Last bar shown (0-based, inclusive). */
  last: number
}

/**
 * A small live rendering of a few bars of the drum part in standard drum notation,
 * drawn with its own alphaTab instance (no player). Builds a fresh score for each redraw
 * with the same track builder the viewer uses, so the preview matches the played track.
 */
export function DrumPreview({ part, first, last }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const apiRef = useRef<AlphaTabApi | null>(null)
  const atRef = useRef<AlphaTab | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  // One alphaTab instance per mounted preview; destroyed on unmount.
  useEffect(() => {
    let disposed = false
    void loadAlphaTab()
      .then((at) => {
        if (disposed || !host.current) return
        const urls = alphaTabUrls()
        const api = new at.AlphaTabApi(host.current, {
          // A score built in memory is laid out here, not in a worker (which needs an imported score).
          core: { scriptFile: urls.script, fontDirectory: urls.fonts, useWorkers: false },
          display: {
            staveProfile: staveProfileOf(at, 'Score'),
            scale: PREVIEW_SCALE,
            layoutMode: at.LayoutMode.Page,
            resources: sheetResources(loadPrefs().sheet),
          },
          player: { playerMode: at.PlayerMode.Disabled },
        } as never)
        apiRef.current = api
        atRef.current = at
        setReady(true)
      })
      .catch(() => {
        if (!disposed) setFailed(true)
      })
    return () => {
      disposed = true
      apiRef.current?.destroy()
      apiRef.current = null
      atRef.current = null
    }
  }, [])

  // Redraw the bars shown, after the edits settle.
  useEffect(() => {
    if (!ready) return
    const timer = window.setTimeout(() => {
      const api = apiRef.current
      const at = atRef.current
      if (!api || !at) return
      const from = Math.max(0, Math.min(first, part.bars.length - 1))
      const to = Math.min(last, part.bars.length - 1, from + MAX_BARS - 1)
      if (to < from) {
        setFailed(false)
        return
      }
      try {
        const bars = part.bars.slice(from, to + 1)
        const score = new at.model.Score()
        for (const b of bars) {
          const mb = new at.model.MasterBar()
          mb.timeSignatureNumerator = b.num
          mb.timeSignatureDenominator = b.den
          score.addMasterBar(mb)
        }
        const track = buildDrumTrack(at, score, { ...part, bars }, '鼓（预览）')
        api.renderScore(score, [score.tracks.indexOf(track)])
        setFailed(false)
      } catch {
        setFailed(true)
      }
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [ready, part, first, last])

  return (
    <section aria-label="鼓谱预览" className="rounded-lg border border-border bg-card/40 p-3">
      <p className="mono pb-2 text-xs text-muted-foreground">预览（标准鼓谱）</p>
      <div
        ref={host}
        className="w-full overflow-x-auto text-[color:var(--sheet-ink)]"
        style={{ minHeight: ready ? undefined : 0 }}
      />
      {failed && <p className="pt-1 text-xs text-muted-foreground">预览暂时画不出来，编辑不受影响。</p>}
    </section>
  )
}
