import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { AlphaTabApi, model } from '@coderline/alphatab'
import { alphaTabUrls, loadAlphaTab } from '@/audio/alphatabLoader'
import { loadScoreDecoded } from '@/audio/alphatabEncoding'
import { desktop } from '@/app/desktop'
import { SongService } from '@/services/songService'
import {
  applyDiagrams,
  applyTranspose,
  cleanHeader,
  displayElements,
  loadDiagrams,
  loadDisplay,
} from '@/widgets/sheets/AlphaTabView'
import { parsePrintQuery, type PrintParams } from '@/widgets/sheets/printUrl'

/** Width of the A4 text area at 96 dpi (794 px page minus the 0.4 in margins on each side). */
const PAGE_WIDTH = 718
/** Time for alphaTab to finish painting after its last render, before the PDF is taken. */
const SETTLE_MS = 300

/** Print only: white paper, no app chrome, and no page-break through a row of notation. */
const PRINT_CSS = `
html, body, #root { background: #fff !important; }
@media print {
  html, body { margin: 0 !important; padding: 0 !important; }
  .at-surface > div { break-inside: avoid; }
}
`

/** The score bytes for the print query: from the score library (read in place) or an imported sheet. */
async function readSource(p: PrintParams): Promise<Uint8Array> {
  if (p.source.kind === 'library') {
    const d = desktop()
    if (!d) throw new Error('谱库只能在应用里导出。')
    return d.scores.read(p.source.path)
  }
  const sheet = await SongService.get(p.source.id)
  if (!sheet) throw new Error('找不到这份谱子。')
  if (!sheet.fileId) throw new Error('这份谱子没有原文件，不能导出 PDF。')
  const bytes = await SongService.fileBytes(sheet.fileId)
  if (!bytes) throw new Error('原文件不见了，请重新导入这份谱子。')
  return bytes
}

/**
 * The sheet as the viewer shows it, laid out on A4 pages for the PDF export
 * (opened in a hidden window by electron/main.ts, `print:exportPdf`). It reports
 * `print.ready()` once alphaTab has finished painting; `print.ready(message)` on failure.
 */
export function ScorePrintPage() {
  const [params] = useSearchParams()
  const search = params.toString()
  const req = useMemo(() => parsePrintQuery(search), [search])
  const host = useRef<HTMLDivElement>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!req) {
      setMessage('打开方式不对。')
      desktop()?.print.ready('打开方式不对。')
      return
    }
    const el = host.current
    if (!el) return
    let disposed = false
    let finished = false
    let api: AlphaTabApi | null = null
    const fail = (text: string) => {
      if (disposed) return
      setMessage(text)
      desktop()?.print.ready(text)
    }
    const succeed = () => {
      if (finished) return
      finished = true
      window.setTimeout(() => desktop()?.print.ready(), SETTLE_MS)
    }

    void (async () => {
      try {
        const bytes = await readSource(req)
        const at = await loadAlphaTab()
        if (disposed) return
        const urls = alphaTabUrls()
        // The same reading as the viewer: the text encoding that reads cleanly (GBK for Chinese GP3–5).
        const { score, encoding } = loadScoreDecoded(at, bytes)
        const trackIndexes = req.track === 'all' ? score.tracks.map((t) => t.index) : [req.track]
        const a = new at.AlphaTabApi(el, {
          core: {
            scriptFile: urls.script,
            fontDirectory: urls.fonts,
            useWorkers: true,
            enableLazyLoading: false,
          },
          importer: { encoding },
          notation: { elements: displayElements(loadDisplay()) },
          display: { staveProfile: req.staff, layoutMode: 'Page', scale: 0.8, stretchForce: 0.8 },
          player: {
            playerMode: at.PlayerMode.Disabled,
            enableCursor: false,
            enableUserInteraction: false,
          },
        } as never)
        api = a
        // Header cleaning, chord-diagram placement and 变调 as the viewer does them, before the first paint.
        a.scoreLoaded.on((s: model.Score) => {
          cleanHeader(s)
          applyDiagrams(s, loadDiagrams())
          applyTranspose(a, s, req.transpose)
          a.updateSettings()
        })
        a.renderFinished.on(succeed)
        if (!a.load(bytes, trackIndexes)) fail('这个文件没能显示出来。')
      } catch (e) {
        fail(e instanceof Error ? e.message : '谱子排版失败。')
      }
    })()

    return () => {
      disposed = true
      api?.destroy()
      api = null
    }
  }, [req])

  return (
    <main className="min-h-screen bg-white text-black">
      <style>{PRINT_CSS}</style>
      {message && <p className="p-6 text-sm text-red-700">{message}</p>}
      <div ref={host} style={{ width: PAGE_WIDTH, margin: '0 auto' }} />
    </main>
  )
}
