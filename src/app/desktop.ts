/**
 * 应用版 (0.23.0): what the desktop app (Electron, electron/) adds to the
 * page. The browser version has none of this; every caller checks `desktop()`
 * first and keeps its browser path.
 */

import type { ScoreScan } from '@/songs/scoreLibraryTypes'

export interface NativeMdxInfo {
  /** 'dml' = graphics card via DirectML, 'cpu' = processor (all cores). */
  provider: 'dml' | 'cpu'
}

export interface NativeMonitorStart {
  /** 'wasapi' (shared: the page can still record) or one ASIO driver. */
  api: 'wasapi' | 'asio'
  asioName?: string
  /** Input device name to look for (the microphone chosen in the page). */
  inputName: string
  /** Output device name to look for ('' = system default). */
  outputName: string
  volume: number
  reverb: boolean
  /** Also send the microphone to the page (ASIO takes the whole sound card: recording reads from here). */
  feed?: boolean
  /** Sample rate to ask for (the page's), when the device supports it. */
  sampleRate?: number
}

export interface NativeMonitorInfo {
  api: 'ASIO' | 'WASAPI'
  input: string
  output: string
  sampleRate: number
  frames: number
  /** Estimated mic-to-ear delay, ms (buffers only; the device adds a little). */
  latencyMs: number
}

export interface DesktopBridge {
  isApp: true
  version: string
  mdx: {
    /** Load the vocals model; DirectML first, else the processor. */
    init(): Promise<NativeMdxInfo>
    /** Chunks of CHUNK samples per channel → vocals chunks. */
    run(
      left: Float32Array[],
      right: Float32Array[],
    ): Promise<{ left: Float32Array[]; right: Float32Array[] }>
    dispose(): Promise<void>
  }
  /** RMVPE in the app's pitch worker (0.24.0): log-mel [128][frames] (frames a multiple of 32) → salience [frames][360]. */
  pitch: {
    available(): Promise<{ rmvpe: boolean; swift: boolean }>
    rmvpe(mel: Float32Array, frames: number): Promise<Float32Array>
    /** SwiftF0 on 16 kHz audio → pitch (Hz) and confidence per 256-sample frame. */
    swift(
      audio: Float32Array,
      fmin: number,
      fmax: number,
    ): Promise<{ pitch: Float32Array; conf: Float32Array }>
  }
  monitor: {
    /** Sound card devices the driver sees (WASAPI and ASIO). */
    devices(): Promise<
      Array<{ api: 'ASIO' | 'WASAPI'; name: string; inputs: number; outputs: number }>
    >
    start(s: NativeMonitorStart): Promise<NativeMonitorInfo>
    update(s: { volume: number; reverb: boolean }): Promise<void>
    /** Buffers handled and the loudest input since the last call (checks that sound arrives). */
    stats(): Promise<{ buffers: number; peak: number }>
    stop(): Promise<void>
    /** The microphone from the driver (when started with `feed`), mono chunks. Returns an unsubscribe. */
    onInput(cb: (data: Float32Array, rate: number) => void): () => void
  }
  /** 谱库 (0.29.0): the score folder the student chose, read only. Paths are relative to it, with '/'. */
  scores: {
    root(): Promise<string | null>
    pickRoot(): Promise<string | null>
    cached(): Promise<ScoreScan | null>
    scan(): Promise<ScoreScan>
    onProgress(cb: (files: number) => void): () => void
    read(path: string): Promise<Uint8Array>
    /** '' when it opened, else the system's error message. */
    openExternal(path: string): Promise<string>
    reveal(path: string): Promise<void>
  }
}

export function desktop(): DesktopBridge | null {
  return typeof window !== 'undefined'
    ? ((window as unknown as { groovelab?: DesktopBridge }).groovelab ?? null)
    : null
}
