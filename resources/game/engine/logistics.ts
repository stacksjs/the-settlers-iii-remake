import type { Context } from './context'
import type { Building, Job, Settler, Stack } from './state'
import { available, createStack, doorOf, emit, nextId, pointAt, prune, record, room, ruleOf, tileOf } from './context'
import { distance, neighbours } from './geometry'
import { effects, finishers, start } from './settlers'

interface Request { building: Building, good: string, need: number, rank: number, tile: number, storage: boolean }

const COOLDOWN = 200

/** Goods are always in a stack or a carrier's hands; this finds or creates the slot for a building good. */
export function slot(ctx: Context, b: Building, role: Stack['role'], good: string, capacity: number): Stack {
  for (const s of ctx.state.stacks.values()) if (s.building === b.id && s.role === role && s.good === good) { s.capacity = Math.max(capacity, s.amount + s.reservedIn); return s }
  return createStack(ctx, { owner: b.owner, tile: doorOf(ctx, b), building: b.id, role, good, amount: 0, capacity })
}

export function groundStackAt(ctx: Context, tile: number): Stack | null {
  for (const s of ctx.state.stacks.values()) if (s.role === 'ground' && s.tile === tile) return s
  return null
}

/** Puts goods on the ground near a tile without creating or destroying any. Returns the amount that could not be placed. */
export function dropToGround(ctx: Context, owner: number, tile: number, good: string, amount: number): number {
  const capacity = ctx.rules.logistics.groundPileCapacity, seen = new Set([tile]), queue = [tile]
  for (let i = 0; i < queue.length && amount > 0 && i < 2000; i++) {
    const at = queue[i]!, existing = groundStackAt(ctx, at)
    if (existing && existing.good === good && existing.capacity - existing.amount - existing.reservedIn > 0) {
      const n = Math.min(amount, existing.capacity - existing.amount - existing.reservedIn); existing.amount += n; amount -= n
    }
    else if (!existing && ctx.index.buildingAt[at] === 0 && ctx.terrain[ctx.state.map.terrain[at]!]!.walkable && !(ctx.objects[ctx.state.map.object[at]! - 1]?.blocks) && !isDoor(ctx, at)) {
      const n = Math.min(amount, capacity); createStack(ctx, { owner, tile: at, building: 0, role: 'ground', good, amount: n, capacity }); amount -= n
    }
    for (const next of neighbours(ctx.state.map, at)) if (!seen.has(next)) { seen.add(next); queue.push(next) }
  }
  return amount
}

function isDoor(ctx: Context, tile: number): boolean {
  for (const b of ctx.state.buildings.values()) if (doorOf(ctx, b) === tile) return true
  return false
}

export function dropCargo(ctx: Context, s: Settler): void {
  if (!s.cargo) return
  const good = s.cargo
  s.cargo = null
  if (dropToGround(ctx, s.owner, s.inside ? doorOf(ctx, ctx.state.buildings.get(s.inside)!) : tileOf(ctx, s), good, 1) > 0) {
    // No ground anywhere nearby: the good stays in hand rather than disappearing.
    s.cargo = good
  }
}

export function cancelJob(ctx: Context, job: Job, reason: string): void {
  if (!ctx.state.jobs.delete(job.id)) return
  const source = ctx.state.stacks.get(job.source)
  if (source && !job.picked) { source.reservedOut--; prune(ctx, source) }
  if (job.kind === 'deliver') {
    const target = ctx.state.stacks.get(job.target)
    ctx.state.cooldowns.set(`deliver:${job.source}:${target?.building || job.target}`, ctx.state.tick + COOLDOWN)
    if (target) { target.reservedIn--; prune(ctx, target) }
    const carrier = ctx.state.settlers.get(job.carrier)
    if (carrier) { if (carrier.program?.kind === 'deliver' && carrier.program.ref === job.id) carrier.program = null; carrier.action = carrier.inside ? 'inside' : 'idle'; dropCargo(ctx, carrier); carrier.diagnostic = reason }
  }
}

effects.set('pickup', (ctx, s, args) => {
  const job = ctx.state.jobs.get(Number(args.job))
  if (!job || job.picked) return false
  const source = ctx.state.stacks.get(job.source)
  const good = job.kind === 'deliver' ? job.good : job.tool
  if (!source || source.amount < 1 || source.reservedOut < 1 || source.good !== good || s.cargo) return false
  source.amount--; source.reservedOut--; job.picked = true
  s.cargo = good
  prune(ctx, source)
  return true
})

effects.set('drop', (ctx, s, args) => {
  const job = ctx.state.jobs.get(Number(args.job))
  if (!job || job.kind !== 'deliver' || !job.picked || s.cargo !== job.good) return false
  const target = ctx.state.stacks.get(job.target)
  if (!target || target.reservedIn < 1) return false
  target.amount++; target.reservedIn--; s.cargo = null
  ctx.state.jobs.delete(job.id)
  return true
})

finishers.set('deliver', (ctx, s, program, ok, reason) => {
  const job = ctx.state.jobs.get(program.ref)
  if (!ok && job) cancelJob(ctx, job, reason ?? 'interrupted')
  else if (!ok) dropCargo(ctx, s)
})

function requests(ctx: Context, owner: number): Request[] {
  const list: Request[] = [], player = ctx.state.players.find(p => p.id === owner)!
  const rank = (good: string): number => { const i = player.settings.transportPriority.indexOf(good); return i < 0 ? 1000 : i }
  const buildings = [...ctx.state.buildings.values()].filter(b => b.owner === owner).sort((a, b) => a.order - b.order || a.id - b.id)
  for (const b of buildings) {
    const rule = ruleOf(ctx, b), door = doorOf(ctx, b)
    if (b.phase !== 'active' && !b.suspended) {
      for (const [good, amount] of Object.entries(rule.cost)) {
        const capacity = amount - (b.used[good] ?? 0)
        if (capacity <= 0) continue
        const stack = slot(ctx, b, 'construction', good, capacity)
        if (room(stack) > 0) list.push({ building: b, good, need: room(stack), rank: rank(good), tile: door, storage: false })
      }
    }
  }
  for (const b of buildings) {
    if (b.phase !== 'active') continue
    const rule = ruleOf(ctx, b), door = doorOf(ctx, b)
    for (const [good, capacity] of Object.entries(rule.inputs)) {
      const stack = slot(ctx, b, 'input', good, capacity)
      if (room(stack) > 0) list.push({ building: b, good, need: room(stack), rank: 2000 + rank(good), tile: door, storage: false })
    }
  }
  for (const b of buildings) {
    const rule = ruleOf(ctx, b)
    if (b.phase !== 'active' || !rule.storage) continue
    const piles = [...ctx.state.stacks.values()].filter(s => s.building === b.id && s.role === 'storage')
    for (const good of player.settings.stored) {
      const pile = piles.find(s => s.good === good && room(s) > 0)
      if (pile) list.push({ building: b, good, need: room(pile), rank: 4000 + rank(good), tile: doorOf(ctx, b), storage: true })
      else if (piles.length < rule.storage.piles) list.push({ building: b, good, need: rule.storage.capacity, rank: 4000 + rank(good), tile: doorOf(ctx, b), storage: true })
    }
  }
  // Construction first (manual M-01), then consumers by transport priority, then storage.
  return list.sort((a, b) => a.rank - b.rank || a.building.order - b.building.order || a.building.id - b.building.id)
}

function target(ctx: Context, request: Request): Stack {
  const rule = ruleOf(ctx, request.building)
  if (request.storage) {
    for (const s of ctx.state.stacks.values()) if (s.building === request.building.id && s.role === 'storage' && s.good === request.good && room(s) > 0) return s
    return createStack(ctx, { owner: request.building.owner, tile: request.tile, building: request.building.id, role: 'storage', good: request.good, amount: 0, capacity: rule.storage!.capacity })
  }
  if (request.building.phase !== 'active') return slot(ctx, request.building, 'construction', request.good, rule.cost[request.good]! - (request.building.used[request.good] ?? 0))
  return slot(ctx, request.building, 'input', request.good, rule.inputs[request.good]!)
}

/** One bounded matching pass: requests in priority order take the nearest offer and the nearest idle carrier. */
export function assignDeliveries(ctx: Context): void {
  const { state } = ctx
  for (const [key, until] of state.cooldowns) if (until <= state.tick) state.cooldowns.delete(key)
  let budget = ctx.rules.logistics.assignmentsPerPass
  for (const player of state.players) {
    if (player.controller === 'observer') continue
    const carriers = [...state.settlers.values()].filter(s => s.owner === player.id && s.profession === 'carrier' && !s.program && !s.inside && !s.cargo)
    if (!carriers.length) continue
    const offers = [...state.stacks.values()].filter(s => s.owner === player.id && (s.role === 'output' || s.role === 'ground' || s.role === 'storage') && available(s) > 0)
    for (const request of requests(ctx, player.id)) {
      let need = request.need
      while (need > 0 && budget > 0 && carriers.length) {
        let best: Stack | null = null, bestDistance = Infinity
        for (const offer of offers) {
          if (offer.good !== request.good || available(offer) <= 0 || offer.building === request.building.id) continue
          if (request.storage && offer.role === 'storage') continue
          // Cooldowns key on the target building, so a failed pairing does not repeat with a fresh stack id.
          if (state.cooldowns.has(`deliver:${offer.id}:${request.building.id}`)) continue
          const d = distance(pointAt(ctx, offer.tile), pointAt(ctx, request.tile))
          if (d < bestDistance || (d === bestDistance && offer.id < best!.id)) { best = offer; bestDistance = d }
        }
        if (!best) break
        const from = pointAt(ctx, best.tile)
        let carrierIndex = 0
        for (let i = 1; i < carriers.length; i++) {
          const a = distance(carriers[i]!, from), b = distance(carriers[carrierIndex]!, from)
          if (a < b || (a === b && carriers[i]!.id < carriers[carrierIndex]!.id)) carrierIndex = i
        }
        const carrier = carriers.splice(carrierIndex, 1)[0]!, destination = target(ctx, request)
        const job: Job = { id: nextId(ctx), kind: 'deliver', owner: player.id, good: request.good, source: best.id, target: destination.id, carrier: carrier.id, picked: false }
        state.jobs.set(job.id, job)
        best.reservedOut++; destination.reservedIn++
        start(ctx, carrier, 'deliver', job.id, [{ op: 'go', tile: best.tile }, { op: 'do', effect: 'pickup', args: { job: job.id } }, { op: 'go', tile: destination.tile }, { op: 'do', effect: 'drop', args: { job: job.id } }])
        need--; budget--
      }
      if (budget <= 0 || !carriers.length) break
    }
  }
}

export function cancelJobsFor(ctx: Context, building: Building, reason: string): void {
  const ids = new Set([...ctx.state.stacks.values()].filter(s => s.building === building.id).map(s => s.id))
  for (const job of [...ctx.state.jobs.values()]) if (ids.has(job.source) || (job.kind === 'deliver' && ids.has(job.target)) || (job.kind === 'equip' && job.building === building.id)) cancelJob(ctx, job, reason)
}

export function moveStackGoodsToGround(ctx: Context, building: Building, role: Stack['role'] | null): void {
  for (const s of [...ctx.state.stacks.values()]) {
    if (s.building !== building.id || (role && s.role !== role)) continue
    const left = dropToGround(ctx, s.owner, s.tile, s.good, s.amount)
    if (left > 0) { record(ctx, s.owner, 'destroyed', s.good, left); emit(ctx, { player: s.owner, type: 'goods-lost', text: `${left} ${s.good} were lost: no free ground nearby`, tile: s.tile }) }
    ctx.state.stacks.delete(s.id)
  }
}

export const isIdleCarrier = (s: Settler): boolean => s.profession === 'carrier' && !s.program && !s.inside && !s.cargo
