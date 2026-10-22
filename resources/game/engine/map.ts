import type { Point } from './geometry'
import type { RulesProfile } from './rules'
import type { MapState } from './state'
import { distance, indexOf, inside, toView, TILE_WIDTH } from './geometry'
import { randomInt, seedRandom } from './random'

export const MAX_MAP_SIZE = 1024

export function emptyMap(width: number, height: number): MapState {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8 || width > MAX_MAP_SIZE || height > MAX_MAP_SIZE) throw new RangeError(`Map size must be between 8 and ${MAX_MAP_SIZE} tiles`)
  const n = width * height
  return { width, height, terrain: new Uint8Array(n), elevation: new Uint8Array(n), resource: new Uint8Array(n), resourceAmount: new Uint16Array(n), object: new Uint8Array(n), objectAmount: new Uint16Array(n), objectSince: new Uint32Array(n), owner: new Uint8Array(n) }
}

export interface MapFeature { kind: 'terrain' | 'object' | 'resource' | 'elevation', id?: string, x: number, y: number, radius: number, amount?: number, density?: number }
export interface MapDescription { width: number, height: number, base: string, features: MapFeature[], seed?: number }

/** Builds a map from declarative features, used by tests, the editor and generated skirmish maps. */
export function describeMap(rules: RulesProfile, description: MapDescription): MapState {
  const map = emptyMap(description.width, description.height), random = seedRandom(description.seed ?? 1)
  const lookup = (ids: string[], id: string, label: string): number => {
    const found = ids.indexOf(id)
    if (found < 0) throw new RangeError(`Unknown ${label} ${id}`)
    return found
  }
  const terrainId = (id: string): number => lookup(rules.terrain.map(t => t.id), id, 'terrain')
  const objectId = (id: string): number => lookup(rules.objects.map(o => o.id), id, 'object') + 1
  const goodId = (id: string): number => lookup(rules.goods, id, 'resource') + 1
  map.terrain.fill(terrainId(description.base))
  for (const f of description.features) {
    for (let y = Math.max(0, f.y - f.radius); y <= Math.min(map.height - 1, f.y + f.radius); y++) {
      for (let x = Math.max(0, f.x - f.radius); x <= Math.min(map.width - 1, f.x + f.radius); x++) {
        const d = distance(f, { x, y })
        if (d > f.radius) continue
        const tile = indexOf(map, x, y)
        if (f.density !== undefined && randomInt(random, 1000) >= f.density * 1000) continue
        if (f.kind === 'terrain') map.terrain[tile] = terrainId(f.id!)
        if (f.kind === 'elevation') map.elevation[tile] = Math.max(map.elevation[tile]!, Math.min(255, Math.round((f.amount ?? 0) * (1 - d / (f.radius + 1)))))
        if (f.kind === 'object') { const id = objectId(f.id!); map.object[tile] = id; map.objectAmount[tile] = f.amount ?? rules.objects[id - 1]!.amount }
        if (f.kind === 'resource') { map.resource[tile] = goodId(f.id!); map.resourceAmount[tile] = Math.min(65535, f.amount ?? 1) }
      }
    }
  }
  return map
}

/** Deterministic generated landscape for skirmish and development play. Not an original map. */
export function generateMap(rules: RulesProfile, width: number, height: number, seed: number): MapState {
  const random = seedRandom(seed), features: MapFeature[] = []
  const at = (margin: number): Point => ({ x: margin + randomInt(random, width - margin * 2), y: margin + randomInt(random, height - margin * 2) })
  for (let i = 0; i < Math.max(2, Math.floor(width * height / 2500)); i++) { const p = at(6); features.push({ kind: 'terrain', id: 'water', ...p, radius: 2 + randomInt(random, 4) }, { kind: 'resource', id: 'fish', ...p, radius: 3, amount: 20 }) }
  for (let i = 0; i < Math.max(2, Math.floor(width * height / 3000)); i++) {
    const p = at(8), ore = ['coal', 'ironore', 'goldore'][i % 3]!
    features.push({ kind: 'terrain', id: 'mountain', ...p, radius: 4 }, { kind: 'elevation', ...p, radius: 4, amount: 12 }, { kind: 'resource', id: ore, ...p, radius: 3, amount: 40 })
  }
  for (let i = 0; i < Math.max(3, Math.floor(width * height / 900)); i++) features.push({ kind: 'object', id: 'tree', ...at(3), radius: 3, density: 0.45 })
  for (let i = 0; i < Math.max(2, Math.floor(width * height / 2500)); i++) features.push({ kind: 'object', id: 'stone', ...at(4), radius: 1, density: 0.8 })
  const map = describeMap(rules, { width, height, base: 'grass', features, seed })
  const water = rules.terrain.findIndex(t => t.id === 'water'), stone = rules.objects.findIndex(o => o.id === 'stone') + 1, tree = rules.objects.findIndex(o => o.id === 'tree') + 1
  for (let tile = 0; tile < map.terrain.length; tile++) {
    if (map.terrain[tile] === water || (rules.terrain[map.terrain[tile]!]!.id === 'mountain' && map.object[tile] === tree)) { map.object[tile] = 0; map.objectAmount[tile] = 0 }
    if (map.terrain[tile] !== water && map.resource[tile] === rules.goods.indexOf('fish') + 1) { map.resource[tile] = 0; map.resourceAmount[tile] = 0 }
    if (map.object[tile] === stone && map.terrain[tile] === water) map.object[tile] = 0
  }
  return map
}

/** Picks the tile whose elevated projection is nearest to a view point. */
export function pick(map: MapState, viewX: number, viewY: number): Point | null {
  let best: Point | null = null, bestError = Infinity
  const row = Math.round(viewY / 9)
  for (let y = row - 2; y <= row + Math.ceil(255 * 2 / 9) + 2; y++) {
    for (let x = Math.floor((viewX + y * 8) / TILE_WIDTH) - 1; x <= Math.ceil((viewX + y * 8) / TILE_WIDTH) + 1; x++) {
      if (!inside(map, x, y)) continue
      const view = toView(x, y, map.elevation[indexOf(map, x, y)]!)
      const error = ((view.x - viewX) / TILE_WIDTH) ** 2 + ((view.y - viewY) / 9) ** 2
      if (error < bestError - 1e-9) { bestError = error; best = { x, y } }
    }
  }
  return bestError <= 1 ? best : null
}
