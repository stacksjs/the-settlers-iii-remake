export const MAX_MAP_SEED = 0xFFFFFFFF
const SEED_ERROR = 'Map seed must be a whole number from 0 to 4294967295.'

export function validateMapSeed(seed: number): number {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > MAX_MAP_SEED) throw new RangeError(SEED_ERROR)
  return seed
}

/** An empty draft keeps random map selection. Canonical unsigned seeds avoid aliases. */
export function parseMapSeed(draft: string): number | undefined {
  const value = draft.trim()
  if (!value) return undefined
  if (!/^\d+$/.test(value)) throw new RangeError(SEED_ERROR)
  return validateMapSeed(Number(value))
}
