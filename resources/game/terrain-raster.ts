import type { Point } from './engine'

/** Opaque pixel-centre coverage with one owner per shared mesh edge.
 * Coordinates are on the backing-store grid. Later calls win at overlapping
 * geometry; the caller retains the mesh's actual face order.
 */
export function paintTriangle(data: Uint32Array, width: number, height: number, a: Point, b: Point, c: Point, sample: (x: number, y: number) => number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height !== data.length) throw new RangeError('Invalid terrain raster dimensions')
  if (![a.x, a.y, b.x, b.y, c.x, c.y].every(value => Number.isFinite(value) && Math.abs(value) <= 2 ** 24)) throw new RangeError('Invalid terrain raster coordinates')
  const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  if (area === 0) return
  if (area < 0) [b, c] = [c, b]
  const edges = [[a, b], [b, c], [c, a]].map(([p, q]) => {
    const dx = q!.x - p!.x, dy = q!.y - p!.y
    return { dx, dy, constant: dy * p!.x - dx * p!.y, include: dy < 0 || dy === 0 && dx > 0 }
  })
  const minX = Math.max(0, Math.ceil(Math.min(a.x, b.x, c.x) - 0.5)), maxX = Math.min(width - 1, Math.floor(Math.max(a.x, b.x, c.x) - 0.5))
  const minY = Math.max(0, Math.ceil(Math.min(a.y, b.y, c.y) - 0.5)), maxY = Math.min(height - 1, Math.floor(Math.max(a.y, b.y, c.y) - 0.5))
  for (let y = minY; y <= maxY; y++) {
    let left = minX, right = maxX
    for (const edge of edges) {
      const n = edge.dx * (y + 0.5) + edge.constant
      if (edge.dy < 0) left = Math.max(left, Math.ceil(n / edge.dy - 0.5))
      else if (edge.dy > 0) right = Math.min(right, Math.ceil(n / edge.dy - 0.5) - 1)
      else if (n < 0 || n === 0 && !edge.include) { right = left - 1; break }
    }
    let index = y * width + left
    for (let x = left; x <= right; x++) data[index++] = sample(x, y)
  }
}
