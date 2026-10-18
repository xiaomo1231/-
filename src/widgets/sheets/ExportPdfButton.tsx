import { useEffect, useRef, useState } from 'react'
import { FileDown } from 'lucide-react'
import { desktop } from '@/app/desktop'
import { toast } from '@/features/toast/toastStore'
import { Button } from '@/shared/ui/Button'
import type { StaffMode } from '@/widgets/sheets/AlphaTabView'
import { buildPrintQuery, type PrintSource } from '@/widgets/sheets/printUrl'

/** PDFs are tablature only (六线谱), whatever the viewer shows. */
const PRINT_STAFF: StaffMode = 'Tab'

export interface ExportPdfButtonProps {
  source: PrintSource
  /** The track on screen (its index). */
  track: number
  trackCount: number
  /** 变调 as shown. */
  transpose: number
  /** Suggested file name (without .pdf). */
  fileName: string
}

/** Electron prefixes the message of a failed IPC call; the student sees only the text. */
function ipcMessage(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  return (
    text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') ||
    '导出失败，请稍后再试。'
  )
}

/** Exports the score as tablature to an A4 PDF (desktop app only; renders nothing in the browser). */
export function ExportPdfButton({
  source,
  track,
  trackCount,
  transpose,
  fileName,
}: ExportPdfButtonProps) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<'track' | 'all'>('track')
  const [busy, setBusy] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const bridge = desktop()
  if (!bridge?.print) return null

  const run = async () => {
    setBusy(true)
    try {
      const query = buildPrintQuery({
        source,
        track: scope === 'all' ? 'all' : track,
        staff: PRINT_STAFF,
        transpose,
      })
      const r = await bridge.print.exportPdf({ query, fileName })
      if (r.saved) toast({ title: '已导出 PDF', description: r.saved, variant: 'success' })
      setOpen(false)
    } catch (e) {
      toast({ title: '没能导出', description: ipcMessage(e), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const shift = transpose ? `，变调 ${transpose > 0 ? '+' : ''}${transpose}` : ''

  return (
    <div ref={wrap} className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <FileDown /> 导出 PDF
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="导出 PDF"
          className="absolute right-0 top-full z-20 mt-2 w-64 space-y-3 rounded-2xl border border-border bg-card p-4 text-sm shadow-lg"
        >
          {trackCount > 1 && (
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-xs text-muted-foreground">导出哪些音轨</legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="export-scope"
                  checked={scope === 'track'}
                  onChange={() => setScope('track')}
                  className="accent-[hsl(var(--amber))]"
                />
                当前音轨
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="export-scope"
                  checked={scope === 'all'}
                  onChange={() => setScope('all')}
                  className="accent-[hsl(var(--amber))]"
                />
                全部音轨
              </label>
            </fieldset>
          )}
          <p className="text-xs text-muted-foreground">
            谱面：六线谱
            {shift}
          </p>
          <Button size="sm" className="w-full" onClick={() => void run()} disabled={busy}>
            {busy ? '正在排版…' : '导出'}
          </Button>
        </div>
      )}
    </div>
  )
}
