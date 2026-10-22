import type { Command, MapState, Session, SessionSetup } from '../../resources/game/engine'
import type { MapFeature } from '../../resources/game/engine/map'
import type { Goods } from '../../resources/game/engine/rules'
import { createSession, describeMap, ROMAN_ENGINEERING } from '../../resources/game/engine'

export const rules = ROMAN_ENGINEERING

/** A 64x64 grass map with forest, granite, water and a coal mountain inside the start territory around (20,20). */
export function landscape(extra: MapFeature[] = []): MapState {
  return describeMap(rules, {
    width: 64, height: 64, base: 'grass', seed: 5,
    features: [
      { kind: 'object', id: 'tree', x: 26, y: 27, radius: 2, density: 0.8 },
      { kind: 'object', id: 'stone', x: 17, y: 25, radius: 1 },
      { kind: 'terrain', id: 'water', x: 27, y: 21, radius: 2 },
      { kind: 'resource', id: 'fish', x: 27, y: 21, radius: 2, amount: 3 },
      { kind: 'terrain', id: 'mountain', x: 13, y: 13, radius: 2 },
      { kind: 'resource', id: 'coal', x: 13, y: 13, radius: 2, amount: 2 },
      ...extra,
    ],
  })
}

export function session(options: Partial<SessionSetup> & { goods?: Goods, settlers?: Record<string, number> } = {}): Session {
  return createSession({
    rules, seed: options.seed ?? 1, map: options.map ?? landscape(),
    players: options.players ?? [{ name: 'Rome', civilization: 'roman', start: { x: 20, y: 20 }, goods: options.goods, settlers: options.settlers }],
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

/** The conservation oracle from the fidelity contract: present = created + produced + recovered - consumed - destroyed - equipped. */
export function expected(s: Session, owner: number): Goods {
  const l = s.state.ledger[owner]!, goods: Goods = {}
  const add = (g: Goods, sign: number): void => { for (const [k, n] of Object.entries(g)) { goods[k] = (goods[k] ?? 0) + n * sign; if (!goods[k]) delete goods[k] } }
  add(l.created, 1); add(l.produced, 1); add(l.recovered, 1); add(l.consumed, -1); add(l.destroyed, -1); add(l.equipped, -1)
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
  for (let r = 0; r < 12; r++) {
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
