import { fileUrl } from '../lib/api'
import { buttonClass } from '../lib/classes'

/** PDFs: phones open them in their own viewer (a new tab); wide screens also show them inline. */
export function PdfViewer({ path }: { path: string }) {
  const url = fileUrl(path)
  return (
    <div className="space-y-3">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClass('primary') + ' w-full'}
      >
        在新标签页打开 PDF
      </a>
      <iframe
        title="PDF 谱子"
        src={url}
        className="hidden h-[80vh] w-full rounded-xl border border-border bg-white md:block"
      />
    </div>
  )
}
