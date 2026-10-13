/**
 * 应用版分轨 (0.23.0): the app's onnxruntime-node separator behind the same
 * message interface as mdx.worker.ts, so runMdx drives it like a worker.
 * The spectrum maths runs in the app too; only audio chunks cross over.
 */
import { desktop } from '@/app/desktop'
import type { MdxMessage, MdxRequest } from './mdx.worker'

export function nativeSeparation(): boolean {
  return desktop() !== null
}

export class NativeMdxWorker {
  onmessage: ((e: MessageEvent<MdxMessage & { provider?: 'dml' | 'cpu' }>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  private closed = false

  postMessage(req: MdxRequest): void {
    const bridge = desktop()
    if (!bridge) return
    const emit = (m: MdxMessage & { provider?: 'dml' | 'cpu' }) => {
      if (!this.closed)
        this.onmessage?.({ data: m } as MessageEvent<MdxMessage & { provider?: 'dml' | 'cpu' }>)
    }
    const fail = (e: unknown) =>
      emit({
        type: 'error',
        message:
          e instanceof Error
            ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
            : String(e),
      })
    if (req.type === 'init') {
      bridge.mdx.init().then((info) => emit({ type: 'ready', provider: info.provider }), fail)
    } else {
      bridge.mdx
        .run(req.left, req.right)
        .then((r) => emit({ type: 'result', ids: req.ids, left: r.left, right: r.right }), fail)
    }
  }

  terminate(): void {
    this.closed = true
  }
}
