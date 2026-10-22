import type { Command, MapState, Session, SessionSetup } from '../../resources/game/engine'
import type { MapFeature } from '../../resources/game/engine/map'
import type { Goods } from '../../resources/game/engine/rules'
import { createSession, describeMap, ROMAN_ENGINEERING } from '../../resources/game/engine'

export const rules = ROMAN_ENGINEERING

/** Named places in the fixture landscape, all inside the start territory around the castle at (40,40). */
export const anchors = {
  castle: { x: 40, y: 40 }, forest: { x: 53, y: 51 }, granite: { x: 30, y: 31 }, water: { x: 55, y: 42 }, mountain: { x: 28, y: 28 },
  west: { x: 30, y: 42 }, north: { x: 40, y: 29 }, south: { x: 42, y: 53 }, east: { x: 52, y: 38 },
}

/** A 96x96 grass map with forest, granite, water and a coal mountain inside the start territory. */
export function landscape(extra: MapFeature[] = []): MapState {
  return describeMap(rules, {
    width: 96, height: 96, base: 'grass', seed: 5,
    features: [
      { kind: 'object', id: 'tree', ...anchors.forest, radius: 2, density: 0.8 },
      { kind: 'object', id: 'stone', ...anchors.granite, radius: 1 },
      { kind: 'terrain', id: 'water', ...anchors.water, radius: 2 },
      { kind: 'resource', id: 'fish', ...anchors.water, radius: 2, amount: 3 },
      { kind: 'terrain', id: 'mountain', ...anchors.mountain, radius: 3 },
      { kind: 'resource', id: 'coal', ...anchors.mountain, radius: 3, amount: 2 },
      ...extra,
    ],
  })
}

export function session(options: Partial<SessionSetup> & { goods?: Goods, settlers?: Record<string, number> } = {}): Session {
  return createSession({
    rules, seed: options.seed ?? 1, map: options.map ?? landscape(),
    players: options.players ?? [{ name: 'Rome', civilization: 'roman', start: anchors.castle, goods: options.goods, settlers: options.settlers }],
  })
}

const sequences = new WeakMap<Session, number>()
export function order(s: Session, type: string, fields: Record<string, unknown>, player = 1): void {
  const seq = sequences.get(s) ?? 0
  sequences.set(s, seq + 1)
  const command = { tick: s.state.tick, player, seq, type, ...fields } as Command
  const rejected = s.enqueue(command)
  if (rejected) throw new Error(`Rejected ${type}: ${rejected.reason}`)
  s.advance(1)
  const result = s.state.results.find(r => r.seq === command.seq && r.player === player)
  if (!result?.ok) throw new Error(`${type} failed: ${result?.reason}`)
}

/** Goods physically present for a player: every stack plus every carried good. */
export function present(s: Session, owner: number): Goods {
  const goods: Goods = {}
  for (const st of s.state.stacks.values()) if (st.owner === owner && st.amount) goods[st.good] = (goods[st.good] ?? 0) + st.amount
  for (const p of s.state.settlers.values()) if (p.owner === owner && p.cargo) goods[p.cargo] = (goods[p.cargo] ?? 0) + 1
  return goods
}

/** The conservation oracle from the fidelity contract: present = created + produced + recovered + gained - consumed - destroyed - equipped - lost. */
export function expected(s: Session, owner: number): Goods {
  const l = s.state.ledger[owner], goods: Goods = {}
  if (!l) return goods
  const add = (g: Goods, sign: number): void => { for (const [k, n] of Object.entries(g)) { goods[k] = (goods[k] ?? 0) + n * sign; if (!goods[k]) delete goods[k] } }
  add(l.created, 1); add(l.produced, 1); add(l.recovered, 1); add(l.gained ?? {}, 1); add(l.consumed, -1); add(l.destroyed, -1); add(l.equipped, -1); add(l.lost ?? {}, -1)
  return goods
}

export function conserved(s: Session, owner = 1): boolean {
  const a = present(s, owner), b = expected(s, owner)
  return Object.keys({ ...a, ...b }).every(k => (a[k] ?? 0) === (b[k] ?? 0))
}

/** Advances tick by tick, asserting conservation and stack bounds the whole way. */
export function run(s: Session, ticks: number, check = true): void {
  for (let i = 0; i < ticks; i++) {
    s.advance(1)
    if (!check) continue
    for (const player of s.state.players) if (!conserved(s, player.id)) throw new Error(`Goods not conserved at tick ${s.state.tick}: ${JSON.stringify(present(s, player.id))} vs ${JSON.stringify(expected(s, player.id))}`)
    for (const st of s.state.stacks.values()) if (st.amount < 0 || st.reservedOut > st.amount || st.reservedIn < 0) throw new Error(`Stack ${st.id} out of bounds at tick ${s.state.tick}`)
  }
}

export function until(s: Session, condition: () => boolean, limit: number, check = true): number {
  for (let i = 0; i < limit; i++) { if (condition()) return i; run(s, 1, check) }
  throw new Error(`Condition not reached within ${limit} ticks (tick ${s.state.tick})`)
}

export const building = (s: Session, type: string) => [...s.state.buildings.values()].find(b => b.type === type)

/** Nearest valid placement to a preferred point, searched in rings so tests do not depend on crowd positions. */
export function site(s: Session, type: string, near: { x: number, y: number }, player = 1): { x: number, y: number } {
  for (let r = 0; r < 16; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const x = near.x + dx, y = near.y + dy
        if (!s.placement(player, type, x, y)) return { x, y }
      }
    }
  }
  throw new Error(`No valid ${type} site near ${near.x},${near.y}`)
}

export function place(s: Session, type: string, near: { x: number, y: number }, player = 1): number {
  order(s, 'build', { building: type, ...site(s, type, near, player) }, player)
  return Math.max(...[...s.state.buildings.values()].filter(b => b.type === type && b.owner === player).map(b => b.id))
}
