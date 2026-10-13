/// <reference lib="webworker" />
/**
 * One vocals-separation worker (UVR-MDX-NET-Voc_FT, half precision, shipped
 * with the site; onnxruntime-web). The page runs one on the GPU, or several
 * single-threaded ones side by side on the CPU (onnxruntime's own threads
 * cannot start inside a worker), and hands each of them chunks of the song.
 *
 * Per chunk: spectrum (STFT) → model → vocals waveform; the page blends the
 * chunks. On the GPU the next batch's spectra are prepared while the current
 * batch runs.
 */
import type * as Ort from 'onnxruntime-web'
import { CHUNK, CHUNK_VALUES, DIM_F, DIM_T, MdxDsp } from './mdx'
import { modelBytes } from './modelCache'

export type MdxRequest =
  | { type: 'init'; base: string; modelUrl: string; backend: 'webgpu' | 'wasm' }
  /** Chunks of CHUNK samples per channel (already padded / zero-filled). */
  | { type: 'chunks'; ids: number[]; left: Float32Array[]; right: Float32Array[] }

export type MdxMessage =
  | { type: 'progress'; phase: 'download'; ratio: number }
  | { type: 'ready' }
  | { type: 'result'; ids: number[]; left: Float32Array[]; right: Float32Array[] }
  | { type: 'error'; message: string }

const post = (m: MdxMessage, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer)

let ort: typeof Ort | null = null
let session: Ort.InferenceSession | null = null
const dsp = new MdxDsp()
const queue: Array<Extract<MdxRequest, { type: 'chunks' }>> = []
let busy = false

async function init(req: Extract<MdxRequest, { type: 'init' }>): Promise<void> {
  ort = (await import(/* @vite-ignore */ `${req.base}ort/ort.webgpu.min.mjs`)) as typeof Ort
  ort.env.wasm.wasmPaths = `${req.base}ort/`
  ort.env.wasm.numThreads = 1
  const bytes = await modelBytes(req.modelUrl, (r) => post({ type: 'progress', phase: 'download', ratio: r }))
  session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: [req.backend], graphOptimizationLevel: 'all' })
  post({ type: 'ready' })
  void drain()
}

function prep(job: Extract<MdxRequest, { type: 'chunks' }>): Ort.Tensor {
  const n = job.ids.length
  const data = new Float32Array(n * CHUNK_VALUES)
  for (let b = 0; b < n; b++) dsp.stft(job.left[b]!, job.right[b]!, data, b)
  return new ort!.Tensor('float32', data, [n, 4, DIM_F, DIM_T])
}

/** Work through the queue; the next batch is prepared while the model runs. */
async function drain(): Promise<void> {
  if (busy || !session) return
  busy = true
  try {
    const s = session
    const run = (t: Ort.Tensor) => s.run({ [s.inputNames[0]!]: t })
    let job = queue.shift()
    let pending = job ? run(prep(job)) : null
    while (job && pending) {
      const nextJob = queue.shift()
      const nextInput = nextJob ? prep(nextJob) : null
      const res = await pending
      pending = nextJob && nextInput ? run(nextInput) : null
      const out = res[s.outputNames[0]!]!.data as Float32Array
      const left: Float32Array[] = []
      const right: Float32Array[] = []
      for (let b = 0; b < job.ids.length; b++) {
        const l = new Float32Array(CHUNK)
        const r = new Float32Array(CHUNK)
        dsp.istft(out, b, l, r)
        left.push(l)
        right.push(r)
      }
      for (const v of Object.values(res)) v.dispose?.()
      post({ type: 'result', ids: job.ids, left, right }, [...left, ...right].map((x) => x.buffer))
      job = nextJob
      // Batches that arrived meanwhile.
      if (!pending && queue.length) {
        job = queue.shift()
        pending = job ? run(prep(job)) : null
      }
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  } finally {
    busy = false
  }
}

self.onmessage = (e: MessageEvent<MdxRequest>) => {
  const req = e.data
  if (req.type === 'init') {
    init(req).catch((err: unknown) => post({ type: 'error', message: err instanceof Error ? err.message : String(err) }))
  } else {
    queue.push(req)
    void drain()
  }
}
