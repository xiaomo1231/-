/**
 * One-click stem separation for the student's own recordings.
 *
 * Two engines, same result (named files the stem detector understands):
 * - local: the GrooveLab helper on this computer (helper/server.py, UVR's
 *   audio-separator on the GPU) — fast, best quality; used when it answers.
 * - browser, mode 'vocals' (跟唱): UVR-MDX-NET-Voc_FT, half precision,
 *   shipped with the site (public/models) — vocals and the rest only, fast.
 * - browser, mode 'stems': htdemucs_6s via onnxruntime-web in a worker —
 *   six stems, slower; the 285 MB model is downloaded once from Hugging Face.
 */
import { encodeWav } from '@/export/wav'
import { DEMUCS_RATE } from './chunks'
import type { WorkerMessage, WorkerRequest } from './demucs.worker'
import type { MdxMessage, MdxRequest } from './mdx.worker'
import { CHUNK, COMPENSATE, MDX_RATE, TRIM, blendWindow, mdxPlan, readChunk } from './mdx'
import { durationText, etaSeconds, recordTiming } from './timings'

export const HELPER_URL = 'http://127.0.0.1:5175'
export const BROWSER_MODEL_URL = 'https://huggingface.co/kramp/htdemucs-6s-webgpu-onnx/resolve/main/htdemucs_6s.onnx'
export const BROWSER_MODEL_MB = 285

export type Engine = 'local' | 'browser'
/** 'vocals': vocals + everything else (enough for 跟唱); 'stems': six stems. */
export type SeparationMode = 'vocals' | 'stems'

/** Shipped half-precision vocals model (UVR-MDX-NET-Voc_FT; scripts/make-vocal-model.py). */
export const VOCALS_MODEL_PATH = 'models/vocals-mdx-fp16.onnx'
/** Admin / testing: localStorage 'groovelab:separation-cpu' = '1' skips the GPU. */
export function forceCpu(): boolean {
  try {
    return localStorage.getItem('groovelab:separation-cpu') === '1'
  } catch {
    return false
  }
}
/** Chunk overlap for the vocals model (UVR uses 0.25; less is faster and sounds the same with Hann blending). */
export const VOCALS_OVERLAP = 0.15

export interface HelperStatus {
  ok: boolean
  device: string
  version: string
}

export interface SeparationProgress {
  phase: 'connect' | 'upload' | 'download' | 'load' | 'separate' | 'encode'
  /** 0–1 within the phase. */
  ratio: number
  text: string
}

/** Is the local helper running? (A quick request; null when not.) */
export async function helperStatus(timeoutMs = 1200): Promise<HelperStatus | null> {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    const res = await fetch(`${HELPER_URL}/health`, { signal: ctl.signal })
    clearTimeout(t)
    if (!res.ok) return null
    const j = (await res.json()) as HelperStatus
    return j.ok ? j : null
  } catch {
    return null
  }
}

export async function browserModelCached(): Promise<boolean> {
  try {
    return Boolean(await (await caches.open('groovelab-models-v1')).match(BROWSER_MODEL_URL))
  } catch {
    return false
  }
}

export function hasWebGpu(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, '').slice(0, 60) || 'song'

/** Separate with the local helper. Mode 'full' = best vocals (roformer) + six stems from the rest. */
async function viaHelper(file: File, onProgress: (p: SeparationProgress) => void, signal?: AbortSignal): Promise<File[]> {
  onProgress({ phase: 'upload', ratio: 0, text: '正在交给本机分轨服务…' })
  const res = await fetch(`${HELPER_URL}/separate?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, ...(signal ? { signal } : {}) })
  if (!res.ok) throw new Error(`本机分轨服务出错（${res.status}）：${await res.text()}`)
  const { job } = (await res.json()) as { job: string }
  for (;;) {
    if (signal?.aborted) throw new DOMException('cancelled', 'AbortError')
    await new Promise((r) => setTimeout(r, 700))
    const st = (await (await fetch(`${HELPER_URL}/jobs/${job}`)).json()) as { state: 'running' | 'done' | 'error'; ratio: number; text: string; files?: Array<{ stem: string; url: string }>; error?: string }
    if (st.state === 'error') throw new Error(st.error ?? '本机分轨失败。')
    onProgress({ phase: 'separate', ratio: st.ratio, text: st.text })
    if (st.state === 'done') {
      const out: File[] = []
      for (const [i, f] of (st.files ?? []).entries()) {
        onProgress({ phase: 'encode', ratio: i / (st.files?.length || 1), text: '正在取回分好的轨道…' })
        const blob = await (await fetch(`${HELPER_URL}${f.url}`)).blob()
        out.push(new File([blob], `${baseName(file.name)}_(${f.stem}).wav`, { type: 'audio/wav' }))
      }
      return out
    }
  }
}

const backendText = (backend?: string) => (backend === 'webgpu' ? '显卡加速' : '处理器计算，会比较慢')
const etaText = (elapsed?: number, ratio = 0) => {
  const eta = elapsed === undefined ? null : etaSeconds(elapsed, ratio)
  return eta === null ? '' : `，还要约 ${durationText(eta)}`
}

async function decodeStereo(file: File, rate: number): Promise<{ left: Float32Array; right: Float32Array }> {
  const ctx = new OfflineAudioContext(2, 1, rate)
  const buf = await ctx.decodeAudioData(await file.arrayBuffer())
  return {
    left: new Float32Array(buf.getChannelData(0)),
    right: new Float32Array(buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)),
  }
}

/** Workers that separate side by side on the CPU (each single-threaded; ~150–300 MB each). */
export function cpuWorkers(cores = navigator.hardwareConcurrency || 4): number {
  return Math.max(1, Math.min(6, Math.floor(cores / 3)))
}

/** Can this GPU run the half-precision model? (WebGPU with float16 shaders.) */
async function gpuCanRun(): Promise<boolean> {
  if (forceCpu()) return false
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ features: { has(f: string): boolean } } | null> } }).gpu
  const adapter = await gpu?.requestAdapter().catch(() => null)
  return Boolean(adapter?.features.has('shader-f16'))
}

/**
 * Separate the song's chunks with a set of workers (one on the GPU, several on
 * the CPU) and blend them like UVR. Returns the vocals.
 */
async function runMdx(
  left: Float32Array,
  right: Float32Array,
  backend: 'webgpu' | 'wasm',
  onProgress: (p: SeparationProgress) => void,
  signal?: AbortSignal,
): Promise<{ vocals: [Float32Array, Float32Array]; workers: number; seconds: number; loadSeconds: number }> {
  const base = new URL((import.meta.env?.BASE_URL as string | undefined) ?? '/', window.location.href).href
  const total = left.length
  const { padded, chunks } = mdxPlan(total, VOCALS_OVERLAP)
  const count = backend === 'webgpu' ? 1 : cpuWorkers()
  const batch = backend === 'webgpu' ? 2 : 1
  const label = backend === 'webgpu' ? '显卡加速' : `处理器 ${count} 路并行`
  const accL = new Float32Array(padded)
  const accR = new Float32Array(padded)
  const div = new Float32Array(padded)
  const workers = Array.from({ length: count }, () => new Worker(new URL('./mdx.worker.ts', import.meta.url), { type: 'module' }))
  const t0 = performance.now()
  let t1 = 0
  try {
    return await new Promise((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')))
      let next = 0
      let done = 0
      let ready = 0
      const send = (w: Worker) => {
        if (next >= chunks.length) return
        const ids: number[] = []
        const ls: Float32Array[] = []
        const rs: Float32Array[] = []
        for (let k = 0; k < batch && next < chunks.length; k++, next++) {
          const l = new Float32Array(CHUNK)
          const r = new Float32Array(CHUNK)
          readChunk(left, chunks[next]!.start, l)
          readChunk(right, chunks[next]!.start, r)
          ids.push(next)
          ls.push(l)
          rs.push(r)
        }
        const req: MdxRequest = { type: 'chunks', ids, left: ls, right: rs }
        w.postMessage(req, [...ls, ...rs].map((x) => x.buffer))
      }
      for (const w of workers) {
        w.onerror = (e) => reject(new Error(e.message || '分轨进程出错。'))
        w.onmessage = (e: MessageEvent<MdxMessage>) => {
          const m = e.data
          if (m.type === 'error') reject(backend === 'webgpu' && done === 0 ? new GpuFailed(m.message) : new Error(m.message))
          else if (m.type === 'progress') onProgress({ phase: 'download', ratio: m.ratio, text: '正在读取人声模型…' })
          else if (m.type === 'ready') {
            if (++ready === count) {
              t1 = performance.now()
              onProgress({ phase: 'separate', ratio: 0, text: `正在分离人声（${label}）… 0%` })
            }
            // Two batches in flight per worker, so it never waits for the page.
            send(w)
            send(w)
          } else {
            m.ids.forEach((id, b) => {
              const s = chunks[id]!.start
              const n = Math.min(CHUNK, padded - s)
              const l = m.left[b]!
              const r = m.right[b]!
              for (let i = 0; i < n; i++) {
                const wgt = blendWindow[i]!
                accL[s + i]! += l[i]! * wgt
                accR[s + i]! += r[i]! * wgt
                div[s + i]! += wgt
              }
              done++
            })
            const ratio = done / chunks.length
            const elapsed = (performance.now() - (t1 || t0)) / 1000
            onProgress({ phase: 'separate', ratio, text: `正在分离人声（${label}）… ${Math.round(ratio * 100)}%${etaText(elapsed, ratio)}` })
            if (done === chunks.length) {
              const vl = new Float32Array(total)
              const vr = new Float32Array(total)
              for (let i = 0; i < total; i++) {
                const p = i + TRIM
                const d = div[p]! > 1e-8 ? div[p]! : 1
                vl[i] = (accL[p]! / d) * COMPENSATE
                vr[i] = (accR[p]! / d) * COMPENSATE
              }
              const end = performance.now()
              resolve({ vocals: [vl, vr], workers: count, seconds: (end - (t1 || t0)) / 1000, loadSeconds: ((t1 || end) - t0) / 1000 })
            } else send(w)
          }
        }
        const init: MdxRequest = { type: 'init', base, modelUrl: `${base}${VOCALS_MODEL_PATH}`, backend }
        w.postMessage(init)
      }
      onProgress({ phase: 'load', ratio: 0, text: `正在准备模型（${label}）…` })
    })
  } finally {
    for (const w of workers) w.terminate()
  }
}

class GpuFailed extends Error {}

/** Vocals and the rest, in this browser (MDX-Net vocals model). */
async function vocalsInBrowser(file: File, onProgress: (p: SeparationProgress) => void, signal?: AbortSignal): Promise<File[]> {
  onProgress({ phase: 'load', ratio: 0, text: '正在解码音频…' })
  const { left, right } = await decodeStereo(file, MDX_RATE)
  let backend: 'webgpu' | 'wasm' = (await gpuCanRun()) ? 'webgpu' : 'wasm'
  let r: Awaited<ReturnType<typeof runMdx>>
  try {
    r = await runMdx(left, right, backend, onProgress, signal)
  } catch (e) {
    if (!(e instanceof GpuFailed)) throw e
    onProgress({ phase: 'load', ratio: 0, text: '显卡加速没能启动，改用处理器计算…' })
    backend = 'wasm'
    r = await runMdx(left, right, backend, onProgress, signal)
  }
  recordTiming({ at: Date.now(), mode: 'vocals', engine: 'browser', backend, precision: 'fp16', threads: r.workers, seconds: r.seconds + r.loadSeconds, audioSeconds: left.length / MDX_RATE })
  onProgress({ phase: 'encode', ratio: 0, text: '正在保存分好的轨道…' })
  const [vl, vr] = r.vocals
  // The rest = mix − vocals.
  const il = new Float32Array(left.length)
  const ir = new Float32Array(right.length)
  for (let i = 0; i < il.length; i++) {
    il[i] = left[i]! - vl[i]!
    ir[i] = right[i]! - vr[i]!
  }
  return [
    new File([encodeWav([vl, vr], MDX_RATE) as BlobPart], `${baseName(file.name)}_(Vocals).wav`, { type: 'audio/wav' }),
    new File([encodeWav([il, ir], MDX_RATE) as BlobPart], `${baseName(file.name)}_(Instrumental).wav`, { type: 'audio/wav' }),
  ]
}

/** Separate in this browser (htdemucs_6s). */
async function viaBrowser(file: File, onProgress: (p: SeparationProgress) => void, signal?: AbortSignal): Promise<File[]> {
  onProgress({ phase: 'load', ratio: 0, text: '正在解码音频…' })
  const { left, right } = await decodeStereo(file, DEMUCS_RATE)
  const worker = new Worker(new URL('./demucs.worker.ts', import.meta.url), { type: 'module' })
  const base = new URL((import.meta.env?.BASE_URL as string | undefined) ?? '/', window.location.href).href
  try {
    const t0 = performance.now()
    let backend: string | undefined
    let threads: number | undefined
    const stems = await new Promise<Extract<WorkerMessage, { type: 'done' }>['stems']>((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')))
      worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const m = e.data
        if (m.type === 'error') reject(new Error(m.message))
        else if (m.type === 'done') resolve(m.stems)
        else {
          backend = m.backend ?? backend
          threads = m.threads ?? threads
          const text =
            m.phase === 'download'
              ? `第一次使用，正在下载分轨模型（约 ${BROWSER_MODEL_MB} MB，之后不用再下）… ${Math.round(m.ratio * 100)}%`
              : m.phase === 'load'
                ? '正在准备模型…'
                : `正在分轨（${backendText(m.backend)}）… ${Math.round(m.ratio * 100)}%${etaText(m.elapsed, m.ratio)}`
          onProgress({ phase: m.phase, ratio: m.ratio, text })
        }
      }
      worker.onerror = (e) => reject(new Error(e.message || '分轨进程出错。'))
      const req: WorkerRequest = { type: 'run', base, modelUrl: BROWSER_MODEL_URL, left, right }
      worker.postMessage(req, [left.buffer, right.buffer])
    })
    recordTiming({ at: Date.now(), mode: 'stems', engine: 'browser', ...(backend ? { backend } : {}), ...(threads ? { threads } : {}), seconds: (performance.now() - t0) / 1000, audioSeconds: left.length / DEMUCS_RATE })
    onProgress({ phase: 'encode', ratio: 0, text: '正在保存分好的轨道…' })
    const label: Record<string, string> = { drums: 'Drums', bass: 'Bass', other: 'Other', vocals: 'Vocals', guitar: 'Guitar', piano: 'Piano' }
    return stems.map((s) => new File([encodeWav([s.left, s.right], DEMUCS_RATE) as BlobPart], `${baseName(file.name)}_(${label[s.name]}).wav`, { type: 'audio/wav' }))
  } finally {
    worker.terminate()
  }
}

/** Separate a recording into stems. Uses the local helper when it is running, unless `engine` says otherwise. */
export async function separateFile(file: File, opts: { engine?: Engine; mode?: SeparationMode; onProgress: (p: SeparationProgress) => void; signal?: AbortSignal }): Promise<{ files: File[]; engine: Engine }> {
  opts.onProgress({ phase: 'connect', ratio: 0, text: '正在查找本机分轨服务…' })
  const engine = opts.engine ?? ((await helperStatus()) ? 'local' : 'browser')
  const t0 = performance.now()
  if (engine === 'local') {
    const files = await viaHelper(file, opts.onProgress, opts.signal)
    recordTiming({ at: Date.now(), mode: opts.mode ?? 'stems', engine, seconds: (performance.now() - t0) / 1000, audioSeconds: 0 })
    return { files, engine }
  }
  const files = opts.mode === 'vocals' ? await vocalsInBrowser(file, opts.onProgress, opts.signal) : await viaBrowser(file, opts.onProgress, opts.signal)
  return { files, engine }
}
