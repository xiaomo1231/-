import { useEffect, useState } from 'react'
import { ScoreLibrary } from '@/features/scores/scoreLibraryClient'
import { decodeLyricBytes } from '@/songs/lyricFiles'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'
import { audioMime, extOf, imageMime } from '@/widgets/scores/ScoreViewerFormat'

export type ReadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; bytes: Uint8Array[] }

export function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : '读取失败，请稍后再试。'
}

/** Reads the library files at these paths, in order (re-read when the list changes). */
export function useLibraryBytes(paths: string[]): ReadState {
  const key = paths.join('\n')
  const [state, setState] = useState<ReadState>({ status: 'loading' })
  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    void (async () => {
      try {
        const out: Uint8Array[] = []
        for (const p of key.split('\n')) out.push(await ScoreLibrary.read(p))
        if (alive) setState({ status: 'ready', bytes: out })
      } catch (e) {
        if (alive) setState({ status: 'error', message: errorText(e) })
      }
    })()
    return () => {
      alive = false
    }
  }, [key])
  return state
}

/** A status line while loading or on failure. */
export function ReadStatus({ state }: { state: ReadState }) {
  if (state.status === 'loading')
    return <p className="py-16 text-center text-sm text-muted-foreground">正在读取…</p>
  if (state.status === 'error')
    return (
      <p className="rounded-2xl border border-destructive/40 p-4 text-sm text-destructive">
        {state.message}
      </p>
    )
  return null
}

type Zoom = 'fit' | 'natural' | 75 | 150

const ZOOMS: Array<{ value: Zoom; label: string }> = [
  { value: 75, label: '75%' },
  { value: 'natural', label: '100%' },
  { value: 150, label: '150%' },
  { value: 'fit', label: '适合宽度' },
]

/** Image scores: every page stacked vertically, with zoom. */
export function ScoreImages({ paths }: { paths: string[] }) {
  const state = useLibraryBytes(paths)
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    if (state.status !== 'ready') return
    const made = state.bytes.map((b, i) =>
      URL.createObjectURL(new Blob([b.slice()], { type: imageMime(extOf(paths[i] ?? '')) })),
    )
    setUrls(made)
    return () => made.forEach((u) => URL.revokeObjectURL(u))
  }, [state, paths])

  if (state.status !== 'ready') return <ReadStatus state={state} />

  const style =
    zoom === 'fit'
      ? { width: '100%' }
      : zoom === 'natural'
        ? { maxWidth: '100%' }
        : { width: `${zoom}%` }
  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="缩放">
        {ZOOMS.map((z) => (
          <Button
            key={String(z.value)}
            size="sm"
            variant={zoom === z.value ? 'default' : 'outline'}
            onClick={() => setZoom(z.value)}
            aria-pressed={zoom === z.value}
          >
            {z.label}
          </Button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <div className="space-y-5">
          {urls.map((u, i) => (
            <figure key={u}>
              <figcaption className="mb-1 text-xs text-muted-foreground">
                第 {i + 1} / {urls.length} 页
              </figcaption>
              <img
                src={u}
                alt={`第 ${i + 1} 页`}
                style={style}
                className="block h-auto rounded-xl border border-border/80 bg-white"
              />
            </figure>
          ))}
        </div>
      </div>
    </div>
  )
}

/** PDF scores: the computer's PDF viewer inside the page. */
export function ScorePdf({ path }: { path: string }) {
  const state = useLibraryBytes([path])
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (state.status !== 'ready') return
    const u = URL.createObjectURL(
      new Blob([(state.bytes[0] ?? new Uint8Array()).slice()], { type: 'application/pdf' }),
    )
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [state])

  if (state.status !== 'ready' || !url) return <ReadStatus state={state} />
  return (
    <iframe
      title="PDF 谱"
      src={url}
      className={cn('h-[85vh] w-full rounded-2xl border border-border/80 bg-white')}
    />
  )
}

/** Chord / tab text: shown as written, whitespace kept. */
export function ScoreText({ path }: { path: string }) {
  const state = useLibraryBytes([path])
  if (state.status !== 'ready') return <ReadStatus state={state} />
  const text = decodeLyricBytes(state.bytes[0] ?? new Uint8Array())
  return (
    <pre className="max-h-[80vh] overflow-auto whitespace-pre rounded-2xl border border-border/80 bg-card p-4 font-mono text-sm leading-relaxed">
      {text}
    </pre>
  )
}

/** Audio files: the browser's own player. */
export function ScoreAudio({ path, ext }: { path: string; ext: string }) {
  const state = useLibraryBytes([path])
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (state.status !== 'ready') return
    const u = URL.createObjectURL(
      new Blob([(state.bytes[0] ?? new Uint8Array()).slice()], { type: audioMime(ext) }),
    )
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [state, ext])

  if (state.status !== 'ready' || !url) return <ReadStatus state={state} />
  return <audio controls src={url} className="w-full" />
}
