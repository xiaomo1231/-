import { describe, expect, it } from 'vitest'
import { assembleVoice, resample, sliceMs } from '@/songs/compAssembly'
import { SongClock, encodeTake, leakHint } from '@/audio/sing/voiceRecorder'

const readBytes = (b: Blob) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as ArrayBuffer)
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(b)
  })

describe('resample', () => {
  it('returns the same array when the rates match', () => {
    const x = new Float32Array([0.1, 0.2])
    expect(resample(x, 44100, 44100)).toBe(x)
  })

  it('produces length = round(len × to / from)', () => {
    expect(resample(new Float32Array(480), 48000, 24000).length).toBe(240)
    expect(resample(new Float32Array(1000), 22050, 44100).length).toBe(2000)
    expect(resample(new Float32Array(3), 44100, 48000).length).toBe(Math.round((3 * 48000) / 44100))
  })

  it('linearly interpolates values', () => {
    const out = resample(new Float32Array([0, 1, 2, 3]), 1, 2)
    expect(Array.from(out)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3])
  })
})

describe('assembleVoice', () => {
  const ones = (n: number) => new Float32Array(n).fill(1)

  it('places a piece at startMs with 30 ms fades at both ends and the middle unchanged', () => {
    const out = assembleVoice([{ samples: ones(200), sampleRate: 1000, startMs: 100 }], 500, 1000)
    expect(out.length).toBe(500)
    expect(out[99]).toBe(0)
    expect(out[100]).toBeCloseTo(0, 6)
    expect(out[200]).toBeCloseTo(1, 6)
    expect(out[299]).toBeCloseTo(0, 6)
    expect(out[101]).toBeCloseTo(1 / 30, 6)
    expect(out[300]).toBe(0)
  })

  it('sums overlapping pieces', () => {
    const out = assembleVoice(
      [
        { samples: ones(200), sampleRate: 1000, startMs: 0 },
        { samples: ones(200), sampleRate: 1000, startMs: 50 },
      ],
      300,
      1000,
    )
    expect(out[50]).toBeCloseTo(1, 6)
    expect(out[100]).toBeCloseTo(2, 6)
  })

  it('clips samples outside the total length and never throws for pieces past the end', () => {
    const out = assembleVoice(
      [
        { samples: ones(200), sampleRate: 1000, startMs: -50 },
        { samples: ones(200), sampleRate: 1000, startMs: 450 },
        { samples: ones(200), sampleRate: 1000, startMs: 9000 },
      ],
      500,
      1000,
    )
    expect(out.length).toBe(500)
    expect(out[0]).toBeCloseTo(1, 6)
    expect(out[499]).toBeCloseTo(1, 6)
  })

  it('resamples pieces to the output rate', () => {
    const out = assembleVoice([{ samples: ones(400), sampleRate: 2000, startMs: 0 }], 200, 1000)
    expect(out.length).toBe(200)
    expect(out[100]).toBeCloseTo(1, 6)
  })
})

describe('sliceMs', () => {
  const ramp = Float32Array.from({ length: 1000 }, (_, i) => i)

  it('cuts by song time', () => {
    const s = sliceMs(ramp, 1000, 100, 200)
    expect(s.length).toBe(100)
    expect(s[0]).toBe(100)
    expect(s[99]).toBe(199)
  })

  it('clamps to the available samples and returns empty for a reversed range', () => {
    expect(sliceMs(ramp, 1000, 900, 5000).length).toBe(100)
    expect(sliceMs(ramp, 1000, 500, 100).length).toBe(0)
    expect(sliceMs(ramp, 1000, -50, 10).length).toBe(10)
  })
})

describe('SongClock', () => {
  it('returns null with fewer than two marks', () => {
    const c = new SongClock()
    expect(c.timeAt(0)).toBeNull()
    c.mark(1, 0)
    expect(c.timeAt(0)).toBeNull()
  })

  it('interpolates between marks', () => {
    const c = new SongClock()
    c.mark(10, 0)
    c.mark(11, 1000)
    expect(c.timeAt(0)).toBeCloseTo(10, 6)
    expect(c.timeAt(500)).toBeCloseTo(10.5, 6)
    expect(c.timeAt(1000)).toBeCloseTo(11, 6)
  })

  it('a backwards jump (seek / loop) starts a new segment', () => {
    const c = new SongClock()
    c.mark(10, 0)
    c.mark(11, 1000)
    c.mark(12, 200)
    expect(c.timeAt(200)).toBeNull()
    c.mark(13, 1200)
    expect(c.timeAt(700)).toBeCloseTo(12.5, 6)
  })

  it('a large forward jump also starts a new segment; reset clears everything', () => {
    const c = new SongClock()
    c.mark(10, 0)
    c.mark(11, 1000)
    c.mark(20, 60000)
    expect(c.timeAt(30000)).toBeNull()
    c.reset()
    c.mark(30, 0)
    expect(c.timeAt(0)).toBeNull()
  })
})

describe('encodeTake', () => {
  it('writes a mono 16-bit RIFF/WAVE header at half the rate for 48 kHz input', async () => {
    const samples = new Float32Array(48000).fill(0.5)
    const { blob, sampleRate } = encodeTake(samples, 48000)
    expect(sampleRate).toBe(24000)
    expect(blob.type).toBe('audio/wav')
    const buf = await readBytes(blob)
    const v = new DataView(buf)
    const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))
    expect(tag(0)).toBe('RIFF')
    expect(tag(8)).toBe('WAVE')
    expect(tag(12)).toBe('fmt ')
    expect(v.getUint16(20, true)).toBe(1)
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint32(24, true)).toBe(24000)
    expect(v.getUint16(34, true)).toBe(16)
    expect(tag(36)).toBe('data')
    expect(v.getUint32(40, true)).toBe(48000)
    expect(v.getUint32(4, true)).toBe(36 + 48000)
    expect(buf.byteLength).toBe(44 + 48000)
    expect(blob.size).toBe(44 + 48000)
    expect(v.getInt16(44, true)).toBeGreaterThan(16000)
  })

  it('keeps the rate of 24 kHz input (no downsampling)', () => {
    const { sampleRate, blob } = encodeTake(new Float32Array(2400), 24000)
    expect(sampleRate).toBe(24000)
    expect(blob.size).toBe(44 + 2400 * 2)
  })
})

describe('leakHint', () => {
  const N = 4096
  const sine = (f: number, phase = 0) => Float32Array.from({ length: N }, (_, i) => Math.sin((2 * Math.PI * f * i) / N + phase))

  it('is about 1 for identical signals', () => {
    const s = sine(5)
    expect(leakHint(s, s)).toBeCloseTo(1, 6)
  })

  it('is about 0 for orthogonal sines', () => {
    expect(leakHint(sine(5), sine(9))).toBeLessThan(0.01)
  })

  it('is 0 for empty input', () => {
    expect(leakHint(new Float32Array(0), new Float32Array(0))).toBe(0)
  })
})
