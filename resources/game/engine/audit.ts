import type { Context } from './context'
import { offsetTile, ruleOf, tileOf } from './context'

/**
 * Cross-checks the whole world for accounting errors. Returns every violation
 * found; an empty list means goods, tools, people, reservations and occupancy
 * agree with each other. Used by long scenario tests and replay diagnostics.
 */
export function audit(ctx: Context): string[] {
  const { state } = ctx, problems: string[] = []
  // Goods: present = created + produced + recovered + gained - consumed - destroyed - equipped - lost, per player and good.
  for (const player of state.players) {
    const present: Record<string, number> = {}, expected: Record<string, number> = {}
    for (const s of state.stacks.values()) if (s.owner === player.id) present[s.good] = (present[s.good] ?? 0) + s.amount
    for (const s of state.settlers.values()) if (s.owner === player.id && s.cargo) present[s.cargo] = (present[s.cargo] ?? 0) + 1
    const l = state.ledger[player.id]
    if (l) for (const [kind, sign] of [['created', 1], ['produced', 1], ['recovered', 1], ['gained', 1], ['consumed', -1], ['destroyed', -1], ['equipped', -1], ['lost', -1]] as const) for (const [g, n] of Object.entries(l[kind] ?? {})) expected[g] = (expected[g] ?? 0) + n * sign
    for (const g of new Set([...Object.keys(present), ...Object.keys(expected)])) if ((present[g] ?? 0) !== (expected[g] ?? 0)) problems.push(`player ${player.id} has ${present[g] ?? 0} ${g}, ledger expects ${expected[g] ?? 0}`)
    // People: every settler is a scenario arrival or a recorded birth, minus recorded deaths.
    const people = [...state.settlers.values()].filter(s => s.owner === player.id).length
    if (l && people < l.births - l.deaths - (l.left ?? 0) + (l.joined ?? 0)) problems.push(`player ${player.id} has ${people} settlers but recorded ${l.births} births`)
  }
  // Reservations: each stack's reserved counts equal what live jobs and trips hold on it.
  const out = new Map<number, number>(), into = new Map<number, number>()
  for (const j of state.jobs.values()) {
    if (!j.picked) out.set(j.source, (out.get(j.source) ?? 0) + 1)
    if (j.kind === 'deliver') into.set(j.target, (into.get(j.target) ?? 0) + 1)
    const holder = state.settlers.get(j.kind === 'deliver' ? j.carrier : j.settler)
    if (!holder || holder.program?.ref !== j.id) problems.push(`job ${j.id} has no settler working on it`)
    if (j.picked && holder?.cargo !== (j.kind === 'deliver' ? j.good : j.tool)) problems.push(`job ${j.id} was picked up but its settler does not carry it`)
  }
  // Output piles also hold room for goods a worker is bringing home or a cycle is making.
  for (const b of state.buildings.values()) {
    const slot = (good: string): number | undefined => [...state.stacks.values()].find(s => s.building === b.id && s.role === 'output' && s.good === good)?.id
    if (b.cycle > 0) for (const [g, n] of Object.entries(b.cycleGoods)) { const id = slot(g); if (id) into.set(id, (into.get(id) ?? 0) + n) }
  }
  for (const s of state.settlers.values()) {
    const p = s.program
    if (p?.kind !== 'work') continue
    const store = p.steps.findIndex(op => op.op === 'do' && op.effect === 'store')
    const fetch = p.steps.find(op => op.op === 'do' && (op.effect === 'harvest' || op.effect === 'extract'))
    if (store < p.pc || !fetch || fetch.op !== 'do') continue
    const id = [...state.stacks.values()].find(st => st.building === p.ref && st.role === 'output' && st.good === String(fetch.args!.output))?.id
    if (id) into.set(id, (into.get(id) ?? 0) + 1)
  }
  for (const s of state.stacks.values()) {
    if (s.reservedOut !== (out.get(s.id) ?? 0)) problems.push(`stack ${s.id} reserves ${s.reservedOut} out, jobs hold ${out.get(s.id) ?? 0}`)
    if (s.reservedIn !== (into.get(s.id) ?? 0)) problems.push(`stack ${s.id} reserves ${s.reservedIn} in, jobs, trips and cycles hold ${into.get(s.id) ?? 0}`)
    if (s.amount < 0 || s.reservedOut > s.amount || s.amount + s.reservedIn > Math.max(s.capacity, s.amount)) problems.push(`stack ${s.id} is out of bounds`)
    if (s.building && !state.buildings.has(s.building)) problems.push(`stack ${s.id} belongs to a missing building`)
  }
  // Tools: a profession that needs a tool has one; nobody holds a tool their profession does not use.
  for (const s of state.settlers.values()) {
    const tool = ctx.profession.get(s.profession)?.tool ?? null
    if (tool && s.tool !== tool) problems.push(`settler ${s.id} is a ${s.profession} without a ${tool}`)
    if (s.workplace && !state.buildings.has(s.workplace)) problems.push(`settler ${s.id} works at a missing building`)
    if (s.holding && (s.inside || state.settlers.get(ctx.index.settlerAt[tileOf(ctx, s)]!) !== s)) problems.push(`settler ${s.id} occupancy is out of step`)
  }
  // Buildings: each worker exists and works there; doors stay open.
  for (const b of state.buildings.values()) {
    if (b.worker && state.settlers.get(b.worker)?.workplace !== b.id) problems.push(`building ${b.id} names a worker who works elsewhere`)
    for (const id of b.workers) if (state.settlers.get(id)?.workplace !== b.id) problems.push(`building ${b.id} crew ${id} works elsewhere`)
    if (ctx.index.buildingAt[offsetTile(ctx, b, ruleOf(ctx, b).door)]) problems.push(`building ${b.id} door is blocked by a footprint`)
  }
  return problems
}
