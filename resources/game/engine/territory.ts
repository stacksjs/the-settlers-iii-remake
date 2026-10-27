import type { Context } from './context'
import type { Building, Job, Op, Settler } from './state'
import { available, changed, emit, nextId, pointAt, record, ruleOf, terrainAt, tileOf } from './context'
import { terrainIs } from './landscapes'
import { area, distance, neighbours } from './geometry'
import { cancelJob, dropCargo, dropToGround } from './logistics'
import { changeProfession, effects, finishers, start } from './settlers'
import { completions, population } from './workforce'
import { enterable, route } from './routing'
import { rememberWorld } from './perception'

/** Claims land for a military building. Tiles already owned by another player are never taken here; capture belongs to combat. */
export function claim(ctx: Context, b: Building): void {
  const radius = ruleOf(ctx, b).territory
  if (!radius) return
  const map = ctx.state.map
  let claimed = 0
  for (const t of area(map, b, radius)) if (map.owner[t] === 0) { map.owner[t] = b.owner; changed(ctx, t); claimed++ }
  if (claimed) emit(ctx, { player: b.owner, type: 'territory', text: `${ruleOf(ctx, b).name} claimed ${claimed} tiles`, entity: b.id })
}
completions.push(claim)

/** A tile is part of the player's land when owned and connected to it; pioneers extend only from owned border tiles. */
export const borders = (ctx: Context, owner: number, tile: number): boolean => ctx.state.map.owner[tile] === 0 && neighbours(ctx.state.map, tile).some(t => ctx.state.map.owner[t] === owner)

/**
 * Dispatches specialists: carriers equipped with the specialist's tool walk to
 * the target without territory restriction and start their duty program.
 */
export function dispatch(ctx: Context, owner: number, profession: 'geologist' | 'pioneer', target: number, count: number): number {
  const rule = ctx.profession.get(profession)!
  let sent = 0
  const goal = pointAt(ctx, target)
  const ready = population(ctx, owner).filter(s => s.profession === profession && !s.program && !s.inside && !s.workplace).sort((a, b) => distance(a, goal) - distance(b, goal) || a.id - b.id)
  for (const s of ready.slice(0, count)) { start(ctx, s, 'duty', target, duty(ctx, s, target)); sent++ }
  if (sent >= count) return sent
  const people = population(ctx, owner), player = ctx.state.players.find(p => p.id === owner)!
  for (let i = sent; i < count; i++) {
    const carriers = people.filter(s => s.profession === 'carrier' && !s.program && !s.inside && !s.cargo && !s.workplace)
    if (carriers.length - 1 < Math.ceil(people.length * player.settings.carrierRatio / 100)) break
    if (rule.tool === null) { const s = carriers.sort((a, b) => distance(a, goal) - distance(b, goal) || a.id - b.id)[0]!; changeProfession(ctx, s, profession); start(ctx, s, 'duty', target, duty(ctx, s, target)); sent++; continue }
    const source = [...ctx.state.stacks.values()].filter(s => s.owner === owner && s.good === rule.tool && available(s) > 0 && s.role !== 'input' && s.role !== 'construction').sort((a, b) => distance(pointAt(ctx, a.tile), goal) - distance(pointAt(ctx, b.tile), goal) || a.id - b.id)[0]
    if (!source) { emit(ctx, { player: owner, type: 'shortage', text: `No ${rule.tool} available for a ${profession}` }); break }
    const from = pointAt(ctx, source.tile), s = carriers.sort((a, b) => distance(a, from) - distance(b, from) || a.id - b.id)[0]!
    const job: Job = { id: nextId(ctx), kind: 'equip', owner, tool: rule.tool, source: source.id, settler: s.id, profession, building: 0, picked: false }
    ctx.state.jobs.set(job.id, job); source.reservedOut++
    start(ctx, s, 'specialist', job.id, [{ op: 'go', tile: source.tile }, { op: 'do', effect: 'pickup', args: { job: job.id } }, { op: 'do', effect: 'arm', args: { job: job.id, target } }])
    sent++
  }
  return sent
}

/**
 * Turns idle specialists back into carriers (manual: Occupations, "changes
 * pioneers back to carriers"). A specialist on duty, walking or carrying keeps
 * working; the tool he was given is set down beside him as a good again.
 * Returns how many were turned back.
 */
export function dismiss(ctx: Context, owner: number, profession: string, count: number): number {
  const idle = population(ctx, owner).filter(s => s.profession === profession && !s.inside && !s.cargo && s.action !== 'walking' && (!s.program || s.diagnostic === 'duty complete')).sort((a, b) => a.id - b.id)
  let done = 0
  for (const s of idle.slice(0, count)) {
    s.program = null
    if (s.tool) {
      const tool = s.tool, left = dropToGround(ctx, owner, tileOf(ctx, s), tool, 1)
      // With no ground nearby the tool stays in his hands, still equipment.
      if (left) continue
      record(ctx, owner, 'recovered', tool, 1)
      s.tool = null
    }
    delete s.thief
    changeProfession(ctx, s, 'carrier')
    s.diagnostic = null
    done++
  }
  return done
}

const duty = (ctx: Context, s: Settler, target: number): Op[] =>
  s.profession === 'geologist'
    ? [{ op: 'go', tile: target }, { op: 'work', ticks: ctx.rules.survey.work }, { op: 'do', effect: 'survey', args: { center: target } }]
    : [{ op: 'go', tile: target }, { op: 'work', ticks: ctx.rules.territory.pioneerWork }, { op: 'do', effect: 'pioneer', args: { center: target } }]

effects.set('arm', (ctx, s, args) => {
  const job = ctx.state.jobs.get(Number(args.job))
  if (!job || job.kind !== 'equip' || s.cargo !== job.tool) return false
  s.cargo = null; s.tool = job.tool
  record(ctx, s.owner, 'equipped', job.tool!, 1)
  changeProfession(ctx, s, job.profession)
  ctx.state.jobs.delete(job.id)
  const target = Number(args.target)
  s.program = { kind: 'duty', ref: target, steps: duty(ctx, s, target), pc: 0 }
  return true
})

finishers.set('specialist', (ctx, s, program, _ok, reason) => {
  const job = ctx.state.jobs.get(program.ref)
  if (job) cancelJob(ctx, job, reason ?? 'interrupted')
  if (s.cargo) dropCargo(ctx, s)
})

/** Geologists survey the tile they stand on, leaving a sign with the player's knowledge of the deposit. */
effects.set('survey', (ctx, s) => {
  const tile = tileOf(ctx, s), map = ctx.state.map, player = ctx.state.players.find(p => p.id === s.owner)!
  if (!terrainIs(terrainAt(ctx, tile), 'mountain')) return true
  const good = map.resource[tile] ? ctx.rules.goods[map.resource[tile]! - 1]! : null
  player.signs = player.signs.filter(sign => sign.tile !== tile && sign.until > ctx.state.tick)
  player.signs.push({ tile, good, amount: good ? map.resourceAmount[tile]! : 0, until: ctx.state.tick + ctx.rules.survey.signTicks })
  if (player.signs.length > 512) player.signs.splice(0, player.signs.length - 512)
  return true
})

effects.set('pioneer', (ctx, s) => {
  const tile = tileOf(ctx, s)
  if (borders(ctx, s.owner, tile)) {
    ctx.state.map.owner[tile] = s.owner
    changed(ctx, tile)
    emit(ctx, { player: s.owner, type: 'territory', text: 'A pioneer claimed new land', tile })
  }
  return true
})

/** Specialists keep working around their assignment until recalled, moving to the next unsurveyed or unclaimed tile. */
finishers.set('duty', (ctx, s, program, ok) => {
  if (!ok) return
  const center = pointAt(ctx, program.ref), map = ctx.state.map
  const radius = s.profession === 'geologist' ? ctx.rules.survey.radius : ctx.rules.territory.pioneerRadius + 2
  const player = ctx.state.players.find(p => p.id === s.owner)!
  const surveyed = new Set(player.signs.filter(sign => sign.until > ctx.state.tick).map(sign => sign.tile))
  const next = area(map, center, radius).filter(t => s.profession === 'geologist' ? terrainIs(terrainAt(ctx, t), 'mountain') && !surveyed.has(t) : borders(ctx, s.owner, t))
    .sort((a, b) => distance(pointAt(ctx, a), s) - distance(pointAt(ctx, b), s) || a - b)
    .find(t => ctx.rules.specialistRouting !== 'reachable' || (enterable(ctx, t, 0, t) && route(ctx, tileOf(ctx, s), t).ok))
  if (next === undefined) { s.diagnostic = 'duty complete'; return }
  start(ctx, s, 'duty', program.ref, [{ op: 'go', tile: next }, { op: 'work', ticks: s.profession === 'geologist' ? ctx.rules.survey.work : ctx.rules.territory.pioneerWork }, { op: 'do', effect: s.profession === 'geologist' ? 'survey' : 'pioneer', args: { center: program.ref } }])
})

/** Recomputes what each player can currently see and permanently records what it has explored. */
export function updateVisibility(ctx: Context): void {
  const map = ctx.state.map
  for (const player of ctx.state.players) {
    // Sight is rebuilt from scratch, then only tiles whose fog actually changed mark their chunk.
    const visible = new Uint8Array(player.visible.length)
    const mark = (center: { x: number, y: number }, radius: number): void => { for (const t of area(map, center, radius)) visible[t] = 1 }
    for (const s of ctx.state.settlers.values()) if (s.owner === player.id) mark(s, ctx.rules.visibility.settler)
    for (const b of ctx.state.buildings.values()) if (b.owner === player.id) mark(b, ruleOf(ctx, b).vision)
    // A Magic Eye keeps its land in sight until it closes.
    for (const eye of ctx.state.eyes ?? []) if (eye.player === player.id && eye.until > ctx.state.tick) mark(pointAt(ctx, eye.tile), eye.radius)
    if (player.controller === 'observer') visible.fill(1)
    rememberWorld(ctx, player, visible)
    for (let t = 0; t < visible.length; t++) {
      if (visible[t] === player.visible[t] && (!visible[t] || player.explored[t])) continue
      player.visible[t] = visible[t]!
      if (visible[t]) player.explored[t] = 1
      changed(ctx, t)
    }
  }
}

