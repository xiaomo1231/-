import { fileBaseName } from '../lib/format'
import { fileUrl } from '../lib/api'
import { buttonClass, PANEL } from '../lib/classes'
import { FormatBadge } from '../components/ui'

/** PDFs: phones open them in their own viewer (a new tab); wide screens also show them inline on paper. */
export function PdfViewer({ path }: { path: string }) {
  const url = fileUrl(path)
  return (
    <div className="space-y-4">
      <div className={PANEL + ' flex items-center gap-3 p-4'}>
        <span
          aria-hidden
          className="mono flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/40 text-xs font-medium text-primary"
        >
          PDF
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{fileBaseName(path)}</p>
          <div className="mt-1">
            <FormatBadge format="pdf" />
          </div>
        </div>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClass('primary') + ' min-h-12 w-full'}
      >
        打开 PDF
      </a>
      <div className="paper hidden overflow-hidden p-3 md:block">
        <iframe title="PDF 谱子" src={url} className="block h-[80vh] w-full rounded-lg bg-white" />
      </div>
    </div>
  )
}
