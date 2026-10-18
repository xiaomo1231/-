import { useEffect, type ReactNode } from 'react'
import type { ScoreFormat } from '@/songs/scoreLibraryTypes'
import { buttonClass } from '../lib/classes'
import { fileUrl } from '../lib/api'
import { fileBaseName, formatOfPath, isScoreFormat } from '../lib/format'
import { goBack, type ViewerRoute } from '../lib/route'
import { recordRecent } from '../lib/recent'
import { FormatBadge, Notice, PageBar } from '../components/ui'
import { ScoreViewer } from './ScoreViewer'
import { ImageViewer } from './ImageViewer'
import { PdfViewer } from './PdfViewer'
import { TextViewer } from './TextViewer'
import { OtherViewer } from './OtherViewer'

/** The score viewer page: the file in the way its format can be shown, plus the original to download. */
export function Viewer({ route }: { route: ViewerRoute }) {
  const path = route.path

  // Remember this score for 最近看过 once per opened file.
  useEffect(() => {
    if (path) recordRecent(route)
    // `route` is read for its fields; the file path identifies the opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  if (!path) {
    return (
      <>
        <PageBar title="看谱" fallback="#/" />
        <Notice tone="error">没有指定要看的文件。</Notice>
      </>
    )
  }

  const format: ScoreFormat = isScoreFormat(route.format) ? route.format : formatOfPath(path)
  const title = route.title || fileBaseName(path)
  const pages = route.pages.length > 0 ? route.pages : [path]

  let body: ReactNode
  switch (format) {
    case 'score':
      body = <ScoreViewer key={path} path={path} />
      break
    case 'image':
      body = <ImageViewer paths={pages} />
      break
    case 'pdf':
      body = <PdfViewer path={path} />
      break
    case 'text':
      body = <TextViewer path={path} />
      break
    default:
      body = <OtherViewer format={format} path={path} />
  }

  return (
    <div className="space-y-5 pb-6">
      <header className="flex items-start gap-3 pt-2">
        <button
          type="button"
          aria-label="返回"
          onClick={() => goBack('#/')}
          className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-3xl leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <span aria-hidden>‹</span>
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="break-words font-display text-3xl font-black leading-tight">{title}</h1>
          {route.artist && (
            <p className="mt-1 break-words text-sm text-muted-foreground">{route.artist}</p>
          )}
        </div>
      </header>
      <div className="flex min-w-0 items-center gap-2">
        <FormatBadge format={format} />
        <span className="mono min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {fileBaseName(path)}
        </span>
        <a
          href={fileUrl(path, true)}
          download
          className={buttonClass('outline') + ' shrink-0 px-3'}
        >
          下载原文件
        </a>
      </div>
      {body}
    </div>
  )
}
