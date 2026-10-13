/**
 * One-click stem separation for the student's own recordings.
 *
 * Two engines, same result (named files the stem detector understands):
 * - local: the GrooveLab helper on this computer (helper/server.py, UVR's
 *   audio-separator on the GPU) — fast, best quality; used when it answers.
 * - browser: htdemucs_6s via onnxruntime-web in a worker — nothing to
 *   install, slower; the 285 MB model is downloaded once from Hugging Face.
 */
import { encodeWav } from '@/export/wav'
import { DEMUCS_RATE } from './chunks'
import type { WorkerMessage, WorkerRequest } from './demucs.worker'

export const HELPER_URL = 'http://127.0.0.1:5175'
export const BROWSER_MODEL_URL = 'https://huggingface.co/kramp/htdemucs-6s-webgpu-onnx/resolve/main/htdemucs_6s.onnx'
export const BROWSER_MODEL_MB = 285

export type Engine = 'local' | 'browser'

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

/** Separate in this browser (htdemucs_6s). */
async function viaBrowser(file: File, onProgress: (p: SeparationProgress) => void, signal?: AbortSignal): Promise<File[]> {
  onProgress({ phase: 'load', ratio: 0, text: '正在解码音频…' })
  const ctx = new OfflineAudioContext(2, 1, DEMUCS_RATE)
  const buf = await ctx.decodeAudioData(await file.arrayBuffer())
  const left = new Float32Array(buf.getChannelData(0))
  const right = new Float32Array(buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0))
  const worker = new Worker(new URL('./demucs.worker.ts', import.meta.url), { type: 'module' })
  const base = new URL((import.meta.env?.BASE_URL as string | undefined) ?? '/', window.location.href).href
  try {
    const stems = await new Promise<Extract<WorkerMessage, { type: 'done' }>['stems']>((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')))
      worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const m = e.data
        if (m.type === 'error') reject(new Error(m.message))
        else if (m.type === 'done') resolve(m.stems)
        else {
          const text =
            m.phase === 'download'
              ? `第一次使用，正在下载分轨模型（约 ${BROWSER_MODEL_MB} MB，之后不用再下）… ${Math.round(m.ratio * 100)}%`
              : m.phase === 'load'
                ? '正在准备模型…'
                : `正在分轨（${m.backend === 'webgpu' ? '显卡加速' : '处理器计算，会比较慢'}）… ${Math.round(m.ratio * 100)}%`
          onProgress({ phase: m.phase, ratio: m.ratio, text })
        }
      }
      worker.onerror = (e) => reject(new Error(e.message || '分轨进程出错。'))
      const req: WorkerRequest = { type: 'run', base, modelUrl: BROWSER_MODEL_URL, left, right }
      worker.postMessage(req, [left.buffer, right.buffer])
    })
    onProgress({ phase: 'encode', ratio: 0, text: '正在保存分好的轨道…' })
    const label: Record<string, string> = { drums: 'Drums', bass: 'Bass', other: 'Other', vocals: 'Vocals', guitar: 'Guitar', piano: 'Piano' }
    return stems.map((s) => new File([encodeWav([s.left, s.right], DEMUCS_RATE) as BlobPart], `${baseName(file.name)}_(${label[s.name]}).wav`, { type: 'audio/wav' }))
  } finally {
    worker.terminate()
  }
}

/** Separate a recording into stems. Uses the local helper when it is running, unless `engine` says otherwise. */
export async function separateFile(file: File, opts: { engine?: Engine; onProgress: (p: SeparationProgress) => void; signal?: AbortSignal }): Promise<{ files: File[]; engine: Engine }> {
  opts.onProgress({ phase: 'connect', ratio: 0, text: '正在查找本机分轨服务…' })
  const engine = opts.engine ?? ((await helperStatus()) ? 'local' : 'browser')
  const files = engine === 'local' ? await viaHelper(file, opts.onProgress, opts.signal) : await viaBrowser(file, opts.onProgress, opts.signal)
  return { files, engine }
}
