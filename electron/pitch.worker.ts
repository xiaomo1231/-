/**
 * 应用版音高 (0.24.0), on a worker thread of the app:
 *
 * - RMVPE (the original singer's line) on the processor with all cores: its
 *   GRU runs ~10× faster there than with DirectML. Weights are stored as
 *   float16 and cast to float32 on load. Requests run one at a time.
 * - SwiftF0 (the live microphone; also the line when RMVPE cannot run) on the
 *   processor: a small float32 model.
 *
 * {id, type: 'rmvpe', mel, frames} → {id, ok, hidden [frames][360]}
 * {id, type: 'swift', audio, fmin, fmax} → {id, ok, pitch, conf}
 */
import { parentPort, workerData } from 'node:worker_threads'
import * as ort from 'onnxruntime-node'

const { rmvpePath, swiftPath, cores } = workerData as {
  rmvpePath: string
  swiftPath: string
  cores: number
}
let rmvpe: Promise<ort.InferenceSession> | null = null
let swift: Promise<ort.InferenceSession> | null = null
let queue: Promise<unknown> = Promise.resolve()

type Req =
  | { id: number; type: 'rmvpe'; mel: Float32Array; frames: number }
  | { id: number; type: 'swift'; audio: Float32Array; fmin: number; fmax: number }

async function runRmvpe(req: Extract<Req, { type: 'rmvpe' }>) {
  rmvpe ??= ort.InferenceSession.create(rmvpePath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    intraOpNumThreads: Math.max(1, cores - 2),
  })
  const s = await rmvpe
  const out = await s.run({
    [s.inputNames[0]!]: new ort.Tensor('float32', req.mel, [1, 128, req.frames]),
  })
  const hidden = Float32Array.from(out[s.outputNames[0]!]!.data as Float32Array)
  for (const v of Object.values(out)) v.dispose?.()
  return { hidden }
}

async function runSwift(req: Extract<Req, { type: 'swift' }>) {
  swift ??= ort.InferenceSession.create(swiftPath, {
    executionProviders: ['cpu'],
    intraOpNumThreads: 1,
  })
  const s = await swift
  const out = await s.run({
    audio: new ort.Tensor('float32', req.audio, [1, req.audio.length]),
    fmin: new ort.Tensor('float32', new Float32Array([req.fmin]), []),
    fmax: new ort.Tensor('float32', new Float32Array([req.fmax]), []),
  })
  return {
    pitch: Float32Array.from(out.pitch!.data as Float32Array),
    conf: Float32Array.from(out.confidence!.data as Float32Array),
  }
}

parentPort!.on('message', (req: Req) => {
  let job: Promise<Record<string, unknown>>
  if (req.type === 'rmvpe') {
    job = queue.catch(() => undefined).then(() => runRmvpe(req))
    queue = job
  } else job = runSwift(req)
  job.then(
    (r) => parentPort!.postMessage({ id: req.id, ok: true, ...r }),
    (e: unknown) => {
      if (req.type === 'rmvpe') rmvpe = null
      else swift = null
      parentPort!.postMessage({
        id: req.id,
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      })
    },
  )
})
