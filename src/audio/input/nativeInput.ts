/**
 * 应用版: the microphone as the sound card driver delivers it (from the
 * app's low-latency monitor), turned into an audio node the page can use in
 * place of the browser's microphone stream. Needed with ASIO, which takes the
 * whole sound card: then recording and scoring read from here.
 *
 * The audio thread keeps a short buffer, converts the driver's sample rate to
 * the page's, and drops excess when the two clocks drift apart, so the delay
 * never grows.
 */
import { desktop } from '@/app/desktop'
import { createWorkletNode } from '@/audio/guitar/worklets'

const NAME = 'groovelab-native-input'

const SOURCE = `
class NativeInput extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buf = new Float32Array(65536)
    this.write = 0
    this.read = 0
    this.ratio = 1
    this.port.onmessage = (e) => {
      const { data, rate } = e.data
      this.ratio = rate / sampleRate
      const n = this.buf.length
      for (let i = 0; i < data.length; i++) this.buf[(this.write + i) % n] = data[i]
      this.write = (this.write + data.length) % n
      // Keep at most ~60 ms queued: drop the oldest when the clocks drift.
      const max = Math.round(rate * 0.06)
      const have = (this.write - Math.floor(this.read) + n) % n
      if (have > max) this.read = (this.write - Math.round(rate * 0.02) + n) % n
    }
  }
  process(_inputs, outputs) {
    const out = outputs[0][0]
    if (!out) return true
    const n = this.buf.length
    for (let i = 0; i < out.length; i++) {
      const have = (this.write - Math.floor(this.read) + n) % n
      if (have < 2) { out[i] = 0; continue }
      const a = Math.floor(this.read)
      const f = this.read - a
      out[i] = this.buf[a % n] * (1 - f) + this.buf[(a + 1) % n] * f
      this.read = (this.read + this.ratio) % n
    }
    return true
  }
}
registerProcessor('${NAME}', NativeInput)
`

const loaded = new WeakMap<BaseAudioContext, Promise<void>>()

async function ensure(ctx: BaseAudioContext): Promise<void> {
  let p = loaded.get(ctx)
  if (!p) {
    p = (async () => {
      const url = URL.createObjectURL(new Blob([SOURCE], { type: 'text/javascript' }))
      try {
        await ctx.audioWorklet.addModule(url)
      } finally {
        URL.revokeObjectURL(url)
      }
    })()
    loaded.set(ctx, p)
  }
  return p
}

/** A node playing the driver's microphone; `stop` ends it. */
export async function nativeInputNode(
  ctx: BaseAudioContext,
): Promise<{ node: AudioNode; stop: () => void }> {
  const app = desktop()
  if (!app) throw new Error('只有应用版能直接读取声卡。')
  await ensure(ctx)
  const node = createWorkletNode(NAME, {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  })
  const off = app.monitor.onInput((data, rate) =>
    node.port.postMessage({ data, rate }, [data.buffer]),
  )
  return {
    node,
    stop: () => {
      off()
      node.disconnect()
    },
  }
}
