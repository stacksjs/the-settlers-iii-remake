import { expect, test } from 'bun:test'
import { paintTriangle } from '../../resources/game/terrain-raster'
import { toView } from '../../resources/game/engine/geometry'

const permutations = <T>(a: T, b: T, c: T): [T, T, T][] => [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]]

test('joined mesh faces cover every square pixel exactly once under all vertex orders', () => {
  const a = { x: 0, y: 0 }, b = { x: 4, y: 0 }, c = { x: 4, y: 4 }, d = { x: 0, y: 4 }
  for (const first of permutations(a, b, c)) for (const second of permutations(a, c, d)) {
    const data = new Uint32Array(16), count = new Uint8Array(16)
    for (const points of [first, second]) paintTriangle(data, 4, 4, ...points, (x, y) => { count[y * 4 + x]!++; return 7 })
    expect([...data]).toEqual(Array(16).fill(7)); expect([...count]).toEqual(Array(16).fill(1))
  }
})

test('pixel-centre ties have half-open ownership at the outer boundary', () => {
  const data = new Uint32Array(25), count = new Uint8Array(25)
  const a = { x: 0.5, y: 0.5 }, b = { x: 4.5, y: 0.5 }, c = { x: 4.5, y: 4.5 }, d = { x: 0.5, y: 4.5 }
  const sample = (x: number, y: number): number => { count[y * 5 + x]!++; return 1 }
  paintTriangle(data, 5, 5, a, b, c, sample); paintTriangle(data, 5, 5, a, c, d, sample)
  expect([...data]).toEqual([1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0])
  expect([...count]).toEqual([...data])
})

test('a horizontal shared edge belongs to the lower face exactly once', () => {
  const data = new Uint32Array(20), count = new Uint8Array(20)
  const left = { x: 0, y: 2.5 }, right = { x: 4, y: 2.5 }
  const paint = (color: number) => (x: number, y: number): number => { count[y * 4 + x]!++; return color }
  paintTriangle(data, 4, 5, left, { x: 2, y: 0.5 }, right, paint(1))
  paintTriangle(data, 4, 5, left, right, { x: 2, y: 4.5 }, paint(2))
  expect([...data]).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 2, 2, 2, 2, 0, 2, 2, 0, 0, 0, 0, 0])
  expect([...count]).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0])
})

test('clipping preserves the literal diagonal and gives the sampler actual raster coordinates', () => {
  const clipped = new Uint32Array(4)
  paintTriangle(clipped, 2, 2, { x: -2, y: -2 }, { x: 3, y: -2 }, { x: 3, y: 3 }, () => 9)
  expect([...clipped]).toEqual([9, 9, 0, 9])
  const patterned = new Uint32Array(4), a = { x: 0, y: 0 }, b = { x: 2, y: 0 }, c = { x: 2, y: 2 }, d = { x: 0, y: 2 }
  const sample = (x: number, y: number): number => (x + y) % 2 ? 2 : 1
  paintTriangle(patterned, 2, 2, a, b, c, sample); paintTriangle(patterned, 2, 2, a, c, d, sample)
  expect([...patterned]).toEqual([1, 2, 2, 1])
})

test('later opaque geometry replaces earlier geometry and degenerate faces paint nothing', () => {
  const data = new Uint32Array(4), a = { x: 0, y: 0 }, b = { x: 2, y: 0 }, c = { x: 2, y: 2 }
  paintTriangle(data, 2, 2, a, b, c, () => 1); paintTriangle(data, 2, 2, a, b, c, () => 2)
  paintTriangle(data, 2, 2, a, a, c, () => 8)
  expect([...data]).toEqual([2, 2, 0, 2])
})

test('invalid targets and non-finite geometry are rejected before sampling', () => {
  const a = { x: 0, y: 0 }, b = { x: 2, y: 0 }, c = { x: 2, y: 2 }, data = new Uint32Array(4)
  const sample = (): number => { throw new Error('Invalid geometry reached the sampler') }
  expect(() => paintTriangle(data, 3, 2, a, b, c, sample)).toThrow(RangeError)
  expect(() => paintTriangle(data, 2.5, 2, a, b, c, sample)).toThrow(RangeError)
  expect(() => paintTriangle(data, 2, 2, { x: NaN, y: 0 }, b, c, sample)).toThrow(RangeError)
  expect(() => paintTriangle(data, 2, 2, { x: Infinity, y: 0 }, b, c, sample)).toThrow(RangeError)
})

test('opaque chunk grouping preserves global row ordering under the actual elevated projection', () => {
  const size = 35, width = size * 24 + 16, height = size * 9 + 526
  const vertex = (x: number, y: number) => {
    const point = toView(x, y, (x * 19 + y * 37 + x * y * 3) % 256)
    return { x: point.x + size * 8, y: point.y + 518 }
  }
  const cell = (target: Uint32Array, x: number, y: number): void => {
    const a = vertex(x, y), b = vertex(x + 1, y), c = vertex(x + 1, y + 1), d = vertex(x, y + 1)
    paintTriangle(target, width, height, a, c, d, () => (0xff000000 | (y * size + x) * 2 + 1) >>> 0)
    paintTriangle(target, width, height, a, b, c, () => (0xff000000 | (y * size + x) * 2 + 2) >>> 0)
  }
  const reference = new Uint32Array(width * height)
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) cell(reference, x, y)
  expect(reference.some(value => value !== 0)).toBe(true)
  for (const chunk of [8, 16, 32]) {
    const grouped = new Uint32Array(reference.length)
    for (let cy = 0; cy < size - 1; cy += chunk) for (let cx = 0; cx < size - 1; cx += chunk) {
      for (let y = cy; y < Math.min(size - 1, cy + chunk); y++) for (let x = cx; x < Math.min(size - 1, cx + chunk); x++) cell(grouped, x, y)
    }
    expect(grouped).toEqual(reference)
  }
})
