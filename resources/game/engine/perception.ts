import type { Context } from './context'
import type { MapState, Player, WorldMemory } from './state'
import type { RoutingSurface } from './routing'

export function createWorldMemory(size: number): WorldMemory {
  return { terrain: new Uint8Array(size), elevation: new Uint8Array(size), object: new Uint8Array(size), amount: new Uint16Array(size), age: new Uint32Array(size), buildings: [], stacks: [], signs: [] }
}
/** Dense memory belongs to chunk hashes and layer encoding, never entity text. */
// eslint-disable-next-line pickier/no-unused-vars
export function playerEntities({ explored, visible, memory, ...player }: Player) {
  return { ...player, ...(memory ? { memory: { buildings: memory.buildings, stacks: memory.stacks, signs: memory.signs } } : {}) }
}
/** Capture at an actual sight transition or explicit mission exploration grant. */
export function recordObservation(ctx: Context, player: Player, tile: number): void {
  const memory = player.memory, { map } = ctx.state
  if (!memory) return
  memory.terrain[tile] = map.terrain[tile]!
  memory.elevation[tile] = map.elevation[tile]!
  memory.object[tile] = map.object[tile]!
  memory.amount[tile] = map.objectAmount[tile]!
  memory.age[tile] = map.object[tile] ? Math.max(0, ctx.state.tick - map.objectSince[tile]!) : 0
}
export const remembers = (player: Player, tile: number): boolean => !!player.memory && player.explored[tile] === 1 && player.visible[tile] === 0
export const perceivedTerrain = (map: MapState, player: Player, tile: number): number => remembers(player, tile) ? player.memory!.terrain[tile]! : map.terrain[tile]!
export const perceivedHeight = (map: MapState, player: Player, tile: number): number => remembers(player, tile) ? player.memory!.elevation[tile]! : map.elevation[tile]!
export const perceivedObject = (map: MapState, player: Player, tile: number): number => remembers(player, tile) ? player.memory!.object[tile]! : map.object[tile]!
export const perceivedAmount = (map: MapState, player: Player, tile: number): number => remembers(player, tile) ? player.memory!.amount[tile]! : map.objectAmount[tile]!
export const perceivedAge = (map: MapState, player: Player, tile: number, tick: number): number => remembers(player, tile) ? player.memory!.age[tile]! : Math.max(0, tick - map.objectSince[tile]!)

/** The same router can answer a player query without consulting unseen changes. */
export function perceivedRouting(ctx: Context, player: Player): RoutingSurface | undefined {
  if (!player.memory) return undefined
  const { map } = ctx.state, buildings = new Set<number>()
  for (const b of [...ctx.state.buildings.values(), ...player.memory.buildings]) {
    const rule = ctx.building.get(b.type)!
    if (!('elevation' in b) && b.owner !== player.id && !rule.footprint.some(([dx, dy]) => player.visible[(b.y + dy) * map.width + b.x + dx])) continue
    for (const [dx, dy] of rule.footprint) buildings.add((b.y + dy) * map.width + b.x + dx)
  }
  return {
    height: tile => perceivedHeight(map, player, tile), terrain: tile => ctx.terrain[perceivedTerrain(map, player, tile)]!,
    object: tile => ctx.objects[perceivedObject(map, player, tile) - 1] ?? null, building: tile => buildings.has(tile),
  }
}

/**
 * FogOfWar.recordHidden and HiddenMapObject freeze persistent map objects when
 * sight leaves. A renderer, first observation or load must never create history.
 * Buildings retain the existing any-footprint sight policy of this engine.
 */
export function rememberWorld(ctx: Context, player: Player, visible: Uint8Array): void {
  const memory = player.memory
  if (!memory) return
  const { map } = ctx.state
  for (let t = 0; t < visible.length; t++) {
    if (player.visible[t] === 1 && visible[t] === 0) {
      recordObservation(ctx, player, t)
    }
    else if (visible[t] && !player.visible[t]) {
      memory.terrain[t] = memory.elevation[t] = memory.object[t] = memory.amount[t] = memory.age[t] = 0
    }
  }
  const seenBuilding = (b: { type: string, x: number, y: number }, sight: Uint8Array): boolean => ctx.building.get(b.type)!.footprint.some(([dx, dy]) => sight[(b.y + dy) * map.width + b.x + dx] === 1)
  memory.buildings = memory.buildings.filter(b => !seenBuilding(b, visible))
  for (const b of ctx.state.buildings.values()) {
    if (!seenBuilding(b, player.visible) || seenBuilding(b, visible)) continue
    memory.buildings.push({ id: b.id, owner: b.owner, type: b.type, x: b.x, y: b.y, phase: b.phase, workRemaining: b.workRemaining, elevation: map.elevation[b.y * map.width + b.x]! })
  }
  memory.stacks = memory.stacks.filter(s => !visible[s.tile])
  for (const s of ctx.state.stacks.values()) {
    if (s.amount < 1 || !player.visible[s.tile] || visible[s.tile]) continue
    memory.stacks.push({ id: s.id, owner: s.owner, tile: s.tile, good: s.good, amount: s.amount, elevation: map.elevation[s.tile]! })
  }
  memory.signs = memory.signs.filter(sign => !visible[sign.tile])
  for (const sign of player.signs) {
    if (sign.until <= ctx.state.tick || !player.visible[sign.tile] || visible[sign.tile]) continue
    memory.signs.push({ tile: sign.tile, good: sign.good, amount: sign.amount, elevation: map.elevation[sign.tile]! })
  }
}
