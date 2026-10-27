import type { Context } from './context'
import type { State } from './state'
import { area } from './geometry'
import { changed } from './context'
import { recordObservation } from './perception'

// Missions are data, never code. A definition names objectives and triggers built
// from a fixed vocabulary of conditions and actions; anything else is rejected
// before a session can use it. Triggers are evaluated in definition order on a
// fixed cadence, so mission progress is deterministic and saved with the world.

export type Condition =
  | { kind: 'tick-at-least', tick: number }
  | { kind: 'goods-at-least', player: number, good: string, amount: number }
  | { kind: 'buildings-at-least', player: number, building: string, count: number }
  | { kind: 'population-at-least', player: number, count: number }
  | { kind: 'territory-at-least', player: number, tiles: number }
  | { kind: 'tile-owned', player: number, x: number, y: number }
  | { kind: 'player-defeated', player: number }
  | { kind: 'trigger-fired', trigger: string }
  | { kind: 'objective-complete', objective: string }
  | { kind: 'all', of: Condition[] }
  | { kind: 'any', of: Condition[] }
  | { kind: 'not', of: Condition }
export type Action =
  | { kind: 'message', player: number, text: string }
  | { kind: 'complete-objective', objective: string }
  | { kind: 'fail-objective', objective: string }
  | { kind: 'reveal', player: number, x: number, y: number, radius: number }
  | { kind: 'victory', player: number }
  | { kind: 'defeat', player: number }
export interface Objective { id: string, player: number, text: string }
export interface Trigger { id: string, when: Condition, then: Action[], repeat?: boolean }
export interface MissionDefinition { id: string, version: 1, objectives: Objective[], triggers: Trigger[] }
export type Outcome = 'playing' | 'won' | 'lost'
export interface MissionState { definition: MissionDefinition, objectives: Record<string, 'open' | 'complete' | 'failed'>, fired: string[], outcome: Record<string, Outcome> }

export const MISSION_LIMITS = { triggers: 256, objectives: 64, actions: 16, depth: 8, nodes: 512, text: 300, interval: 20 }

export class MissionError extends Error {
  constructor(readonly problems: string[]) { super(`Invalid mission: ${problems.slice(0, 4).join('; ')}${problems.length > 4 ? ` (+${problems.length - 4} more)` : ''}`) }
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const id = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v)
const int = (v: unknown, min = 0, max = 0xFFFFFFFF): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max

/** Validates untrusted mission data against the vocabulary, the rules and the world size. */
export function validateMission(value: unknown, world: { players: number, width: number, height: number, goods: string[], buildings: string[] }): MissionDefinition {
  const problems: string[] = []
  if (!isObject(value) || !id(value.id) || value.version !== 1 || !Array.isArray(value.objectives) || !Array.isArray(value.triggers)) throw new MissionError(['Mission needs an id, version 1, objectives and triggers'])
  const allowed = new Set(['id', 'version', 'objectives', 'triggers'])
  for (const key of Object.keys(value)) if (!allowed.has(key)) problems.push(`unknown field ${key}`)
  if (value.objectives.length > MISSION_LIMITS.objectives || value.triggers.length > MISSION_LIMITS.triggers) problems.push('too many objectives or triggers')
  const player = (v: unknown): boolean => int(v, 1, world.players)
  const objectiveIds = new Set<string>(), triggerIds = new Set<string>()
  for (const o of value.objectives as unknown[]) {
    if (!isObject(o) || !id(o.id) || !player(o.player) || typeof o.text !== 'string' || o.text.length > MISSION_LIMITS.text) { problems.push('malformed objective'); continue }
    if (objectiveIds.has(o.id)) problems.push(`objective ${o.id} is defined twice`)
    objectiveIds.add(o.id)
  }
  for (const t of value.triggers as unknown[]) if (isObject(t) && id(t.id)) { if (triggerIds.has(t.id)) problems.push(`trigger ${t.id} is defined twice`); triggerIds.add(t.id) }
  let nodes = 0
  const references = new Map<string, Set<string>>()
  const condition = (c: unknown, depth: number, owner: string): void => {
    if (++nodes > MISSION_LIMITS.nodes) { problems.push('conditions are too large'); return }
    if (depth > MISSION_LIMITS.depth) { problems.push(`trigger ${owner} nests conditions too deeply`); return }
    if (!isObject(c) || typeof c.kind !== 'string') { problems.push(`trigger ${owner} has a malformed condition`); return }
    const ok = (fields: string[], check: boolean): void => { if (!check || Object.keys(c).some(k => k !== 'kind' && !fields.includes(k))) problems.push(`trigger ${owner} has an invalid ${c.kind} condition`) }
    switch (c.kind) {
      case 'tick-at-least': ok(['tick'], int(c.tick)); break
      case 'goods-at-least': ok(['player', 'good', 'amount'], player(c.player) && world.goods.includes(c.good as string) && int(c.amount, 1, 1e6)); break
      case 'buildings-at-least': ok(['player', 'building', 'count'], player(c.player) && world.buildings.includes(c.building as string) && int(c.count, 1, 1e4)); break
      case 'population-at-least': ok(['player', 'count'], player(c.player) && int(c.count, 1, 1e6)); break
      case 'territory-at-least': ok(['player', 'tiles'], player(c.player) && int(c.tiles, 1, world.width * world.height)); break
      case 'tile-owned': ok(['player', 'x', 'y'], player(c.player) && int(c.x, 0, world.width - 1) && int(c.y, 0, world.height - 1)); break
      case 'player-defeated': ok(['player'], player(c.player)); break
      case 'trigger-fired': ok(['trigger'], id(c.trigger) && triggerIds.has(c.trigger)); if (id(c.trigger)) references.get(owner)?.add(c.trigger); break
      case 'objective-complete': ok(['objective'], id(c.objective) && objectiveIds.has(c.objective)); break
      case 'all': case 'any':
        ok(['of'], Array.isArray(c.of) && c.of.length > 0 && c.of.length <= 32)
        if (Array.isArray(c.of)) for (const child of c.of) condition(child, depth + 1, owner)
        break
      case 'not': ok(['of'], isObject(c.of)); condition(c.of, depth + 1, owner); break
      default: problems.push(`trigger ${owner} uses unknown condition ${c.kind}`)
    }
  }
  const action = (a: unknown, owner: string): void => {
    if (!isObject(a) || typeof a.kind !== 'string') { problems.push(`trigger ${owner} has a malformed action`); return }
    const ok = (fields: string[], check: boolean): void => { if (!check || Object.keys(a).some(k => k !== 'kind' && !fields.includes(k))) problems.push(`trigger ${owner} has an invalid ${a.kind} action`) }
    switch (a.kind) {
      case 'message': ok(['player', 'text'], player(a.player) && typeof a.text === 'string' && a.text.length <= MISSION_LIMITS.text); break
      case 'complete-objective': case 'fail-objective': ok(['objective'], id(a.objective) && objectiveIds.has(a.objective)); break
      case 'reveal': ok(['player', 'x', 'y', 'radius'], player(a.player) && int(a.x, 0, world.width - 1) && int(a.y, 0, world.height - 1) && int(a.radius, 0, 64)); break
      case 'victory': case 'defeat': ok(['player'], player(a.player)); break
      default: problems.push(`trigger ${owner} uses unknown action ${a.kind}`)
    }
  }
  for (const t of value.triggers as unknown[]) {
    if (!isObject(t) || !id(t.id) || !Array.isArray(t.then) || t.then.length > MISSION_LIMITS.actions || (t.repeat !== undefined && typeof t.repeat !== 'boolean') || Object.keys(t).some(k => !['id', 'when', 'then', 'repeat'].includes(k))) { problems.push('malformed trigger'); continue }
    references.set(t.id, new Set())
    condition(t.when, 1, t.id)
    for (const a of t.then) action(a, t.id)
  }
  // A trigger waiting on itself, directly or through others, could never fire.
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (node: string, path: string[]): void => {
    if (state.get(node) === 'done') return
    if (state.get(node) === 'visiting') { problems.push(`triggers wait on each other: ${[...path, node].join(' -> ')}`); return }
    state.set(node, 'visiting')
    for (const next of references.get(node) ?? []) visit(next, [...path, node])
    state.set(node, 'done')
  }
  for (const t of references.keys()) visit(t, [])
  if (problems.length) throw new MissionError([...new Set(problems)])
  return structuredClone(value) as unknown as MissionDefinition
}

export function startMission(definition: MissionDefinition, players: number): MissionState {
  return {
    definition, fired: [],
    objectives: Object.fromEntries(definition.objectives.map(o => [o.id, 'open' as const])),
    outcome: Object.fromEntries(Array.from({ length: players }, (_, i) => [String(i + 1), 'playing' as Outcome])),
  }
}

function holds(ctx: Context, mission: MissionState, c: Condition): boolean {
  const { state } = ctx
  switch (c.kind) {
    case 'tick-at-least': return state.tick >= c.tick
    case 'goods-at-least': {
      let n = 0
      for (const s of state.stacks.values()) if (s.owner === c.player && s.good === c.good) n += s.amount
      for (const s of state.settlers.values()) if (s.owner === c.player && s.cargo === c.good) n++
      return n >= c.amount
    }
    case 'buildings-at-least': return [...state.buildings.values()].filter(b => b.owner === c.player && b.type === c.building && b.phase === 'active').length >= c.count
    case 'population-at-least': return [...state.settlers.values()].filter(s => s.owner === c.player).length >= c.count
    case 'territory-at-least': { let n = 0; for (const o of state.map.owner) if (o === c.player) n++; return n >= c.tiles }
    case 'tile-owned': return state.map.owner[c.y * state.map.width + c.x] === c.player
    case 'player-defeated': return ![...state.buildings.values()].some(b => b.owner === c.player && ctx.building.get(b.type)?.military && b.phase === 'active')
    case 'trigger-fired': return mission.fired.includes(c.trigger)
    case 'objective-complete': return mission.objectives[c.objective] === 'complete'
    case 'all': return c.of.every(child => holds(ctx, mission, child))
    case 'any': return c.of.some(child => holds(ctx, mission, child))
    case 'not': return !holds(ctx, mission, c.of)
  }
}

function perform(ctx: Context, mission: MissionState, a: Action): void {
  const { state } = ctx
  const event = (player: number, type: string, text: string): void => { state.events.push({ tick: state.tick, player, type, text }); if (state.events.length > 256) state.events.splice(0, state.events.length - 256) }
  switch (a.kind) {
    case 'message': event(a.player, 'mission', a.text); break
    case 'complete-objective': case 'fail-objective': {
      if (mission.objectives[a.objective] !== 'open') break
      mission.objectives[a.objective] = a.kind === 'complete-objective' ? 'complete' : 'failed'
      const o = mission.definition.objectives.find(o => o.id === a.objective)!
      event(o.player, 'objective', `${a.kind === 'complete-objective' ? 'Objective complete' : 'Objective failed'}: ${o.text}`)
      break
    }
    case 'reveal': { const p = state.players[a.player - 1]!; for (const t of area(state.map, a, a.radius)) { if (!p.explored[t]) recordObservation(ctx, p, t); p.explored[t] = 1; changed(ctx, t) } break }
    case 'victory': case 'defeat':
      if (mission.outcome[a.player] === 'playing') { mission.outcome[a.player] = a.kind === 'victory' ? 'won' : 'lost'; event(a.player, 'outcome', a.kind === 'victory' ? 'Victory. The mission is won.' : 'Defeat. The mission is lost.') }
      break
  }
}

/** Evaluates triggers in order on the mission cadence. Each trigger fires once unless it repeats. */
export function advanceMission(ctx: Context): void {
  const mission = ctx.state.mission
  if (!mission || ctx.state.tick % MISSION_LIMITS.interval !== 0) return
  for (const t of mission.definition.triggers) {
    if (!t.repeat && mission.fired.includes(t.id)) continue
    if (!holds(ctx, mission, t.when)) continue
    if (!mission.fired.includes(t.id)) mission.fired.push(t.id)
    for (const a of t.then) perform(ctx, mission, a)
  }
}

export interface OriginalVictory {
  killPlayers: { enabled: boolean, players: boolean[] }
  destroyBuildings: { enabled: boolean, targets: { player: number, building: number }[] }
  conquerPositions: { enabled: boolean, positions: { enabled: boolean, x: number, y: number }[] }
  survive: { enabled: boolean, durations: number[] }
  produceGoods: { enabled: boolean, goals: { amount: number, good: number }[] }
}

/**
 * Translates decoded original victory records for one player. Only records whose
 * meaning is supported become objectives; the rest are reported. The record
 * semantics follow the reference remake reader and remain unverified (S3-006).
 */
export function missionFromVictory(victory: OriginalVictory, player: number, numbering: Map<number, number>, goodNames: (code: number) => string | null): { definition: MissionDefinition, unsupported: string[] } {
  const objectives: Objective[] = [], triggers: Trigger[] = [], unsupported: string[] = []
  if (victory.killPlayers.enabled) {
    victory.killPlayers.players.forEach((target, original) => {
      if (!target) return
      const n = numbering.get(original)
      if (!n) { unsupported.push(`defeat original player ${original}, who is not in this session`); return }
      objectives.push({ id: `defeat-${n}`, player, text: `Defeat player ${n}` })
      triggers.push({ id: `defeat-${n}`, when: { kind: 'player-defeated', player: n }, then: [{ kind: 'complete-objective', objective: `defeat-${n}` }] })
    })
  }
  if (victory.conquerPositions.enabled) {
    victory.conquerPositions.positions.forEach((p, i) => {
      if (!p.enabled) return
      objectives.push({ id: `conquer-${i}`, player, text: `Take the position at ${p.x}, ${p.y}` })
      triggers.push({ id: `conquer-${i}`, when: { kind: 'tile-owned', player, x: p.x, y: p.y }, then: [{ kind: 'complete-objective', objective: `conquer-${i}` }] })
    })
  }
  if (victory.produceGoods.enabled) {
    victory.produceGoods.goals.forEach((g, i) => {
      const good = goodNames(g.good)
      if (!good || g.amount < 1) { unsupported.push(`produce goods goal ${i} uses good ${g.good}`); return }
      objectives.push({ id: `produce-${i}`, player, text: `Stock ${g.amount} ${good}` })
      triggers.push({ id: `produce-${i}`, when: { kind: 'goods-at-least', player, good, amount: g.amount }, then: [{ kind: 'complete-objective', objective: `produce-${i}` }] })
    })
  }
  if (victory.destroyBuildings.enabled) unsupported.push('destroy-buildings goals need decoded building identities (S3-006)')
  if (victory.survive.enabled) unsupported.push('survive goals have unverified duration units (S3-006)')
  if (objectives.length) triggers.push({ id: 'victory', when: { kind: 'all', of: objectives.map(o => ({ kind: 'objective-complete' as const, objective: o.id })) }, then: [{ kind: 'victory', player }] })
  return { definition: { id: 'original-victory', version: 1, objectives, triggers }, unsupported }
}

export const missionOf = (state: State): MissionState | null => state.mission
