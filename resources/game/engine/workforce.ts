import type { Context } from './context'
import type { Building, Job, Op, Settler, Stack } from './state'
import { available, changed, doorOf, emit, footprint, nextId, occupy, offsetTile, passable, pointAt, record, ruleOf, tileOf } from './context'
import { distance, neighbours } from './geometry'
import { cancelJob, dropCargo } from './logistics'
import { changeProfession, effects, finishers, halt, spawn, start } from './settlers'

const SITE_CREW = { digger: 2, builder: 2 }

export const population = (ctx: Context, owner: number): Settler[] => [...ctx.state.settlers.values()].filter(s => s.owner === owner)
const free = (s: Settler): boolean => !s.program && !s.workplace && !s.inside && !s.cargo

/** Releases a settler from its workplace or site without losing anything it holds. */
export function release(ctx: Context, s: Settler, reason: string): void {
  const program = s.program
  if (program) {
    const job = program.kind === 'equip' || program.kind === 'enlist' || program.kind === 'deliver' ? ctx.state.jobs.get(program.ref) : undefined
    s.program = null
    if (job) cancelJob(ctx, job, reason)
  }
  const b = ctx.state.buildings.get(s.workplace)
  if (b) { if (b.worker === s.id) b.worker = 0; b.workers = b.workers.filter(id => id !== s.id) }
  s.workplace = 0
  if (s.inside) {
    // Leave by the door; if another settler stands there, step to the nearest free tile.
    const door = b ? doorOf(ctx, b) : tileOf(ctx, s)
    s.inside = 0
    const p = pointAt(ctx, ctx.index.settlerAt[door] === 0 ? door : (nearestFree(ctx, door) ?? door))
    s.x = p.x; s.y = p.y
    occupy(ctx, s, tileOf(ctx, s))
  }
  if (s.cargo) dropCargo(ctx, s)
  // Detach first so a cancelled work program cannot send this released
  // worker back to its old building. Its owner still releases resource
  // claims, doorstep reservations and any interrupted recruitment order.
  if (program) finishers.get(program.kind)?.(ctx, s, program, false, reason)
  halt(s); s.diagnostic = reason
}

function nearestFree(ctx: Context, tile: number): number | null {
  for (const n of neighbours(ctx.state.map, tile)) if (passable(ctx, n) && ctx.index.settlerAt[n] === 0) return n
  return null
}

function toolOffers(ctx: Context, owner: number, tool: string): Stack[] {
  return [...ctx.state.stacks.values()].filter(s => s.owner === owner && s.good === tool && available(s) > 0 && (s.role === 'output' || s.role === 'storage' || s.role === 'ground'))
}

function carriersToSpare(ctx: Context, owner: number): number {
  const people = population(ctx, owner), carriers = people.filter(s => s.profession === 'carrier').length
  const player = ctx.state.players.find(p => p.id === owner)!
  return carriers - Math.ceil(people.length * player.settings.carrierRatio / 100)
}

/**
 * Staffs a workplace or construction site with a settler of the profession.
 * Prefers an unemployed settler who already has the profession, then equips a
 * carrier with the required tool. Returns a shortage description when neither
 * is possible, so no phantom worker is ever assigned.
 */
export function recruit(ctx: Context, b: Building, profession: string, steps: (s: Settler) => Op[], kind: string): string | null {
  const owner = b.owner, at = pointAt(ctx, doorOf(ctx, b))
  const byDistance = (a: Settler, c: Settler): number => distance(a, at) - distance(c, at) || a.id - c.id
  const skilled = population(ctx, owner).filter(s => s.profession === profession && free(s)).sort(byDistance)[0]
  if (skilled) { assign(b, skilled, profession); start(ctx, skilled, kind, b.id, steps(skilled)); return null }
  if (carriersToSpare(ctx, owner) < 1) return 'carriers'
  const tool = ctx.profession.get(profession)!.tool
  const carriers = population(ctx, owner).filter(s => s.profession === 'carrier' && free(s))
  if (!carriers.length) return 'settlers'
  if (tool === null) {
    const carrier = carriers.sort(byDistance)[0]!
    changeProfession(ctx, carrier, profession)
    assign(b, carrier, profession)
    start(ctx, carrier, kind, b.id, steps(carrier))
    return null
  }
  const offers = toolOffers(ctx, owner, tool).sort((a, c) => distance(pointAt(ctx, a.tile), at) - distance(pointAt(ctx, c.tile), at) || a.id - c.id)
  const source = offers.find(o => !ctx.state.cooldowns.has(`equip:${o.id}:${b.id}`))
  if (!source) return `tool:${tool}`
  const from = pointAt(ctx, source.tile)
  const carrier = carriers.sort((a, c) => distance(a, from) - distance(c, from) || a.id - c.id)[0]!
  const job: Job = { id: nextId(ctx), kind: 'equip', owner, tool, source: source.id, settler: carrier.id, profession, building: b.id, picked: false }
  ctx.state.jobs.set(job.id, job)
  source.reservedOut++
  assign(b, carrier, profession)
  start(ctx, carrier, 'equip', job.id, [{ op: 'go', tile: source.tile }, { op: 'do', effect: 'pickup', args: { job: job.id } }, { op: 'do', effect: 'equip', args: { job: job.id, kind } }])
  return null
}

function assign(b: Building, s: Settler, profession: string): void {
  s.workplace = b.id
  if (profession === 'digger' || profession === 'builder') b.workers.push(s.id)
  else b.worker = s.id
}

effects.set('equip', (ctx, s, args) => {
  const job = ctx.state.jobs.get(Number(args.job))
  if (!job || job.kind !== 'equip' || !job.picked || s.cargo !== job.tool) return false
  // The tool leaves goods accounting and becomes the person's equipment.
  s.cargo = null; s.tool = job.tool
  record(ctx, s.owner, 'equipped', job.tool!, 1)
  changeProfession(ctx, s, job.profession)
  ctx.state.jobs.delete(job.id)
  const b = ctx.state.buildings.get(job.building)
  if (!b) { release(ctx, s, 'workplace gone'); return true }
  // Continue straight into the work program the recruiter asked for.
  const kind = String(args.kind)
  const steps = kind === 'commute' ? commute(ctx, b) : siteSteps(ctx, b, s)
  s.program = { kind, ref: b.id, steps, pc: 0 }
  return true
})

finishers.set('equip', (ctx, s, program, ok, reason) => {
  const job = ctx.state.jobs.get(program.ref)
  if (job) { cancelJob(ctx, job, reason ?? 'interrupted'); if (s.cargo) dropCargo(ctx, s) }
  if (!ok) release(ctx, s, reason ?? 'equip failed')
})

export const commute = (ctx: Context, b: Building): Op[] => [{ op: 'go', tile: doorOf(ctx, b) }, { op: 'enter', building: b.id }]

finishers.set('commute', (ctx, s, _program, ok, reason) => {
  if (!ok) { ctx.state.cooldowns.set(`staff:${s.workplace}`, ctx.state.tick + 200); release(ctx, s, reason ?? 'could not reach workplace') }
})

/** Work spots around a site: free passable tiles bordering the footprint, in stable order. */
export function workSpots(ctx: Context, b: Building): number[] {
  const rule = ruleOf(ctx, b)
  const defined = rule.builders.map(at => offsetTile(ctx, b, at)).filter(t => passable(ctx, t) && ctx.state.map.owner[t] === b.owner)
  if (defined.length) return defined
  const tiles = new Set(footprint(rule, b).map(p => tileOf(ctx, p))), spots = new Set<number>()
  for (const t of tiles) for (const n of neighbours(ctx.state.map, t)) if (!tiles.has(n) && passable(ctx, n) && ctx.state.map.owner[n] === b.owner) spots.add(n)
  return [...spots].sort((a, c) => a - c)
}

function siteSteps(ctx: Context, b: Building, s: Settler): Op[] {
  const spots = workSpots(ctx, b), taken = new Set(b.workers.filter(id => id !== s.id).map(id => ctx.state.settlers.get(id)?.program?.steps[0]).flatMap(op => op?.op === 'go' ? [op.tile] : []))
  const spot = spots.find(t => !taken.has(t)) ?? doorOf(ctx, b)
  const rule = ruleOf(ctx, b)
  return s.profession === 'digger'
    ? [{ op: 'go', tile: spot }, { op: 'work', ticks: rule.levelWork }, { op: 'do', effect: 'level', args: { building: b.id } }]
    : [{ op: 'go', tile: spot }, { op: 'work', ticks: rule.buildWork }, { op: 'do', effect: 'build', args: { building: b.id } }]
}

function siteLoop(ctx: Context, s: Settler, b: Building | undefined): void {
  if (!b || b.phase === 'active' || !b.workers.includes(s.id)) { release(ctx, s, 'site finished'); return }
  if (b.suspended) { start(ctx, s, 'site', b.id, [{ op: 'work', ticks: 20 }]); return }
  if (s.profession === 'digger' && b.phase !== 'leveling') { release(ctx, s, 'levelled'); return }
  if (s.profession === 'builder' && b.phase !== 'building') { start(ctx, s, 'site', b.id, [{ op: 'work', ticks: 20 }]); return }
  if (s.profession === 'builder' && !materials(ctx, b)) { start(ctx, s, 'site', b.id, [{ op: 'work', ticks: 20 }]); return }
  start(ctx, s, 'site', b.id, siteSteps(ctx, b, s))
}

finishers.set('site', (ctx, s, program, ok, reason) => {
  if (!ok) { release(ctx, s, reason ?? 'site work failed'); return }
  siteLoop(ctx, s, ctx.state.buildings.get(program.ref))
})

const materials = (ctx: Context, b: Building): Stack | undefined => [...ctx.state.stacks.values()].filter(s => s.building === b.id && s.role === 'construction' && s.amount > 0).sort((a, c) => a.good.localeCompare(c.good))[0]

effects.set('level', (ctx, _s, args) => {
  const b = ctx.state.buildings.get(Number(args.building))
  if (!b || b.phase !== 'leveling') return true
  const map = ctx.state.map
  let worst = -1, gap = 0
  for (const p of footprint(ruleOf(ctx, b), b)) { const t = tileOf(ctx, p), d = Math.abs(map.elevation[t]! - b.target); if (d > gap) { gap = d; worst = t } }
  if (worst >= 0) { map.elevation[worst] = map.elevation[worst]! + (map.elevation[worst]! > b.target ? -1 : 1); changed(ctx, worst); ctx.state.navigation++ }
  b.levelRemaining = Math.max(0, b.levelRemaining - 1)
  if (b.levelRemaining === 0) { b.phase = 'building'; emit(ctx, { player: b.owner, type: 'site-levelled', text: `${ruleOf(ctx, b).name} site levelled`, entity: b.id }) }
  return true
})

effects.set('build', (ctx, s, args) => {
  const b = ctx.state.buildings.get(Number(args.building))
  if (!b || b.phase !== 'building') return true
  const stack = materials(ctx, b)
  if (!stack) return true
  stack.amount--
  b.used[stack.good] = (b.used[stack.good] ?? 0) + 1
  record(ctx, s.owner, 'consumed', stack.good, 1)
  b.workRemaining--
  if (b.workRemaining <= 0) complete(ctx, b)
  return true
})

/** Systems that react to a completed building, such as territory claims. */
export const completions: ((ctx: Context, b: Building) => void)[] = []

export function complete(ctx: Context, b: Building): void {
  b.phase = 'active'
  for (const id of [...b.workers]) { const s = ctx.state.settlers.get(id); if (s) release(ctx, s, 'construction complete') }
  b.workers = []
  for (const s of [...ctx.state.stacks.values()]) if (s.building === b.id && s.role === 'construction' && s.amount === 0 && s.reservedIn === 0) ctx.state.stacks.delete(s.id)
  emit(ctx, { player: b.owner, type: 'building-complete', text: `${ruleOf(ctx, b).name} completed`, entity: b.id, tile: doorOf(ctx, b) })
  for (const hook of completions) hook(ctx, b)
}

/** Staffing pass: residences grow population, sites get crews, workplaces get workers. */
export function staff(ctx: Context): void {
  const { state } = ctx
  for (const b of [...state.buildings.values()].sort((a, c) => a.order - c.order || a.id - c.id)) {
    const rule = ruleOf(ctx, b)
    if (b.phase === 'active' && rule.residents && b.residents < rule.residents.count && state.tick >= b.nextResident) {
      if (spawn(ctx, b.owner, 'carrier', doorOf(ctx, b), 'birth')) { b.residents++; b.nextResident = state.tick + rule.residents.interval }
    }
    if (b.suspended || state.cooldowns.has(`staff:${b.id}`)) continue
    if (b.phase !== 'active') {
      const profession = b.phase === 'leveling' ? 'digger' : 'builder'
      if (profession === 'builder' && !materials(ctx, b)) continue
      const crew = b.workers.filter(id => state.settlers.get(id)?.profession === profession).length
      const total = population(ctx, b.owner).filter(s => s.profession === profession).length
      const player = state.players.find(p => p.id === b.owner)!
      const limit = profession === 'digger' ? player.settings.diggerLimit : player.settings.builderLimit
      if (crew < SITE_CREW[profession] && (total < limit || population(ctx, b.owner).some(s => s.profession === profession && free(s)))) {
        const shortage = recruit(ctx, b, profession, s => siteSteps(ctx, b, s), 'site')
        b.shortage = shortage
        if (shortage) state.cooldowns.set(`staff:${b.id}`, state.tick + 40)
      }
      continue
    }
    if (rule.worker && !b.worker) {
      const shortage = recruit(ctx, b, rule.worker, () => commute(ctx, b), 'commute')
      if (shortage !== b.shortage && shortage) emit(ctx, { player: b.owner, type: 'shortage', text: `${rule.name} has no ${rule.worker}: missing ${shortage.replace('tool:', '')}`, entity: b.id })
      b.shortage = shortage
      if (shortage) state.cooldowns.set(`staff:${b.id}`, state.tick + 40)
    }
  }
}

