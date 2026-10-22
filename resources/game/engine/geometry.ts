// Settlers III uses a sheared triangular lattice: each tile has six neighbours.
// Direction order and offsets follow the pinned reference remake's EDirection
// (paulwedeck/settlers-remake@6ad8c42), which is engineering evidence for the
// original topology, not an original-executable observation.
export const DIRECTIONS = [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 0], [-1, -1]] as const
export const DIRECTION_NAMES = ['north-east', 'east', 'south-east', 'south-west', 'west', 'north-west'] as const
export type Direction = 0 | 1 | 2 | 3 | 4 | 5

export interface Point { x: number, y: number }
export interface Bounds { width: number, height: number }

export const inside = (bounds: Bounds, x: number, y: number): boolean => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < bounds.width && y < bounds.height
export const indexOf = (bounds: Bounds, x: number, y: number): number => y * bounds.width + x
export const pointOf = (bounds: Bounds, index: number): Point => ({ x: index % bounds.width, y: Math.floor(index / bounds.width) })

/** Steps between two tiles on the six-neighbour lattice. */
export function distance(a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  return (dx >= 0) === (dy >= 0) ? Math.max(Math.abs(dx), Math.abs(dy)) : Math.abs(dx) + Math.abs(dy)
}

export function directionBetween(from: Point, to: Point): Direction | null {
  const dx = to.x - from.x, dy = to.y - from.y
  const found = DIRECTIONS.findIndex(([x, y]) => x === dx && y === dy)
  return found < 0 ? null : found as Direction
}

export function neighbours(bounds: Bounds, index: number): number[] {
  const x = index % bounds.width, y = Math.floor(index / bounds.width), result: number[] = []
  for (const [dx, dy] of DIRECTIONS) if (inside(bounds, x + dx, y + dy)) result.push(indexOf(bounds, x + dx, y + dy))
  return result
}

/** Tiles within a lattice radius, in stable row-major order. */
export function area(bounds: Bounds, center: Point, radius: number): number[] {
  const result: number[] = []
  for (let y = Math.max(0, center.y - radius); y <= Math.min(bounds.height - 1, center.y + radius); y++) {
    for (let x = Math.max(0, center.x - radius); x <= Math.min(bounds.width - 1, center.x + radius); x++) if (distance(center, { x, y }) <= radius) result.push(indexOf(bounds, x, y))
  }
  return result
}

// View projection measured by the reference remake's MapCoordinateConverter:
// a tile is 16 units wide, rows are 9 units apart and shift 8 units left, and
// each elevation unit raises the tile 2 units. Renderers scale these units.
export const TILE_WIDTH = 16, ROW_HEIGHT = 9, ELEVATION_RISE = 2
export const toView = (x: number, y: number, elevation = 0): Point => ({ x: x * TILE_WIDTH - y * TILE_WIDTH / 2, y: y * ROW_HEIGHT - elevation * ELEVATION_RISE })

/** Inverse projection on flat ground, rounded to the nearest lattice tile. */
export function fromView(viewX: number, viewY: number): Point {
  const y = viewY / ROW_HEIGHT, x = (viewX + y * TILE_WIDTH / 2) / TILE_WIDTH
  let best = { x: Math.round(x), y: Math.round(y) }, bestError = Infinity
  for (let cy = Math.floor(y) - 1; cy <= Math.ceil(y) + 1; cy++) {
    for (let cx = Math.floor(x) - 1; cx <= Math.ceil(x) + 1; cx++) {
      const view = toView(cx, cy), error = ((view.x - viewX) / TILE_WIDTH) ** 2 + ((view.y - viewY) / ROW_HEIGHT) ** 2
      if (error < bestError - 1e-9) { bestError = error; best = { x: cx, y: cy } }
    }
  }
  return best
}
