import type { Point } from './geometry'
import type { PlayerView, Session } from './session'
import type { RulesProfile } from './rules'
import type { Command, CommandResult, PlayerSettings } from './state'
import { area, distance, indexOf, neighbours } from './geometry'

// A computer player is a client like any other: it reads what its player may
// know and submits ordinary commands. It never touches simulation state, so it
// cannot conjure workers or goods, and its orders replay like a person's.

/** What a computer player may know: its view plus explored terrain and objects. Deposits come only from its own survey signs. */
export interface Observation {
  view: PlayerView, player: number, width: number, height: number
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

export interface EconomicAI { player: number, interval: number, decide: (o: Observation) => Order[], results: CommandResult[] }

/**
 * An economic computer player: at most two construction sites at a time, built
 * in policy order near the resources it has seen, plus one geologist sent to
 * the nearest owned mountain. Difficulty is this declared policy and cadence.
 */
export function economicAI(player: number, options: { interval?: number, maxSites?: number } = {}): EconomicAI {
  const interval = options.interval ?? 80, maxSites = options.maxSites ?? 2
  // Decisions derive only from the observation, never from memory, so a restored game decides the same way.
  const ai: EconomicAI = {
    player, interval, results: [],
    decide(o) {
      const orders: Order[] = []
      const sites = o.view.buildings.filter(b => b.owner === o.player && b.phase !== 'active').length
      // Survey owned mountains until coal and iron are known: the first geologist is equipped with a hammer,
      // later surveys reuse a geologist whose duty is done.
      const geologists = o.view.settlers.filter(s => s.owner === o.player && s.profession === 'geologist')
      const idle = geologists.some(s => s.diagnostic === 'duty complete')
      const surveyedTiles = new Set(o.view.signs.map(sign => sign.tile))
      const missing = ['coal', 'ironore'].some(good => !o.view.signs.some(sign => sign.good === good && sign.amount > 0))
      if (missing && (geologists.length === 0 ? (o.view.goods.hammer ?? 0) > 0 : idle)) {
        const mountain = find(o, t => o.terrain(t) === 'mountain' && !surveyedTiles.has(t), 1)[0]
        if (mountain) orders.push({ type: 'specialists', profession: 'geologist', ...mountain, count: 1 })
      }
      // Recovery: once goods can be stored, store materials and tools so full doorsteps do not stop production.
      if (own(o, 'storage') > 0 && STORED.some(g => !o.settings.stored.includes(g))) orders.push({ type: 'settings', settings: { stored: [...new Set([...o.settings.stored, ...STORED])] } })
      if (sites >= maxSites) return orders
      const have = (type: string): number => own(o, type)
      for (const want of POLICY) {
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
