/**
 * Offline brick-wall limiter and loudness normalisation (pure), used when a
 * mix is rendered for export: the live preview's DynamicsCompressor is not a
 * true peak limiter, so the rendered result is made safe here.
 *
 * Gain computer: the gain each sample needs to stay under the ceiling, the
 * minimum of that over ± lookahead, averaged over the same window (so the gain
 * is smooth and still never above what any sample needs), then a slow
 * release. Checked with a 4× true-peak meter and tightened until it holds.
 */
import { integratedLufs, truePeakDb } from './loudness'

export function limitPeaks(channels: Float32Array[], sampleRate: number, ceilingDb: number, lookaheadMs = 3, releaseMs = 120): Float32Array[] {
  const n = channels[0]?.length ?? 0
  if (!n) return channels.map((c) => c.slice())
  const L = Math.max(1, Math.round((lookaheadMs / 1000) * sampleRate))
  const relA = 1 - Math.exp(-1 / ((releaseMs / 1000) * sampleRate))
  let out: Float32Array[] = channels.map((c) => c.slice())
  for (let pass = 0, margin = 0.3; pass < 4; pass++, margin += 0.4) {
    const ceil = Math.pow(10, (ceilingDb - margin) / 20)
    // required gain per sample
    const need = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      let p = 0
      for (const c of out) {
        const a = Math.abs(c[i]!)
        if (a > p) p = a
      }
      need[i] = p > ceil ? ceil / p : 1
    }
    if (need.every((g) => g >= 1) && truePeakDb(out, sampleRate) <= ceilingDb) return out
    // sliding minimum over [i−L, i+L] (monotonic deque)
    const minG = new Float32Array(n)
    const dq: number[] = []
    let head = 0
    for (let i = 0, j = 0; i < n; i++) {
      while (j < n && j <= i + L) {
        while (dq.length > head && need[dq[dq.length - 1]!]! >= need[j]!) dq.pop()
        dq.push(j)
        j++
      }
      while (dq[head]! < i - L) head++
      minG[i] = need[dq[head]!]!
    }
    // moving average of the minimum over the same window
    const smooth = new Float32Array(n)
    let sum = 0
    let count = 0
    for (let i = 0; i < Math.min(n, L); i++) {
      sum += minG[i]!
      count++
    }
    for (let i = 0; i < n; i++) {
      const add = i + L
      if (add < n) {
        sum += minG[add]!
        count++
      }
      const drop = i - L - 1
      if (drop >= 0) {
        sum -= minG[drop]!
        count--
      }
      smooth[i] = Math.min(minG[i]!, sum / count)
    }
    // slow release (never above what is needed)
    let g = 1
    const next = out.map(() => new Float32Array(n))
    for (let i = 0; i < n; i++) {
      g = Math.min(smooth[i]!, g + (1 - g) * relA)
      out.forEach((c, k) => (next[k]![i] = c[i]! * g))
    }
    out = next
  }
  return out
}

/** Bring a mix to a target loudness (LUFS), limiting peaks to `ceilingDb` when `limit`. Two passes (limiting lowers loudness a little). */
export function normalizeLoudness(channels: Float32Array[], sampleRate: number, targetLufs: number, ceilingDb: number, limit: boolean): Float32Array[] {
  let out: Float32Array[] = channels.map((c) => c.slice())
  for (let pass = 0; pass < 2; pass++) {
    const l = integratedLufs(out, sampleRate)
    if (!Number.isFinite(l)) return out
    const gain = Math.pow(10, (targetLufs - l) / 20)
    if (Math.abs(targetLufs - l) < 0.2 && pass > 0) break
    out = out.map((c) => c.map((v) => v * gain))
    if (limit) out = limitPeaks(out, sampleRate, ceilingDb)
  }
  return out
}
