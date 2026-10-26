import { expect, test } from 'bun:test'
import type { AtlasFrame } from '../../resources/game/assets'
import { indexAtlasFrames } from '../../resources/game/assets'

const body: AtlasFrame = { key: 'worker', frame: 0, x: 0, y: 0, width: 1, height: 1, offsetX: -1, offsetY: -2, torso: null, shadow: 'shadow:worker' }
const shadow: AtlasFrame = { key: 'shadow:worker', frame: 0, x: 1, y: 0, width: 1, height: 1, offsetX: -3, offsetY: 4 }
test('original atlas layers require explicit, typed associations to the same body frame', () => {
  expect(indexAtlasFrames([body, shadow], 4, 4).get('shadow:worker')).toEqual([shadow])
  for (const value of [0, false, '', 'worker', 'shadow:geologist']) {
    expect(() => indexAtlasFrames([{ ...body, shadow: value as unknown as string }], 4, 4)).toThrow()
    expect(() => indexAtlasFrames([{ ...body, shadow: null, torso: value as unknown as string }], 4, 4)).toThrow()
  }
  expect(() => indexAtlasFrames([{ ...body, shadow: undefined }, shadow], 4, 4)).toThrow()
  expect(() => indexAtlasFrames([body], 4, 4)).toThrow()
  expect(() => indexAtlasFrames([{ ...body, shadow: null }, shadow], 4, 4)).toThrow()
})

test('original atlas indexing rejects invalid geometry and ambiguous frame sequences before painting', () => {
  for (const [width, height] of [[0, 4], [4, -1], [Number.NaN, 4], [4, Number.POSITIVE_INFINITY], [8193, 8192]]) expect(() => indexAtlasFrames([], width!, height!)).toThrow()
  expect(() => indexAtlasFrames([body, body, shadow], 4, 4)).toThrow()
  expect(() => indexAtlasFrames([{ ...body, frame: 1 }, { ...shadow, frame: 1 }], 4, 4)).toThrow()
  for (const bad of [{ x: -1 }, { width: 5 }, { height: 0 }, { offsetX: 40000 }, { frame: -1 }]) expect(() => indexAtlasFrames([{ ...body, ...bad }, shadow], 4, 4)).toThrow()
})
