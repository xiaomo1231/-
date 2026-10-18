import type { ReactNode } from 'react'
import type { ScoreFormat } from '@/songs/scoreLibraryTypes'
import { buttonClass } from '../lib/classes'
import { fileUrl } from '../lib/api'
import { fileBaseName, formatOfPath, isScoreFormat } from '../lib/format'
import type { ViewerRoute } from '../lib/route'
import { FormatBadge, Notice, PageBar } from '../components/ui'
import { ScoreViewer } from './ScoreViewer'
import { ImageViewer } from './ImageViewer'
import { PdfViewer } from './PdfViewer'
import { TextViewer } from './TextViewer'
import { OtherViewer } from './OtherViewer'

/** The score viewer page: the file in the way its format can be shown, plus the original to download. */
export function Viewer({ route }: { route: ViewerRoute }) {
  if (!route.path) {
    return (
      <>
        <PageBar title="看谱" fallback="#/" />
        <Notice tone="error">没有指定要看的文件。</Notice>
      </>
    )
  }

  const format: ScoreFormat = isScoreFormat(route.format) ? route.format : formatOfPath(route.path)
  const title = route.title || fileBaseName(route.path)
  const pages = route.pages.length > 0 ? route.pages : [route.path]

  let body: ReactNode
  switch (format) {
    case 'score':
      body = <ScoreViewer key={route.path} path={route.path} />
      break
    case 'image':
      body = <ImageViewer paths={pages} />
      break
    case 'pdf':
      body = <PdfViewer path={route.path} />
      break
    case 'text':
      body = <TextViewer path={route.path} />
      break
    default:
      body = <OtherViewer format={format} />
  }

  return (
    <div className="space-y-4 pb-6">
      <PageBar title={title} subtitle={route.artist || undefined} fallback="#/" />
      <div className="flex flex-wrap items-center gap-2">
        <FormatBadge format={format} />
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {fileBaseName(route.path)}
        </span>
        <a href={fileUrl(route.path, true)} download className={buttonClass('outline')}>
          下载原文件
        </a>
      </div>
      {body}
    </div>
  )
}
