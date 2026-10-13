/// <reference lib="webworker" />
/**
 * In-browser stem separation (htdemucs_6s, ONNX) in a worker so the page
 * stays responsive. onnxruntime-web is loaded from public/ort at run time
 * (WebGPU when available, else WASM); the model is downloaded once from
 * Hugging Face and kept in Cache Storage.
 */
import type * as Ort from 'onnxruntime-web'
import { SEGMENT, STEMS_6, chunkPlan, chunkWeight } from './chunks'
import { gpuAdapter, modelBytes as cachedModel, wasmThreads } from './modelCache'

export interface WorkerRequest {
  type: 'run'
  base: string
  modelUrl: string
  left: Float32Array
  right: Float32Array
}

export type WorkerMessage =
  | { type: 'progress'; phase: 'download' | 'load' | 'separate'; ratio: number; backend?: string; threads?: number; elapsed?: number }
  | { type: 'done'; stems: Array<{ name: (typeof STEMS_6)[number]; left: Float32Array; right: Float32Array }>; backend: string }
  | { type: 'error'; message: string }

const post = (m: WorkerMessage, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer)

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data
  if (req.type !== 'run') return
  try {
    const ort = (await import(/* @vite-ignore */ `${req.base}ort/ort.webgpu.min.mjs`)) as typeof Ort
    ort.env.wasm.wasmPaths = `${req.base}ort/`
    const threads = wasmThreads()
    ort.env.wasm.numThreads = threads
    const bytes = await cachedModel(req.modelUrl, (r) => post({ type: 'progress', phase: 'download', ratio: r }))
    post({ type: 'progress', phase: 'load', ratio: 0 })
    const hasGpu = (await gpuAdapter()) !== null
    let session: Ort.InferenceSession
    let backend = hasGpu ? 'webgpu' : 'wasm'
    try {
      session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: hasGpu ? ['webgpu'] : ['wasm'], graphOptimizationLevel: 'all' })
    } catch (err) {
      if (!hasGpu) throw err
      backend = 'wasm'
      session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
    }
    post({ type: 'progress', phase: 'separate', ratio: 0, backend, threads, elapsed: 0 })
    const tRun = performance.now()

    const total = req.left.length
    const plan = chunkPlan(total)
    const out = STEMS_6.map(() => [new Float32Array(total), new Float32Array(total)] as const)
    const weight = new Float32Array(total)
    const input = new Float32Array(2 * SEGMENT)
    for (let ci = 0; ci < plan.length; ci++) {
      const c = plan[ci]!
      input.fill(0)
      input.set(req.left.subarray(c.start, c.start + c.length), 0)
      input.set(req.right.subarray(c.start, c.start + c.length), SEGMENT)
      const result = await session.run({ mix: new ort.Tensor('float32', input, [1, 2, SEGMENT]) })
      const stems = (result.stems ?? Object.values(result)[0]!).data as Float32Array
      for (let s = 0; s < STEMS_6.length; s++) {
        for (let ch = 0; ch < 2; ch++) {
          const src = (s * 2 + ch) * SEGMENT
          const dst = out[s]![ch]!
          for (let j = 0; j < c.length; j++) dst[c.start + j]! += stems[src + j]! * chunkWeight(c, j)
        }
      }
      for (let j = 0; j < c.length; j++) weight[c.start + j]! += chunkWeight(c, j)
      for (const t of Object.values(result)) t.dispose?.()
      post({ type: 'progress', phase: 'separate', ratio: (ci + 1) / plan.length, backend, threads, elapsed: (performance.now() - tRun) / 1000 })
    }
    for (const [l, r] of out) {
      for (let i = 0; i < total; i++) {
        const w = weight[i]! || 1
        l[i] = l[i]! / w
        r[i] = r[i]! / w
      }
    }
    await session.release()
    const stems = STEMS_6.map((name, s) => ({ name, left: out[s]![0], right: out[s]![1] }))
    post({ type: 'done', stems, backend }, stems.flatMap((s) => [s.left.buffer, s.right.buffer]))
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
