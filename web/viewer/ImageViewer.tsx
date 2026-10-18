import { fileUrl } from '../lib/api'

/** Image scores: every page stacked at full width; pinch-zoom works (the page does not block it). */
export function ImageViewer({ paths }: { paths: string[] }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{paths.length} 页 · 双指可以放大看细节</p>
      <ol className="space-y-3">
        {paths.map((p, i) => (
          <li key={p}>
            <img
              src={fileUrl(p)}
              alt={`第 ${i + 1} 页`}
              loading="lazy"
              decoding="async"
              className="block h-auto w-full rounded-xl border border-border bg-white"
            />
          </li>
        ))}
      </ol>
    </div>
  )
}
