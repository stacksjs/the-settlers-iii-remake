import type { PlayerSlotCatalog } from './player-colors'
import { DEFAULT_PLAYER_SLOTS, playerSlotsForContent } from './player-colors'
import type { BrowserPlatform } from 'craft-native/browser'
import type { Command, Point, Session } from './engine'
import type { Renderer } from './renderer'
import { useAnimationFrame } from '@stacksjs/stx/composables'
import { createBrowserPlatform } from 'craft-native/browser'
import { loadOriginalAssets } from './assets'
import type { Checkpoints } from './checkpoint'
import { createCheckpoints } from './checkpoint'
import type { EconomicAI } from './engine'
import { createSession, DEFAULT_START, economicAI, findBuildingSite, findStart, generateMap, observe, PUBLISHED_RULES, restore, ROMAN_ENGINEERING, save, SaveError, statistics, stepAI, surveyedMineForecast, worldFromOriginal } from './engine'
import { loadOriginalMap } from './maps'
import { createRenderer } from './renderer'
import { scene } from './scene'
import type { MinimapOptions } from './minimap'
import { alertTarget, fromMinimap, minimapPixels, minimapSize, toMinimap } from './minimap'
import { BUILDING_MENU } from './menus'
import { createTroops } from './troops'
import { RIVAL_MISSION } from './skirmish'
import { validateMapSeed } from './setup'
import { prepareDemolition } from './demolition'

const rules = ROMAN_ENGINEERING
export const PLAYER = 1
// Checkpoints live in two slots plus a head under this prefix; the earlier single-key save is still read.
const SAVE_PREFIX = 'gold-checkpoint'
const LEGACY_SAVE_KEY = 'gold-session'
const PROTOTYPE_KEY = 'campaign'
const MAP_SIZE = 96

/** Building catalog for the control center, grouped as the manual groups the build menu. */
export const catalog = rules.buildings.filter(b => b.id !== 'castle').map(b => ({
  id: b.id, name: b.name, category: b.category, menu: BUILDING_MENU[b.id] ?? 'misc',
  cost: Object.entries(b.cost).map(([good, n]) => `${n} ${good}`).join(' + '),
  description: describe(b.id),
}))
export const categories = [...new Set(catalog.map(item => item.category))]
export const goods = rules.goods

function describe(id: string, profile = rules): string {
  const b = profile.buildings.find(r => r.id === id)!, w = b.workflow
  if (b.storage) return `Stores up to ${b.storage.piles} piles of ${b.storage.capacity} goods marked for storage.`
  if (b.residents) return `Houses ${b.residents.count} new settlers, who arrive one at a time.`
  if (b.garrison) return `Claims land within ${b.territory} tiles and holds ${b.garrison.infantry} infantry and ${b.garrison.bowmen} bowmen.`
  if (!b.military && !b.territory && b.vision > 24) return `Watches over the land within ${b.vision} tiles; it claims none.`
  if (b.id === 'barracks') return 'Turns carriers into soldiers with the swords, spears and bows delivered here.'
  if (b.temple === 'small') return 'Turns each delivered wine into manna, one offering at a time. Manna buys promotions.'
  if (b.temple === 'large') return 'Pleases Jupiter once with manna when completed and brings a priest every five minutes.'
  if (w.kind === 'cultivate' && w.slope) return `A ${b.worker} plants vines on slopes within ${w.radius} tiles and presses ripe grapes into ${w.output}.`
  if (b.territory) return `Claims land within ${b.territory} tiles once completed.`
  if (w.kind === 'harvest') return `A ${b.worker} fetches ${w.object === 'tree' ? 'trees' : 'stone'} within ${w.radius} tiles and returns ${w.output}.`
  if (w.kind === 'plant') return `A ${b.worker} plants saplings within ${w.radius} tiles.`
  if (w.kind === 'cultivate') return `A ${b.worker} sows fields and harvests ripe ${w.output}.`
  if (w.kind === 'extract') return w.food ? `A miner digs ${w.output} from the deposit below. Prefers ${w.food.preferred}.` : w.resource === 'water' ? 'A waterworker collects fresh water from rivers in the working area.' : 'A fisher catches fish from sea water in the working area.'
  if (w.kind === 'process') return `Turns ${Object.keys(w.inputs).join(' and ')} into ${Object.keys(w.outputs).join(' and ')}.`
  if (w.kind === 'craft') return `Forges ${b.id === 'weaponsmith' ? 'swords, spears and bows' : w.choices.length > 1 ? 'tools' : w.choices[0]} from iron and coal.`
  return b.name
}

const STATUS: Record<string, string> = {
  'leveling': 'Diggers are levelling the site', 'building': 'Builders are at work', 'suspended': 'Work paused', 'inputs': 'Waiting for supplies', 'output-full': 'Doorstep full',
  'no-resources': 'Nothing left in the working area', 'no-space': 'No room to plant', 'exhausted': 'Deposit exhausted', 'food': 'Miners need food', 'carriers': 'Too few carriers to spare', 'settlers': 'No free settlers', 'crew-limit': 'Construction crew limit reached', 'unreachable': 'No free worker can reach this workplace',
}
const article = (word: string): string => `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`
export function status(phase: string, shortage: string | null, suspended: boolean, worker: boolean, needsWorker: boolean): string {
  if (suspended) return STATUS.suspended!
  if (phase !== 'active') return shortage?.startsWith('tool:') ? `Needs ${article(shortage.slice(5))} for its crew` : STATUS[phase]!
  if (shortage?.startsWith('tool:')) return `Needs ${article(shortage.slice(5))}`
  if (shortage) return STATUS[shortage] ?? shortage
  if (needsWorker && !worker) return 'Waiting for a worker'
  return needsWorker ? 'Working' : 'Ready'
}

export const DEFAULT_MINIMAP: MinimapOptions = { territory: 'players', settlers: 'all', buildings: true }

export function snapshot(session: Session | null, selected: number | null, message: string, speed: number, tool: string | null = null, sound = false, ready = false, marked = 0, me = PLAYER) {
  if (!session) return { match: null as MatchStatus | null, rulesVersion: rules.version, canReassignCrew: rules.constructionReassignment === 'surplus-idle', production: [] as { key: string, stock: number, produced: number, consumed: number }[], distribution: [] as { good: string, types: { type: string, name: string, weight: number }[] }[], crafts: [] as { key: string, urgent: number, weight: number, weapon: boolean }[], transport: [] as { key: string, rank: number, stored: boolean }[], limits: { builders: 0, diggers: 0 }, minimap: DEFAULT_MINIMAP, marked, army: army(null, me), carried: 0, needs: [] as string[], objectives: [] as { id: string, text: string, status: string }[], outcome: 'playing', map: 'Generated landscape', seed: null as number | null, ready: false, message, speed, tool, sound, time: '0:00', population: 0, professions: [] as { name: string, count: number }[], goods: [] as { key: string, amount: number, stored: boolean }[], buildings: 0, carrierRatio: 0, selected: null as null | ReturnType<typeof inspect>, events: [] as { text: string, at: Point | null }[], prototypeKept: false }
  const view = session.view(me), player = session.state.players[me - 1]!
  const seconds = Math.floor(session.state.tick / rules.tickRate)
  return {
    ready, message, speed, tool, sound, marked, minimap: DEFAULT_MINIMAP,
    rulesVersion: session.rules.version, canReassignCrew: session.rules.constructionReassignment === 'surplus-idle',
    time: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
    population: view.population,
    professions: Object.entries(view.professions).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    goods: rules.goods.map(key => ({ key, amount: view.goods[key] ?? 0, stored: player.settings.stored.includes(key) })),
    buildings: view.buildings.filter(b => b.owner === me).length,
    carrierRatio: player.settings.carrierRatio,
    selected: selected ? inspect(session, selected, me) : null,
    // Alerts point at what they are about, where the player may look (manual: the Information Center).
    events: view.events.slice(-6).reverse().map(e => ({ text: e.text, at: alertTarget({ explored: t => view.explored[t] === 1, view, width: view.width }, e) })),
    prototypeKept: false,
    match: null as MatchStatus | null,
    map: mapName(session),
    seed: generatedSeed(session),
    objectives: view.mission?.objectives ?? [],
    outcome: view.mission?.outcome ?? 'playing',
    ...economy(session, me),
    army: army(session, me),
    ...controls(session, me),
  }
}

/** The Goods and Settlers menus' settings: urgent orders and priorities for smiths, transport order, and occupation limits. */
function controls(session: Session, me: number) {
  const settings = session.state.players[me - 1]!.settings, rules = session.rules
  const made = [...rules.tools, ...rules.professions.flatMap(p => p.soldier ? [p.soldier.weapon] : [])]
  return {
    crafts: made.map(key => ({ key, urgent: settings.urgentTools.filter(t => t === key).length, weight: settings.toolWeights[key] ?? 1, weapon: !rules.tools.includes(key) })),
    transport: settings.transportPriority.map((key, rank) => ({ key, rank: rank + 1, stored: settings.stored.includes(key) })),
    limits: { builders: settings.builderLimit, diggers: settings.diggerLimit },
    // Goods more than one kind of building uses, with each kind's share (manual: Distribution of Goods).
    distribution: rules.goods.map(good => ({ good, types: rules.buildings.filter(b => b.inputs[good]).map(b => ({ type: b.id, name: b.name, weight: settings.distribution?.[good]?.[b.id] ?? 1 })) })).filter(d => d.types.length > 1),
  }
}

/** Soldiers by class and rank, and the barracks orders that make more. */
function army(session: Session | null, me: number) {
  const classes = (session?.rules ?? rules).professions.filter(p => p.soldier).map(p => ({ name: p.id, weapon: p.soldier!.weapon }))
  if (!session) return { soldiers: classes.map(item => ({ ...item, weapons: 0, count: 0, queued: 0, rank: 1 })), outside: 0, ranks: rules.military?.ranks ?? 1, automatic: false, manna: 0, next: null as number | null, interventions: [] as { id: string, name: string, cost: number }[], priests: 0 }
  const player = session.state.players[me - 1]!, own = [...session.state.settlers.values()].filter(s => s.owner === me && s.soldier)
  // The manual's recruitment figures count weapons delivered to barracks,
  // not warehouse stock, goods still being carried, or equipped soldiers.
  const weapons = new Map<string, number>()
  for (const stack of session.state.stacks.values()) {
    const building = session.state.buildings.get(stack.building)
    if (stack.owner === me && stack.role === 'input' && building?.owner === me && building.type === 'barracks')
      weapons.set(stack.good, (weapons.get(stack.good) ?? 0) + stack.amount)
  }
  // Profiles with religion buy ranks with manna; older saved games keep the rank setting they were made with.
  const religion = session.view(me).religion
  return {
    soldiers: classes.map(({ name, weapon }) => ({ name, weapon, weapons: weapons.get(weapon) ?? 0, count: own.filter(s => s.profession === name).length, queued: player.settings.recruit?.queue[name] ?? 0, rank: religion?.ranks[name] ?? player.settings.rank ?? 1 })),
    outside: own.filter(s => !s.inside).length,
    ranks: session.rules.military?.ranks ?? 1,
    automatic: player.settings.recruit?.automatic ?? false,
    manna: religion?.manna ?? 0, next: religion ? religion.next : null,
    interventions: religion?.interventions ?? [],
    priests: [...session.state.settlers.values()].filter(s => s.owner === me && s.profession === session.rules.religion?.priest).length,
  }
}

/** Figures derived from the world: goods in carriers' hands and the shortages holding buildings back. */
function economy(session: Session, me: number): { carried: number, needs: string[], production: { key: string, stock: number, produced: number, consumed: number }[] } {
  const stats = statistics(session, me)
  return {
    production: session.rules.goods.map(key => ({ key, stock: stats.total[key] ?? 0, produced: stats.produced[key] ?? 0, consumed: stats.consumed[key] ?? 0 })),
    carried: Object.values(stats.stock.transit).reduce((a, n) => a + n, 0),
    needs: stats.shortages.map(s => `${rules.buildings.find(b => b.id === s.type)!.name}: ${status('active', s.shortage, false, true, true).toLowerCase()}`).slice(0, 6),
  }
}

/**
 * The reference indexes the whole protected building area for selection,
 * separately from blocked movement tiles. Storage centers remain passable.
 */
export function inspectBuildingAt(session: Session, player: number, point: Point): number | null {
  const { width, height } = session.state.map
  if (!Number.isInteger(point.x) || !Number.isInteger(point.y) || point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) return null
  for (const b of session.state.buildings.values()) {
    if (b.owner !== player) continue
    const rule = session.rules.buildings.find(r => r.id === b.type)!
    if ([...rule.footprint, ...rule.protected, rule.door].some(([x, y]) => b.x + x === point.x && b.y + y === point.y)) return b.id
  }
  return null
}

function inspect(session: Session, id: number, me: number) {
  const b = session.state.buildings.get(id)
  if (!b || b.owner !== me) return null
  const rule = session.rules.buildings.find(r => r.id === b.type)!
  const total = Object.values(rule.cost).reduce((a, n) => a + n, 0) || 1
  const worker = session.state.settlers.get(b.worker)
  return {
    id: b.id, type: b.type, name: rule.name, phase: b.phase, suspended: b.suspended, castle: b.type === 'castle',
    status: status(b.phase, b.shortage, b.suspended, !!worker, !!rule.worker),
    progress: b.phase === 'leveling' ? 0 : b.phase === 'building' ? (total - b.workRemaining) / total : 'work' in rule.workflow ? b.cycle / rule.workflow.work : 1,
    worker: worker ? `${worker.profession} #${worker.id}` : rule.worker ? 'none' : 'not needed',
    stocks: [...session.state.stacks.values()].filter(s => s.building === b.id).map(s => ({ role: s.role, good: s.good, amount: s.amount, capacity: s.capacity })),
    garrison: rule.garrison ? `${session.view(me).buildings.find(v => v.id === b.id)?.garrison ?? 0} of ${rule.garrison.infantry + rule.garrison.bowmen} soldiers inside` : null,
    workArea: 'radius' in rule.workflow ? { ...b.workArea, radius: rule.workflow.radius } : null,
    description: describe(b.type, session.rules),
  }
}
export type Snapshot = ReturnType<typeof snapshot>
export type Game = ReturnType<typeof mountGame>

export type Landscape = 'generated' | 'tutorial' | 'rival'
export const mapName = (session: Session | null): string => session?.identity.content.id.startsWith('demo:') ? 'Original tutorial map' : session?.identity.content.id.startsWith('rival') ? 'Computer rival' : session?.identity.content.id.startsWith('duel') ? 'Online duel' : 'Generated landscape'

function generatedSeed(session: Session): number | null {
  const { id, digest } = session.identity.content
  const seed = /^(generated|rival|duel)-/.test(id) ? /^seed:(\d+)$/.exec(digest) : null
  return seed ? Number(seed[1]) : null
}
const RIVAL_SIZE = 128
const RIVAL_GUARD: Record<string, number> = { swordsman: 4, bowman: 2 }
/** The rival's declared military difficulty. */
export const RIVAL_MILITARY = { attackAt: 8, scoutEvery: 1600, scoutParty: 3 }

/** Two Roman settlements on a wider generated landscape; the second is the economic computer player. */
export function rivalSession(seed: number): Session {
  const map = generateMap(rules, RIVAL_SIZE, RIVAL_SIZE, seed)
  const west = findStart(rules, map, { x: 34, y: 64 }, 10), east = findStart(rules, map, { x: 94, y: 64 }, 10)
  if (!west || !east || Math.abs(west.x - east.x) < 40) throw new Error('This landscape has no room for two settlements. Start another one.')
  // Both sides start with a small guard so the rival can scout and fight from the outset (unverified start, S3-074).
  const settlers = { ...DEFAULT_START.settlers, ...RIVAL_GUARD }
  return createSession({ rules, map, seed, mission: RIVAL_MISSION, players: [{ name: 'Rome', civilization: 'roman', start: west, settlers }, { name: 'Computer', civilization: 'roman', controller: 'computer', start: east, settlers }], content: { id: `rival-${RIVAL_SIZE}-elimination-v1`, digest: `seed:${seed}` } })
}

/** A Roman start on the Amazons demo's original T1 tutorial map. Its missions and AI are not yet played. */
export async function tutorialSession(seed: number): Promise<Session> {
  const asset = await loadOriginalMap('t1')
  const world = worldFromOriginal(rules, asset.input)
  if (!world.players.length) throw new Error('The original tutorial map has no Roman player.')
  return createSession({ rules, map: world.map, seed, players: world.players.slice(0, 1), piles: world.piles, content: { id: `demo:${asset.source.path}`, digest: asset.source.sha256 } })
}

/** A fresh development settlement on a generated landscape. Not an original map or campaign. */
export function newSession(seed: number): Session {
  const map = generateMap(rules, MAP_SIZE, MAP_SIZE, seed)
  // The castle's reference footprint and protected ring reach nine tiles from its origin.
  const start = findStart(rules, map, { x: MAP_SIZE / 2, y: MAP_SIZE / 2 }, 10)
  if (!start) throw new Error('This landscape has no room for a settlement. Start another one.')
  return createSession({ rules, map, seed, players: [{ name: 'Rome', civilization: 'roman', start }], content: { id: `generated-${MAP_SIZE}`, digest: `seed:${seed}` } })
}

/**
 * An online match as the controller sees it. The server owns the simulation and
 * publishes it as numbered turns; the controller runs the same turns on its own
 * copy so the picture is smooth and local, and asks for a fresh snapshot when
 * its copy ever disagrees with the server's checksum.
 */
export interface MatchTurn { n: number, from: number, ticks: number, commands: Command[], checksum: string }
export interface MatchLink {
  /** The seat this browser plays. */
  player: number
  /** Opens the live stream and resolves with the world as of the turn it is at. */
  open: (onTurn: (turn: MatchTurn) => void, onStatus: (connected: boolean) => void, onNotice: (text: string) => void) => Promise<{ envelope: unknown, turn: number }>
  /** The whole world again, after a gap or a disagreement. */
  resync: () => Promise<{ envelope: unknown, turn: number }>
  /** Sends one order. The server stamps whose it is and when it runs. */
  order: (type: string, fields: Record<string, unknown>) => Promise<void>
  close: () => void
}

/** How an online match stands from this copy's side: used by the page's sync badge and by the acceptance checks. */
export interface MatchStatus { turn: number, verified: number, resyncs: number, buildings: number, connected: boolean }

export interface MountOptions {
  /** A guest game runs the same simulation but never reads or writes the signed-in player's checkpoints. */
  guest?: boolean
  /** An online match: the server's turns drive the simulation instead of the local clock. */
  match?: MatchLink
}

export function mountGame(canvas: HTMLCanvasElement, update: (value: Snapshot) => void, reduceMotion: () => boolean, overview?: HTMLCanvasElement, options: MountOptions = {}) {
  const link = options.match, me = link?.player ?? PLAYER
  let session: Session | null = null, selected: number | null = null, tool: string | null = null, cursor: Point | null = null
  let speed = 1, message = 'Preparing original graphics and your settlement...', disposed = false, sound = false, soundPending = false
  let platform: BrowserPlatform | null = null, assetsReady = false, ready = false, elapsed = 0, sinceUpdate = 0, sinceSave = 0, accumulator = 0, seq = 0
  let playerCatalog: PlayerSlotCatalog = [], playerSlots: readonly number[] = DEFAULT_PLAYER_SLOTS
  let prototypeKept = false
  // Computer players act through the same command queue as the person playing.
  let computers: { ai: EconomicAI, sequence: { next: number } }[] = []
  const renderer: Renderer = createRenderer(canvas), lifetime = new AbortController()
  // Marked soldiers and numbered groups are interface state; only the orders they produce enter the simulation.
  let troops = createTroops(() => session, me), band: { x0: number, y0: number, x1: number, y1: number } | null = null
  let thief: number | null = null
  let minimap: MinimapOptions = { ...DEFAULT_MINIMAP }, sinceMinimap = 0
  const mapInstruction = (): string => {
    if (tool?.startsWith('work-area:')) return 'Press Enter to set the working area. Escape cancels.'
    if (tool === 'pioneer' || tool === 'geologist') return `Press Enter to send a ${tool}. Escape cancels.`
    if (tool === 'march') return 'Press Enter to send soldiers. Escape cancels.'
    if (tool?.startsWith('spell:')) return 'Press Enter to use the intervention here. Escape cancels.'
    if (tool) return `Press Enter to place ${session?.rules.buildings.find(b => b.id === tool)?.name ?? tool}.`
    return 'Press Enter to inspect.'
  }
  const emit = (): void => {
    if (cursor) {
      const label = `Settlement map. Tile ${cursor.x}, ${cursor.y}. ${mapInstruction()}`
      if (canvas.getAttribute('aria-label') !== label) canvas.setAttribute('aria-label', label)
    }
    const value = snapshot(session, selected, message, speed, tool, sound, ready && assetsReady, troops.selected().length, me)
    value.prototypeKept = prototypeKept; value.minimap = minimap
    if (link && session) value.match = { turn: lastTurn, verified, resyncs, buildings: session.state.buildings.size, connected: online }
    update(value)
  }
  /** Draws the overview map from the player's observation and frames the part of the land on screen. */
  const drawOverview = (): void => {
    const target = overview?.getContext('2d')
    if (!overview || !target || !session || !assetsReady) return
    const { map } = session.state, size = minimapSize(map.width, map.height), image = new ImageData(minimapPixels(observe(session, me), minimap, playerSlots), size.width, size.height)
    const scratch = document.createElement('canvas')
    scratch.width = size.width; scratch.height = size.height
    scratch.getContext('2d')!.putImageData(image, 0, 0)
    overview.width = overview.clientWidth * 2 || size.width * 2; overview.height = overview.clientHeight * 2 || size.height * 2
    target.imageSmoothingEnabled = false
    target.drawImage(scratch, 0, 0, overview.width, overview.height)
    // The white frame is the playing area currently on screen.
    const rect = canvas.getBoundingClientRect(), sx = overview.width / size.width, sy = overview.height / size.height
    const corners = [[rect.left, rect.top], [rect.right, rect.top], [rect.right, rect.bottom], [rect.left, rect.bottom]].map(([x, y]) => renderer.pick(session!, x!, y!)).filter(Boolean).map(p => toMinimap(p!, map.height))
    if (corners.length === 4) {
      target.strokeStyle = '#ffffff'; target.lineWidth = 2; target.beginPath()
      corners.forEach((p, i) => i ? target.lineTo(p.x * sx, p.y * sy) : target.moveTo(p.x * sx, p.y * sy))
      target.closePath(); target.stroke()
    }
  }
  const overviewTile = (event: MouseEvent): Point | null => {
    if (!session || !overview) return null
    const rect = overview.getBoundingClientRect(), { map } = session.state, size = minimapSize(map.width, map.height)
    const tile = fromMinimap({ x: Math.floor((event.clientX - rect.left) / rect.width * size.width), y: Math.floor((event.clientY - rect.top) / rect.height * size.height) }, map.height)
    return tile.x < 0 || tile.y < 0 || tile.x >= map.width || tile.y >= map.height ? null : tile
  }
  overview?.addEventListener('click', event => {
    const tile = overviewTile(event)
    if (!tile || !session) return
    renderer.home(tile, session.state.map.elevation[tile.y * session.state.map.width + tile.x]); cursor = tile; drawOverview()
  }, { signal: lifetime.signal })
  // A right click on the overview gives the marked soldiers or thief the same order as on the map.
  overview?.addEventListener('contextmenu', event => {
    event.preventDefault()
    const tile = overviewTile(event)
    if (!tile || !session || !ready || !assetsReady) return
    if (thief !== null && session.state.settlers.has(thief)) report(send('thief', { thief, x: tile.x, y: tile.y, steal: event.altKey }) ?? 'Your thief is on his way.')
    else command(tile, modifiers(event))
  }, { signal: lifetime.signal })
  const report = (text: string): void => { message = text; emit() }
  // The castle on generated starts, otherwise the first building or settler an original map gives the player.
  const castle = (): Point | null => {
    if (!session) return null
    const own = [...session.state.buildings.values()].filter(b => b.owner === me)
    const b = own.find(b => b.type === 'castle') ?? own[0]
    if (b) return { x: b.x, y: b.y }
    const s = [...session.state.settlers.values()].find(s => s.owner === me)
    return s ? { x: s.x, y: s.y } : null
  }
  const center = (): void => { const c = castle(); if (c && session) renderer.home(c, session.state.map.elevation[c.y * session.state.map.width + c.x]) }
  const syncPlayerColors = (next: Session): void => {
    playerSlots = playerSlotsForContent(next.identity.content, next.state.players.length, playerCatalog)
    renderer.setPlayerSlots(playerSlots)
  }
  const adopt = (next: Session): void => {
    if (assetsReady) { try { syncPlayerColors(next) } catch (error) { next.dispose(); throw error } }
    session?.dispose(); session = next; selected = null; tool = null; thief = null; accumulator = 0
    troops = createTroops(() => session, me)
    const nextSeq = (player: number): number => Math.max(0, ...next.state.pending.filter(c => c.player === player).map(c => c.seq + 1), ...next.state.results.filter(r => r.player === player).map(r => r.seq + 1))
    seq = nextSeq(me)
    computers = next.state.players.filter(p => p.controller === 'computer').map(p => ({ ai: economicAI(p.id, { military: RIVAL_MILITARY }), sequence: { next: nextSeq(p.id) } }))
    renderer.invalidate(); center(); cursor = castle()
  }
  const finishBoot = (): void => {
    if (ready && assetsReady && message.startsWith('Preparing')) message = 'Choose a building, then click open ground inside your border.'
    emit()
  }
  const assetsLoaded = loadOriginalAssets().then(atlas => { if (disposed) return false; renderer.setAssets(atlas); playerCatalog = atlas.playerSlots; assetsReady = true; drawOverview(); finishBoot(); return true }).catch(error => { if (!disposed) { assetsReady = false; report(error instanceof Error ? error.message : 'Could not load original game assets.') }; return false })

  const send = (type: string, fields: Record<string, unknown>): string | null => {
    if (!session) return 'The settlement is not ready.'
    if (link) {
      // Online, the server orders and validates every command. The order runs on the next turn, on every copy at once,
      // so nothing advances here; a refusal comes back with the turn and replaces this optimistic answer.
      link.order(type, fields).catch(error => { if (!disposed) report(error instanceof Error ? error.message : 'The order was not sent.') })
      return null
    }
    const command = { tick: session.state.tick, player: me, seq: seq++, type, ...fields } as Command
    const rejected = session.enqueue(command)
    if (rejected) return rejected.reason ?? 'That order was refused.'
    // Orders take effect on the next simulation tick, even while paused.
    session.advance(1)
    const result = session.state.results.find(r => r.seq === command.seq && r.player === me)
    return result?.ok ? null : result?.reason ?? 'That order was refused.'
  }
  let checkpoints: Checkpoints | null = null
  const persist = async (): Promise<void> => {
    if (!checkpoints || !ready || !session) return
    const result = await checkpoints.save(JSON.stringify(save(session)))
    if (disposed) return
    // Success follows the host's acknowledgement of the atomic checkpoint commit.
    if (result.ok) report('Settlement saved on this device.')
    else report(`Save failed. ${result.message} Your settlement is still running.`)
  }
  const load = async (): Promise<void> => {
    if (!ready || !checkpoints) { report('Device storage is not ready.'); return }
    try {
      const saved = await checkpoints.load()
      if (!saved) { report('There is no saved settlement on this device yet.'); return }
      const next = restore(saved, PUBLISHED_RULES)
      if (disposed) return
      adopt(next); report('Saved settlement restored.')
    }
    catch (error) { if (!disposed) report(error instanceof Error ? error.message : 'Could not restore the settlement.') }
  }
  // Online play. Turns from the server wait here until the clock has run the simulation up to them, so the
  // picture moves at the frame rate while every copy of the world still executes the same orders at the same tick.
  const turns: MatchTurn[] = [], early: MatchTurn[] = [], held: MatchTurn[] = []
  let running: { turn: MatchTurn, done: number } | null = null
  let expected = 0, resyncing = false
  let verified = 0, resyncs = 0, lastTurn = 0, online = true
  const stage = (turn: MatchTurn): void => {
    if (disposed) return
    if (!expected) { early.push(turn); return }
    if (resyncing) { held.push(turn); return }
    if (turn.n < expected) return
    if (turn.n > expected) { void resync('A turn was missed.'); return }
    expected = turn.n + 1; turns.push(turn)
  }
  const resync = async (why: string): Promise<void> => {
    if (!link || resyncing || disposed) return
    resyncing = true; resyncs++; report(`${why} Catching up with the match...`)
    const view = { x: renderer.camera.x, y: renderer.camera.y, zoom: renderer.camera.zoom }
    try {
      const fresh = await link.resync()
      if (disposed) return
      adopt(restore(fresh.envelope, PUBLISHED_RULES))
      Object.assign(renderer.camera, view)
      turns.length = 0; running = null; expected = fresh.turn + 1
      report('Back in step with the match.')
    }
    catch (error) { if (!disposed) report(error instanceof Error ? error.message : 'Could not rejoin the match.') }
    finally {
      resyncing = false
      for (const turn of held.splice(0).sort((a, b) => a.n - b.n)) stage(turn)
    }
  }
  const joinMatch = async (): Promise<void> => {
    if (!link) return
    try {
      const first = await link.open(stage, connected => { online = connected; if (!disposed) report(connected ? 'Connected to the match.' : 'Connection lost. Reconnecting...') }, text => { if (!disposed) report(text) })
      if (!await assetsLoaded || disposed) return
      adopt(restore(first.envelope, PUBLISHED_RULES))
      expected = first.turn + 1
      for (const turn of early.splice(0).sort((a, b) => a.n - b.n)) stage(turn)
      ready = true
      message = `The match has started. You hold the ${me === 1 ? 'west' : 'east'} castle.`
      emit()
    }
    catch (error) {
      if (disposed) return
      // A snapshot made under other rules or content cannot be played here; say so rather than show the raw save error.
      report(error instanceof SaveError ? 'This match runs on game rules this version of the page does not have. Reload the page to get the latest version, then rejoin.' : error instanceof Error ? error.message : 'Could not join the match.')
    }
  }
  /** After a turn has run in full: it must agree with the server, and a refused order of this player's is said so. */
  const finishTurn = (turn: MatchTurn): void => {
    if (!session) return
    if (session.checksum() !== turn.checksum) { void resync('This copy of the world disagreed with the server.'); return }
    verified++; lastTurn = turn.n
    for (const command of turn.commands) {
      if (command.player !== me) continue
      const result = session.state.results.find(r => r.seq === command.seq && r.player === me)
      if (result && !result.ok) report(result.reason ?? 'That order was refused.')
    }
  }
  /** Runs the simulation through as many staged turns as the clock allows. Returns the ticks it ran. */
  const runMatch = (budget: number): number => {
    if (!session) return 0
    const behind = turns.length + (running ? 1 : 0)
    let allowance = budget * (behind > 12 ? 4 : behind > 4 ? 2 : 1), used = 0
    while (allowance > 0 && session && !resyncing) {
      if (!running) {
        const next = turns.shift()
        if (!next) break
        if (session.state.tick !== next.from) { void resync('This copy of the world drifted from the server.'); break }
        let refused = false
        for (const command of next.commands) if (session.enqueue(command)) refused = true
        if (refused) { void resync('An order from the server was not accepted here.'); break }
        running = { turn: next, done: 0 }
      }
      const step = Math.min(allowance, running.turn.ticks - running.done)
      session.advance(step)
      running.done += step; allowance -= step; used += step
      if (running.done === running.turn.ticks) { const done = running.turn; running = null; finishTurn(done) }
    }
    return used
  }
  void createBrowserPlatform({ namespace: 'the-settlers-iii-remake' }).then(async host => {
    if (disposed) { host.dispose(); return }
    platform = host
    if (link) { await joinMatch(); return }
    if (options.guest) {
      if (!await assetsLoaded || disposed) return
      if (!session) { try { adopt(newSession(1 + Math.floor(Math.random() * 1_000_000))) } catch (error) { report(error instanceof Error ? error.message : 'Could not start a settlement.'); return } }
      ready = true; finishBoot()
      return
    }
    checkpoints = createCheckpoints({
      get: (key, signal) => host.call('Storage', 'get', [key], signal),
      setIfAbsent: (key, value, signal) => host.call('Storage', 'setIfAbsent', [key, value], signal) as Promise<boolean>,
      compareAndSet: (key, expected, value, signal) => host.call('Storage', 'compareAndSet', [key, expected, value], signal) as Promise<boolean>,
    }, SAVE_PREFIX, LEGACY_SAVE_KEY)
    // Resolve presentation before adopting saved content. An unavailable original
    // mapping leaves its checkpoint intact instead of starting a replacement.
    if (!await assetsLoaded || disposed) return
    let resumed: Session | null = null
    try {
      const saved = await checkpoints.load()
      // The Riverlands prototype save stays untouched under its own key; it is never reinterpreted.
      prototypeKept = !!(await host.call('Storage', 'get', [PROTOTYPE_KEY], lifetime.signal))
      if (saved && !disposed) resumed = restore(saved, PUBLISHED_RULES)
    }
    catch (error) { if (!disposed) message = error instanceof SaveError ? `${error.message} A new settlement was started.` : 'Could not read the saved settlement. A new settlement was started.' }
    if (disposed) return
    if (resumed) {
      try { adopt(resumed); message = 'Welcome back. Your settlement has been restored.' }
      catch (error) { report(error instanceof Error ? error.message : 'Could not restore player colors.'); return }
    }
    if (!session) { try { adopt(newSession(1 + Math.floor(Math.random() * 1_000_000))) } catch (error) { report(error instanceof Error ? error.message : 'Could not start a settlement.'); return } }
    ready = true
    host.emit((type, payload) => { if (type === 'APP_STATE' && (payload as { state: string }).state === 'background') void persist() })
    finishBoot()
  }).catch(async () => {
    if (link) { await joinMatch(); return }
    if (!await assetsLoaded || disposed) return
    if (!session) { try { adopt(newSession(1 + Math.floor(Math.random() * 1_000_000))) } catch (error) { report(error instanceof Error ? error.message : 'Could not start a settlement.'); return } }
    ready = true; report('Device storage is unavailable. You can play, but this settlement cannot be saved.')
  })
  const play = (name: string): void => { if (sound && platform) void platform.call('Audio', 'play', [name, `/assets/settlers-original/${name}.wav`, { volume: 0.3 }], lifetime.signal).catch(() => {}) }

  const act = (): void => {
    if (!cursor || !session) return
    if (tool?.startsWith('work-area:')) {
      const error = send('work-area', { building: Number(tool.slice(10)), x: cursor.x, y: cursor.y })
      if (!error) tool = null
      report(error ?? 'Working area moved. The worker finishes the current trip before using the new area.')
      return
    }
    if (tool?.startsWith('spell:')) {
      // The nearest free priest answers; a busy priest keeps his current order.
      const spell = tool.slice(6), at = cursor
      const priests = [...session.state.settlers.values()].filter(s => s.owner === me && s.profession === session!.rules.religion?.priest)
        .sort((a, b) => Number(!!a.cast) - Number(!!b.cast) || Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y) || a.id - b.id)
      if (!priests.length) { report('You have no priests. A large temple brings one every five minutes.'); return }
      const name = session.view(me).religion?.interventions.find(i => i.id === spell)?.name ?? spell
      report(send('cast', { priest: priests[0]!.id, spell, x: at.x, y: at.y }) ?? `A priest goes to call on Jupiter: ${name}.`)
      tool = null
      return
    }
    if (tool === 'march') {
      // Soldiers standing outside obey first; otherwise garrisons send all but their last soldier.
      const own = [...session.state.settlers.values()].filter(s => s.owner === me && s.soldier)
      const outside = own.filter(s => !s.inside), marked = troops.selected()
      const soldiers = marked.length ? marked : (outside.length ? outside : own).map(s => s.id)
      if (!soldiers.length) { report('You have no soldiers yet. Build a barracks and recruit some.'); return }
      const map = session.state.map, target = session.state.buildings.get(session.context.index.buildingAt[cursor.y * map.width + cursor.x]!)
      const enemy = target && target.owner !== me && rules.buildings.find(r => r.id === target.type)?.garrison
      const error = enemy ? send('attack', { soldiers, building: target.id }) : send('move-soldiers', { soldiers, x: cursor.x, y: cursor.y })
      report(error ?? (enemy ? 'Your soldiers march to attack.' : 'Your soldiers march there and hold the position.'))
      return
    }
    if (tool === 'pioneer' || tool === 'geologist') {
      const error = send('specialists', { profession: tool, x: cursor.x, y: cursor.y, count: 1 })
      report(error ?? `A ${tool} is on the way.`)
      return
    }
    if (tool) {
      const error = send('build', { building: tool, x: cursor.x, y: cursor.y })
      const name = rules.buildings.find(b => b.id === tool)?.name ?? tool
      report(error ?? `${name} site placed. Diggers and builders will start when they are free.`)
      if (!error) { play('build'); if (!link) selected = Math.max(...[...session.state.buildings.values()].filter(b => b.owner === me).map(b => b.id)) }
      return
    }
    selected = inspectBuildingAt(session, me, cursor)
    emit()
  }

  let pointer: { x: number, y: number, cameraX: number, cameraY: number, moved: boolean, button: number, touch: boolean } | null = null
  const modifiers = (event: MouseEvent | KeyboardEvent) => ({ shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey || event.metaKey })
  /** Own soldiers on the map with their canvas positions, as the scene draws them. */
  const soldiersOnScreen = (): { id: number, at: Point }[] => session ? scene(session, { player: me }).filter(i => i.kind === 'settler' && i.rank && i.owner === me).map(i => ({ id: i.entity, at: renderer.screen(i.view) })) : []
  const thievesOnScreen = (): { id: number, at: Point }[] => session ? scene(session, { player: me }).filter(i => i.kind === 'settler' && i.owner === me && session!.state.settlers.get(i.entity)?.thief).map(i => ({ id: i.entity, at: renderer.screen(i.view) })) : []
  const local = (event: MouseEvent): Point => { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top } }
  const soldierAt = (point: Point, people = soldiersOnScreen()): number | null => {
    const z = renderer.camera.zoom
    const hits = people.filter(({ at }) => Math.abs(point.x - at.x) <= 9 * z && point.y >= at.y - 32 * z && point.y <= at.y + 4 * z)
    return hits.sort((a, b) => Math.hypot(point.x - a.at.x, point.y - a.at.y + 14 * z) - Math.hypot(point.x - b.at.x, point.y - b.at.y + 14 * z) || a.id - b.id)[0]?.id ?? null
  }
  const command = (target: Point, mods: ReturnType<typeof modifiers>): void => {
    const order = troops.order(target, mods)
    if (!order) { report('Mark soldiers first: click one, or drag a rectangle around them.'); return }
    const { type, ...fields } = order
    const error = send(type, fields)
    const how = type === 'attack' ? 'march to attack' : 'mode' in fields && fields.mode === 'patrol' ? 'patrol between here and there' : 'append' in fields ? 'add that waypoint' : 'mode' in fields && fields.mode === 'forced' ? 'march there, ignoring enemies' : 'march there'
    report(error ?? `${order.soldiers.length} ${order.soldiers.length === 1 ? 'soldier will' : 'soldiers will'} ${how}.`)
  }
  const on = <K extends keyof HTMLElementEventMap>(name: K, handler: (event: HTMLElementEventMap[K]) => void, options: AddEventListenerOptions = {}): void => canvas.addEventListener(name, handler as EventListener, { ...options, signal: lifetime.signal })
  // Left drag marks soldiers in a rectangle, as in the original; the right or middle button, or a finger, pans.
  on('pointerdown', event => { if (event.button > 2) return; canvas.focus(); pointer = { x: event.clientX, y: event.clientY, cameraX: renderer.camera.x, cameraY: renderer.camera.y, moved: false, button: event.button, touch: event.pointerType !== 'mouse' }; canvas.setPointerCapture(event.pointerId) })
  on('pointermove', event => {
    if (session) cursor = renderer.pick(session, event.clientX, event.clientY) ?? cursor
    if (pointer) {
      const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y
      if (Math.hypot(dx, dy) > 6) pointer.moved = true
      if (!pointer.moved) return
      if (pointer.button === 0 && !pointer.touch && !tool) { const start = local({ clientX: pointer.x, clientY: pointer.y } as MouseEvent), end = local(event); band = { x0: start.x, y0: start.y, x1: end.x, y1: end.y } }
      else { renderer.camera.x = pointer.cameraX + dx; renderer.camera.y = pointer.cameraY + dy }
    }
  })
  on('pointerup', event => {
    const ready_ = ready && assetsReady && !!session
    if (pointer && band && ready_) {
      thief = null
      const { x0, y0, x1, y1 } = band, z = renderer.camera.zoom
      const inside = soldiersOnScreen().filter(({ at }) => at.x >= Math.min(x0, x1) && at.x <= Math.max(x0, x1) && at.y - 14 * z >= Math.min(y0, y1) && at.y - 14 * z <= Math.max(y0, y1)).map(s => s.id)
      troops.band(inside, modifiers(event))
      report(troops.selected().length ? `${troops.selected().length} soldiers marked. Right-click to move them; hold Ctrl to ignore enemies, Shift to add waypoints, Alt to patrol.` : 'No soldiers in that area.')
    }
    else if (pointer && !pointer.moved && ready_ && pointer.button === 2) {
      cursor = renderer.pick(session!, event.clientX, event.clientY)
      // A marked thief goes where he is sent; with ALT he pilfers there (manual: Moving and Using Thieves).
      if (cursor && thief !== null && session!.state.settlers.has(thief)) report(send('thief', { thief, x: cursor.x, y: cursor.y, steal: event.altKey }) ?? (event.altKey ? 'Your thief sets out to pilfer.' : 'Your thief is on his way.'))
      else if (cursor) command(cursor, modifiers(event))
    }
    else if (pointer && !pointer.moved && ready_ && pointer.button === 0) {
      cursor = renderer.pick(session!, event.clientX, event.clientY)
      const hit = tool ? null : soldierAt(local(event)), sneak = tool || hit !== null ? null : soldierAt(local(event), thievesOnScreen())
      thief = sneak
      if (sneak !== null) { troops.clear(); report('Thief marked. Right-click to send him; hold Alt to have him pilfer there.') }
      else if (hit !== null) {
        troops.click(hit, modifiers(event))
        const count = troops.selected().length
        report(`${count} ${count === 1 ? 'soldier' : 'soldiers'} marked. Right-click where they should go.`)
      }
      else {
        if (!tool && !event.shiftKey) troops.clear()
        const placing = tool
        act()
        if (placing && !event.shiftKey && tool === placing && message.includes('placed')) { tool = null; emit() }
      }
    }
    pointer = null; band = null
  })
  on('pointercancel', () => { pointer = null; band = null })
  on('contextmenu', event => event.preventDefault())
  on('wheel', event => {
    // A guest map sits inside a scrolling page, so only a deliberate Ctrl/Cmd wheel or pinch zooms it.
    if (options.guest && !(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    const bounds = canvas.getBoundingClientRect(), x = event.clientX - bounds.left, y = event.clientY - bounds.top, old = renderer.camera.zoom
    renderer.camera.zoom = Math.max(0.5, Math.min(3, old * Math.exp(-event.deltaY * 0.001)))
    const ratio = renderer.camera.zoom / old
    renderer.camera.x = x - (x - renderer.camera.x) * ratio; renderer.camera.y = y - (y - renderer.camera.y) * ratio
  }, { passive: false })
  on('keydown', event => {
    if (!session) return
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) event.preventDefault()
    const map = session.state.map
    cursor ??= castle() ?? { x: 0, y: 0 }
    if (event.key === 'ArrowUp') cursor = { x: cursor.x, y: Math.max(0, cursor.y - 1) }
    if (event.key === 'ArrowDown') cursor = { x: cursor.x, y: Math.min(map.height - 1, cursor.y + 1) }
    if (event.key === 'ArrowLeft') cursor = { x: Math.max(0, cursor.x - 1), y: cursor.y }
    if (event.key === 'ArrowRight') cursor = { x: Math.min(map.width - 1, cursor.x + 1), y: cursor.y }
    if (event.key === 'Enter' && ready && assetsReady) act()
    if (event.key === 'Tab' && troops.selected().length) {
      event.preventDefault()
      troops.wounded()
      report(troops.selected().length ? `${troops.selected().length} wounded soldiers stay marked. Send them to a healer's hut.` : 'None of the marked soldiers is wounded.')
    }
    const digit = /^Digit([1-9])$/.exec(event.code)
    if (digit && ready) {
      event.preventDefault()
      if (!event.altKey) thief = null
      const n = Number(digit[1]), center = troops.key(n, modifiers(event))
      if (event.altKey) report(`Group ${n} holds ${troops.selected().length} soldiers. Press ${n} to mark them, twice to find them.`)
      else if (center) renderer.home(center, map.elevation[center.y * map.width + center.x])
      else report(troops.selected().length ? `Group ${n}: ${troops.selected().length} soldiers marked.` : `Group ${n} is empty. Mark soldiers and press Alt+${n}.`)
    }
    if (event.key === ' ' && !link) speed = speed === 0 ? 1 : 0
    if (event.key === 'Escape') { tool = null; selected = null; thief = null; troops.clear() }
    if (event.key.toLowerCase() === 'h') center()
    if (event.key.toLowerCase() === 's') void persist()
    emit()
  })
  const resize = new ResizeObserver(() => { renderer.resize() }); resize.observe(canvas)
  const clock = useAnimationFrame(delta => {
    if (speed > 0) elapsed += delta / 1000
    if (session && ready && assetsReady && speed > 0) {
      // Fixed simulation ticks make the economy independent of the display refresh rate.
      sinceUpdate += delta; sinceSave += delta
      accumulator = Math.min(accumulator + delta / 1000 * speed * rules.tickRate, rules.tickRate * 2)
      const ticks = Math.floor(accumulator)
      if (link) { runMatch(ticks); accumulator = turns.length || running ? accumulator - ticks : 0 }
      else if (ticks > 0) {
        if (!computers.length) session.advance(ticks)
        else for (let i = 0; i < ticks; i++) { for (const c of computers) stepAI(session, c.ai, c.sequence); session.advance(1) }
        accumulator -= ticks
      }
      if (sinceUpdate >= 250) { sinceUpdate = 0; emit() }
      sinceMinimap += delta
      if (sinceMinimap >= 500) { sinceMinimap = 0; drawOverview() }
      if (sinceSave >= 30000) { sinceSave = 0; void persist() }
    }
    if (session) {
      const placement = tool && cursor && session.context.building.has(tool) ? session.placement(me, tool, cursor.x, cursor.y) : null
      renderer.draw(session, { player: me, cursor, tool, selected, time: elapsed, reduceMotion: reduceMotion(), placement, marked: new Set(troops.selected()), band })
    }
  })
  emit()
  return {
    choose(kind: string | null) {
      if (!ready || !session) return
      tool = kind
      if (kind && session.context.building.has(kind)) {
        // Prefer known resources, retaining legal ground as a fallback.
        const c = castle(), found = c ? findBuildingSite(session, me, kind, c) : null
        if (found) cursor = found
        const work = session.context.building.get(kind)!.workflow
        const harvest = work.kind === 'harvest', mine = work.kind === 'extract' && !!work.food
        const warning = found && mine && !surveyedMineForecast(session.view(me), session.rules, kind)(found)
          ? 'This site has no known matching deposit in reach. Send a geologist to survey or choose another site.'
          : found && harvest && !observe(session, me).harvestable(kind, found.x, found.y)
            ? 'This site has no known reachable resources in its working area. Explore or choose another site.'
            : 'Choose open ground inside your border.'
        report(found ? `${describe(kind, session.rules)} ${warning}` : `No valid site for ${session.rules.buildings.find(b => b.id === kind)!.name} inside your territory. Clear ground or claim more land.`)
      }
      else if (kind === 'march') report('Click open ground to send your soldiers there, or an enemy tower or castle to attack it.')
      else if (kind?.startsWith('spell:')) report('Click where the intervention should fall. A priest walks within reach first, except for the Magic Eye.')
      else if (kind) report(`Choose where the ${kind} should go.`)
      else report('Select a building to inspect it.')
      canvas.focus()
    },
    async toggleSound() {
      if (!platform || !ready || soundPending || disposed) return
      soundPending = true
      try {
        if (sound) { await platform.call('Audio', 'stopAll', [], lifetime.signal); sound = false }
        else { await platform.call('Audio', 'play', ['ambient', '/assets/settlers-original/birds.wav', { loop: true, volume: 0.12 }], lifetime.signal); sound = true }
        if (!disposed) emit()
      }
      catch { if (!disposed) report('Your browser could not enable audio. You can continue playing.') }
      finally { soundPending = false }
    },
    speed(value: number) { if (link) { report('An online match runs at one speed for both players.'); return } speed = value; emit() },
    /** Switches the overview's territory, settler or building display (manual: The Overview Map). */
    overview(change: Partial<MinimapOptions>) { minimap = { ...minimap, ...change }; drawOverview(); emit() },
    /** Centres the playing area on a tile, as clicking an alert does. */
    goto(x: number, y: number) { if (!session) return; const { map } = session.state; renderer.home({ x, y }, map.elevation[y * map.width + x]); cursor = { x, y }; drawOverview() },
    home: center,
    save: persist, load,
    workArea() {
      if (!ready || !session || !selected) return
      const building = session.state.buildings.get(selected), area = inspect(session, selected, me)?.workArea
      if (!building || !area) return
      tool = `work-area:${building.id}`; cursor = { x: area.x, y: area.y }; thief = null; troops.clear()
      report('Choose the working area on the map, or use arrow keys and Enter. Escape cancels.')
      canvas.focus()
    },
    async restart(landscape: Landscape = 'generated', requestedSeed?: number) {
      if (!ready) return
      if (link) { report('An online match cannot be restarted from here. Leave it to start another.'); return }
      try {
        const seed = requestedSeed === undefined ? 1 + Math.floor(Math.random() * 1_000_000) : validateMapSeed(requestedSeed)
        const next = landscape === 'tutorial' ? await tutorialSession(seed) : landscape === 'rival' ? rivalSession(seed) : newSession(seed)
        if (disposed) return
        adopt(next); speed = 1
        report(landscape === 'tutorial' ? 'The original tutorial map. Your Roman settlers and their tower are ready.' : landscape === 'rival' ? 'A computer settlement grows to the east, building and fighting by the same rules. It scouts, raises an army and attacks the towers it finds. You only see it where your settlers can.' : 'A new landscape. Your settlers have arrived.')
        void persist()
      }
      catch (error) { if (!disposed) report(error instanceof Error ? error.message : 'Could not open that map.') }
    },
    toggle() { if (!session || !selected) return; const b = session.state.buildings.get(selected); if (!b) return; report(send('suspend', { building: b.id, suspended: !b.suspended }) ?? (b.suspended ? 'Work paused.' : 'Work resumed.')) },
    demolition() {
      if (!ready || disposed || selected === null) return null
      const target = prepareDemolition(() => disposed ? null : session, me, selected, id => send('demolish', { building: id }))
      if (!target) return null
      return { name: target.name, confirm() {
        const error = target.confirm()
        if (!error) selected = null
        report(error ?? 'Building torn down. Half of its materials lie on the ground.')
        if (!error) void persist()
      } }
    },
    store(good: string) {
      if (!session) return
      const stored = session.state.players[me - 1]!.settings.stored
      const next = stored.includes(good) ? stored.filter(g => g !== good) : [...stored, good]
      report(send('settings', { settings: { stored: next } }) ?? (next.includes(good) ? `Carriers will take ${good} to storage areas.` : `${good} will stay at the doorsteps.`))
    },
    recruit(profession: string) {
      if (!session) return
      report(send('recruit', { profession, count: 1 }) ?? `A ${profession} will be recruited when a barracks has the weapon and a carrier is free.`)
    },
    cancelRecruit(profession: string) {
      if (!session) return
      report(send('cancel-recruit', { profession, count: 1 }) ?? `One waiting ${profession} order cancelled.`)
    },
    recruitAutomatic() {
      if (!session) return
      const next = !session.state.players[me - 1]!.settings.recruit?.automatic
      report(send('settings', { settings: { recruitAutomatic: next } }) ?? (next ? 'Barracks recruit whenever weapons arrive.' : 'Barracks recruit only the soldiers you order.'))
    },
    promote(profession: string) {
      if (!session) return
      report(send('promote', { profession }) ?? `New ${profession} soldiers will join a rank higher. Soldiers already serving keep their rank.`)
    },
    dismiss(profession: string) {
      if (!session) return
      report(send('dismiss', { profession, count: 1 }) ?? `An idle ${profession} went back to carrying.`)
    },
    thieves() {
      if (!session) return
      report(send('thieves', { count: 1 }) ?? 'A carrier became a thief. Click him, then right-click with Alt where he should pilfer.')
    },
    /** Adds one urgent order for a tool or weapon; smiths make urgent orders first, top to bottom (manual). */
    urgent(key: string) { if (!session) return; report(send('urgent-tool', { tool: key }) ?? `The next ${key} will be made first.`) },
    weight(key: string, delta: number) {
      if (!session) return
      const value = Math.max(0, Math.min(10, (session.state.players[me - 1]!.settings.toolWeights[key] ?? 1) + delta))
      report(send('settings', { settings: { toolWeights: { [key]: value } } }) ?? `${key} priority set to ${value}.`)
    },
    /** Moves a good in the transport chain: up or down one place, or to the top or bottom (manual: Transportation Priorities). */
    priority(key: string, move: 'up' | 'down' | 'top' | 'bottom') {
      if (!session) return
      const list = [...session.state.players[me - 1]!.settings.transportPriority], at = list.indexOf(key)
      if (at < 0) return
      list.splice(at, 1)
      const to = move === 'top' ? 0 : move === 'bottom' ? list.length : Math.max(0, Math.min(list.length, at + (move === 'up' ? -1 : 1)))
      list.splice(to, 0, key)
      report(send('settings', { settings: { transportPriority: list } }) ?? `${key} is carried ${to + 1}${to === 0 ? 'st' : to === 1 ? 'nd' : to === 2 ? 'rd' : 'th'} in line.`)
    },
    distribute(good: string, type: string, delta: number) {
      if (!session) return
      const value = Math.max(0, Math.min(10, (session.state.players[me - 1]!.settings.distribution?.[good]?.[type] ?? 1) + delta))
      report(send('settings', { settings: { distribution: { [good]: { [type]: value } } } }) ?? (value ? `The ${rules.buildings.find(b => b.id === type)?.name ?? type} now gets share ${value} of the ${good}.` : `No ${good} goes to the ${rules.buildings.find(b => b.id === type)?.name ?? type} now.`))
    },
    limit(kind: 'builders' | 'diggers', delta: number) {
      if (!session) return
      const settings = session.state.players[me - 1]!.settings, key = kind === 'builders' ? 'builderLimit' : 'diggerLimit'
      const value = Math.max(0, Math.min(1000, settings[key] + delta))
      report(send('settings', { settings: { [key]: value } }) ?? `At most ${value} ${kind}.`)
    },
    carrierRatio(delta: number) {
      if (!session) return
      const value = Math.max(0, Math.min(100, session.state.players[me - 1]!.settings.carrierRatio + delta))
      report(send('settings', { settings: { carrierRatio: value } }) ?? `At least ${value}% of settlers stay carriers.`)
    },
    dispose() {
      if (disposed) return
      // A last checkpoint is written before storage is released; the session itself stops now.
      const final = checkpoints && session && ready ? checkpoints.save(JSON.stringify(save(session))) : Promise.resolve()
      disposed = true; link?.close(); clock.stop(); resize.disconnect(); session?.dispose(); renderer.dispose()
      void final.finally(() => { checkpoints?.dispose(); lifetime.abort(); platform?.dispose() })
    },
  }
}
