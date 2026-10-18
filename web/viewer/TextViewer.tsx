import { api } from '../lib/api'
import { useLoad } from '../lib/useLoad'
import { Notice } from '../components/ui'

/** Chord / tab text: monospace on the sheet, scrolling sideways rather than wrapping (the columns matter). */
export function TextViewer({ path }: { path: string }) {
  const state = useLoad((signal) => api.text(path, signal).then((r) => r.text), `text\n${path}`)

  if (state.status === 'loading') {
    return <p className="py-10 text-center text-sm text-muted-foreground">正在读取…</p>
  }
  if (state.status === 'error') return <Notice tone="error">{state.message}</Notice>
  if (!state.data.trim()) return <Notice>这个文件是空的。</Notice>

  return (
    <div className="sheet -mx-4 pb-24 sm:mx-0 sm:rounded-2xl">
      <pre className="max-h-[80vh] overflow-auto whitespace-pre px-4 py-6 font-mono text-[13px] leading-relaxed">
        {state.data}
      </pre>
    </div>
  )
}
