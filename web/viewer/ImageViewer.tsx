import { fileUrl } from '../lib/api'

/** Image scores: each page full width on the page, stacked, with its number; pinch-zoom works. */
export function ImageViewer({ paths }: { paths: string[] }) {
  const total = paths.length
  return (
    <ol className="space-y-6 pb-24">
      {paths.map((p, i) => (
        <li key={p} className="space-y-2">
          <p className="mono text-[11px] text-muted-foreground">
            第 {i + 1} / {total} 页
          </p>
          <img
            src={fileUrl(p)}
            alt={`第 ${i + 1} 页`}
            loading="lazy"
            decoding="async"
            className="block h-auto w-full"
          />
        </li>
      ))}
    </ol>
  )
}
