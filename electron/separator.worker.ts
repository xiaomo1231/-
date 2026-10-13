/**
 * 应用版分轨 (0.23.0): the vocals model through onnxruntime-node, on a worker
 * thread of the app. DirectML runs it on the graphics card (NVIDIA, AMD and
 * Intel alike); without it, the processor with all its cores. The spectrum
 * maths is the page's own (src/audio/separation/mdx.ts), so the result is the
 * same as the browser version's.
 */
import { parentPort, workerData } from 'node:worker_threads'
import * as ort from 'onnxruntime-node'
import { CHUNK, CHUNK_VALUES, DIM_F, DIM_T, MdxDsp } from '../src/audio/separation/mdx'

export type SeparatorRequest =
  | { id: number; type: 'init' }
  | { id: number; type: 'run'; left: Float32Array[]; right: Float32Array[] }
export type SeparatorReply =
  | {
      id: number
      ok: true
      provider?: 'dml' | 'cpu'
      left?: Float32Array[]
      right?: Float32Array[]
    }
  | { id: number; ok: false; message: string }

const { modelPath, cores } = workerData as { modelPath: string; cores: number }
const dsp = new MdxDsp()
let session: ort.InferenceSession | null = null
let provider: 'dml' | 'cpu' = 'cpu'
let queue: Promise<unknown> = Promise.resolve()

async function load(): Promise<'dml' | 'cpu'> {
  if (session) return provider
  try {
    session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['dml'],
      graphOptimizationLevel: 'all',
    })
    // A tiny run proves the card can actually do it (old drivers fail here, not at load).
    const probe = new Float32Array(CHUNK)
    await run([probe], [probe])
    provider = 'dml'
  } catch {
    await session?.release().catch(() => undefined)
    session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      intraOpNumThreads: Math.max(1, cores - 1),
    })
    provider = 'cpu'
  }
  return provider
}

async function run(
  left: Float32Array[],
  right: Float32Array[],
): Promise<{ left: Float32Array[]; right: Float32Array[] }> {
  const s = session!
  const n = left.length
  const data = new Float32Array(n * CHUNK_VALUES)
  for (let b = 0; b < n; b++) dsp.stft(left[b]!, right[b]!, data, b)
  const res = await s.run({
    [s.inputNames[0]!]: new ort.Tensor('float32', data, [n, 4, DIM_F, DIM_T]),
  })
  const out = res[s.outputNames[0]!]!.data as Float32Array
  const outL: Float32Array[] = []
  const outR: Float32Array[] = []
  for (let b = 0; b < n; b++) {
    const l = new Float32Array(CHUNK)
    const r = new Float32Array(CHUNK)
    dsp.istft(out, b, l, r)
    outL.push(l)
    outR.push(r)
  }
  for (const v of Object.values(res)) v.dispose?.()
  return { left: outL, right: outR }
}

parentPort!.on('message', (req: SeparatorRequest) => {
  const reply = (r: SeparatorReply, transfer: ArrayBuffer[] = []) =>
    parentPort!.postMessage(r, transfer)
  const fail = (e: unknown) =>
    reply({ id: req.id, ok: false, message: e instanceof Error ? e.message : String(e) })
  if (req.type === 'init') load().then((p) => reply({ id: req.id, ok: true, provider: p }), fail)
  else {
    // DirectML cannot run one session twice at the same time: one after another.
    const job = queue.catch(() => undefined).then(() => run(req.left, req.right))
    queue = job
    job.then(
      (r) =>
        reply(
          { id: req.id, ok: true, left: r.left, right: r.right },
          [...r.left, ...r.right].map((x) => x.buffer as ArrayBuffer),
        ),
      fail,
    )
  }
})
