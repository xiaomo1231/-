/**
 * 应用版 (0.23.0): what the desktop app (Electron, electron/) adds to the
 * page. The browser version has none of this; every caller checks `desktop()`
 * first and keeps its browser path.
 */

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
}

export function desktop(): DesktopBridge | null {
  return typeof window !== 'undefined'
    ? ((window as unknown as { groovelab?: DesktopBridge }).groovelab ?? null)
    : null
}
