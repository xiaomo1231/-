import { fileUrl } from '../lib/api'

/** Image scores: each page on its own sheet of paper, stacked; pinch-zoom works (the page does not block it). */
export function ImageViewer({ paths }: { paths: string[] }) {
  const total = paths.length
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{total} 页 · 双指可以放大看细节</p>
      <ol className="space-y-5">
        {paths.map((p, i) => (
          <li key={p} className="space-y-2">
            <p className="mono text-[11px] text-muted-foreground">
              第 {i + 1} / {total} 页
            </p>
            <div className="paper p-2 sm:p-3">
              <img
                src={fileUrl(p)}
                alt={`第 ${i + 1} 页`}
                loading="lazy"
                decoding="async"
                className="block h-auto w-full rounded-lg"
              />
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
