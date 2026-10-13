/**
 * 应用版低延迟监听 (0.23.0): microphone → headphones through the sound card
 * driver directly (RtAudio via audify), on a worker thread of the app, with
 * small buffers. The page keeps recording and scoring through the browser as
 * before; this only replaces what the singer hears.
 *
 * Same sound as the browser monitor: both input channels folded to mono, a
 * gentle 90 Hz low cut, the level and an optional light reverb.
 */
import { parentPort } from 'node:worker_threads'
import { RtAudio } from 'audify'

// audify's enums are ambient const enums (not usable with isolated modules): their values.
type Api = ConstructorParameters<typeof RtAudio>[0]
const API_ASIO = 6 as Api
const API_WASAPI = 7 as Api
const FLOAT32 = 0x10 as Parameters<RtAudio['openStream']>[2]
const MINIMIZE_LATENCY = 0x2 as NonNullable<Parameters<RtAudio['openStream']>[8]>

export type MonitorRequest =
  | { id: number; type: 'devices' }
  | {
      id: number
      type: 'start'
      api: 'wasapi' | 'asio'
      asioName?: string
      inputName: string
      outputName: string
      volume: number
      reverb: boolean
    }
  | { id: number; type: 'update'; volume: number; reverb: boolean }
  | { id: number; type: 'stop' }
  | { id: number; type: 'stats' }

export interface NativeDevice {
  api: 'ASIO' | 'WASAPI'
  name: string
  inputs: number
  outputs: number
}

const FRAMES_WASAPI = 128
const FRAMES_ASIO = 0 // the driver's own buffer size

let rt: RtAudio | null = null
/** Input buffers handled and the loudest input since the last 'stats' (for checking the stream runs). */
let buffers = 0
let peak = 0
let gain = 0.8
let target = 0.8
let wet = 0.25
let wetTarget = 0.25

/** Simple Schroeder reverb (4 combs, 2 all-passes), like a small plate. */
class Reverb {
  private combs: Array<{ buf: Float32Array; i: number; fb: number; lp: number }>
  private aps: Array<{ buf: Float32Array; i: number }>
  constructor(rate: number) {
    const s = rate / 44100
    this.combs = [1116, 1188, 1277, 1356].map((n) => ({
      buf: new Float32Array(Math.round(n * s)),
      i: 0,
      fb: 0.78,
      lp: 0,
    }))
    this.aps = [556, 441].map((n) => ({ buf: new Float32Array(Math.round(n * s)), i: 0 }))
  }
  process(x: number): number {
    let y = 0
    for (const c of this.combs) {
      const out = c.buf[c.i]!
      c.lp = out * 0.6 + c.lp * 0.4
      c.buf[c.i] = x + c.lp * c.fb
      c.i = (c.i + 1) % c.buf.length
      y += out
    }
    y *= 0.25
    for (const a of this.aps) {
      const b = a.buf[a.i]!
      const o = -y + b
      a.buf[a.i] = y + b * 0.5
      a.i = (a.i + 1) % a.buf.length
      y = o
    }
    return y
  }
}

function devices(): NativeDevice[] {
  const out: NativeDevice[] = []
  for (const [api, label] of [
    [API_WASAPI, 'WASAPI'],
    [API_ASIO, 'ASIO'],
  ] as const) {
    try {
      for (const d of new RtAudio(api).getDevices())
        out.push({ api: label, name: d.name, inputs: d.inputChannels, outputs: d.outputChannels })
    } catch {
      // this API is not available here
    }
  }
  return out
}

/** Device names from the browser and from the driver differ a little ("麦克风 (USB Audio)" vs "USB Audio"). */
function findDevice(
  list: Array<{ id: number; name: string; isDefault: number; channels: number }>,
  name: string,
) {
  const usable = list.filter((d) => d.channels > 0)
  const clean = (x: string) =>
    x
      .toLowerCase()
      .replace(/^(默认|default|communications|通讯)\s*-\s*/i, '')
      .replace(/\s+/g, '')
  const want = clean(name)
  if (want) {
    const exact = usable.find((d) => clean(d.name) === want)
    if (exact) return exact
    const part = usable.find((d) => clean(d.name).includes(want) || want.includes(clean(d.name)))
    if (part) return part
    // "麦克风 (Realtek(R) Audio)": the part in brackets is often the driver's name.
    const inner = /\((.+)\)\s*$/.exec(name)?.[1]
    const byInner = inner ? usable.find((d) => clean(d.name).includes(clean(inner))) : undefined
    if (byInner) return byInner
  }
  return usable.find((d) => d.isDefault) ?? usable[0]
}

function start(req: Extract<MonitorRequest, { type: 'start' }>) {
  stop()
  const api = req.api === 'asio' ? API_ASIO : API_WASAPI
  const audio = new RtAudio(api)
  const all = audio.getDevices()
  let input: ReturnType<typeof findDevice>
  let output: ReturnType<typeof findDevice>
  if (req.api === 'asio') {
    const d = all.find((x) => x.name === req.asioName) ?? all[0]
    if (!d) throw new Error('没有找到 ASIO 驱动。')
    input = { id: d.id, name: d.name, isDefault: 1, channels: d.inputChannels }
    output = { id: d.id, name: d.name, isDefault: 1, channels: d.outputChannels }
  } else {
    input = findDevice(
      all.map((d) => ({
        id: d.id,
        name: d.name,
        isDefault: d.isDefaultInput,
        channels: d.inputChannels,
      })),
      req.inputName,
    )
    output = findDevice(
      all.map((d) => ({
        id: d.id,
        name: d.name,
        isDefault: d.isDefaultOutput,
        channels: d.outputChannels,
      })),
      req.outputName,
    )
  }
  if (!input) throw new Error('没有找到输入设备。')
  if (!output) throw new Error('没有找到输出设备。')
  const outInfo = all.find((d) => d.id === output!.id)!
  const inInfo = all.find((d) => d.id === input!.id)!
  const rate =
    req.api === 'asio' ? inInfo.preferredSampleRate || 48000 : outInfo.preferredSampleRate || 48000
  const inCh = Math.min(2, inInfo.inputChannels)
  const outCh = Math.min(2, outInfo.outputChannels)
  const reverb = new Reverb(rate)
  // 90 Hz one-pole high-pass.
  const a = Math.exp((-2 * Math.PI * 90) / rate)
  let hpX = 0
  let hpY = 0
  gain = target = req.volume
  wet = wetTarget = req.reverb ? 0.25 : 0
  const step = 1 / (rate * 0.02)
  let frames = 0
  const onInput = (buf: Buffer) => {
    const x = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
    const n = x.length / inCh
    buffers++
    const out = new Float32Array(n * outCh)
    for (let i = 0; i < n; i++) {
      let m = 0
      for (let c = 0; c < inCh; c++) m += x[i * inCh + c]!
      if (Math.abs(m) > peak) peak = Math.abs(m)
      hpY = a * (hpY + m - hpX)
      hpX = m
      gain += Math.max(-step, Math.min(step, target - gain))
      wet += Math.max(-step, Math.min(step, wetTarget - wet))
      const r = wet > 0.0005 ? reverb.process(hpY) * wet : (reverb.process(0), 0)
      const y = Math.max(-1, Math.min(1, (hpY + r) * gain))
      for (let c = 0; c < outCh; c++) out[i * outCh + c] = y
    }
    try {
      audio.write(Buffer.from(out.buffer))
    } catch {
      // stream stopping
    }
  }
  frames = audio.openStream(
    { deviceId: output.id, nChannels: outCh },
    { deviceId: input.id, nChannels: inCh },
    FLOAT32,
    rate,
    req.api === 'asio' ? FRAMES_ASIO : FRAMES_WASAPI,
    'GrooveLab monitor',
    onInput,
    null,
    MINIMIZE_LATENCY,
    (_type, text) => parentPort!.postMessage({ event: 'error', message: text }),
  )
  audio.start()
  rt = audio
  const bufferMs = (frames / rate) * 1000
  return {
    api: req.api === 'asio' ? 'ASIO' : 'WASAPI',
    input: input.name,
    output: output.name,
    sampleRate: rate,
    frames,
    // input buffer + output queue (one buffer each); WASAPI shared adds its own period (~10 ms) on each side.
    latencyMs: Math.round(req.api === 'asio' ? bufferMs * 2 : bufferMs * 2 + 20),
  }
}

function stop() {
  if (!rt) return
  try {
    if (rt.isStreamRunning()) rt.stop()
    rt.closeStream()
  } catch {
    // already closed
  }
  rt = null
}

parentPort!.on('message', (req: MonitorRequest) => {
  try {
    let value: unknown
    if (req.type === 'devices') value = devices()
    else if (req.type === 'start') value = start(req)
    else if (req.type === 'stats') {
      value = { buffers, peak }
      buffers = 0
      peak = 0
    } else if (req.type === 'update') {
      target = Math.max(0, Math.min(1.5, req.volume))
      wetTarget = req.reverb ? 0.25 : 0
    } else stop()
    parentPort!.postMessage({ id: req.id, ok: true, value })
  } catch (e) {
    parentPort!.postMessage({
      id: req.id,
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    })
  }
})
