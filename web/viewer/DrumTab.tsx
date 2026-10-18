import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toDrumTab } from '@/songs/drumPart'
import type { DrumPart, DrumPiece } from '@/songs/drumTypes'
import { DrumLegend } from './DrumGrid'

/** Approximate advance of one monospace character at the tab's font size (px). */
const CHAR_PX = 8
/** Horizontal padding of the tab box (px). */
const PAD_PX = 24
const FALLBACK_BARS_PER_LINE = 4

interface Props {
  part: DrumPart
  pieces: DrumPiece[]
}

function longestLine(text: string): number {
  let max = 0
  for (const line of text.split('\n')) max = Math.max(max, line.length)
  return max
}

/**
 * Bars per tab line that fit `widthPx`. Measured from the tab itself: the width of one bar
 * and the fixed part of a line (labels, barlines) come from rendering 1 and n bars.
 */
function barsPerLineFor(part: DrumPart, pieces: DrumPiece[], widthPx: number): number {
  const total = part.bars.length
  if (total <= 1) return Math.max(1, total)
  if (widthPx <= 0) return FALLBACK_BARS_PER_LINE
  const n = Math.min(4, total)
  const one = longestLine(toDrumTab({ ...part, bars: part.bars.slice(0, 1) }, { barsPerLine: 1, pieces }))
  const many = longestLine(toDrumTab({ ...part, bars: part.bars.slice(0, n) }, { barsPerLine: n, pieces }))
  const perBar = (many - one) / (n - 1)
  if (!(perBar > 0)) return FALLBACK_BARS_PER_LINE
  const base = one - perBar
  const availChars = (widthPx - PAD_PX) / CHAR_PX
  return Math.max(1, Math.floor((availChars - base) / perBar))
}

/** Monospace text tab of a drum part, with a copy button. */
export function DrumTab({ part, pieces }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const [width, setWidth] = useState(0)
  const [status, setStatus] = useState<'copied' | 'selected' | null>(null)

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const barsPerLine = useMemo(() => barsPerLineFor(part, pieces, width), [part, pieces, width])
  const text = useMemo(() => toDrumTab(part, { barsPerLine, pieces }), [part, pieces, barsPerLine])

  useEffect(() => {
    if (!status) return
    const t = window.setTimeout(() => setStatus(null), 2500)
    return () => window.clearTimeout(t)
  }, [status])

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setStatus('copied')
      return
    } catch {
      // fall through: select the text so the user can copy it by hand
    }
    const pre = preRef.current
    if (pre) {
      const range = document.createRange()
      range.selectNodeContents(pre)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    setStatus(ok ? 'copied' : 'selected')
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DrumLegend pieces={pieces} />
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded border border-[color:var(--sheet-line)] px-3 py-1 text-xs text-[color:var(--sheet-ink)] hover:border-[color:var(--sheet-pen)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--sheet-pen)]"
        >
          复制
        </button>
      </div>
      {status && (
        <p role="status" className="text-xs text-[color:var(--sheet-dim)]">
          {status === 'copied' ? '已复制到剪贴板。' : '已选中鼓谱文字，请手动复制（长按或 Ctrl+C）。'}
        </p>
      )}
      <div ref={boxRef} className="w-full overflow-x-auto">
        <pre
          ref={preRef}
          translate="no"
          className="m-0 whitespace-pre text-[13px] leading-5 text-[color:var(--sheet-ink)]"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {text}
        </pre>
      </div>
    </div>
  )
}
