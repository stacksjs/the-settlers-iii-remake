import type { Command, Session } from '../../resources/game/engine'
import { PUBLISHED_RULES, restore, save } from '../../resources/game/engine'
import { duelSession, playableDuelSeed } from '../../resources/game/duel'

/** Simulation ticks per broadcast turn: a quarter of a second at the rules' 20 ticks a second. */
export const TURN_TICKS = 5
/** Orders one player may queue in a single turn. The rest are refused, so one tab cannot flood the room. */
export const MAX_ORDERS_PER_TURN = 24
const MAX_FIELD_BYTES = 2048
const RESERVED = new Set(['tick', 'player', 'seq', 'type'])
const TYPE = /^[a-z][a-z0-9-]{0,31}$/

export interface Seat { userId: number, name: string, player: number }
export interface Turn {
  /** Consecutive from 1. A client that misses one asks for a snapshot. */
  n: number
  /** Tick the turn starts at: its commands execute here, then the turn runs `ticks` ticks. */
  from: number
  ticks: number
  commands: Command[]
  /** State checksum once the turn has run. Every client compares its own against it. */
  checksum: string
}
export type RoomStatus = 'lobby' | 'running' | 'over'
export type Outcome = 'playing' | 'won' | 'lost'

interface Order { player: number, type: string, fields: Record<string, unknown> }

/**
 * One online match. The room owns the authoritative simulation: players send
 * orders, the room stamps their tick, player and sequence, validates them with
 * the engine, advances the world and publishes each turn. Clients replay the
 * same turns on their own copy of the simulation and compare checksums, so a
 * client that falls out of step is detected and handed a fresh snapshot.
 *
 * The room knows nothing about transport; `Rooms` and the actions publish its
 * turns through Stacks realtime.
 */
export class Room {
  readonly seats: Seat[] = []
  status: RoomStatus = 'lobby'
  seed = 0
  private session: Session | null = null
  private pending: Order[] = []
  private counts = new Map<number, number>()
  private next = new Map<number, number>()
  private history: Turn[] = []
  private n = 0
  touched = Date.now()

  constructor(readonly code: string, host: { id: number, name: string }, seed: number) {
    this.seed = playableDuelSeed(seed)
    this.seats.push({ userId: host.id, name: host.name, player: 1 })
  }

  get host(): Seat { return this.seats[0]! }
  get turn(): number { return this.n }
  get tick(): number { return this.session?.state.tick ?? 0 }
  seatOf(userId: number): Seat | undefined { return this.seats.find(seat => seat.userId === userId) }

  /** Takes the next free seat. Joining twice is the same seat, so a reload does not fail. */
  join(user: { id: number, name: string }): Seat {
    const existing = this.seatOf(user.id)
    if (existing) return existing
    if (this.status !== 'lobby') throw new RoomError('The match has already started.', 409)
    if (this.seats.length >= 2) throw new RoomError('This room is full.', 409)
    const seat: Seat = { userId: user.id, name: user.name, player: this.seats.length + 1 }
    this.seats.push(seat)
    this.touched = Date.now()
    return seat
  }

  leave(userId: number): void {
    if (this.status !== 'lobby') return
    const at = this.seats.findIndex(seat => seat.userId === userId)
    if (at < 0 || at === 0) return
    this.seats.splice(at, 1)
    this.seats.forEach((seat, index) => { seat.player = index + 1 })
  }

  start(userId: number): void {
    if (userId !== this.host.userId) throw new RoomError('Only the host can start the match.', 403)
    if (this.status !== 'lobby') throw new RoomError('The match has already started.', 409)
    if (this.seats.length < 2) throw new RoomError('Wait for the second player to join.', 409)
    this.session = duelSession(this.seed)
    this.status = 'running'
    this.touched = Date.now()
  }

  /** Queues an order from a seated player. The seat, not the request, decides whose order it is. */
  submit(userId: number, type: unknown, fields: unknown): void {
    const seat = this.seatOf(userId)
    if (!seat) throw new RoomError('You are not in this match.', 403)
    if (this.status !== 'running') throw new RoomError('The match is not running.', 409)
    if (typeof type !== 'string' || !TYPE.test(type)) throw new RoomError('That order is not valid.', 422)
    const extra = fields && typeof fields === 'object' && !Array.isArray(fields) ? fields as Record<string, unknown> : {}
    const encoded = JSON.stringify(extra)
    if (encoded.length > MAX_FIELD_BYTES) throw new RoomError('That order is too large.', 413)
    const clean: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(JSON.parse(encoded) as Record<string, unknown>)) if (!RESERVED.has(key)) clean[key] = value
    const used = this.counts.get(seat.player) ?? 0
    if (used >= MAX_ORDERS_PER_TURN) throw new RoomError('Too many orders at once. Wait a moment.', 429)
    this.counts.set(seat.player, used + 1)
    this.pending.push({ player: seat.player, type, fields: clean })
    this.touched = Date.now()
  }

  /** Runs one turn: stamp and validate the queued orders, advance the world, report the result. */
  step(): Turn {
    const session = this.session
    if (!session || this.status !== 'running') throw new RoomError('The match is not running.', 409)
    const from = session.state.tick, commands: Command[] = []
    for (const order of this.pending) {
      const seq = this.next.get(order.player) ?? 0
      const command = { ...order.fields, tick: from, player: order.player, seq, type: order.type } as Command
      this.next.set(order.player, seq + 1)
      // A refused order is dropped here, and consumes its sequence number so every client counts alike.
      if (!session.enqueue(command)) commands.push(command)
    }
    this.pending = []
    this.counts.clear()
    session.advance(TURN_TICKS)
    const turn: Turn = { n: ++this.n, from, ticks: TURN_TICKS, commands, checksum: session.checksum() }
    this.history.push(turn)
    if (this.history.length > 240) this.history.shift()
    this.touched = Date.now()
    if (this.outcomeOf(1) !== 'playing' || this.outcomeOf(2) !== 'playing') this.status = 'over'
    return turn
  }

  /** How the match stands for a player, from the mission the engine itself evaluates. */
  outcomeOf(player: number): Outcome {
    return this.session?.state.mission?.outcome[String(player)] ?? 'playing'
  }

  /** The whole world and the turn it is at, to start a client from or to put one back in step. */
  snapshot(): { turn: number, tick: number, seed: number, envelope: unknown } {
    if (!this.session) throw new RoomError('The match has not started.', 409)
    return { turn: this.n, tick: this.session.state.tick, seed: this.seed, envelope: save(this.session) }
  }

  turnsSince(after: number): Turn[] | null {
    if (after >= this.n) return []
    const first = this.history[0]
    if (!first || after + 1 < first.n) return null
    return this.history.filter(turn => turn.n > after)
  }

  close(): void {
    this.session?.dispose()
    this.session = null
    this.status = 'over'
  }

  /** The room's public face: what the lobby shows, never the simulation. */
  describe() {
    return {
      code: this.code, status: this.status, seed: this.seed, turn: this.n, tick: this.tick,
      seats: this.seats.map(seat => ({ name: seat.name, player: seat.player, host: seat.userId === this.host.userId })),
      outcome: { 1: this.outcomeOf(1), 2: this.outcomeOf(2) },
    }
  }
}

/** The HTTP statuses a refusal can carry. */
export type RefusalStatus = 401 | 403 | 404 | 409 | 413 | 422 | 429 | 503

export class RoomError extends Error {
  constructor(message: string, readonly status: RefusalStatus) { super(message) }
}

/** Rebuilds a session from a snapshot, as a client or a test does. */
export function sessionFromSnapshot(envelope: unknown): Session {
  return restore(envelope, PUBLISHED_RULES)
}
