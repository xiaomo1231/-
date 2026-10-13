/**
 * Model bytes for the separation workers: from Cache Storage when stored,
 * else downloaded (with progress) and stored best-effort.
 */
export const MODEL_CACHE = 'groovelab-models-v1'

export async function modelBytes(url: string, onProgress: (ratio: number) => void): Promise<ArrayBuffer> {
  const cache = await caches.open(MODEL_CACHE).catch(() => null)
  const hit = await cache?.match(url).catch(() => undefined)
  if (hit) {
    onProgress(1)
    return hit.arrayBuffer()
  }
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`模型下载失败（${res.status}）。检查网络后重试。`)
  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    got += value.length
    if (total) onProgress(got / total)
  }
  const bytes = new Uint8Array(got)
  let o = 0
  for (const p of parts) {
    bytes.set(p, o)
    o += p.length
  }
  try {
    await cache?.put(url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }))
  } catch {
    // Storage full or restricted: still separate now, download again next time.
  }
  return bytes.buffer
}

/** Threads for onnxruntime's WASM backend: all but one core when the page is cross-origin isolated, else 1. */
export function wasmThreads(): number {
  return self.crossOriginIsolated ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1)) : 1
}

interface GpuAdapterLike {
  features: { has(name: string): boolean }
}

/** The WebGPU adapter, if any (null when WebGPU is missing or refused). */
export async function gpuAdapter(): Promise<GpuAdapterLike | null> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(o?: unknown): Promise<GpuAdapterLike | null> } }).gpu
  if (!gpu) return null
  return gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null)
}
