import { api } from '../lib/api'
import { useLoad } from '../lib/useLoad'
import { Notice } from '../components/ui'

/** Chord / tab text: monospace on paper, scrolling sideways rather than wrapping (the columns matter). */
export function TextViewer({ path }: { path: string }) {
  const state = useLoad((signal) => api.text(path, signal).then((r) => r.text), `text\n${path}`)

  if (state.status === 'loading') {
    return <p className="py-10 text-center text-sm text-muted-foreground">正在读取…</p>
  }
  if (state.status === 'error') return <Notice tone="error">{state.message}</Notice>
  if (!state.data.trim()) return <Notice>这个文件是空的。</Notice>

  return (
    <div className="paper overflow-hidden">
      <pre className="max-h-[75vh] overflow-auto whitespace-pre p-4 font-mono text-[13px] leading-relaxed">
        {state.data}
      </pre>
    </div>
  )
}
