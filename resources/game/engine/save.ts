import type { RulesProfile } from './rules'
import type { Session } from './session'
import type { Building, Command, Job, Ledger, MapState, Op, Player, Settler, Stack, State } from './state'
import { canonical } from './hash'
import { MAX_MAP_SIZE } from './map'
import type { MissionDefinition, MissionState } from './mission'
import { MissionError, validateMission } from './mission'
import { validRandomState } from './random'
import { rulesIdentity } from './rules'
import { openSession } from './session'

export const SAVE_FORMAT = 'settlers-iii-remake/session'
export const SAVE_VERSION = 1
export const MAX_SAVE_BYTES = 64 * 1024 * 1024

type LayerName = 'terrain' | 'elevation' | 'resource' | 'resourceAmount' | 'object' | 'objectAmount' | 'objectSince' | 'owner'
const LAYERS: Record<LayerName, 1 | 2 | 4> = { terrain: 1, elevation: 1, resource: 1, resourceAmount: 2, object: 1, objectAmount: 2, objectSince: 4, owner: 1 }

export interface EncodedState {
  schema: 1, tick: number, random: number[], nextId: number, navigation: number
  map: { width: number, height: number, layers: Record<LayerName, string> }
  players: (Omit<Player, 'explored' | 'visible'> & { explored: string, visible: string })[]
  settlers: Settler[], buildings: Building[], stacks: Stack[], jobs: Job[]
  claims: [number, number][], growth: [number, number][], cooldowns: [string, number][]
  ledger: Record<string, Ledger>, events: State['events'], results: State['results'], pending: Command[]
  mission: MissionState | null
}
export interface SaveEnvelope {
  format: typeof SAVE_FORMAT, version: number
  rules: { id: string, version: string, digest: string }
  content: { id: string, digest: string }
  tick: number, checksum: string, state: EncodedState
}

export class SaveError extends Error {
  constructor(readonly code: 'not-a-save' | 'prototype-save' | 'newer-version' | 'incompatible-rules' | 'damaged' | 'too-large', message: string) { super(message) }
}

// Little-endian layer encoding keeps saves identical across hosts.
function encodeLayer(array: Uint8Array | Uint16Array | Uint32Array, width: 1 | 2 | 4): string {
  const bytes = new Uint8Array(array.length * width), view = new DataView(bytes.buffer)
  for (let i = 0; i < array.length; i++) { if (width === 1) bytes[i] = array[i]!; else if (width === 2) view.setUint16(i * 2, array[i]!, true); else view.setUint32(i * 4, array[i]!, true) }
  return toBase64(bytes)
}
function decodeLayer(text: unknown, length: number, width: 1 | 2 | 4, label: string): Uint8Array | Uint16Array | Uint32Array {
  if (typeof text !== 'string' || text.length > Math.ceil(length * width / 3) * 4 + 4) throw damaged(`${label} layer is malformed`)
  const bytes = fromBase64(text, label)
  if (bytes.length !== length * width) throw damaged(`${label} layer has the wrong size`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = width === 1 ? new Uint8Array(length) : width === 2 ? new Uint16Array(length) : new Uint32Array(length)
  for (let i = 0; i < length; i++) out[i] = width === 1 ? bytes[i]! : width === 2 ? view.getUint16(i * 2, true) : view.getUint32(i * 4, true)
  return out
}
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + (i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63]! : '=') + (i + 2 < bytes.length ? ALPHABET[n & 63]! : '=')
  }
  return out
}
function fromBase64(text: string, label: string): Uint8Array {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw damaged(`${label} is not base64`)
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0, out = new Uint8Array(text.length / 4 * 3 - padding)
  for (let i = 0, o = 0; i < text.length; i += 4) {
    const n = (ALPHABET.indexOf(text[i]!) << 18) | (ALPHABET.indexOf(text[i + 1]!) << 12) | ((ALPHABET.indexOf(text[i + 2]!) & 63) << 6) | (ALPHABET.indexOf(text[i + 3]!) & 63)
    out[o++] = (n >> 16) & 255
    if (o < out.length) out[o++] = (n >> 8) & 255
    if (o < out.length) out[o++] = n & 255
  }
  return out
}

/** FNV-1a over the complete simulation state. Equal checksums mean equal saves for replay and network comparison. */
export function checksum(state: State): string {
  let h = 0x811C9DC5
  const byte = (b: number): void => { h ^= b & 255; h = Math.imul(h, 0x01000193) >>> 0 }
  const text = (s: string): void => { for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); byte(c); byte(c >> 8) } }
  const map = state.map
  for (const name of Object.keys(LAYERS) as LayerName[]) { const layer = map[name]; for (let i = 0; i < layer.length; i++) { const v = layer[i]!; byte(v); if (v > 255) { byte(v >> 8); byte(v >> 16); byte(v >> 24) } } }
  // Canonical text sorts keys, so equal state checksums equally however its objects were built.
  text(canonical(encodeEntities(state)))
  for (const p of state.players) { for (let i = 0; i < p.explored.length; i++) byte(p.explored[i]! | (p.visible[i]! << 1)) }
  return h.toString(16).padStart(8, '0')
}

function encodeEntities(state: State): Omit<EncodedState, 'map' | 'players'> & { players: Omit<Player, 'explored' | 'visible'>[] } {
  return {
    schema: state.schema, tick: state.tick, random: [...state.random], nextId: state.nextId, navigation: state.navigation,
    players: state.players.map(({ explored: _e, visible: _v, ...p }) => p),
    settlers: [...state.settlers.values()], buildings: [...state.buildings.values()], stacks: [...state.stacks.values()], jobs: [...state.jobs.values()],
    claims: [...state.claims], growth: state.growth, cooldowns: [...state.cooldowns], ledger: Object.fromEntries(Object.entries(state.ledger)),
    events: state.events, results: state.results, pending: state.pending, mission: state.mission,
  }
}

export function encodeState(state: State): EncodedState {
  const map = state.map
  return structuredClone({
    ...encodeEntities(state),
    map: { width: map.width, height: map.height, layers: Object.fromEntries((Object.keys(LAYERS) as LayerName[]).map(name => [name, encodeLayer(map[name], LAYERS[name])])) as Record<LayerName, string> },
    players: state.players.map(p => ({ ...structuredClone({ ...p, explored: undefined, visible: undefined }), explored: encodeLayer(p.explored, 1), visible: encodeLayer(p.visible, 1) })) as EncodedState['players'],
  })
}

export function save(session: Session): SaveEnvelope {
  return { format: SAVE_FORMAT, version: SAVE_VERSION, rules: session.identity.rules, content: session.identity.content, tick: session.state.tick, checksum: checksum(session.state), state: encodeState(session.state) }
}

const damaged = (detail: string): SaveError => new SaveError('damaged', `Saved game is damaged: ${detail}.`)
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const int = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max
function list<T>(v: unknown, max: number, label: string): T[] { if (!Array.isArray(v) || v.length > max) throw damaged(`${label} list is malformed`); return v as T[] }
function check(condition: unknown, detail: string): asserts condition { if (!condition) throw damaged(detail) }
const goodsMap = (v: unknown, rules: RulesProfile, label: string, min = 0): void => { check(isObject(v) && Object.entries(v).every(([k, n]) => rules.goods.includes(k) && int(n, min, 1e9)), `${label} goods are malformed`) }

/**
 * Migration policy: envelopes carry their format version. Older versions are
 * migrated forward step by step through this table; newer versions and the
 * browser prototype's World saves are refused without being reinterpreted.
 */
export const MIGRATIONS: Record<number, (envelope: Record<string, unknown>) => Record<string, unknown>> = {}

export function migrate(raw: unknown): SaveEnvelope {
  if (isObject(raw) && raw.version === 1 && Array.isArray(raw.buildings) && isObject(raw.stock) && 'enemyHealth' in raw) throw new SaveError('prototype-save', 'This is a Riverlands prototype campaign save. It is kept unchanged and cannot be opened as a Gold Edition session.')
  if (!isObject(raw) || raw.format !== SAVE_FORMAT || !Number.isInteger(raw.version)) throw new SaveError('not-a-save', 'This is not a Settlers III remake saved game.')
  let envelope = raw, version = raw.version as number
  if (version > SAVE_VERSION) throw new SaveError('newer-version', `This save was made by a newer version (format ${version}). Update the game to open it.`)
  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version]
    if (!step) throw new SaveError('damaged', `Saved game format ${version} has no migration.`)
    envelope = step(envelope); version++
    if (envelope.version !== version) throw new SaveError('damaged', `Migration to format ${version} failed.`)
  }
  return envelope as unknown as SaveEnvelope
}

/** Saves are untrusted input: every field is bounded and every reference resolved before a session is created. */
export function decodeState(envelope: SaveEnvelope, rules: RulesProfile): State {
  const e = envelope.state
  check(isObject(e) && e.schema === 1, 'unknown state schema')
  check(int(e.tick, 0, 0xFFFFFFFF) && e.tick === envelope.tick, 'tick does not match')
  check(validRandomState(e.random), 'random state is invalid')
  check(int(e.nextId, 1, Number.MAX_SAFE_INTEGER) && int(e.navigation, 0, Number.MAX_SAFE_INTEGER), 'counters are invalid')
  check(isObject(e.map) && int(e.map.width, 8, MAX_MAP_SIZE) && int(e.map.height, 8, MAX_MAP_SIZE) && isObject(e.map.layers), 'map header is invalid')
  const width = e.map.width, height = e.map.height, size = width * height
  const layers = Object.fromEntries((Object.keys(LAYERS) as LayerName[]).map(name => [name, decodeLayer(e.map.layers[name], size, LAYERS[name], name)])) as unknown as Omit<MapState, 'width' | 'height'>
  const map: MapState = { width, height, ...layers }
  const players = list<EncodedState['players'][number]>(e.players, 20, 'player')
  check(players.length >= 1, 'no players')
  for (let t = 0; t < size; t++) {
    check(map.terrain[t]! < rules.terrain.length && map.object[t]! <= rules.objects.length && map.resource[t]! <= rules.goods.length && map.owner[t]! <= players.length, `tile ${t} has unknown values`)
  }
  const ids = new Set<number>()
  const id = (v: unknown, label: string): number => { check(int(v, 1, e.nextId - 1) && !ids.has(v), `${label} id is invalid or duplicated`); ids.add(v); return v }
  const tile = (v: unknown): v is number => int(v, 0, size - 1)
  const owner = (v: unknown): v is number => int(v, 1, players.length)
  const good = (v: unknown): v is string => typeof v === 'string' && rules.goods.includes(v)
  const decodedPlayers: Player[] = players.map((p, i) => {
    check(isObject(p) && p.id === i + 1 && str(p.name, 64) && str(p.civilization, 32) && ['human', 'computer', 'observer'].includes(p.controller), `player ${i + 1} is invalid`)
    const s = p.settings
    check(isObject(s) && int(s.carrierRatio, 0, 100) && int(s.builderLimit, 0, 1000) && int(s.diggerLimit, 0, 1000), `player ${p.id} settings are invalid`)
    check(Array.isArray(s.transportPriority) && s.transportPriority.length === rules.goods.length && new Set(s.transportPriority).size === rules.goods.length && s.transportPriority.every(good), `player ${p.id} transport priority is invalid`)
    check(Array.isArray(s.stored) && s.stored.every(good) && new Set(s.stored).size === s.stored.length, `player ${p.id} storage settings are invalid`)
    check(isObject(s.toolWeights) && Object.entries(s.toolWeights).every(([t, w]) => rules.tools.includes(t) && int(w, 0, 10)), `player ${p.id} tool weights are invalid`)
    check(Array.isArray(s.urgentTools) && s.urgentTools.length <= 64 && s.urgentTools.every(t => rules.tools.includes(t)), `player ${p.id} urgent tools are invalid`)
    check(int(p.craftCursor, 0, 1000), `player ${p.id} craft cursor is invalid`)
    const signs = list<Player['signs'][number]>(p.signs, 512, 'sign')
    check(signs.every(sign => isObject(sign) && tile(sign.tile) && (sign.good === null || good(sign.good)) && int(sign.amount, 0, 65535) && int(sign.until, 0, 0xFFFFFFFF)), `player ${p.id} signs are invalid`)
    return { id: p.id, name: p.name, civilization: p.civilization, controller: p.controller, settings: structuredClone(s), signs: structuredClone(signs), craftCursor: p.craftCursor, explored: decodeLayer(p.explored, size, 1, 'explored') as Uint8Array, visible: decodeLayer(p.visible, size, 1, 'visible') as Uint8Array }
  })
  const buildings = list<Building>(e.buildings, 100_000, 'building')
  const buildingIds = new Set<number>()
  const covered = new Set<number>()
  for (const b of buildings) {
    check(isObject(b), 'building is malformed')
    id(b.id, 'building'); buildingIds.add(b.id)
    const rule = rules.buildings.find(r => r.id === b.type)
    check(rule && owner(b.owner) && int(b.x, 0, width - 1) && int(b.y, 0, height - 1) && ['leveling', 'building', 'active'].includes(b.phase) && typeof b.suspended === 'boolean' && int(b.order, 0, 1e9), `building ${b.id} header is invalid`)
    check(int(b.target, 0, 255) && int(b.levelRemaining, 0, 1e6) && int(b.workRemaining, 0, 1e6) && int(b.cycle, 0, 1e6) && int(b.meals, 0, 1000) && int(b.residents, 0, 1e6) && int(b.nextResident, 0, 0xFFFFFFFF), `building ${b.id} counters are invalid`)
    goodsMap(b.used, rules, `building ${b.id} used`); goodsMap(b.cycleGoods, rules, `building ${b.id} cycle`)
    check(isObject(b.workArea) && int(b.workArea.x, 0, width - 1) && int(b.workArea.y, 0, height - 1) && (b.shortage === null || str(b.shortage)), `building ${b.id} state is invalid`)
    check(int(b.worker, 0, e.nextId) && Array.isArray(b.workers) && b.workers.length <= 16 && b.workers.every(w => int(w, 1, e.nextId)), `building ${b.id} workers are invalid`)
    for (const [dx, dy] of [...rule.footprint, rule.door]) check(int(b.x + dx, 0, width - 1) && int(b.y + dy, 0, height - 1), `building ${b.id} lies outside the map`)
    for (const [dx, dy] of rule.footprint) { const t = (b.y + dy) * width + b.x + dx; check(!covered.has(t), `buildings overlap at tile ${t}`); covered.add(t) }
  }
  const settlers = list<Settler>(e.settlers, 200_000, 'settler')
  const settlerIds = new Set<number>(), standing = new Set<number>()
  for (const s of settlers) {
    check(isObject(s), 'settler is malformed')
    id(s.id, 'settler'); settlerIds.add(s.id)
    check(owner(s.owner) && rules.professions.some(p => p.id === s.profession) && (s.tool === null || rules.tools.includes(s.tool)) && int(s.x, 0, width - 1) && int(s.y, 0, height - 1) && int(s.dir, 0, 5), `settler ${s.id} header is invalid`)
    check(['idle', 'walking', 'waiting', 'working', 'inside'].includes(s.action) && (s.next === -1 || tile(s.next)) && int(s.step, 0, 1e6) && int(s.stepTicks, 0, 1e6) && int(s.waited, 0, 1e6) && int(s.retries, 0, 1000), `settler ${s.id} motion is invalid`)
    check(Array.isArray(s.path) && s.path.length <= size && s.path.every(tile) && (s.cargo === null || good(s.cargo)) && (s.diagnostic === null || str(s.diagnostic)), `settler ${s.id} path or cargo is invalid`)
    check((s.workplace === 0 || buildingIds.has(s.workplace)) && (s.inside === 0 || buildingIds.has(s.inside)), `settler ${s.id} workplace is invalid`)
    check((s.action === 'walking') === (s.next !== -1) && typeof s.holding === 'boolean' && !(s.holding && (s.inside || s.action === 'walking')), `settler ${s.id} walking state is inconsistent`)
    if (s.program !== null) validateProgram(s.program, size, e.nextId, `settler ${s.id}`)
    if (s.holding) { const t = s.y * width + s.x; check(!standing.has(t), `two settlers rest on tile ${t}`); standing.add(t) }
  }
  for (const b of buildings) check((b.worker === 0 || settlerIds.has(b.worker)) && b.workers.every(w => settlerIds.has(w)), `building ${b.id} refers to a missing worker`)
  const stacks = list<Stack>(e.stacks, 200_000, 'stack'), stackIds = new Set<number>()
  for (const s of stacks) {
    check(isObject(s), 'stack is malformed')
    id(s.id, 'stack'); stackIds.add(s.id)
    check(owner(s.owner) && tile(s.tile) && (s.building === 0 || buildingIds.has(s.building)) && ['ground', 'input', 'output', 'construction', 'storage'].includes(s.role) && good(s.good), `stack ${s.id} header is invalid`)
    check(int(s.amount, 0, 65535) && int(s.capacity, 0, 65535) && int(s.reservedIn, 0, 65535) && int(s.reservedOut, 0, s.amount) && s.amount + s.reservedIn <= Math.max(s.capacity, s.amount), `stack ${s.id} quantities are invalid`)
  }
  const jobs = list<Job>(e.jobs, 200_000, 'job')
  for (const j of jobs) {
    check(isObject(j), 'job is malformed')
    id(j.id, 'job')
    check(owner(j.owner) && (stackIds.has(j.source) || (j.picked === true && int(j.source, 1, e.nextId))), `job ${j.id} source is invalid`)
    if (j.kind === 'deliver') check(good(j.good) && stackIds.has(j.target) && settlerIds.has(j.carrier) && typeof j.picked === 'boolean', `job ${j.id} is invalid`)
    else check(j.kind === 'equip' && (j.tool === null || rules.tools.includes(j.tool)) && settlerIds.has(j.settler) && rules.professions.some(p => p.id === j.profession) && int(j.building, 0, e.nextId) && typeof j.picked === 'boolean', `job ${j.id} is invalid`)
  }
  const claims = list<[number, number]>(e.claims, size, 'claim')
  check(claims.every(c => Array.isArray(c) && tile(c[0]) && settlerIds.has(c[1])), 'claims are invalid')
  const growth = list<[number, number]>(e.growth, size, 'growth')
  check(growth.every((g, i) => Array.isArray(g) && int(g[0], 0, 0xFFFFFFFF) && tile(g[1]) && (i === 0 || g[0] > growth[i - 1]![0] || (g[0] === growth[i - 1]![0] && g[1] > growth[i - 1]![1]))), 'growth schedule is invalid')
  const cooldowns = list<[string, number]>(e.cooldowns, 100_000, 'cooldown')
  check(cooldowns.every(c => Array.isArray(c) && str(c[0], 100) && int(c[1], 0, 0xFFFFFFFF)), 'cooldowns are invalid')
  check(isObject(e.ledger) && Object.entries(e.ledger).every(([k, l]) => owner(Number(k)) && isObject(l)), 'ledger is invalid')
  for (const l of Object.values(e.ledger)) {
    for (const kind of ['created', 'produced', 'recovered', 'consumed', 'destroyed', 'equipped'] as const) goodsMap(l[kind], rules, 'ledger')
    check(int(l.births, 0, 1e9) && int(l.deaths, 0, 1e9) && int(l.transitions, 0, 1e9), 'ledger counters are invalid')
  }
  const events = list<State['events'][number]>(e.events, 256, 'event')
  check(events.every(ev => isObject(ev) && int(ev.tick, 0, 0xFFFFFFFF) && int(ev.player, 0, players.length) && str(ev.type, 40) && str(ev.text, 300)), 'events are invalid')
  const results = list<State['results'][number]>(e.results, 128, 'result')
  check(results.every(r => isObject(r) && int(r.tick, 0, 0xFFFFFFFF) && int(r.player, 0, players.length) && int(r.seq, 0, Number.MAX_SAFE_INTEGER) && str(r.type, 40) && typeof r.ok === 'boolean'), 'results are invalid')
  const pending = list<Command>(e.pending, 10_000, 'command')
  check(pending.every((c, i) => isObject(c) && int(c.tick, e.tick, 0xFFFFFFFF) && owner(c.player) && int(c.seq, 0, Number.MAX_SAFE_INTEGER) && str(c.type, 40) && JSON.stringify(c).length <= 4096 && (i === 0 || c.tick >= pending[i - 1]!.tick)), 'pending commands are invalid')
  let mission: MissionState | null = null
  if (e.mission !== null) {
    check(isObject(e.mission), 'mission is malformed')
    let definition: MissionDefinition
    try { definition = validateMission(e.mission.definition, { players: players.length, width, height, goods: rules.goods, buildings: rules.buildings.map(b => b.id) }) }
    catch (error) { throw damaged(error instanceof MissionError ? error.message : 'mission is invalid') }
    const objectives = e.mission.objectives, fired = e.mission.fired, outcome = e.mission.outcome
    check(isObject(objectives) && Object.keys(objectives).length === definition.objectives.length && definition.objectives.every(o => ['open', 'complete', 'failed'].includes((objectives as Record<string, string>)[o.id]!)), 'mission objectives are invalid')
    check(Array.isArray(fired) && fired.length <= definition.triggers.length && new Set(fired).size === fired.length && fired.every(t => definition.triggers.some(d => d.id === t)), 'mission triggers are invalid')
    check(isObject(outcome) && Object.keys(outcome).length === players.length && Object.entries(outcome).every(([k, v]) => owner(Number(k)) && ['playing', 'won', 'lost'].includes(v as string)), 'mission outcome is invalid')
    mission = { definition, objectives: structuredClone(objectives) as MissionState['objectives'], fired: [...fired], outcome: structuredClone(outcome) as MissionState['outcome'] }
  }
  return {
    mission,
    schema: 1, tick: e.tick, random: [...e.random] as State['random'], nextId: e.nextId, navigation: e.navigation, map, players: decodedPlayers,
    settlers: new Map(settlers.map(s => [s.id, structuredClone(s)])), buildings: new Map(buildings.map(b => [b.id, structuredClone(b)])), stacks: new Map(stacks.map(s => [s.id, structuredClone(s)])), jobs: new Map(jobs.map(j => [j.id, structuredClone(j)])),
    claims: new Map(claims), growth: structuredClone(growth), cooldowns: new Map(cooldowns), ledger: structuredClone(e.ledger) as Record<number, Ledger>, events: structuredClone(events), results: structuredClone(results), pending: structuredClone(pending),
  }
}

function validateProgram(p: unknown, size: number, nextId: number, label: string): void {
  check(isObject(p) && str(p.kind, 40) && int(p.ref, 0, nextId) && Array.isArray(p.steps) && p.steps.length <= 32 && int(p.pc, -1, p.steps.length), `${label} program is invalid`)
  for (const op of p.steps as Op[]) {
    check(isObject(op), `${label} program step is invalid`)
    if (op.op === 'go') check(int(op.tile, 0, size - 1) && (op.adjacent === undefined || typeof op.adjacent === 'boolean'), `${label} walk step is invalid`)
    else if (op.op === 'work') check(int(op.ticks, 0, 1e6), `${label} work step is invalid`)
    else if (op.op === 'do') check(str(op.effect, 40) && (op.args === undefined || (isObject(op.args) && Object.values(op.args).every(v => str(v, 100) || Number.isFinite(v)))), `${label} effect step is invalid`)
    else if (op.op === 'enter') check(int(op.building, 1, nextId), `${label} enter step is invalid`)
    else check(op.op === 'leave', `${label} program step is unknown`)
  }
}

/** Restores a saved game for the given rules. Mismatched rules are refused rather than reinterpreted. */
export function restore(raw: unknown, rules: RulesProfile): Session {
  if (typeof raw === 'string') { if (raw.length > MAX_SAVE_BYTES) throw new SaveError('too-large', 'Saved game is too large.'); try { raw = JSON.parse(raw) } catch { throw new SaveError('not-a-save', 'Saved game is not readable.') } }
  const envelope = migrate(raw)
  const identity = rulesIdentity(rules)
  if (!isObject(envelope.rules) || envelope.rules.id !== identity.id || envelope.rules.version !== identity.version || envelope.rules.digest !== identity.digest) throw new SaveError('incompatible-rules', `This save uses rules ${String(envelope.rules?.id)} ${String(envelope.rules?.version)}, which this build does not provide.`)
  check(isObject(envelope.content) && str(envelope.content.id) && str(envelope.content.digest, 128), 'content identity is missing')
  const state = decodeState(envelope, rules)
  if (checksum(state) !== envelope.checksum) throw damaged('checksum does not match')
  return openSession(rules, state, { id: envelope.content.id, digest: envelope.content.digest })
}
