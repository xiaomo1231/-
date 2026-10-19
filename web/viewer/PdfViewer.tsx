import { fileBaseName } from '../lib/format'
import { fileUrl } from '../lib/api'
import { buttonClass } from '../lib/classes'
import { ConversionsPanel } from './ConversionsPanel'

/**
 * PDFs: a button opens the file in its own tab; the conversion panel (experimental
 * GP5 from a text tab PDF) sits below it; wide screens also show the file inline.
 */
export function PdfViewer({ path, title, artist }: { path: string; title: string; artist: string }) {
  const url = fileUrl(path)
  return (
    <div className="space-y-4 pb-24">
      <p className="break-all text-sm text-muted-foreground">{fileBaseName(path)}</p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClass('primary') + ' min-h-12 w-full'}
      >
        打开 PDF
      </a>
      <ConversionsPanel path={path} title={title} artist={artist} />
      <iframe
        title="PDF 谱子"
        src={url}
        className="hidden h-[82vh] w-full rounded-lg border border-border bg-white md:block"
      />
    </div>
  )
}
