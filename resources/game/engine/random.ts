/** xoshiro128** with serializable state. The state travels with saves and replays. */
export type RandomState = [number, number, number, number]

export function seedRandom(seed: number): RandomState {
  if (!Number.isInteger(seed)) throw new RangeError('Seeds must be integers')
  let x = seed >>> 0
  const next = (): number => {
    x = (x + 0x9E3779B9) >>> 0
    let z = x
    z = Math.imul(z ^ (z >>> 16), 0x85EBCA6B) >>> 0
    z = Math.imul(z ^ (z >>> 13), 0xC2B2AE35) >>> 0
    return (z ^ (z >>> 16)) >>> 0
  }
  const state: RandomState = [next(), next(), next(), next()]
  if (state.every(value => value === 0)) state[0] = 1
  return state
}

export function nextRandom(state: RandomState): number {
  const [s0, s1, s2, s3] = state
  const rotate = (x: number, n: number): number => ((x << n) | (x >>> (32 - n))) >>> 0
  const result = Math.imul(rotate(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0
  const t = (s1 << 9) >>> 0
  state[2] = (s2 ^ s0) >>> 0
  state[3] = (s3 ^ s1) >>> 0
  state[1] = (s1 ^ state[2]) >>> 0
  state[0] = (s0 ^ state[3]) >>> 0
  state[2] = (state[2] ^ t) >>> 0
  state[3] = rotate(state[3], 11)
  return result
}

/** Unbiased integer in [0, bound). */
export function randomInt(state: RandomState, bound: number): number {
  if (!Number.isInteger(bound) || bound <= 0 || bound > 0x100000000) throw new RangeError('Random bound must be a positive 32-bit integer')
  const limit = 0x100000000 - (0x100000000 % bound)
  let value = nextRandom(state)
  while (value >= limit) value = nextRandom(state)
  return value % bound
}

export const validRandomState = (value: unknown): value is RandomState => Array.isArray(value) && value.length === 4 && value.every(n => Number.isInteger(n) && n >= 0 && n <= 0xFFFFFFFF) && value.some(n => n !== 0)
