import type { Point } from './geometry'
import type { PlayerView, Session } from './session'
import type { RulesProfile } from './rules'
import type { Command, CommandResult, PlayerSettings } from './state'
import { area, DIRECTIONS, distance, indexOf, neighbours } from './geometry'

// A computer player is a client like any other: it reads what its player may
// know and submits ordinary commands. It never touches simulation state, so it
// cannot conjure workers or goods, and its orders replay like a person's.

/** What a computer player may know: its view plus explored terrain and objects. Deposits come only from its own survey signs. */
export interface Observation {
  view: PlayerView, player: number, width: number, height: number
  /** Ticks between this player's decisions, when a computer player observes. */
  interval?: number
  /** The player's own settings, which any player can read in their menus. */
  settings: PlayerSettings
  /** The rules every player plays by. */
  rules: RulesProfile
  explored: (tile: number) => boolean
  terrain: (tile: number) => string | null
  object: (tile: number) => string | null
  placement: (type: string, x: number, y: number) => string | null
}

export function observe(session: Session, player: number): Observation {
  const view = session.view(player), { map } = session.state, rules = session.rules
  const explored = (t: number): boolean => view.explored[t] === 1
  return {
    view, player, width: map.width, height: map.height, explored, settings: structuredClone(session.state.players[player - 1]!.settings), rules,
    terrain: t => (explored(t) ? rules.terrain[map.terrain[t]!]!.id : null),
    // Objects on explored tiles are what the player last saw there; the engine keeps no separate memory yet.
    object: t => (explored(t) && map.object[t] ? rules.objects[map.object[t]! - 1]!.id : null),
    placement: (type, x, y) => session.placement(player, type, x, y),
  }
}

type Order = Omit<Command, 'tick' | 'player' | 'seq'>
interface Want { building: string, count: number, near: (o: Observation) => Point[], when?: (o: Observation, have: (type: string) => number) => boolean }

const own = (o: Observation, type: string): number => o.view.buildings.filter(b => b.owner === o.player && b.type === type).length
const home = (o: Observation): Point[] => {
  const b = o.view.buildings.find(b => b.owner === o.player && (b.type === 'castle' || b.type === 'small-tower'))
  return b ? [{ x: b.x, y: b.y }] : []
}
/** Every owned military building, castle first: large buildings search for room around each. */
const holdings = (o: Observation): Point[] => o.view.buildings.filter(b => b.owner === o.player && (b.type === 'castle' || b.type === 'small-tower')).map(b => ({ x: b.x, y: b.y }))
/** Owned, explored tiles matching a test, nearest the settlement first. */
function find(o: Observation, test: (t: number) => boolean, limit = 6): Point[] {
  const center = home(o)[0]
  if (!center) return []
  const found: Point[] = []
  for (const t of area({ width: o.width, height: o.height }, center, 30)) if (o.view.owner[t] === o.player && test(t)) found.push({ x: t % o.width, y: Math.floor(t / o.width) })
  return found.sort((a, b) => distance(a, center) - distance(b, center) || a.y - b.y || a.x - b.x).slice(0, limit)
}
const signs = (o: Observation, good: string): Point[] => o.view.signs.filter(s => s.good === good && s.amount > 0 && o.view.owner[s.tile] === o.player).map(s => ({ x: s.tile % o.width, y: Math.floor(s.tile / o.width) }))

/** The declared build policy, in priority order. Engineering choice, not the original AI. */
const POLICY: Want[] = [
  { building: 'woodcutter', count: 2, near: o => find(o, t => o.object(t) === 'tree') },
  { building: 'stonecutter', count: 1, near: o => find(o, t => o.object(t) === 'stone') },
  { building: 'sawmill', count: 1, near: home },
  { building: 'forester', count: 1, near: o => find(o, t => o.object(t) === 'tree'), when: (_o, have) => have('woodcutter') > 0 },
  { building: 'small-residence', count: 1, near: home, when: (o, have) => have('sawmill') > 0 && (o.view.professions.carrier ?? 0) < 20 },
  { building: 'fisher', count: 1, near: o => find(o, t => o.terrain(t) === 'water'), when: (_o, have) => have('sawmill') > 0 },
  { building: 'waterworks', count: 1, near: o => find(o, t => o.terrain(t) === 'water'), when: (_o, have) => have('fisher') > 0 },
  { building: 'grain-farm', count: 1, near: holdings, when: (_o, have) => have('waterworks') > 0 },
  { building: 'mill', count: 1, near: holdings, when: (_o, have) => have('grain-farm') > 0 },
  { building: 'bakery', count: 1, near: holdings, when: (_o, have) => have('mill') > 0 },
  { building: 'coal-mine', count: 1, near: o => signs(o, 'coal') },
  { building: 'iron-mine', count: 1, near: o => signs(o, 'ironore') },
  { building: 'iron-smelter', count: 1, near: holdings, when: (_o, have) => have('coal-mine') > 0 && have('iron-mine') > 0 },
  { building: 'toolsmith', count: 1, near: holdings, when: (_o, have) => have('iron-smelter') > 0 },
  { building: 'storage', count: 1, near: holdings, when: o => o.view.buildings.some(b => b.owner === o.player && b.shortage === 'output-full') },
  { building: 'small-residence', count: 3, near: holdings, when: (o, have) => have('bakery') > 0 && (o.view.professions.carrier ?? 0) < 25 },
]

export interface EconomicAI {
  player: number, interval: number, decide: (o: Observation) => Order[], results: CommandResult[]
  /** What held the economy back at the last decision, and whether a legal action can still free it. For display and tests only. */
  diagnosis: Diagnosis[]
}

/**
 * One reason the computer's economy is held back, read from its own view. Kinds
 * follow the issue's shortages: tools, food, population, delivery, exhausted
 * working areas, and building materials. A recovery is the ordinary command the
 * computer gives for it; an unrecoverable state is one no legal action can free.
 */
export interface Diagnosis {
  kind: 'tool' | 'food' | 'population' | 'delivery' | 'exhausted' | 'materials'
  building: number, detail: string
  recovery: Order | null
  recoverable: boolean
}

const HARVESTERS = new Set(['woodcutter', 'stonecutter', 'fisher', 'coal-mine', 'iron-mine', 'gold-mine'])
/** Goods any player can hand out: loose piles, doorsteps and storage, not what sites and inputs already hold. */
const free = (o: Observation, good: string): number => o.view.stacks.filter(st => st.owner === o.player && st.good === good && (st.role === 'ground' || st.role === 'output' || st.role === 'storage')).reduce((n, st) => n + st.amount, 0)

/**
 * Reads the computer's view for deadlocks and chooses one legal recovery for each:
 * an urgent order for a missing tool, a fisher for hungry mines, residences for
 * missing workers, storage for full doorsteps, demolition of a building whose
 * working area is used up, and demolition of idle buildings when their refund is
 * the only way left to pay for a sawmill or woodcutter. With no planks, logs or
 * refunds left to build those, the economy is recognised as unrecoverable.
 */
export function diagnose(o: Observation): Diagnosis[] {
  const found: Diagnosis[] = [], mine = o.view.buildings.filter(b => b.owner === o.player)
  const rules = new Map(o.rules.buildings.map(b => [b.id, b])), active = (type: string): boolean => mine.some(b => b.type === type && b.phase === 'active')
  const urgent = new Set(o.settings.urgentTools)
  for (const b of mine) {
    const shortage = b.shortage
    if (!shortage) continue
    if (shortage.startsWith('tool:')) {
      // A tool lying free will be fetched; otherwise only a working smith can make one. A smith that lacks
      // its own tool cannot, so with no other smith and none lying free that building can never be staffed.
      const tool = shortage.slice(5), spare = free(o, tool) > 0
      const makers = mine.filter(m => m.phase === 'active' && m.id !== b.id && rules.get(m.type)?.workflow.kind === 'craft' && (rules.get(m.type)!.workflow as { choices: string[] }).choices.includes(tool))
      // Other buildings can wait for a smith to be built or staffed, unless the smith itself lacks a hammer for good.
      const later = b.type !== 'toolsmith' && (free(o, 'hammer') > 0 || !mine.some(m => m.type === 'toolsmith' && m.shortage === 'tool:hammer'))
      found.push({ kind: 'tool', building: b.id, detail: `needs ${tool}`, recovery: !spare && makers.length && !urgent.has(tool) ? { type: 'urgent-tool', tool } : null, recoverable: spare || makers.length > 0 || later })
      urgent.add(tool)
    }
    else if (shortage === 'food') found.push({ kind: 'food', building: b.id, detail: 'miners have no food', recovery: null, recoverable: true })
    else if (shortage === 'carriers' || shortage === 'settlers') found.push({ kind: 'population', building: b.id, detail: shortage === 'carriers' ? 'too few carriers to spare' : 'no free settlers', recovery: null, recoverable: true })
    else if (shortage === 'output-full') found.push({ kind: 'delivery', building: b.id, detail: 'doorstep full', recovery: null, recoverable: true })
    else if ((shortage === 'no-resources' || shortage === 'exhausted') && HARVESTERS.has(b.type)) {
      // Foresters replant around woodcutters, so a woodcutter waits while one stands.
      const waits = b.type === 'woodcutter' && active('forester')
      found.push({ kind: 'exhausted', building: b.id, detail: `${rules.get(b.type)?.name ?? b.type} has nothing left to work`, recovery: waits ? null : { type: 'demolish', building: b.id }, recoverable: true })
    }
  }
  // Building materials: planks come only from a sawmill fed by woodcutters, and both cost planks to build.
  const planks = free(o, 'plank'), logs = free(o, 'log'), [num, den] = o.rules.demolition.refundFraction
  const wood = active('sawmill') && (logs > 0 || active('woodcutter'))
  if (!wood) {
    const missing = ['sawmill', ...(logs > 0 ? [] : ['woodcutter'])].filter(t => !active(t))
    const need = missing.reduce((n, t) => n + Math.max(0, (rules.get(t)?.cost.plank ?? 0) - stocked(o, t)), 0)
    // Refunds: half the cost of active buildings, everything already delivered to unfinished sites.
    // The wood chain itself, the castle and military buildings are never torn down for planks.
    const spare = mine.filter(b => !['castle', 'woodcutter', 'forester', 'sawmill'].includes(b.type) && !rules.get(b.type)?.military)
      .map(b => ({ id: b.id, planks: b.phase === 'active' ? Math.floor((rules.get(b.type)?.cost.plank ?? 0) * num / den) : constructionPlanks(o, b.id) }))
      .filter(b => b.planks > 0).sort((a, b) => b.planks - a.planks || a.id - b.id)
    if (planks >= need) { /* Enough planks: the build policy places the missing producer. */ }
    else if (planks + spare.reduce((n, b) => n + b.planks, 0) >= need) found.push({ kind: 'materials', building: spare[0]!.id, detail: `${need} planks needed for ${missing.join(' and ')}; tearing down for its refund`, recovery: { type: 'demolish', building: spare[0]!.id }, recoverable: true })
    else found.push({ kind: 'materials', building: 0, detail: `${need} planks needed for ${missing.join(' and ')} and no planks, logs or refunds remain`, recovery: null, recoverable: false })
  }
  return found
}
/** Planks already delivered to the computer's own unfinished sites of a type. */
const stocked = (o: Observation, type: string): number => o.view.buildings.filter(b => b.owner === o.player && b.type === type && b.phase !== 'active').reduce((n, b) => n + constructionPlanks(o, b.id), 0)
const constructionPlanks = (o: Observation, building: number): number => o.view.stacks.filter(st => st.building === building && st.role === 'construction' && st.good === 'plank').reduce((n, st) => n + st.amount, 0)

/**
 * Declared military difficulty: how many soldiers the computer gathers before it
 * attacks a military building it can see, and how often it sends a scout toward
 * land it has not explored. Engineering choices, not the original AI (S3-072).
 */
export interface MilitaryPolicy { attackAt: number, scoutEvery: number }

/** Weapons, a barracks and storage for the new goods, after the economy that feeds them. */
const ARMS: Want[] = [
  { building: 'weaponsmith', count: 1, near: holdings, when: (_o, have) => have('iron-smelter') > 0 && have('toolsmith') > 0 },
  { building: 'barracks', count: 1, near: holdings, when: (_o, have) => have('weaponsmith') > 0 },
]
const MILITARY_STORED = ['spear', 'bow']

/**
 * Military decisions from the observation alone: recruit automatically once a
 * barracks stands, meet visible enemy soldiers on its own land, scout toward
 * unexplored land, and attack the nearest enemy military building it can see
 * once its army is large enough. Every decision is an ordinary command.
 */
export function militaryOrders(o: Observation, policy: MilitaryPolicy): Order[] {
  const orders: Order[] = [], { view } = o
  const at = (p: Point): number => indexOf(o, p.x, p.y)
  if (own(o, 'barracks') > 0 && !o.settings.recruit?.automatic) orders.push({ type: 'settings', settings: { recruitAutomatic: true } })
  const mine = view.settlers.filter(s => s.owner === o.player && s.rank !== undefined)
  if (!mine.length) return orders
  const outside = mine.filter(s => !s.inside), ready = outside.filter(s => s.action !== 'walking')
  const center = home(o)[0] ?? { x: mine[0]!.x, y: mine[0]!.y }
  // Defence: enemy soldiers seen on its own land are met where they stand.
  const intruders = view.settlers.filter(s => s.owner !== o.player && s.rank !== undefined && !s.inside && view.owner[at(s)] === o.player)
    .sort((a, b) => distance(a, center) - distance(b, center) || a.id - b.id)
  // Soldiers standing ready go first; otherwise garrisons send all but their last soldier.
  if (intruders.length) { orders.push({ type: 'move-soldiers', soldiers: (ready.length ? ready : mine).map(s => s.id), x: intruders[0]!.x, y: intruders[0]!.y }); return orders }
  // Attack: only buildings the player currently sees are in its view at all.
  const rules = new Map(o.rules.buildings.map(b => [b.id, b]))
  const targets = view.buildings.filter(b => b.owner !== o.player && b.phase === 'active' && rules.get(b.type)?.garrison)
    .sort((a, b) => distance(a, center) - distance(b, center) || a.id - b.id)
  if (targets.length && mine.length >= policy.attackAt) { orders.push({ type: 'attack', soldiers: mine.map(s => s.id), building: targets[0]!.id }); return orders }
  // Scouting: one soldier walks toward the nearest unexplored land in a direction that turns with time.
  if (!targets.length && view.tick % policy.scoutEvery < (o.interval ?? 1)) {
    const scout = (ready.length ? ready : mine).sort((a, b) => a.id - b.id)[0]!
    const [dx, dy] = DIRECTIONS[Math.floor(view.tick / policy.scoutEvery) % 6]!
    for (let step = 1; step < Math.max(o.width, o.height); step++) {
      const x = center.x + dx * step, y = center.y + dy * step
      if (x < 0 || y < 0 || x >= o.width || y >= o.height) break
      if (!o.explored(indexOf(o, x, y))) { orders.push({ type: 'move-soldiers', soldiers: [scout.id], x, y }); break }
    }
  }
  return orders
}

/**
 * An economic computer player: at most two construction sites at a time, built
 * in policy order near the resources it has seen, plus one geologist sent to
 * the nearest owned mountain. Difficulty is this declared policy and cadence.
 */
export function economicAI(player: number, options: { interval?: number, maxSites?: number, military?: MilitaryPolicy } = {}): EconomicAI {
  const interval = options.interval ?? 80, maxSites = options.maxSites ?? 2
  const policy = options.military ? [...POLICY, ...ARMS] : POLICY, stored = options.military ? [...STORED, ...MILITARY_STORED] : STORED
  // Decisions derive only from the observation, never from memory, so a restored game decides the same way.
  const ai: EconomicAI = {
    player, interval, results: [], diagnosis: [],
    decide(o) {
      const orders: Order[] = []
      // Deadlock recovery comes first: each diagnosis gives at most one ordinary command.
      const diagnosis = diagnose(o)
      ai.diagnosis = diagnosis
      for (const d of diagnosis) if (d.recovery) orders.push(d.recovery)
      const hungry = diagnosis.some(d => d.kind === 'food'), shortHanded = diagnosis.some(d => d.kind === 'population'), blockedDelivery = diagnosis.some(d => d.kind === 'delivery')
      const sites = o.view.buildings.filter(b => b.owner === o.player && b.phase !== 'active').length
      // Survey owned mountains until coal and iron are known: the first geologist is equipped with a hammer,
      // later surveys reuse a geologist whose duty is done.
      const geologists = o.view.settlers.filter(s => s.owner === o.player && s.profession === 'geologist')
      const idle = geologists.some(s => s.diagnostic === 'duty complete')
      const surveyedTiles = new Set(o.view.signs.map(sign => sign.tile))
      const missing = ['coal', 'ironore'].some(good => !o.view.signs.some(sign => sign.good === good && sign.amount > 0))
      // A hammer a building is waiting for is not taken for a geologist: count unstaffed buildings whose worker uses one.
      const tools = new Map(o.rules.professions.map(p => [p.id, p.tool])), workers = new Map(o.rules.buildings.map(b => [b.id, b.worker]))
      const awaited = o.view.buildings.filter(b => b.owner === o.player && !b.worker && (b.phase !== 'active' || tools.get(workers.get(b.type) ?? '') === 'hammer')).length
      if (missing && own(o, 'sawmill') > 0 && o.view.buildings.some(b => b.owner === o.player && b.type === 'sawmill' && b.phase === 'active') && (geologists.length === 0 ? (o.view.goods.hammer ?? 0) > awaited : idle)) {
        const mountain = find(o, t => o.terrain(t) === 'mountain' && !surveyedTiles.has(t), 1)[0]
        if (mountain) orders.push({ type: 'specialists', profession: 'geologist', ...mountain, count: 1 })
      }
      // Recovery: once goods can be stored, store materials and tools so full doorsteps do not stop production.
      if (own(o, 'storage') > 0 && stored.some(g => !o.settings.stored.includes(g))) orders.push({ type: 'settings', settings: { stored: [...new Set([...o.settings.stored, ...stored])] } })
      if (options.military) orders.push(...militaryOrders({ ...o, interval }, options.military))
      // Nothing can be built once materials are unrecoverable, so the computer orders no sites it cannot pay for.
      if (sites >= maxSites || diagnosis.some(d => d.kind === 'materials' && !d.recoverable)) return orders
      const have = (type: string): number => own(o, type)
      // Hungry mines put the fisher first, and buildings without workers put a residence first, whatever the usual order.
      const timber: Want[] = !o.view.buildings.some(b => b.owner === o.player && b.type === 'sawmill') && (have('woodcutter') > 0 || free(o, 'log') > 0) ? [{ building: 'sawmill', count: 1, near: home }] : []
      const ordered = [...timber, ...(blockedDelivery ? [{ building: 'storage', count: 1, near: holdings }] : []), ...(hungry ? [{ building: 'fisher', count: 1, near: (o: Observation) => find(o, t => o.terrain(t) === 'water') }] : []), ...(shortHanded ? [{ building: 'small-residence', count: 4, near: holdings }] : []), ...policy]
      for (const want of ordered as Want[]) {
        if (have(want.building) >= want.count || (want.when && !want.when(o, have))) continue
        const anchors = want.near(o)
        const site = placeNear(o, want.building, anchors)
        if (site) { orders.push({ type: 'build', building: want.building, ...site }); break }
        // Recovery: a needed resource lies outside the border, so push the border toward it with a tower.
        const need = NEEDS[want.building]
        // Unknown resources are sought by towers in a fixed rotation of directions, which also widens sight.
        const center = home(o)[0]
        const rotation = [[1, 0], [1, 1], [0, 1], [-1, 0], [-1, -1], [0, -1]][have('small-tower') % 6]!
        const explore = center ? { x: Math.max(0, Math.min(o.width - 1, center.x + rotation[0]! * 30)), y: Math.max(0, Math.min(o.height - 1, center.y + rotation[1]! * 30)) } : undefined
        const target = !anchors.length && need ? beyond(o, need(o))[0] ?? explore : undefined
        if (target && have('small-tower') < 4 && !o.view.buildings.some(b => b.owner === o.player && b.type === 'small-tower' && b.phase !== 'active')) {
          const tower = placeNear(o, 'small-tower', borderToward(o, target))
          if (tower) { orders.push({ type: 'build', building: 'small-tower', ...tower }); break }
        }
      }
      return orders
    },
  }
  return ai
}

/** Explored tiles outside the border that would serve a want, nearest the settlement first. */
function beyond(o: Observation, test: (t: number) => boolean): Point[] {
  const center = home(o)[0]
  if (!center) return []
  const found: Point[] = []
  for (const t of area({ width: o.width, height: o.height }, center, 40)) if (o.view.owner[t] !== o.player && test(t)) found.push({ x: t % o.width, y: Math.floor(t / o.width) })
  return found.sort((a, b) => distance(a, center) - distance(b, center) || a.y - b.y || a.x - b.x).slice(0, 3)
}
/** Owned tiles at the border nearest a target, where a tower would push the border toward it. */
function borderToward(o: Observation, target: Point): Point[] {
  const edge: Point[] = []
  for (const t of area({ width: o.width, height: o.height }, target, 40)) {
    if (o.view.owner[t] !== o.player) continue
    const x = t % o.width, y = Math.floor(t / o.width)
    if (neighbours({ width: o.width, height: o.height }, t).some(n => o.view.owner[n] !== o.player)) edge.push({ x, y })
  }
  // Step a few tiles back from the edge so the tower's own footprint stays inside the border.
  return edge.sort((a, b) => distance(a, target) - distance(b, target) || a.y - b.y || a.x - b.x).slice(0, 4).map(p => ({ x: Math.round(p.x + (home(o)[0]!.x - p.x) * 0.25), y: Math.round(p.y + (home(o)[0]!.y - p.y) * 0.25) }))
}

const STORED = ['log', 'plank', 'stone', 'coal', 'ironore', 'goldore', 'iron', 'gold', 'hammer', 'shovel', 'axe', 'saw', 'pickaxe', 'scythe', 'fishingrod', 'sword']
/** Resources a want depends on, so the AI can expand toward them when none lie inside its border. */
const NEEDS: Record<string, (o: Observation) => (t: number) => boolean> = {
  woodcutter: o => t => o.object(t) === 'tree', stonecutter: o => t => o.object(t) === 'stone',
  fisher: o => t => o.terrain(t) === 'water', waterworks: o => t => o.terrain(t) === 'water',
}

function placeNear(o: Observation, type: string, anchors: Point[]): Point | null {
  // Harvesting and extracting buildings must have their resource within their working radius.
  const workflow = o.rules.buildings.find(b => b.id === type)?.workflow
  const need = NEEDS[type]?.(o)
  const radius = workflow && 'radius' in workflow ? workflow.radius : 0
  const serves = (x: number, y: number): boolean => !need || !radius || area({ width: o.width, height: o.height }, { x, y }, radius).some(t => need(t))
  for (const anchor of anchors) {
    for (let r = 0; r <= 14; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const x = anchor.x + dx, y = anchor.y + dy
          if (x < 0 || y < 0 || x >= o.width || y >= o.height || !o.explored(indexOf(o, x, y))) continue
          if (!o.placement(type, x, y) && serves(x, y)) return { x, y }
        }
      }
    }
  }
  return null
}

/** Runs a computer player's decisions on its cadence by enqueuing ordinary commands for the current tick. */
export function stepAI(session: Session, ai: EconomicAI, sequence: { next: number }): void {
  if (session.state.tick % ai.interval !== 0) return
  for (const order of ai.decide(observe(session, ai.player))) {
    const rejected = session.enqueue({ ...order, tick: session.state.tick, player: ai.player, seq: sequence.next++ } as Command)
    if (rejected) ai.results.push(rejected)
  }
}
