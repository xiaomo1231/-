import { api } from '../lib/api'
import { useLoad } from '../lib/useLoad'
import { Notice } from '../components/ui'

/** Chord / tab text: monospace, scrolling sideways rather than wrapping (the columns matter). */
export function TextViewer({ path }: { path: string }) {
  const state = useLoad((signal) => api.text(path, signal).then((r) => r.text), `text\n${path}`)

  if (state.status === 'loading') {
    return <p className="py-10 text-center text-sm text-muted-foreground">正在读取…</p>
  }
  if (state.status === 'error') return <Notice tone="error">{state.message}</Notice>
  if (!state.data.trim()) return <Notice>这个文件是空的。</Notice>

  return (
    <pre className="max-h-[75vh] overflow-auto whitespace-pre rounded-2xl border border-border/80 bg-card p-4 font-mono text-sm leading-relaxed text-foreground">
      {state.data}
    </pre>
  )
}
