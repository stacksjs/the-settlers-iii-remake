import { expect, test } from 'bun:test'
import { MAX_MAP_SEED, parseMapSeed, validateMapSeed } from '../../resources/game/setup'

test('map setup accepts unsigned seeds and leaves an empty draft random', () => {
  expect(parseMapSeed('')).toBeUndefined()
  expect(parseMapSeed('  ')).toBeUndefined()
  expect(parseMapSeed('0')).toBe(0)
  expect(parseMapSeed(' 0002 ')).toBe(2)
  expect(parseMapSeed('4294967295')).toBe(MAX_MAP_SEED)
  for (const draft of ['-1', '1.5', '1e3', '4294967296', 'Infinity', 'NaN', 'seed']) expect(() => parseMapSeed(draft)).toThrow('Map seed must be a whole number')
  for (const seed of [-1, 0.5, MAX_MAP_SEED + 1, NaN, Infinity]) expect(() => validateMapSeed(seed)).toThrow('Map seed must be a whole number')
})
