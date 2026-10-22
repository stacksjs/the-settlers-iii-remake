import type { Condition } from './mission'
import type { Goods } from './rules'
import type { Session } from './session'
import { add } from './state'

export interface Statistics {
  /** Goods by where they are: lying loose, at doorsteps, waiting as inputs, on sites, stored, or carried. */
  stock: Record<'ground' | 'doorstep' | 'input' | 'construction' | 'storage' | 'transit', Goods>
  total: Goods
  produced: Goods, consumed: Goods
  occupations: Record<string, { total: number, working: number }>
  shortages: { building: number, type: string, shortage: string }[]
  /** Progress toward goods goals of the current mission, as reached and required amounts. */
  goals: { objective: string, good: string, have: number, need: number }[]
}

/**
 * Derives statistics from world state for one player. Nothing here is stored
 * separately, so the figures cannot drift from the goods and people they count,
 * and other players' goods are never included.
 */
export function statistics(session: Session, player: number): Statistics {
  const { state } = session
  const stock: Statistics['stock'] = { ground: {}, doorstep: {}, input: {}, construction: {}, storage: {}, transit: {} }, total: Goods = {}
  for (const s of state.stacks.values()) {
    if (s.owner !== player || !s.amount) continue
    add(stock[s.role === 'output' ? 'doorstep' : s.role], s.good, s.amount); add(total, s.good, s.amount)
  }
  const occupations: Statistics['occupations'] = {}
  for (const s of state.settlers.values()) {
    if (s.owner !== player) continue
    if (s.cargo) { add(stock.transit, s.cargo, 1); add(total, s.cargo, 1) }
    const o = occupations[s.profession] ??= { total: 0, working: 0 }
    o.total++
    if (s.program || s.workplace) o.working++
  }
  const shortages = [...state.buildings.values()].filter(b => b.owner === player && b.shortage && b.shortage !== 'suspended').map(b => ({ building: b.id, type: b.type, shortage: b.shortage! }))
  const goals: Statistics['goals'] = []
  const mission = state.mission
  if (mission) {
    const visit = (c: Condition, objective: string): void => {
      if (c.kind === 'goods-at-least' && c.player === player) goals.push({ objective, good: c.good, have: total[c.good] ?? 0, need: c.amount })
      if (c.kind === 'all' || c.kind === 'any') c.of.forEach(child => visit(child, objective))
    }
    for (const t of mission.definition.triggers) {
      const completes = t.then.find(a => a.kind === 'complete-objective')
      if (completes && completes.kind === 'complete-objective' && mission.objectives[completes.objective] === 'open') visit(t.when, completes.objective)
    }
  }
  const ledger = state.ledger[player]
  return { stock, total, produced: { ...ledger?.produced }, consumed: { ...ledger?.consumed }, occupations, shortages, goals }
}
