import { useMemo, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, FolderOpen } from 'lucide-react'
import { ScoreLibrary } from '@/features/scores/scoreLibraryClient'
import { toast } from '@/features/toast/toastStore'
import { Button } from '@/shared/ui/Button'
import { ScoreViewerScore } from '@/widgets/scores/ScoreViewerScore'
import {
  ScoreAudio,
  ScoreImages,
  ScorePdf,
  ScoreText,
  errorText,
} from '@/widgets/scores/ScoreViewerFiles'
import {
  extOf,
  fileBaseName,
  parsePagesParam,
  scoreFormatOf,
} from '@/widgets/scores/ScoreViewerFormat'

/** One file of the score library, opened in place by its format (URL: ?p=…&pages=…&title=…&artist=…). */
export function ScoreViewPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const p = params.get('p') ?? ''
  const title = params.get('title')?.trim() ?? ''
  const artist = params.get('artist')?.trim() ?? ''
  const pagesRaw = params.get('pages')
  const pages = useMemo(() => parsePagesParam(pagesRaw), [pagesRaw])
  const ext = extOf(p)
  const format = scoreFormatOf(ext)

  const back = () => (location.key !== 'default' ? navigate(-1) : navigate('/scores'))
  const reportError = (e: unknown) =>
    toast({ title: '没能打开', description: errorText(e), variant: 'error' })
  const openExternal = () => {
    ScoreLibrary.openExternal(p).catch(reportError)
  }
  const reveal = () => {
    ScoreLibrary.reveal(p).catch(reportError)
  }

  const imagePaths = useMemo(() => (pages.length ? pages : [p]), [pages, p])
  const openButton = (
    <Button variant="outline" onClick={openExternal}>
      <ExternalLink /> 用系统程序打开
    </Button>
  )

  let body: ReactNode
  if (!p) {
    body = <p className="py-16 text-center text-sm text-muted-foreground">没有指定要打开的文件。</p>
  } else if (format === 'score') {
    body = <ScoreViewerScore key={p} path={p} fallback={openButton} />
  } else if (format === 'legacy') {
    body = (
      <div className="space-y-4 rounded-3xl border border-border/80 bg-card p-6">
        <p className="text-sm">这是 Guitar Pro 1–2 / Power Tab 的旧格式，应用里的看谱器读不了。</p>
        <div>{openButton}</div>
      </div>
    )
  } else if (format === 'image') {
    body = <ScoreImages paths={imagePaths} />
  } else if (format === 'pdf') {
    body = <ScorePdf path={p} />
  } else if (format === 'text') {
    body = <ScoreText path={p} />
  } else if (format === 'audio') {
    body = <ScoreAudio path={p} ext={ext} />
  } else if (format === 'midi') {
    body = (
      <div className="space-y-4 rounded-3xl border border-border/80 bg-card p-6">
        <p className="text-sm">MIDI 文件：用系统程序打开或播放</p>
        <div>{openButton}</div>
      </div>
    )
  } else {
    body = <div>{openButton}</div>
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={back}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> 返回谱库
      </button>
      <header className="min-w-0">
        <h1 className="truncate text-4xl font-semibold">{title || fileBaseName(p) || '谱子'}</h1>
        {artist && <p className="mt-1 text-sm text-muted-foreground">{artist}</p>}
      </header>
      {p && (
        <div className="flex flex-wrap items-center gap-2">
          <code
            className="min-w-0 flex-1 break-all rounded-lg bg-muted px-2 py-1 font-mono text-xs"
            title={p}
          >
            {p}
          </code>
          <Button variant="outline" size="sm" onClick={reveal}>
            <FolderOpen /> 在文件夹中显示
          </Button>
          {format !== 'score' && format !== 'legacy' && format !== 'midi' && (
            <Button variant="outline" size="sm" onClick={openExternal}>
              <ExternalLink /> 用系统程序打开
            </Button>
          )}
        </div>
      )}
      {body}
      <p className="text-xs text-muted-foreground">直接读取谱库里的原文件，不会复制或修改。</p>
    </div>
  )
}
