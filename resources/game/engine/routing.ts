import type { Context } from './context'
import { passable, terrainAt } from './context'
import { distance, neighbours, pointOf } from './geometry'

export type Route = { ok: true, path: number[], cost: number, expanded: number } | { ok: false, reason: 'unreachable' | 'search-limit' | 'invalid', expanded: number }
export interface RouteOptions {
  /** Owner whose territory restricts the route; 0 allows any land. */
  territory?: number
  /** Tiles treated as blocked for this search, such as occupied tiles near a jam. */
  avoid?: ReadonlySet<number>
  /** Accept any tile adjacent to the goal when the goal itself is blocked (trees, stones). */
  adjacent?: boolean
  limit?: number
}

/** Ticks to step between two neighbouring tiles, or Infinity when the climb is too steep. */
export function stepCost(ctx: Context, from: number, to: number): number {
  const { movement } = ctx.rules, climb = Math.abs(ctx.state.map.elevation[to]! - ctx.state.map.elevation[from]!)
  if (climb > movement.maxClimb) return Infinity
  return movement.ticksPerStep * terrainAt(ctx, to).moveCost + climb * movement.slopeTicks
}

export function enterable(ctx: Context, tile: number, territory = 0, goal = -1): boolean {
  if (territory && ctx.state.map.owner[tile] !== territory) return false
  if (passable(ctx, tile)) return true
  // A building door is reachable even though the footprint is not.
  return tile === goal && terrainAt(ctx, tile).walkable && ctx.index.buildingAt[tile] === 0 && !(ctx.objects[ctx.state.map.object[tile]! - 1]?.blocks)
}

/** Deterministic bounded A*. Ties break on estimated remaining cost, then tile index. */
export function route(ctx: Context, from: number, goal: number, options: RouteOptions = {}): Route {
  const map = ctx.state.map, size = map.width * map.height
  if (!Number.isInteger(from) || !Number.isInteger(goal) || from < 0 || goal < 0 || from >= size || goal >= size) return { ok: false, reason: 'invalid', expanded: 0 }
  const limit = options.limit ?? ctx.rules.movement.searchLimit, territory = options.territory ?? 0
  const goals = new Set<number>(options.adjacent ? neighbours(map, goal).filter(t => t === from || enterable(ctx, t, territory)) : [goal])
  if (options.adjacent && passable(ctx, goal)) goals.add(goal)
  if (goals.has(from)) return { ok: true, path: [], cost: 0, expanded: 0 }
  const target = pointOf(map, goal), minimum = ctx.rules.movement.ticksPerStep
  const g = new Map<number, number>([[from, 0]]), parent = new Map<number, number>()
  const heap: [number, number, number][] = []
  const push = (item: [number, number, number]): void => {
    heap.push(item)
    for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (less(heap[i]!, heap[p]!)) { [heap[i], heap[p]] = [heap[p]!, heap[i]!]; i = p } else break }
  }
  const pop = (): [number, number, number] => {
    const top = heap[0]!, last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      for (let i = 0; ;) {
        const l = i * 2 + 1, r = l + 1
        let m = i
        if (l < heap.length && less(heap[l]!, heap[m]!)) m = l
        if (r < heap.length && less(heap[r]!, heap[m]!)) m = r
        if (m === i) break
        ;[heap[i], heap[m]] = [heap[m]!, heap[i]!]; i = m
      }
    }
    return top
  }
  const estimate = (tile: number): number => distance(pointOf(map, tile), target) * minimum
  push([estimate(from), estimate(from), from])
  let expanded = 0
  while (heap.length) {
    const [f, h, tile] = pop()
    const cost = g.get(tile)!
    if (f - h > cost) continue
    if (goals.has(tile)) {
      const path: number[] = []
      for (let at = tile; at !== from; at = parent.get(at)!) path.push(at)
      return { ok: true, path: path.reverse(), cost, expanded }
    }
    if (++expanded > limit) return { ok: false, reason: 'search-limit', expanded }
    for (const next of neighbours(map, tile)) {
      if (options.avoid?.has(next) || !(goals.has(next) ? enterable(ctx, next, territory, next) : enterable(ctx, next, territory))) continue
      const step = stepCost(ctx, tile, next)
      if (step === Infinity) continue
      const total = cost + step
      if (total < (g.get(next) ?? Infinity)) { g.set(next, total); parent.set(next, tile); const e = estimate(next); push([total + e, e, next]) }
    }
  }
  return { ok: false, reason: 'unreachable', expanded }
}

function less(a: [number, number, number], b: [number, number, number]): boolean {
  return a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2]
}
