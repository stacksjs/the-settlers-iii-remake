import type { Point } from './geometry'
import type { BuildingRule, Goods, ObjectRule, ProfessionRule, RulesProfile, TerrainRule } from './rules'
import type { Building, GameEvent, Ledger, Settler, Stack, State } from './state'
import { indexOf, pointOf } from './geometry'
import { add, emptyLedger } from './state'

/** Derived lookups rebuilt from State; never saved. */
export interface Index { buildingAt: Int32Array, settlerAt: Int32Array }
export interface Context {
  rules: RulesProfile, state: State, index: Index
  building: Map<string, BuildingRule>, profession: Map<string, ProfessionRule>
  terrain: TerrainRule[], objects: ObjectRule[], objectIndex: Map<string, number>, goodIndex: Map<string, number>
}

export function createContext(rules: RulesProfile, state: State): Context {
  const ctx: Context = {
    rules, state, index: { buildingAt: new Int32Array(state.map.width * state.map.height), settlerAt: new Int32Array(state.map.width * state.map.height) },
    building: new Map(rules.buildings.map(b => [b.id, b])), profession: new Map(rules.professions.map(p => [p.id, p])),
    terrain: rules.terrain, objects: rules.objects, objectIndex: new Map(rules.objects.map((o, i) => [o.id, i + 1])), goodIndex: new Map(rules.goods.map((g, i) => [g, i + 1])),
  }
  for (const b of state.buildings.values()) markFootprint(ctx, b, b.id)
  for (const s of state.settlers.values()) if (s.holding) ctx.index.settlerAt[tileOf(ctx, s)] = s.id
  return ctx
}

export const tileOf = (ctx: Context, p: Point): number => indexOf(ctx.state.map, p.x, p.y)
export const pointAt = (ctx: Context, tile: number): Point => pointOf(ctx.state.map, tile)
export const ruleOf = (ctx: Context, b: Building): BuildingRule => ctx.building.get(b.type)!
export const terrainAt = (ctx: Context, tile: number): TerrainRule => ctx.terrain[ctx.state.map.terrain[tile]!]!
export const objectAt = (ctx: Context, tile: number): ObjectRule | null => { const i = ctx.state.map.object[tile]!; return i ? ctx.objects[i - 1]! : null }
export const footprint = (rule: BuildingRule, at: Point): Point[] => rule.footprint.map(([dx, dy]) => ({ x: at.x + dx, y: at.y + dy }))
export const doorOf = (ctx: Context, b: Building): number => { const rule = ruleOf(ctx, b); return indexOf(ctx.state.map, b.x + rule.door[0], b.y + rule.door[1]) }

export function markFootprint(ctx: Context, b: Building, value: number): void {
  for (const p of footprint(ruleOf(ctx, b), b)) ctx.index.buildingAt[tileOf(ctx, p)] = value
}
export function occupy(ctx: Context, s: Settler, tile: number): void { if (ctx.index.settlerAt[tile] === 0) { ctx.index.settlerAt[tile] = s.id; s.holding = true } }
export function vacate(ctx: Context, s: Settler, tile: number): void { if (ctx.index.settlerAt[tile] === s.id) { ctx.index.settlerAt[tile] = 0; s.holding = false } }

/** Static traversability: terrain, blocking objects and building footprints. Doors stay open. */
export function passable(ctx: Context, tile: number): boolean {
  const object = objectAt(ctx, tile)
  return terrainAt(ctx, tile).walkable && !(object?.blocks) && ctx.index.buildingAt[tile] === 0
}

export function nextId(ctx: Context): number { return ctx.state.nextId++ }
export function ledger(ctx: Context, player: number): Ledger { return ctx.state.ledger[player] ??= emptyLedger() }
export function record(ctx: Context, player: number, kind: 'created' | 'produced' | 'recovered' | 'consumed' | 'destroyed' | 'equipped', good: string, amount: number): void { add(ledger(ctx, player)[kind], good, amount) }

export function emit(ctx: Context, event: Omit<GameEvent, 'tick'>): void {
  ctx.state.events.push({ tick: ctx.state.tick, ...event })
  if (ctx.state.events.length > 256) ctx.state.events.splice(0, ctx.state.events.length - 256)
}

export function createStack(ctx: Context, stack: Omit<Stack, 'id' | 'reservedIn' | 'reservedOut'>): Stack {
  const created: Stack = { id: nextId(ctx), reservedIn: 0, reservedOut: 0, ...stack }
  ctx.state.stacks.set(created.id, created)
  return created
}
export const available = (s: Stack): number => s.amount - s.reservedOut
export const room = (s: Stack): number => s.capacity - s.amount - s.reservedIn

/** Removes empty, unreserved stacks that do not represent a fixed building slot. */
export function prune(ctx: Context, s: Stack): void {
  if (s.amount === 0 && s.reservedIn === 0 && s.reservedOut === 0 && (s.role === 'ground' || s.role === 'storage' || s.role === 'construction')) ctx.state.stacks.delete(s.id)
}

export function stacksOf(ctx: Context, building: number): Stack[] { return [...ctx.state.stacks.values()].filter(s => s.building === building) }
export function totals(goods: Goods[]): Goods { const result: Goods = {}; for (const g of goods) for (const [k, n] of Object.entries(g)) add(result, k, n); return result }
