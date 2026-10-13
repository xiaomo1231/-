/**
 * Seedable PRNG (mulberry32). Every generated drill question carries its seed,
 * so a question can be reproduced exactly for review, bug reports and tests.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number
  pick<T>(items: readonly T[]): T
  shuffle<T>(items: readonly T[]): T[]
  /** True with the given probability. */
  chance(p: number): boolean
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1))
    },
    pick(items) {
      if (items.length === 0) throw new Error('pick() from empty list')
      return items[Math.floor(next() * items.length)]!
    },
    shuffle(items) {
      const out = [...items]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const tmp = out[i]!
        out[i] = out[j]!
        out[j] = tmp
      }
      return out
    },
    chance(p) {
      return next() < p
    },
  }
}

/** A fresh random seed for a new question. */
export function randomSeed(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    return buf[0]!
  }
  return Math.floor(Math.random() * 0xffffffff)
}
