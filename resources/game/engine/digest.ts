import type { Player, State } from './state'
import { canonical } from './hash'

// The state checksum (save format 3 onward). Map and fog layers are hashed in
// square chunks; the checksum combines the chunk hashes with the canonical
// entity text. A session keeps the chunk hashes and rehashes only chunks the
// simulation wrote to, so per-tick cost follows what changed instead of the
// map size, while a full recomputation gives the same value on any host.

export const CHUNK = 32
export const LAYERS = ['terrain', 'elevation', 'resource', 'resourceAmount', 'object', 'objectAmount', 'objectSince', 'owner'] as const

/** Which chunks the simulation wrote to since their hashes were last taken. Derived, never saved. */
export interface ChunkDigest { columns: number, rows: number, dirty: Uint8Array, hashes: Uint32Array }

export function createDigest(width: number, height: number): ChunkDigest {
  const columns = Math.ceil(width / CHUNK), rows = Math.ceil(height / CHUNK)
  return { columns, rows, dirty: new Uint8Array(columns * rows).fill(1), hashes: new Uint32Array(columns * rows) }
}

/** Marks the chunk holding a tile as changed. Every write to a map or fog layer during play goes through here. */
export function touch(digest: ChunkDigest, width: number, tile: number): void {
  digest.dirty[Math.floor(Math.floor(tile / width) / CHUNK) * digest.columns + Math.floor((tile % width) / CHUNK)] = 1
}

const PRIME = 0x01000193, OFFSET = 0x811C9DC5

function chunkHash(state: State, players: Player[], chunk: number, columns: number): number {
  const map = state.map, cx = (chunk % columns) * CHUNK, cy = Math.floor(chunk / columns) * CHUNK
  let h = OFFSET
  const byte = (b: number): void => { h ^= b & 255; h = Math.imul(h, PRIME) >>> 0 }
  for (let y = cy; y < Math.min(cy + CHUNK, map.height); y++) {
    for (let x = cx; x < Math.min(cx + CHUNK, map.width); x++) {
      const t = y * map.width + x
      for (const name of LAYERS) { const v = map[name][t]!; byte(v); if (v > 255) { byte(v >> 8); byte(v >> 16); byte(v >> 24) } }
      for (const p of players) byte(p.explored[t]! | (p.visible[t]! << 1))
    }
  }
  return h
}

function combine(state: State, hashes: Uint32Array): string {
  let h = OFFSET
  const byte = (b: number): void => { h ^= b & 255; h = Math.imul(h, PRIME) >>> 0 }
  const word = (n: number): void => { byte(n); byte(n >>> 8); byte(n >>> 16); byte(n >>> 24) }
  word(state.map.width); word(state.map.height); word(hashes.length)
  for (let i = 0; i < hashes.length; i++) word(hashes[i]!)
  const text = canonical(entities(state))
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); byte(c); byte(c >> 8) }
  return h.toString(16).padStart(8, '0')
}

/** Everything in State besides the map and fog layers, in the form saves write it. */
export function entities(state: State) {
  return {
    schema: state.schema, tick: state.tick, random: [...state.random], nextId: state.nextId, navigation: state.navigation,
    players: state.players.map(({ explored: _e, visible: _v, ...p }) => p),
    settlers: [...state.settlers.values()], buildings: [...state.buildings.values()], stacks: [...state.stacks.values()], jobs: [...state.jobs.values()],
    claims: [...state.claims], growth: state.growth, cooldowns: [...state.cooldowns], ledger: Object.fromEntries(Object.entries(state.ledger)),
    events: state.events, results: state.results, pending: state.pending, mission: state.mission,
    ...(state.projectiles ? { projectiles: state.projectiles } : {}),
    ...(state.eyes ? { eyes: state.eyes } : {}),
  }
}

/** The checksum recomputed from scratch. */
export function fullChecksum(state: State): string {
  const digest = createDigest(state.map.width, state.map.height)
  for (let c = 0; c < digest.hashes.length; c++) digest.hashes[c] = chunkHash(state, state.players, c, digest.columns)
  return combine(state, digest.hashes)
}

/** The same checksum, rehashing only chunks marked since the last call. */
export function incrementalChecksum(state: State, digest: ChunkDigest): string {
  for (let c = 0; c < digest.dirty.length; c++) {
    if (!digest.dirty[c]) continue
    digest.hashes[c] = chunkHash(state, state.players, c, digest.columns)
    digest.dirty[c] = 0
  }
  return combine(state, digest.hashes)
}
