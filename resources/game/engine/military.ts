import type { Context } from './context'
import type { SoldierRule } from './rules'
import type { Building, Job, Projectile, Settler } from './state'
import { changed, doorOf, emit, ledger, markFootprint, nextId, occupy, passable, pointAt, record, ruleOf, tileOf, vacate } from './context'
import type { Direction, Point } from './geometry'
import { area, DIRECTIONS, distance, neighbours } from './geometry'
import { cancelJob, cancelJobsFor, dropCargo, moveStackGoodsToGround, slot } from './logistics'
import { changeProfession, effects, finishers, freeTileNear, start } from './settlers'
import { release } from './workforce'

// Soldiers are settlers who took a weapon at a barracks. Swordsmen strike
// adjacent enemies, pikemen reach two steps, bowmen loose arrows that land a few
// ticks later. Military buildings hold garrisons; one whose last defender has
// fallen while an attacker stands at its door changes hands with its land.
// Engineering model built on reference-remake values (S3-051 to S3-054).

/** Order values besides a target tile: no order, or holding a position the player chose. */
export const NO_ORDER = -1, HOLDING = -2

export const soldierRule = (ctx: Context, s: Settler): SoldierRule | undefined => ctx.profession.get(s.profession)?.soldier
const military = (ctx: Context) => ctx.rules.military!
const ranged = (ctx: Context, s: Settler): boolean => !!soldierRule(ctx, s)?.ranged

/** Professions recruited at a barracks, with the weapon each takes. */
export const recruits = (ctx: Context): { profession: string, weapon: string }[] => ctx.rules.professions.filter(p => p.soldier).map(p => ({ profession: p.id, weapon: p.soldier!.weapon }))

/** Makes a settler a soldier of a rank. The weapon is equipment from now on, outside goods accounting. */
export function arm(ctx: Context, s: Settler, profession: string, rank: number): void {
  const rule = ctx.profession.get(profession)!.soldier!
  changeProfession(ctx, s, profession)
  s.tool = rule.weapon
  s.soldier = { rank, health: rule.health[rank - 1]!, cooldown: 0, order: NO_ORDER, attack: 0, garrison: 0 }
}

/** Barracks turn carriers into soldiers with weapons delivered to them, by queue or automatically. */
function enlist(ctx: Context): void {
  const { state } = ctx
  for (const player of state.players) {
    const orders = player.settings.recruit
    if (!orders || player.controller === 'observer') continue
    const barracks = [...state.buildings.values()].filter(b => b.owner === player.id && b.type === 'barracks' && b.phase === 'active' && !b.suspended).sort((a, c) => a.id - c.id)
    for (const b of barracks) {
      for (const { profession, weapon } of recruits(ctx)) {
        const wanted = orders.automatic ? Infinity : orders.queue[profession] ?? 0
        const capacity = ruleOf(ctx, b).inputs[weapon]
        if (wanted < 1 || !capacity) continue
        const stack = slot(ctx, b, 'input', weapon, capacity)
        if (stack.amount - stack.reservedOut < 1) continue
        // Recruits come from idle carriers and keep the carrier ratio, like any other profession.
        const people = [...state.settlers.values()].filter(s => s.owner === player.id)
        const carriers = people.filter(s => s.profession === 'carrier' && !s.program && !s.inside && !s.cargo && !s.workplace)
        if (!carriers.length || people.filter(s => s.profession === 'carrier').length - 1 < Math.ceil(people.length * player.settings.carrierRatio / 100)) continue
        const door = pointAt(ctx, doorOf(ctx, b))
        const carrier = carriers.sort((a, c) => distance(a, door) - distance(c, door) || a.id - c.id)[0]!
        const job: Job = { id: nextId(ctx), kind: 'equip', owner: player.id, tool: weapon, source: stack.id, settler: carrier.id, profession, building: b.id, picked: false }
        state.jobs.set(job.id, job)
        stack.reservedOut++
        if (!orders.automatic) { orders.queue[profession] = wanted - 1; if (!orders.queue[profession]) delete orders.queue[profession] }
        start(ctx, carrier, 'enlist', job.id, [{ op: 'go', tile: stack.tile }, { op: 'do', effect: 'pickup', args: { job: job.id } }, { op: 'go', tile: doorOf(ctx, b) }, { op: 'work', ticks: military(ctx).recruitWork }, { op: 'do', effect: 'enlist', args: { job: job.id, profession } }])
      }
    }
  }
}

effects.set('enlist', (ctx, s, args) => {
  const job = ctx.state.jobs.get(Number(args.job))
  if (!job || job.kind !== 'equip' || !job.picked || s.cargo !== job.tool) return false
  const player = ctx.state.players.find(p => p.id === s.owner)!
  // The rank is fixed at recruitment and never raised afterwards.
  const rank = Math.max(1, Math.min(military(ctx).ranks, player.settings.rank ?? 1))
  s.cargo = null
  record(ctx, s.owner, 'equipped', job.tool!, 1)
  arm(ctx, s, job.profession, rank)
  ctx.state.jobs.delete(job.id)
  emit(ctx, { player: s.owner, type: 'recruit', text: `A ${job.profession} of rank ${rank} joined your army`, entity: s.id })
  return true
})

finishers.set('enlist', (ctx, s, program, ok, reason) => {
  const job = ctx.state.jobs.get(program.ref)
  if (job) cancelJob(ctx, job, reason ?? 'recruitment interrupted')
  if (s.cargo) dropCargo(ctx, s)
  if (ok) return
  // An interrupted recruitment returns to the queue, so a manual order is never silently lost.
  const step = program.steps.find(op => op.op === 'do' && op.effect === 'enlist')
  const profession = step?.op === 'do' ? String(step.args?.profession ?? '') : ''
  const orders = ctx.state.players.find(p => p.id === s.owner)?.settings.recruit
  if (orders && !orders.automatic && ctx.profession.get(profession)?.soldier) orders.queue[profession] = Math.min(1000, (orders.queue[profession] ?? 0) + 1)
})

const garrisonOf = (ctx: Context, b: Building): Settler[] => [...ctx.state.settlers.values()].filter(s => s.soldier?.garrison === b.id && s.inside === b.id).sort((a, c) => a.id - c.id)
/** Soldiers assigned to a building, inside or on their way. */
const assigned = (ctx: Context, b: Building): Settler[] => [...ctx.state.settlers.values()].filter(s => s.soldier?.garrison === b.id)

/** Soldiers without orders walk to their own military buildings with free places, infantry and bowmen separately. */
function station(ctx: Context): void {
  const { state } = ctx
  for (const b of [...state.buildings.values()].filter(b => b.phase === 'active' && ruleOf(ctx, b).garrison).sort((a, c) => a.id - c.id)) {
    const places = ruleOf(ctx, b).garrison!, there = assigned(ctx, b)
    const door = pointAt(ctx, doorOf(ctx, b))
    const free = [...state.settlers.values()].filter(s => s.owner === b.owner && s.soldier && !s.inside && !s.program && s.soldier.order === NO_ORDER && !s.soldier.attack && !s.soldier.garrison)
      .sort((a, c) => distance(a, door) - distance(c, door) || a.id - c.id)
    for (const bow of [false, true]) {
      let open = (bow ? places.bowmen : places.infantry) - there.filter(s => ranged(ctx, s) === bow).length
      for (const s of free.filter(s => ranged(ctx, s) === bow)) {
        if (open-- <= 0) break
        s.soldier!.garrison = b.id
        start(ctx, s, 'garrison', b.id, [{ op: 'go', tile: doorOf(ctx, b) }, { op: 'enter', building: b.id }])
      }
    }
  }
}

finishers.set('garrison', (_ctx, s, _program, ok) => { if (!ok && s.soldier && !s.inside) s.soldier.garrison = 0 })
finishers.set('march', (_ctx, s, _program, ok) => {
  const soldier = s.soldier
  if (!soldier) return
  if (!ok) { soldier.attack = 0; if (soldier.order >= 0) stand(soldier, NO_ORDER); return }
  if (soldier.order < 0) return
  // Arrived: walk on to the next waypoint, turn around on patrol, or hold the position.
  if (soldier.route?.length) { soldier.order = soldier.route.shift()!; if (!soldier.route.length) delete soldier.route }
  else if (soldier.patrol) soldier.order = soldier.order === soldier.patrol[1] ? soldier.patrol[0] : soldier.patrol[1]
  else stand(soldier, HOLDING)
})

/** Ends every movement order: no route, patrol or forced march remains. */
function stand(soldier: NonNullable<Settler['soldier']>, order: number): void {
  soldier.order = order
  delete soldier.route; delete soldier.patrol; delete soldier.forced
}
finishers.set('chase', () => {})

/** Takes a soldier out of its building onto the door or the nearest free tile. A garrison keeps its last soldier. */
export function leave(ctx: Context, s: Settler): boolean {
  if (!s.inside) { s.soldier!.garrison = 0; return true }
  const b = ctx.state.buildings.get(s.inside)
  if (b && garrisonOf(ctx, b).length <= 1) return false
  const door = b ? doorOf(ctx, b) : tileOf(ctx, s)
  const p = pointAt(ctx, freeTileNear(ctx, door) ?? door)
  s.inside = 0; s.x = p.x; s.y = p.y; s.action = 'idle'; s.program = null; s.soldier!.garrison = 0
  occupy(ctx, s, tileOf(ctx, s))
  return true
}

function enemiesNear(ctx: Context, s: Settler, from: { x: number, y: number }, radius: number): Settler[] {
  const player = ctx.state.players.find(p => p.id === s.owner)!
  const found: Settler[] = []
  for (const other of ctx.state.settlers.values()) {
    if (other.owner === s.owner || !other.soldier || other.inside || distance(from, other) > radius) continue
    // Soldiers fight only what their player can see.
    if (player.visible[tileOf(ctx, other)] === 1) found.push(other)
  }
  return found.sort((a, b) => distance(from, a) - distance(from, b) || a.id - b.id)
}

/**
 * log2(n) in 1/65536 units. Squaring and halving are exact or correctly rounded
 * in IEEE arithmetic, so every host computes the same value, unlike Math.log.
 */
export function log2Fixed(n: number): number {
  let x = n, whole = 0, fraction = 0
  while (x >= 2) { x /= 2; whole++ }
  for (let bit = 15; bit >= 0; bit--) { x *= x; if (x >= 2) { x /= 2; fraction |= 1 << bit } }
  return whole * 65536 + fraction
}

/** A player's fighting strength in thousandths from the wealth rule, or full strength when the rules have none. */
export function strength(ctx: Context, owner: number, tile: number): number {
  const wealth = ctx.rules.military?.wealth
  if (!wealth) return 1000
  let stock = 0
  // Only goods the player can hand out count, as the reference counts offered material.
  for (const st of ctx.state.stacks.values()) if (st.owner === owner && st.good === wealth.good && st.role !== 'input' && st.role !== 'construction') stock += st.amount - st.reservedOut
  const start = wealth.start[Math.min(wealth.start.length, ctx.state.players.length) - 1]!
  const value = Math.floor((log2Fixed(stock * 100 + start) - log2Fixed(100)) * 1000 / (wealth.doublings * 65536))
  return ctx.state.map.owner[tile] === owner ? Math.max(value, wealth.ownGround) : value
}

/** The lattice direction that brings a step closest to a target, for facing it. */
function facing(from: Point, to: Point): Direction {
  let best = 0
  for (let d = 1; d < 6; d++) if (distance({ x: from.x + DIRECTIONS[d]![0], y: from.y + DIRECTIONS[d]![1] }, to) < distance({ x: from.x + DIRECTIONS[best]![0], y: from.y + DIRECTIONS[best]![1] }, to)) best = d
  return best as Direction
}

/** A blow or a shot. Arrows fly two ticks per step plus a release time and are resolved when they land. */
function strike(ctx: Context, attacker: Settler, target: Settler, from: number): void {
  const rule = soldierRule(ctx, attacker)!
  attacker.dir = facing(pointAt(ctx, from), target)
  // Damage is the rank's strength scaled by the player's fighting strength where the soldier stands, at least one point.
  const damage = Math.max(1, Math.round(rule.strength[attacker.soldier!.rank - 1]! * strength(ctx, attacker.owner, tileOf(ctx, attacker)) / 1000))
  attacker.soldier!.cooldown = rule.attackTicks
  if (!rule.ranged) { hurt(ctx, target, damage); return }
  const projectile: Projectile = { id: nextId(ctx), owner: attacker.owner, from, to: tileOf(ctx, target), target: target.id, damage, fired: ctx.state.tick, arrives: ctx.state.tick + 4 + distance(pointAt(ctx, from), target) * 2 }
  ;(ctx.state.projectiles ??= []).push(projectile)
}

function hurt(ctx: Context, target: Settler, damage: number): void {
  if (!target.soldier || !ctx.state.settlers.has(target.id)) return
  target.soldier.health = Math.max(0, target.soldier.health - damage)
  if (target.soldier.health > 0) return
  // A fallen soldier leaves the world with the weapon, which was equipment rather than goods.
  if (target.holding) vacate(ctx, target, tileOf(ctx, target))
  ctx.state.settlers.delete(target.id)
  ledger(ctx, target.owner).deaths++
  emit(ctx, { player: target.owner, type: 'death', text: `A ${target.profession} fell`, tile: tileOf(ctx, target) })
}

/** Arrows land at their tick and hurt their target only if it still stands within a step of where they were aimed. */
function fly(ctx: Context): void {
  const list = ctx.state.projectiles
  if (!list?.some(p => p.arrives <= ctx.state.tick)) return
  ctx.state.projectiles = list.filter(p => p.arrives > ctx.state.tick)
  for (const p of list.filter(p => p.arrives <= ctx.state.tick)) {
    const target = ctx.state.settlers.get(p.target)
    if (target && !target.inside && distance(target, pointAt(ctx, p.to)) <= 1) hurt(ctx, target, p.damage)
  }
}

/** One decision for a soldier outside: fight what is in reach, close in on what is seen, then follow orders. */
function act(ctx: Context, s: Settler): void {
  const soldier = s.soldier!, rule = soldierRule(ctx, s)!
  if (soldier.cooldown > 0 && --soldier.cooldown > 0) return
  if (s.action === 'working' && !s.program) s.action = 'idle'
  if (s.program && !['march', 'chase', 'settle'].includes(s.program.kind)) return
  // Marching soldiers only answer enemies within reach; others look as far as they search.
  const marching = s.program?.kind === 'march' && soldier.order >= 0
  // A forced move ignores every enemy until it arrives (manual: "Ignoring the Opponent").
  const target = soldier.forced && soldier.order >= 0 ? undefined : enemiesNear(ctx, s, s, marching ? rule.range[1] : military(ctx).searchRadius)[0]
  if (s.action === 'walking') {
    // A step cannot be interrupted: stop on the tile being entered once the target is in reach from there,
    // or turn toward a newly seen enemy after this step.
    const reach = target ? distance(pointAt(ctx, s.next), target) : -1
    if (target && ((reach >= rule.range[0] && reach <= rule.range[1]) || s.program?.kind !== 'chase')) { s.path = []; s.program = { kind: 'chase', ref: target.id, steps: [{ op: 'go', tile: s.next }], pc: 0 } }
    return
  }
  if (target) {
    const d = distance(s, target)
    if (d >= rule.range[0] && d <= rule.range[1]) {
      s.program = null; s.path = []
      strike(ctx, s, target, tileOf(ctx, s))
      s.action = 'working'; s.step = 0
      occupy(ctx, s, tileOf(ctx, s))
      return
    }
    if (d < rule.range[0]) {
      // Too close to shoot: step away from the enemy.
      const away = neighbours(ctx.state.map, tileOf(ctx, s)).filter(t => passable(ctx, t)).sort((a, b) => distance(pointAt(ctx, b), target) - distance(pointAt(ctx, a), target) || a - b)[0]
      if (away !== undefined && distance(pointAt(ctx, away), target) > d) start(ctx, s, 'chase', target.id, [{ op: 'go', tile: away }])
      return
    }
    if (s.program?.kind !== 'chase' || s.program.ref !== target.id) start(ctx, s, 'chase', target.id, [{ op: 'go', tile: tileOf(ctx, target), adjacent: true }])
    return
  }
  if (s.program?.kind === 'chase') s.program = null
  if (soldier.attack) { assault(ctx, s); return }
  // A target covered by a building, site or tree is reached beside it.
  if (soldier.order >= 0 && !s.program) start(ctx, s, 'march', soldier.order, [{ op: 'go', tile: soldier.order, adjacent: !passable(ctx, soldier.order) }])
}

const attackable = (ctx: Context, b: Building | undefined, owner: number): b is Building => !!b && b.owner !== owner && b.phase === 'active' && !!ruleOf(ctx, b).garrison

/** At an enemy military building: its soldiers come out one at a time to fight; with none left inside, it is taken. */
function assault(ctx: Context, s: Settler): void {
  const b = ctx.state.buildings.get(s.soldier!.attack)
  if (!attackable(ctx, b, s.owner)) { s.soldier!.attack = 0; stand(s.soldier!, NO_ORDER); return }
  const door = doorOf(ctx, b)
  if (distance(s, pointAt(ctx, door)) > military(ctx).defendRadius) {
    if (!s.program) start(ctx, s, 'march', door, [{ op: 'go', tile: door, adjacent: true }])
    return
  }
  // Infantry defend the door first; bowmen leave the walls only when no infantry is left.
  const inside = garrisonOf(ctx, b)
  const defender = inside.find(d => !ranged(ctx, d)) ?? inside[0]
  if (defender) {
    defender.inside = 0
    const p = pointAt(ctx, freeTileNear(ctx, door) ?? door)
    defender.x = p.x; defender.y = p.y; defender.action = 'idle'; defender.program = null
    occupy(ctx, defender, tileOf(ctx, defender))
    return
  }
  capture(ctx, b, s)
}

/** The building, its goods and the land it holds pass to the attacker's player. */
export function capture(ctx: Context, b: Building, conqueror: Settler): void {
  const loser = b.owner, winner = conqueror.owner, rule = ruleOf(ctx, b)
  cancelJobsFor(ctx, b, 'building captured')
  for (const s of [...ctx.state.settlers.values()]) {
    if (s.owner !== loser) continue
    if (s.workplace === b.id || s.inside === b.id) release(ctx, s, 'building captured')
    // Soldiers on their way to this garrison stop.
    if (s.soldier?.garrison === b.id) { s.soldier.garrison = 0; if (s.program?.kind === 'garrison') s.program = null }
  }
  for (const stack of ctx.state.stacks.values()) {
    if (stack.building !== b.id) continue
    if (stack.amount) transfer(ctx, stack.owner, winner, stack.good, stack.amount)
    stack.owner = winner
  }
  b.owner = winner
  b.suspended = false
  conqueror.soldier!.attack = 0; stand(conqueror.soldier!, NO_ORDER); conqueror.soldier!.garrison = b.id
  start(ctx, conqueror, 'garrison', b.id, [{ op: 'go', tile: doorOf(ctx, b) }, { op: 'enter', building: b.id }])
  emit(ctx, { player: winner, type: 'capture', text: `You captured a ${rule.name}`, entity: b.id, tile: doorOf(ctx, b) })
  emit(ctx, { player: loser, type: 'captured', text: `Your ${rule.name} was captured`, entity: b.id, tile: doorOf(ctx, b) })
  redraw(ctx, b)
}

function transfer(ctx: Context, from: number, to: number, good: string, amount: number): void {
  const lost = ledger(ctx, from).lost ??= {}, gained = ledger(ctx, to).gained ??= {}
  lost[good] = (lost[good] ?? 0) + amount
  gained[good] = (gained[good] ?? 0) + amount
}

/**
 * Land within a captured building's reach goes to the nearest active military
 * building that covers it. Other buildings left standing on land their owner
 * lost are destroyed without refund: their goods drop where they stood and
 * their people are released.
 */
function redraw(ctx: Context, captured: Building): void {
  const { state } = ctx, map = state.map
  const holders = [...state.buildings.values()].filter(b => b.phase === 'active' && ruleOf(ctx, b).territory)
  for (const t of area(map, captured, ruleOf(ctx, captured).territory ?? 0)) {
    const p = pointAt(ctx, t)
    const nearest = holders.filter(b => distance(b, p) <= ruleOf(ctx, b).territory!).sort((a, c) => distance(a, p) - distance(c, p) || a.id - c.id)[0]
    map.owner[t] = nearest?.owner ?? 0
    changed(ctx, t)
  }
  state.navigation++
  for (const b of [...state.buildings.values()]) {
    const rule = ruleOf(ctx, b)
    if (rule.military && b.phase === 'active') continue
    if (rule.footprint.every(([dx, dy]) => map.owner[tileOf(ctx, { x: b.x + dx, y: b.y + dy })] === b.owner)) continue
    cancelJobsFor(ctx, b, 'land lost')
    for (const s of [...state.settlers.values()]) if (s.workplace === b.id || s.inside === b.id) release(ctx, s, 'land lost')
    moveStackGoodsToGround(ctx, b, null)
    for (const [t, id] of [...state.claims]) if (state.settlers.get(id)?.workplace === b.id) state.claims.delete(t)
    markFootprint(ctx, b, 0)
    state.buildings.delete(b.id)
    emit(ctx, { player: b.owner, type: 'destroyed', text: `${rule.name} was lost with its land`, tile: doorOf(ctx, b) })
  }
}

/** Bowmen on the walls shoot at visible enemies in reach of their building. */
function walls(ctx: Context): void {
  for (const b of [...ctx.state.buildings.values()].sort((a, c) => a.id - c.id)) {
    if (b.phase !== 'active' || !ruleOf(ctx, b).garrison) continue
    const door = doorOf(ctx, b)
    for (const archer of garrisonOf(ctx, b)) {
      if (!ranged(ctx, archer)) continue
      if (archer.soldier!.cooldown > 0 && --archer.soldier!.cooldown > 0) continue
      const target = enemiesNear(ctx, archer, pointAt(ctx, door), military(ctx).towerRange)[0]
      if (target) strike(ctx, archer, target, door)
    }
  }
}

/** Defenders with no enemy in sight go back inside. */
function regroup(ctx: Context): void {
  for (const s of [...ctx.state.settlers.values()].sort((a, c) => a.id - c.id)) {
    const soldier = s.soldier
    if (!soldier?.garrison || s.inside || s.program || soldier.cooldown > 0) continue
    const b = ctx.state.buildings.get(soldier.garrison)
    if (!b || b.owner !== s.owner) { soldier.garrison = 0; continue }
    if (!enemiesNear(ctx, s, s, military(ctx).searchRadius).length) start(ctx, s, 'garrison', b.id, [{ op: 'go', tile: doorOf(ctx, b) }, { op: 'enter', building: b.id }])
  }
}

/** The military pass for one tick: arrows land, barracks recruit, garrisons fill, then each soldier decides. */
export function wage(ctx: Context): void {
  if (!ctx.rules.military) return
  fly(ctx)
  if (ctx.state.tick % ctx.rules.logistics.assignmentInterval === 0) { enlist(ctx); station(ctx) }
  walls(ctx)
  for (const s of [...ctx.state.settlers.values()].sort((a, c) => a.id - c.id)) if (s.soldier && !s.inside && ctx.state.settlers.has(s.id)) act(ctx, s)
  regroup(ctx)
}

/** Most moves one order may hold: three waypoints plus the final destination (manual: "Setting Waypoints"). */
export const MAX_MOVES = 4

/**
 * Move and attack orders from the command queue. A move may be forced (ignoring
 * enemies), a patrol between the soldier's position and the target, or appended
 * as a waypoint to a move in progress. Any other move cancels the previous one.
 * Returns a rejection reason, or null when at least one soldier obeys.
 */
export function command(ctx: Context, player: number, value: Record<string, unknown>): string | null {
  if (!ctx.rules.military) return 'These rules have no soldiers.'
  const { state } = ctx
  const ids = value.soldiers
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || new Set(ids).size !== ids.length) return 'Choose up to 500 soldiers.'
  const soldiers = ids.map(id => state.settlers.get(id as number))
  if (!soldiers.every(s => s?.owner === player && s.soldier)) return 'Those are not all your soldiers.'
  let building = 0, tile = NO_ORDER
  if (value.type === 'attack') {
    const b = state.buildings.get(value.building as number)
    const seen = state.players.find(p => p.id === player)!.visible
    if (!attackable(ctx, b, player) || !ruleOf(ctx, b).footprint.some(([dx, dy]) => seen[tileOf(ctx, { x: b.x + dx, y: b.y + dy })] === 1)) return 'Choose a visible enemy military building.'
    building = b.id
  }
  else {
    const { x, y } = value
    if (!Number.isInteger(x) || !Number.isInteger(y) || (x as number) < 0 || (y as number) < 0 || (x as number) >= state.map.width || (y as number) >= state.map.height) return 'Choose a tile on the map.'
    tile = tileOf(ctx, { x: x as number, y: y as number })
  }
  const mode = value.mode ?? 'move', append = value.append ?? false
  if (!['move', 'forced', 'patrol'].includes(mode as string) || typeof append !== 'boolean' || (building && (mode !== 'move' || append))) return 'Unknown kind of move.'
  let sent = 0, full = 0
  for (const s of soldiers as Settler[]) {
    const soldier = s.soldier!
    if (append && soldier.order >= 0 && !soldier.attack && !soldier.patrol) {
      // A waypoint joins the move in progress, up to four moves in all.
      const route = soldier.route ?? []
      if (route.length + 1 >= MAX_MOVES) { full++; continue }
      soldier.route = [...route, tile]
      if (mode === 'forced') soldier.forced = true
      sent++
      continue
    }
    if (!leave(ctx, s)) continue
    s.program = null; s.path = []
    stand(soldier, tile)
    soldier.attack = building
    if (mode === 'forced') soldier.forced = true
    if (mode === 'patrol' && tileOf(ctx, s) !== tile) soldier.patrol = [tileOf(ctx, s), tile]
    sent++
  }
  if (sent) return null
  return full ? 'A move has at most three waypoints before its destination.' : 'Each garrison keeps its last soldier.'
}

export const garrisonCount = (ctx: Context, b: Building): number => garrisonOf(ctx, b).length
