import type { Direction, Point } from './geometry'
import type { MissionState } from './mission'
import type { RandomState } from './random'
import type { Goods } from './rules'

export interface MapState {
  width: number, height: number
  /** Index into rules.terrain. */
  terrain: Uint8Array
  elevation: Uint8Array
  /** 0 or 1 + index into rules.goods, with remaining quantity. */
  resource: Uint8Array, resourceAmount: Uint16Array
  /** 0 or 1 + index into rules.objects, with quantity and the tick it last changed. */
  object: Uint8Array, objectAmount: Uint16Array, objectSince: Uint32Array
  /** 0 for unowned, otherwise the owning player id. */
  owner: Uint8Array
}

export interface PlayerSettings {
  carrierRatio: number, builderLimit: number, diggerLimit: number
  /** Goods earlier in this list are transported first. */
  transportPriority: string[]
  /** Relative tool-smith weights and urgent single orders (S3-045). */
  toolWeights: Record<string, number>, urgentTools: string[]
  /** Goods carriers move from doorsteps into storage areas. */
  stored: string[]
  /** Barracks orders: recruit whenever weapons and carriers allow, or work through a queue per class. */
  recruit?: { automatic: boolean, queue: Record<string, number> }
  /** Rank given to soldiers recruited from now on; existing soldiers keep theirs. */
  rank?: number
}
export interface Sign { tile: number, good: string | null, amount: number, until: number }
export interface Player {
  id: number, name: string, civilization: string, controller: 'human' | 'computer' | 'observer'
  settings: PlayerSettings
  explored: Uint8Array, visible: Uint8Array
  signs: Sign[]
  craftCursor: number
}

export type Op =
  | { op: 'go', tile: number, adjacent?: boolean }
  | { op: 'work', ticks: number }
  | { op: 'do', effect: string, args?: Record<string, number | string> }
  | { op: 'enter', building: number }
  | { op: 'leave' }
export interface Program { kind: string, ref: number, steps: Op[], pc: number }

export type Action = 'idle' | 'walking' | 'waiting' | 'working' | 'inside'
/** Present only on soldiers. Order is a target tile, -1 for none or -2 while holding a chosen position; attack and garrison are building ids or 0. */
export interface Soldier {
  rank: number, health: number, cooldown: number, order: number, attack: number, garrison: number
  /** Further destinations after the current order, at most three waypoints in all. */
  route?: number[]
  /** The two ends of a patrol: where the soldier started and the turn-around point. */
  patrol?: [number, number]
  /** A forced move ignores enemies until the soldier arrives. */
  forced?: boolean
}
/** An arrow in flight: it lands on a tile at a tick and hurts whoever it was aimed at if they are still there. */
export interface Projectile { id: number, owner: number, from: number, to: number, target: number, damage: number, fired: number, arrives: number }
export interface Settler {
  id: number, owner: number, profession: string, tool: string | null
  x: number, y: number, dir: Direction
  action: Action
  /** Tile being entered and remaining lattice path, both as tile indices. */
  next: number, path: number[], step: number, stepTicks: number
  waited: number, retries: number
  /** True while this settler holds its resting tile; walkers pass through others. */
  holding: boolean
  cargo: string | null
  program: Program | null
  workplace: number, inside: number
  diagnostic: string | null
  soldier?: Soldier
}

export type StackRole = 'ground' | 'input' | 'output' | 'construction' | 'storage'
export interface Stack { id: number, owner: number, tile: number, building: number, role: StackRole, good: string, amount: number, capacity: number, reservedOut: number, reservedIn: number }

export type Phase = 'leveling' | 'building' | 'active'
export interface Building {
  id: number, owner: number, type: string, x: number, y: number
  phase: Phase, suspended: boolean, order: number
  /** Leveling target and remaining elevation units to move. */
  target: number, levelRemaining: number
  /** Construction units consumed by builders. */
  used: Goods, workRemaining: number
  worker: number, workers: number[]
  workArea: Point
  /** Production state: current cycle progress and the goods it has committed. */
  cycle: number, cycleGoods: Goods, meals: number, shortage: string | null
  residents: number, nextResident: number
}

export type Job =
  | { id: number, kind: 'deliver', owner: number, good: string, source: number, target: number, carrier: number, picked: boolean }
  | { id: number, kind: 'equip', owner: number, tool: string | null, source: number, settler: number, profession: string, building: number, picked: boolean }

/** Goods accounting per player: end stock = created + produced + recovered + gained - consumed - destroyed - equipped - lost. */
export interface Ledger {
  created: Goods, produced: Goods, recovered: Goods, consumed: Goods, destroyed: Goods, equipped: Goods, births: number, deaths: number, transitions: number
  /** Goods that changed owner through capture, received and lost. Absent until the first capture. */
  gained?: Goods, lost?: Goods
}
export interface GameEvent { tick: number, player: number, type: string, text: string, tile?: number, entity?: number }

export interface Command { tick: number, player: number, seq: number, type: string, [key: string]: unknown }
export interface CommandResult { tick: number, player: number, seq: number, type: string, ok: boolean, reason?: string }

export interface State {
  schema: 1
  tick: number
  random: RandomState
  nextId: number
  map: MapState
  players: Player[]
  settlers: Map<number, Settler>
  buildings: Map<number, Building>
  stacks: Map<number, Stack>
  jobs: Map<number, Job>
  /** Object tiles claimed by a worker program, mapped to the settler id. */
  claims: Map<number, number>
  /** Scheduled object growth as [tick, tile], ordered by tick then tile. */
  growth: [number, number][]
  ledger: Record<number, Ledger>
  events: GameEvent[]
  results: CommandResult[]
  /** Failed source/target pairings and other retries suppressed until a tick, so unreachable work cannot spin. */
  cooldowns: Map<string, number>
  /** Commands accepted for future ticks, executed in (tick, player, seq) order. */
  pending: Command[]
  /** Objective and trigger progress for a scenario mission, saved with the world. */
  mission: MissionState | null
  /** Arrows in flight. Absent in saves made before soldiers existed. */
  projectiles?: Projectile[]
  /** Increments whenever static traversal changes, so cached paths can be revalidated. */
  navigation: number
}

export const emptyLedger = (): Ledger => ({ created: {}, produced: {}, recovered: {}, consumed: {}, destroyed: {}, equipped: {}, births: 0, deaths: 0, transitions: 0 })
export const add = (goods: Goods, good: string, amount: number): void => { goods[good] = (goods[good] ?? 0) + amount; if (goods[good] === 0) delete goods[good] }
