import { useEffect, type ReactNode } from 'react'
import type { ScoreFormat } from '@/songs/scoreLibraryTypes'
import { fileUrl } from '../lib/api'
import { fileBaseName, formatOfPath, isScoreFormat } from '../lib/format'
import { goBack, type ViewerRoute } from '../lib/route'
import { recordRecent } from '../lib/recent'
import { Notice, PageBar } from '../components/ui'
import { ScoreViewer } from './ScoreViewer'
import { ImageViewer } from './ImageViewer'
import { PdfViewer } from './PdfViewer'
import { TextViewer } from './TextViewer'
import { OtherViewer } from './OtherViewer'
import { FileBar } from './Remote'

/** The score viewer page: a one-line header, then the file in the way its format can be shown. */
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
  const artist = route.artist
  const pages = route.pages.length > 0 ? route.pages : [path]
  const item = { path, format, pages, title, artist }

  let body: ReactNode
  let bar: ReactNode = null
  switch (format) {
    case 'score':
      body = (
        <ScoreViewer
          key={path + route.combo + route.conv + route.arr}
          path={path}
          title={title}
          artist={artist}
          pages={pages}
          band={route.band}
          showDrums={route.drums}
          combo={route.combo}
          conv={route.conv}
          arr={route.arr}
          rehearsal={route.rehearsal}
        />
      )
      break
    case 'image':
      body = <ImageViewer paths={pages} />
      bar = <FileBar item={item} downloadHref={fileUrl(path, true)} />
      break
    case 'pdf':
      body = <PdfViewer path={path} title={title} artist={artist} />
      bar = <FileBar item={item} downloadHref={fileUrl(path, true)} />
      break
    case 'text':
      body = <TextViewer path={path} />
      bar = <FileBar item={item} downloadHref={fileUrl(path, true)} />
      break
    default:
      body = <OtherViewer format={format} path={path} />
  }

  return (
    <div className="space-y-4 pb-6">
      <header className="gutter mx-auto flex w-full max-w-[1180px] flex-wrap items-baseline gap-x-3.5 gap-y-1 pb-1 pt-3.5">
        <button
          type="button"
          aria-label="返回"
          onClick={() => goBack('#/')}
          className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center self-center rounded-full text-3xl leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <span aria-hidden className="-translate-y-0.5">
            ‹
          </span>
        </button>
        <h1 className="min-w-0 break-words font-display text-[26px] font-black leading-tight">
          {title}
        </h1>
        {artist && <span className="break-words text-sm text-muted-foreground">{artist}</span>}
        <span className="mono min-w-0 break-all text-[11px] text-muted-foreground">
          {fileBaseName(path)}
        </span>
      </header>
      {/* The score runs edge to edge; pictures, PDFs and text keep the page gutter. */}
      {format === 'score' ? (
        body
      ) : (
        <div className="gutter mx-auto w-full max-w-[1180px]">{body}</div>
      )}
      {bar}
    </div>
  )
}
