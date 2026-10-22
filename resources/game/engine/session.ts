import type { Context } from './context'
import type { Point } from './geometry'
import type { Goods, RulesProfile } from './rules'
import type { Building, Command, CommandResult, GameEvent, MapState, Player, PlayerSettings, Settler, Stack, State } from './state'
import { createContext, doorOf, emit, footprint, markFootprint, nextId, objectAt, record, ruleOf, terrainAt, tileOf } from './context'
import { distance, indexOf, inside } from './geometry'
import { cancelJob, cancelJobsFor, dropToGround, groundStackAt, moveStackGoodsToGround, assignDeliveries } from './logistics'
import { grow, work } from './production'
import { seedRandom } from './random'
import { rulesIdentity, validateRules } from './rules'
import { spawn, tickSettler } from './settlers'
import { dispatch, updateVisibility } from './territory'
import { complete, release, staff } from './workforce'

export interface PlayerSetup {
  name: string, civilization: string, controller?: Player['controller'], start: Point
  settlers?: Record<string, number>, goods?: Goods, settings?: Partial<PlayerSettings>
}
export interface SessionSetup { rules: RulesProfile, map: MapState, seed: number, players: PlayerSetup[], content?: { id: string, digest: string }, startBuilding?: string }

/** Engineering start conditions; original start resources remain unverified (S3-074). */
export const DEFAULT_START = {
  settlers: { carrier: 30, digger: 4, builder: 4 } as Record<string, number>,
  goods: { plank: 30, stone: 26, log: 8, fish: 8, bread: 8, meat: 8, axe: 3, saw: 2, pickaxe: 4, shovel: 2, hammer: 4, scythe: 2, fishingrod: 2 } as Goods,
}

const defaultSettings = (rules: RulesProfile): PlayerSettings => ({
  carrierRatio: rules.population.carrierRatio, builderLimit: rules.population.builderLimit, diggerLimit: rules.population.diggerLimit,
  transportPriority: [...rules.goods], toolWeights: Object.fromEntries(rules.tools.map(t => [t, 1])), urgentTools: [], stored: [],
})

export function createState(setup: SessionSetup): State {
  const rules = validateRules(setup.rules), size = setup.map.width * setup.map.height
  if (!setup.players.length || setup.players.length > 20) throw new RangeError('A session needs between 1 and 20 players')
  const map: MapState = { ...setup.map, terrain: setup.map.terrain.slice(), elevation: setup.map.elevation.slice(), resource: setup.map.resource.slice(), resourceAmount: setup.map.resourceAmount.slice(), object: setup.map.object.slice(), objectAmount: setup.map.objectAmount.slice(), objectSince: setup.map.objectSince.slice(), owner: setup.map.owner.slice() }
  for (const [name, array] of Object.entries(map)) if (ArrayBuffer.isView(array) && (array as unknown as ArrayLike<number>).length !== size) throw new RangeError(`Map layer ${name} has the wrong size`)
  return {
    schema: 1, tick: 0, random: seedRandom(setup.seed), nextId: 1, map,
    players: setup.players.map((p, i) => ({ id: i + 1, name: p.name, civilization: p.civilization, controller: p.controller ?? 'human', settings: { ...defaultSettings(rules), ...p.settings }, explored: new Uint8Array(size), visible: new Uint8Array(size), signs: [], craftCursor: 0 })),
    settlers: new Map(), buildings: new Map(), stacks: new Map(), jobs: new Map(), claims: new Map(), growth: [], ledger: {}, events: [], results: [], cooldowns: new Map(), pending: [], navigation: 0,
  }
}

/** Places the opening settlement for each player as completed scenario state. */
export function populate(ctx: Context, setup: SessionSetup): void {
  const start = setup.startBuilding ?? 'castle'
  setup.players.forEach((p, i) => {
    const owner = i + 1, rule = ctx.building.get(start)
    if (!rule) throw new RangeError(`Unknown start building ${start}`)
    const map = ctx.state.map
    // Scenario starts clear their site; this is setup, not construction work.
    for (const q of [...footprint(rule, p.start), ...[...rule.protected, rule.door].map(([dx, dy]) => ({ x: p.start.x + dx, y: p.start.y + dy }))]) {
      if (!inside(map, q.x, q.y)) throw new RangeError(`Player ${owner} start does not fit on the map`)
      const t = tileOf(ctx, q)
      if (ctx.index.buildingAt[t] || ctx.index.protectedAt[t] || !terrainAt(ctx, t).walkable) throw new RangeError(`Player ${owner} start is not on open land`)
      map.object[t] = 0; map.objectAmount[t] = 0
    }
    const b = createBuilding(ctx, owner, start, p.start.x, p.start.y)
    for (const q of footprint(rule, b)) map.elevation[tileOf(ctx, q)] = b.target
    b.levelRemaining = 0; b.workRemaining = 0; b.used = { ...rule.cost }
    complete(ctx, b)
    const door = doorOf(ctx, b)
    for (const [profession, n] of Object.entries(p.settlers ?? DEFAULT_START.settlers)) {
      const tool = ctx.profession.get(profession)?.tool ?? null
      for (let k = 0; k < n; k++) { const s = spawn(ctx, owner, profession, door, 'scenario'); if (s) s.tool = tool }
    }
    for (const [good, n] of Object.entries(p.goods ?? DEFAULT_START.goods)) {
      const left = dropToGround(ctx, owner, door, good, n)
      record(ctx, owner, 'created', good, n - left)
    }
  })
  updateVisibility(ctx)
}

function createBuilding(ctx: Context, owner: number, type: string, x: number, y: number): Building {
  const rule = ctx.building.get(type)!, tiles = footprint(rule, { x, y }).map(p => tileOf(ctx, p)), map = ctx.state.map
  const target = Math.round(tiles.reduce((sum, t) => sum + map.elevation[t]!, 0) / tiles.length)
  const levelRemaining = tiles.reduce((sum, t) => sum + Math.abs(map.elevation[t]! - target), 0)
  const order = Math.max(0, ...[...ctx.state.buildings.values()].map(b => b.order)) + 1
  const b: Building = {
    id: nextId(ctx), owner, type, x, y, phase: levelRemaining ? 'leveling' : 'building', suspended: false, order, target, levelRemaining,
    used: {}, workRemaining: Object.values(rule.cost).reduce((a, n) => a + n, 0), worker: 0, workers: [], workArea: { x, y },
    cycle: 0, cycleGoods: {}, meals: 0, shortage: null, residents: 0, nextResident: ctx.state.tick,
  }
  ctx.state.buildings.set(b.id, b)
  markFootprint(ctx, b, b.id)
  ctx.state.navigation++
  if (b.workRemaining === 0 && b.phase === 'building') complete(ctx, b)
  return b
}

/** Why a player cannot place a building here, or null when the placement is valid. */
export function placementError(ctx: Context, owner: number, type: string, x: number, y: number): string | null {
  const rule = ctx.building.get(type), map = ctx.state.map
  if (!rule) return 'Unknown building.'
  if (!inside(map, x, y)) return 'Choose a tile on the map.'
  const tiles = footprint(rule, { x, y }), kept = [...rule.protected, rule.door].map(([dx, dy]) => ({ x: x + dx, y: y + dy }))
  if (![...tiles, ...kept].every(p => inside(map, p.x, p.y))) return 'The building does not fit here.'
  if (![...tiles, ...kept].every(p => map.owner[tileOf(ctx, p)] === owner)) return 'Build inside your territory.'
  const buildable = ctx.terrain.filter(t => t.buildable).map(t => t.id)
  // Mines stand with their origin on the mountain; the rest of the site may reach onto open land.
  if (rule.ground && !rule.ground.includes(terrainAt(ctx, tileOf(ctx, { x, y })).id)) return `This building needs ${rule.ground.join(' or ')} ground.`
  const elevations: number[] = []
  for (const p of tiles) {
    const t = tileOf(ctx, p), kind = terrainAt(ctx, t).id
    if (ctx.index.buildingAt[t] || ctx.index.protectedAt[t]) return 'Another building is in the way.'
    if (!buildable.includes(kind) && !rule.ground?.includes(kind)) return 'Choose clear, buildable ground.'
    if (objectAt(ctx, t)) return 'Trees, stones or crops are in the way.'
    if (ctx.index.settlerAt[t]) return 'Settlers are standing on this site.'
    if (groundStackAt(ctx, t)) return 'Goods are lying on this site.'
    elevations.push(map.elevation[t]!)
  }
  for (const p of kept) {
    const t = tileOf(ctx, p)
    if (ctx.index.buildingAt[t]) return 'Another building is too close.'
    if (!terrainAt(ctx, t).walkable) return 'The building needs open ground around it.'
  }
  const doorTile = tileOf(ctx, { x: x + rule.door[0], y: y + rule.door[1] })
  if (objectAt(ctx, doorTile)?.blocks) return 'The entrance is blocked.'
  // Carriers and builders must be able to stand at every pile and work spot.
  for (const [dx, dy] of [...rule.piles.map(p => p.at), ...rule.builders]) {
    const px = x + dx, py = y + dy
    if (inside(map, px, py) && objectAt(ctx, tileOf(ctx, { x: px, y: py }))?.blocks) return 'Trees or stones block the building\'s piles.'
  }
  if (Math.max(...elevations) - Math.min(...elevations) > ctx.rules.movement.maxClimb * 4) return 'The ground is too steep.'
  return null
}

function settings(player: Player, value: Record<string, unknown>, rules: RulesProfile): string | null {
  const next = structuredClone(player.settings)
  const percent = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 100
  const count = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 1000
  if ('carrierRatio' in value) { if (!percent(value.carrierRatio)) return 'Carrier ratio must be 0 to 100.'; next.carrierRatio = value.carrierRatio }
  if ('builderLimit' in value) { if (!count(value.builderLimit)) return 'Invalid builder limit.'; next.builderLimit = value.builderLimit }
  if ('diggerLimit' in value) { if (!count(value.diggerLimit)) return 'Invalid digger limit.'; next.diggerLimit = value.diggerLimit }
  if ('transportPriority' in value) {
    const list = value.transportPriority
    if (!Array.isArray(list) || list.length !== rules.goods.length || new Set(list).size !== list.length || !list.every(g => rules.goods.includes(g))) return 'Transport priority must list every good once.'
    next.transportPriority = list as string[]
  }
  if ('stored' in value) {
    const list = value.stored
    if (!Array.isArray(list) || new Set(list).size !== list.length || !list.every(g => rules.goods.includes(g))) return 'Stored goods must be known goods.'
    next.stored = list as string[]
  }
  if ('toolWeights' in value) {
    const weights = value.toolWeights
    if (!weights || typeof weights !== 'object' || !Object.entries(weights).every(([t, w]) => rules.tools.includes(t) && Number.isInteger(w) && (w as number) >= 0 && (w as number) <= 10)) return 'Tool weights must be 0 to 10.'
    next.toolWeights = { ...next.toolWeights, ...(weights as Record<string, number>) }
  }
  player.settings = next
  return null
}

function demolish(ctx: Context, b: Building): void {
  const rule = ruleOf(ctx, b), door = doorOf(ctx, b), [num, den] = ctx.rules.demolition.refundFraction
  cancelJobsFor(ctx, b, 'building demolished')
  for (const s of [...ctx.state.settlers.values()]) if (s.workplace === b.id || s.inside === b.id) release(ctx, s, 'building demolished')
  // Stored, doorstep and delivered-but-unused goods stay physical: they move onto nearby ground.
  moveStackGoodsToGround(ctx, b, null)
  // Manual candidate: half of the construction materials become available again.
  const basis = b.phase === 'active' ? rule.cost : b.used
  for (const [good, n] of Object.entries(basis)) {
    const refund = Math.floor(n * num / den)
    if (refund <= 0) continue
    const left = dropToGround(ctx, b.owner, door, good, refund)
    record(ctx, b.owner, 'recovered', good, refund - left)
  }
  for (const [tile, id] of [...ctx.state.claims]) if (ctx.state.settlers.get(id)?.workplace === b.id) ctx.state.claims.delete(tile)
  markFootprint(ctx, b, 0)
  ctx.state.buildings.delete(b.id)
  ctx.state.navigation++
  emit(ctx, { player: b.owner, type: 'demolished', text: `${rule.name} demolished`, tile: door })
}

const integer = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max

/** Executes one validated command. Every outcome is recorded so the issuing player sees accepted and rejected orders. */
function execute(ctx: Context, command: Command): CommandResult {
  const { state, rules } = ctx
  const result = (ok: boolean, reason?: string): CommandResult => ({ tick: state.tick, player: command.player, seq: command.seq, type: command.type, ok, ...(reason ? { reason } : {}) })
  const player = state.players.find(p => p.id === command.player)
  if (!player || player.controller === 'observer') return result(false, 'Unknown or observing player.')
  const owned = (): Building | string => {
    const b = state.buildings.get(command.building as number)
    return b && b.owner === player.id ? b : 'That building is not yours.'
  }
  switch (command.type) {
    case 'build': {
      if (typeof command.building !== 'string' || !integer(command.x, 0, state.map.width - 1) || !integer(command.y, 0, state.map.height - 1)) return result(false, 'Malformed build order.')
      const error = placementError(ctx, player.id, command.building, command.x, command.y)
      if (error) return result(false, error)
      const b = createBuilding(ctx, player.id, command.building, command.x, command.y)
      emit(ctx, { player: player.id, type: 'site', text: `${ruleOf(ctx, b).name} site placed`, entity: b.id, tile: doorOf(ctx, b) })
      return result(true)
    }
    case 'demolish': { const b = owned(); if (typeof b === 'string') return result(false, b); demolish(ctx, b); return result(true) }
    case 'suspend': {
      const b = owned(); if (typeof b === 'string') return result(false, b)
      if (typeof command.suspended !== 'boolean') return result(false, 'Malformed suspend order.')
      b.suspended = command.suspended
      // Deliveries not yet picked up are withdrawn; goods already in a carrier's hands arrive.
      if (b.suspended && b.phase !== 'active') for (const job of [...state.jobs.values()]) if (job.kind === 'deliver' && !job.picked && state.stacks.get(job.target)?.building === b.id) cancelJob(ctx, job, 'site suspended')
      return result(true)
    }
    case 'work-area': {
      const b = owned(); if (typeof b === 'string') return result(false, b)
      const w = ruleOf(ctx, b).workflow
      if (!('radius' in w) || !integer(command.x, 0, state.map.width - 1) || !integer(command.y, 0, state.map.height - 1)) return result(false, 'This building has no working area.')
      if (distance(b, { x: command.x, y: command.y }) > w.radius * 3) return result(false, 'That working area is too far away.')
      b.workArea = { x: command.x, y: command.y }
      state.cooldowns.delete(`work:${b.id}`)
      return result(true)
    }
    case 'settings': {
      const error = settings(player, (command.settings ?? {}) as Record<string, unknown>, rules)
      return error ? result(false, error) : result(true)
    }
    case 'urgent-tool': {
      if (typeof command.tool !== 'string' || !rules.tools.includes(command.tool) || player.settings.urgentTools.length >= 64) return result(false, 'Unknown tool order.')
      player.settings.urgentTools.push(command.tool)
      return result(true)
    }
    case 'specialists': {
      if ((command.profession !== 'geologist' && command.profession !== 'pioneer') || !integer(command.x, 0, state.map.width - 1) || !integer(command.y, 0, state.map.height - 1) || !integer(command.count, 1, 50)) return result(false, 'Malformed specialist order.')
      const sent = dispatch(ctx, player.id, command.profession, indexOf(state.map, command.x, command.y), command.count)
      return sent ? result(true) : result(false, `No ${command.profession} could be equipped.`)
    }
    default: return result(false, 'Unknown command.')
  }
}

const COMMAND_TYPES = new Set(['build', 'demolish', 'suspend', 'work-area', 'settings', 'urgent-tool', 'specialists'])

export interface PlayerView {
  tick: number, player: number, width: number, height: number
  explored: Uint8Array, visible: Uint8Array, owner: Uint8Array
  settlers: Pick<Settler, 'id' | 'owner' | 'profession' | 'x' | 'y' | 'next' | 'step' | 'stepTicks' | 'dir' | 'action' | 'cargo' | 'inside' | 'tool' | 'diagnostic'>[]
  buildings: (Pick<Building, 'id' | 'owner' | 'type' | 'x' | 'y' | 'phase' | 'suspended' | 'shortage' | 'worker' | 'levelRemaining' | 'workRemaining' | 'workArea' | 'cycle'> & { door: number })[]
  stacks: Pick<Stack, 'id' | 'owner' | 'tile' | 'building' | 'role' | 'good' | 'amount' | 'capacity'>[]
  goods: Goods, professions: Record<string, number>, population: number
  signs: Player['signs'], events: GameEvent[], results: CommandResult[]
}

export interface Session {
  readonly rules: RulesProfile
  readonly state: State
  readonly context: Context
  readonly identity: { rules: ReturnType<typeof rulesIdentity>, content: { id: string, digest: string } }
  /** Accepts a command for its tick. Returns a rejection immediately for malformed or late commands. */
  enqueue: (command: Command) => CommandResult | null
  advance: (ticks?: number) => void
  view: (player: number) => PlayerView
  placement: (player: number, type: string, x: number, y: number) => string | null
  dispose: () => void
}

export function openSession(rules: RulesProfile, state: State, content: { id: string, digest: string }): Session {
  validateRules(rules)
  const context = createContext(rules, state)
  let disposed = false
  const identity = { rules: rulesIdentity(rules), content }
  const guard = (): void => { if (disposed) throw new Error('This game session has been disposed.') }
  const tick = (): void => {
    const due: Command[] = []
    while (state.pending.length && state.pending[0]!.tick === state.tick) due.push(state.pending.shift()!)
    for (const command of due) { const outcome = execute(context, command); state.results.push(outcome); if (!outcome.ok) emit(context, { player: command.player, type: 'rejected', text: outcome.reason! }) }
    if (state.results.length > 128) state.results.splice(0, state.results.length - 128)
    grow(context)
    if (state.tick % rules.logistics.assignmentInterval === 0) { staff(context); assignDeliveries(context) }
    for (const s of [...state.settlers.values()]) tickSettler(context, s)
    work(context)
    if (state.tick % rules.visibility.interval === 0) updateVisibility(context)
    state.tick++
  }
  return {
    rules, state, context, identity,
    enqueue(command) {
      guard()
      const reject = (reason: string): CommandResult => ({ tick: state.tick, player: Number(command?.player) || 0, seq: Number(command?.seq) || 0, type: String(command?.type ?? ''), ok: false, reason })
      if (!command || typeof command !== 'object' || !COMMAND_TYPES.has(command.type)) return reject('Unknown command.')
      if (!integer(command.tick, state.tick, state.tick + 1_000_000) || !integer(command.player, 1, state.players.length) || !integer(command.seq, 0, Number.MAX_SAFE_INTEGER)) return reject('Commands need a current tick, a player and a sequence number.')
      if (JSON.stringify(command).length > 4096) return reject('Command is too large.')
      if (state.pending.length >= 10_000) return reject('Too many pending commands.')
      const copy = structuredClone(command)
      const at = state.pending.findIndex(c => c.tick > copy.tick || (c.tick === copy.tick && (c.player > copy.player || (c.player === copy.player && c.seq > copy.seq))))
      if (state.pending.some(c => c.tick === copy.tick && c.player === copy.player && c.seq === copy.seq)) return reject('Duplicate command sequence.')
      state.pending.splice(at < 0 ? state.pending.length : at, 0, copy)
      return null
    },
    advance(ticks = 1) {
      guard()
      if (!integer(ticks, 0, 1_000_000)) throw new RangeError('Advance by a whole number of ticks.')
      for (let i = 0; i < ticks; i++) tick()
    },
    view: player => { guard(); return view(context, player) },
    placement: (player, type, x, y) => placementError(context, player, type, x, y),
    dispose() { disposed = true },
  }
}

export function createSession(setup: SessionSetup): Session {
  const state = createState(setup)
  const session = openSession(setup.rules, state, setup.content ?? { id: 'generated', digest: 'unverified' })
  populate(session.context, setup)
  return session
}

/** Information this player may know. Foreign entities appear only where the player currently sees. */
export function view(ctx: Context, playerId: number): PlayerView {
  const { state } = ctx, player = state.players.find(p => p.id === playerId)
  if (!player) throw new RangeError('Unknown player')
  const seen = (tile: number): boolean => player.visible[tile] === 1
  const own = (owner: number): boolean => owner === playerId || player.controller === 'observer'
  const goods: Goods = {}, professions: Record<string, number> = {}
  for (const s of state.stacks.values()) if (s.owner === playerId && s.amount > 0) goods[s.good] = (goods[s.good] ?? 0) + s.amount
  let people = 0
  for (const s of state.settlers.values()) if (s.owner === playerId) { people++; professions[s.profession] = (professions[s.profession] ?? 0) + 1; if (s.cargo) goods[s.cargo] = (goods[s.cargo] ?? 0) + 1 }
  const owner = state.map.owner.slice()
  for (let t = 0; t < owner.length; t++) if (!player.explored[t]) owner[t] = 0
  return {
    tick: state.tick, player: playerId, width: state.map.width, height: state.map.height, explored: player.explored.slice(), visible: player.visible.slice(), owner,
    settlers: [...state.settlers.values()].filter(s => own(s.owner) || (!s.inside && seen(tileOf(ctx, s)))).map(s => ({ id: s.id, owner: s.owner, profession: s.profession, x: s.x, y: s.y, next: s.next, step: s.step, stepTicks: s.stepTicks, dir: s.dir, action: s.action, cargo: s.cargo, inside: s.inside, tool: s.tool, diagnostic: own(s.owner) ? s.diagnostic : null })),
    buildings: [...state.buildings.values()].filter(b => own(b.owner) || footprint(ruleOf(ctx, b), b).some(p => seen(tileOf(ctx, p)))).map(b => ({ id: b.id, owner: b.owner, type: b.type, x: b.x, y: b.y, phase: b.phase, suspended: own(b.owner) && b.suspended, shortage: own(b.owner) ? b.shortage : null, worker: own(b.owner) ? b.worker : 0, levelRemaining: b.levelRemaining, workRemaining: b.workRemaining, workArea: own(b.owner) ? b.workArea : { x: b.x, y: b.y }, cycle: own(b.owner) ? b.cycle : 0, door: doorOf(ctx, b) })),
    stacks: [...state.stacks.values()].filter(s => s.amount > 0 && (own(s.owner) || seen(s.tile))).map(s => ({ id: s.id, owner: s.owner, tile: s.tile, building: s.building, role: s.role, good: s.good, amount: s.amount, capacity: s.capacity })),
    goods, professions, population: people,
    signs: player.signs.filter(sign => sign.until > state.tick),
    events: state.events.filter(e => e.player === playerId).slice(-32),
    results: state.results.filter(r => r.player === playerId).slice(-32),
  }
}

