import type { Context } from './context'
import type { Goods, Workflow } from './rules'
import type { Building, Settler, Stack } from './state'
import { changed, doorOf, emit, objectAt, passable, pointAt, record, room, ruleOf, terrainAt } from './context'
import { area, DIRECTIONS, distance, neighbours } from './geometry'
import { dropCargo, groundStackAt, slot } from './logistics'
import { randomInt } from './random'
import { route } from './routing'
import { effects, finishers, start } from './settlers'
import { commute, release } from './workforce'

const output = (ctx: Context, b: Building, good: string): Stack => slot(ctx, b, 'output', good, ruleOf(ctx, b).outputs[good]!)
const input = (ctx: Context, b: Building, good: string): Stack => slot(ctx, b, 'input', good, ruleOf(ctx, b).inputs[good]!)
const has = (ctx: Context, b: Building, goods: Goods): boolean => Object.entries(goods).every(([g, n]) => input(ctx, b, g).amount >= n)
const fits = (ctx: Context, b: Building, goods: Goods): boolean => Object.entries(goods).every(([g, n]) => room(output(ctx, b, g)) >= n)

function consume(ctx: Context, b: Building, goods: Goods): void {
  for (const [g, n] of Object.entries(goods)) { input(ctx, b, g).amount -= n; record(ctx, b.owner, 'consumed', g, n) }
}
function produce(ctx: Context, b: Building, goods: Goods): void {
  for (const [g, n] of Object.entries(goods)) { output(ctx, b, g).amount += n; record(ctx, b.owner, 'produced', g, n) }
}

/**
 * Chooses the next crafted good: urgent orders first, then a weighted rotation, skipping full doorsteps.
 * Nothing is consumed until commit() runs, so waiting for inputs never loses an order or a turn.
 */
function craftChoice(ctx: Context, b: Building, choices: string[]): { good: string, commit: () => void } | null {
  const player = ctx.state.players.find(p => p.id === b.owner)!
  const urgent = player.settings.urgentTools.findIndex(t => choices.includes(t) && room(output(ctx, b, t)) > 0)
  if (urgent >= 0) return { good: player.settings.urgentTools[urgent]!, commit: () => { player.settings.urgentTools.splice(urgent, 1) } }
  const rotation = choices.flatMap(c => Array.from({ length: Math.max(0, Math.min(10, player.settings.toolWeights[c] ?? 1)) }, () => c))
  for (let i = 0; i < rotation.length; i++) {
    const choice = rotation[(player.craftCursor + i) % rotation.length]!
    if (room(output(ctx, b, choice)) > 0) return { good: choice, commit: () => { player.craftCursor = (player.craftCursor + i + 1) % rotation.length } }
  }
  return null
}

function within(ctx: Context, b: Building, radius: number): number[] {
  return area(ctx.state.map, b.workArea, radius).sort((a, c) => distance(pointAt(ctx, a), b.workArea) - distance(pointAt(ctx, c), b.workArea) || a - c)
}

function reachable(ctx: Context, s: Settler, from: number, tile: number, adjacent: boolean): boolean {
  return route(ctx, from, tile, { adjacent, territory: s.owner, limit: 4000 }).ok
}

function plantable(ctx: Context, tile: number, owner: number): boolean {
  // Buildings keep their protected ring, door and pile tiles free of new growth.
  return passable(ctx, tile) && terrainAt(ctx, tile).buildable && !ctx.state.map.object[tile] && ctx.state.map.owner[tile] === owner && !ctx.state.claims.has(tile) && ctx.index.settlerAt[tile] === 0 && ctx.index.protectedAt[tile] === 0 && !groundStackAt(ctx, tile)
}

/**
 * Where a crop may be sown: its tile and neighbours on the required ground, and
 * for sloped crops a neighbour at least the required height away, with no
 * planting on that neighbour or the one opposite (reference isWinePlantable).
 */
function sowable(ctx: Context, tile: number, w: Extract<Workflow, { kind: 'cultivate' }>): boolean {
  const map = ctx.state.map, x = tile % map.width, y = Math.floor(tile / map.width)
  if (w.ground && ![tile, ...neighbours(map, tile)].every(t => w.ground!.includes(terrainAt(ctx, t).id))) return false
  if (!w.slope) return true
  const at = (d: number): number | null => { const nx = x + DIRECTIONS[d]![0], ny = y + DIRECTIONS[d]![1]; return nx >= 0 && ny >= 0 && nx < map.width && ny < map.height ? ny * map.width + nx : null }
  const crop = (t: number | null): boolean => t !== null && [w.plant, w.ripe].includes(objectAt(ctx, t)?.id ?? '')
  for (let d = 0; d < 6; d++) {
    const n = at(d)
    if (n !== null && Math.abs(map.elevation[n]! - map.elevation[tile]!) >= w.slope) return !crop(n) && !crop(at((d + 3) % 6))
  }
  return false
}

/** Starts one trip outside the building, claiming the target so two workers never share it. */
function trip(ctx: Context, b: Building, s: Settler, tile: number, adjacent: boolean, work: number, effect: string, args: Record<string, number | string>): void {
  ctx.state.claims.set(tile, s.id)
  start(ctx, s, 'work', b.id, [{ op: 'leave' }, { op: 'go', tile, adjacent }, { op: 'work', ticks: work }, { op: 'do', effect, args: { tile, building: b.id, ...args } }, { op: 'go', tile: doorOf(ctx, b) }, { op: 'do', effect: 'store', args: { building: b.id } }, { op: 'enter', building: b.id }])
}

function outdoor(ctx: Context, b: Building, s: Settler, w: Workflow): string | null {
  const door = doorOf(ctx, b)
  if (w.kind === 'harvest' || (w.kind === 'cultivate')) {
    const object = w.kind === 'harvest' ? w.object : w.ripe
    if (room(output(ctx, b, w.output)) < 1) return 'output-full'
    const target = within(ctx, b, w.radius).find(t => objectAt(ctx, t)?.id === object && !ctx.state.claims.has(t) && reachable(ctx, s, door, t, true))
    if (target !== undefined) { output(ctx, b, w.output).reservedIn++; trip(ctx, b, s, target, true, w.work, 'harvest', { output: w.output }); return null }
    if (w.kind === 'harvest') return 'no-resources'
  }
  if (w.kind === 'plant' || w.kind === 'cultivate') {
    const object = w.kind === 'plant' ? w.object : w.plant
    const candidates = within(ctx, b, w.radius).filter(t => plantable(ctx, t, b.owner) && (w.kind !== 'cultivate' || sowable(ctx, t, w))).slice(0, 8)
    // Choose among the nearest free tiles so plantings spread out rather than filling one line.
    while (candidates.length) {
      const pick = candidates.splice(randomInt(ctx.state.random, candidates.length), 1)[0]!
      if (reachable(ctx, s, door, pick, false)) { ctx.state.claims.set(pick, s.id); start(ctx, s, 'work', b.id, [{ op: 'leave' }, { op: 'go', tile: pick }, { op: 'work', ticks: w.work }, { op: 'do', effect: 'plant', args: { tile: pick, object } }, { op: 'go', tile: door }, { op: 'enter', building: b.id }]); return null }
    }
    return 'no-space'
  }
  if (w.kind === 'extract' && !w.food) {
    if (room(output(ctx, b, w.output)) < 1) return 'output-full'
    const map = ctx.state.map, resource = ctx.goodIndex.get(w.resource) ?? 0
    const target = within(ctx, b, w.radius).find(t => terrainAt(ctx, t).water && (w.resource === 'water' || (map.resource[t] === resource && map.resourceAmount[t]! > 0)) && !ctx.state.claims.has(t) && reachable(ctx, s, door, t, true))
    if (target === undefined) return 'no-resources'
    output(ctx, b, w.output).reservedIn++
    trip(ctx, b, s, target, true, w.work, 'extract', { resource: w.resource, output: w.output })
    return null
  }
  return null
}

/** Inside work: processing, crafting and mining advance a cycle while the worker stays in the building. */
function indoor(ctx: Context, b: Building, w: Workflow): string | null {
  if (w.kind === 'process' || w.kind === 'craft') {
    if (b.cycle === 0) {
      const choice = w.kind === 'craft' ? craftChoice(ctx, b, w.choices) : null
      const goods = w.kind === 'process' ? w.outputs : choice ? { [choice.good]: 1 } : null
      if (!goods) return 'output-full'
      if (!fits(ctx, b, goods)) return 'output-full'
      if (!has(ctx, b, w.inputs)) return 'inputs'
      choice?.commit()
      consume(ctx, b, w.inputs)
      b.cycleGoods = goods
      for (const [g, n] of Object.entries(goods)) output(ctx, b, g).reservedIn += n
    }
    if (++b.cycle < w.work) return null
    for (const [g, n] of Object.entries(b.cycleGoods)) output(ctx, b, g).reservedIn -= n
    produce(ctx, b, b.cycleGoods)
    b.cycle = 0; b.cycleGoods = {}
    return null
  }
  if (w.kind === 'extract' && w.food) {
    if (b.cycle === 0) {
      if (room(output(ctx, b, w.output)) < 1) return 'output-full'
      const map = ctx.state.map, resource = ctx.goodIndex.get(w.resource)!
      const deposit = area(map, b, w.radius).filter(t => map.resource[t] === resource && map.resourceAmount[t]! > 0).sort((a, c) => map.resourceAmount[c]! - map.resourceAmount[a]! || a - c)[0]
      if (deposit === undefined) { if (b.shortage !== 'exhausted') emit(ctx, { player: b.owner, type: 'exhausted', text: `${ruleOf(ctx, b).name} has exhausted its deposit`, entity: b.id }); return 'exhausted' }
      if (b.meals === 0) {
        const food = [w.food.preferred, ...w.food.accepted].find(g => input(ctx, b, g).amount > 0)
        if (!food) return 'food'
        consume(ctx, b, { [food]: 1 })
        b.meals = food === w.food.preferred ? w.food.preferredCycles : w.food.otherCycles
      }
      b.meals--
      map.resourceAmount[deposit] = map.resourceAmount[deposit]! - 1
      if (map.resourceAmount[deposit] === 0) map.resource[deposit] = 0
      changed(ctx, deposit)
      // The ore is now in the worker's hands inside the mine until the cycle ends.
      b.cycleGoods = { [w.output]: 1 }
      output(ctx, b, w.output).reservedIn++
    }
    if (++b.cycle < w.work) return null
    output(ctx, b, w.output).reservedIn--
    produce(ctx, b, b.cycleGoods)
    b.cycle = 0; b.cycleGoods = {}
    return null
  }
  return null
}

/** Production pass for staffed, active, unsuspended buildings. */
export function work(ctx: Context): void {
  for (const b of ctx.state.buildings.values()) {
    if (b.phase !== 'active' || !b.worker) continue
    const s = ctx.state.settlers.get(b.worker)
    const w = ruleOf(ctx, b).workflow
    if (!s || s.inside !== b.id || s.program || w.kind === 'none') continue
    if (b.suspended) { if (b.shortage !== 'suspended') b.shortage = 'suspended'; continue }
    const indoorKinds = w.kind === 'process' || w.kind === 'craft' || (w.kind === 'extract' && !!w.food)
    if (b.shortage && ctx.state.cooldowns.has(`work:${b.id}`) && !indoorKinds) continue
    const shortage = indoorKinds ? indoor(ctx, b, w) : outdoor(ctx, b, s, w)
    b.shortage = shortage
    if (shortage && !indoorKinds) ctx.state.cooldowns.set(`work:${b.id}`, ctx.state.tick + 40)
  }
}

export function scheduleGrowth(ctx: Context, tile: number, ticks: number): void {
  const due = ctx.state.tick + ticks, list = ctx.state.growth
  let lo = 0, hi = list.length
  while (lo < hi) { const mid = (lo + hi) >> 1; const [t, i] = list[mid]!; if (t < due || (t === due && i < tile)) lo = mid + 1; else hi = mid }
  list.splice(lo, 0, [due, tile])
}

export function grow(ctx: Context): void {
  const map = ctx.state.map, list = ctx.state.growth
  while (list.length && list[0]![0] <= ctx.state.tick) {
    const [, tile] = list.shift()!
    const rule = objectAt(ctx, tile)
    if (!rule?.grows) continue
    const into = ctx.objectIndex.get(rule.grows.into)!
    const blocking = ctx.objects[into - 1]!.blocks
    if (blocking && ctx.index.settlerAt[tile]) { scheduleGrowth(ctx, tile, 20); continue }
    map.object[tile] = into; map.objectAmount[tile] = ctx.objects[into - 1]!.amount; map.objectSince[tile] = ctx.state.tick
    changed(ctx, tile)
    if (ctx.objects[into - 1]!.grows) scheduleGrowth(ctx, tile, ctx.objects[into - 1]!.grows!.ticks)
    if (blocking !== rule.blocks) ctx.state.navigation++
  }
}

effects.set('harvest', (ctx, s, args) => {
  const tile = Number(args.tile), map = ctx.state.map, rule = objectAt(ctx, tile)
  ctx.state.claims.delete(tile)
  if (!rule || map.objectAmount[tile]! < 1) return false
  map.objectAmount[tile] = map.objectAmount[tile]! - 1
  if (map.objectAmount[tile] === 0) { map.object[tile] = 0; map.objectSince[tile] = ctx.state.tick; if (rule.blocks) ctx.state.navigation++ }
  changed(ctx, tile)
  s.cargo = String(args.output)
  record(ctx, s.owner, 'produced', s.cargo, 1)
  return true
})

effects.set('extract', (ctx, s, args) => {
  const tile = Number(args.tile), map = ctx.state.map
  ctx.state.claims.delete(tile)
  if (args.resource !== 'water') {
    const resource = ctx.goodIndex.get(String(args.resource))!
    if (map.resource[tile] !== resource || map.resourceAmount[tile]! < 1) return false
    map.resourceAmount[tile] = map.resourceAmount[tile]! - 1
    if (map.resourceAmount[tile] === 0) map.resource[tile] = 0
    changed(ctx, tile)
  }
  s.cargo = String(args.output)
  record(ctx, s.owner, 'produced', s.cargo, 1)
  return true
})

// eslint-disable-next-line pickier/no-unused-vars
effects.set('plant', (ctx, s, args) => {
  const tile = Number(args.tile), map = ctx.state.map
  ctx.state.claims.delete(tile)
  if (map.object[tile] || ctx.index.buildingAt[tile]) return false
  const id = ctx.objectIndex.get(String(args.object))!, rule = ctx.objects[id - 1]!
  map.object[tile] = id; map.objectAmount[tile] = rule.amount; map.objectSince[tile] = ctx.state.tick
  changed(ctx, tile)
  if (rule.grows) scheduleGrowth(ctx, tile, rule.grows.ticks)
  if (rule.blocks) ctx.state.navigation++
  return true
})

effects.set('store', (ctx, s, args) => {
  const b = ctx.state.buildings.get(Number(args.building))
  if (!b || !s.cargo) return false
  const stack = output(ctx, b, s.cargo)
  if (stack.reservedIn > 0) stack.reservedIn--
  if (stack.amount >= stack.capacity) return false
  stack.amount++; s.cargo = null
  return true
})

finishers.set('work', (ctx, s, program, ok, reason) => {
  if (ok) return
  for (const [tile, id] of [...ctx.state.claims]) if (id === s.id) ctx.state.claims.delete(tile)
  const b = ctx.state.buildings.get(program.ref)
  if (b) {
    const step = program.steps.find(op => op.op === 'do' && (op.effect === 'harvest' || op.effect === 'extract'))
    // Release the doorstep space reserved for this trip unless the store already used it.
    if (step && step.op === 'do' && program.steps.slice(program.pc).some(op => op.op === 'do' && op.effect === 'store')) { const st = output(ctx, b, String(step.args!.output)); if (st.reservedIn > 0) st.reservedIn-- }
  }
  if (s.cargo) dropCargo(ctx, s)
  s.diagnostic = reason
  if (b && b.worker === s.id && !s.inside) { ctx.state.cooldowns.set(`work:${b.id}`, ctx.state.tick + 40); start(ctx, s, 'commute', b.id, commute(ctx, b)) }
  else if (!b) release(ctx, s, reason ?? 'workplace gone')
})

