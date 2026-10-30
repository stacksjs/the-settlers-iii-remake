import { createBroadcastHub, emit, getServer } from '@stacksjs/realtime'
import type { Turn } from './Room'
import { Room, RoomError, TURN_TICKS } from './Room'

/** Real time between turns: the turn's ticks at the rules' 20 ticks a second. */
export const TURN_MS = TURN_TICKS * 50
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const MAX_ROOMS = 200
const LOBBY_TTL_MS = 30 * 60_000
const OVER_TTL_MS = 10 * 60_000
const IDLE_TTL_MS = 6 * 60 * 60_000

/** The private channel every message of one match travels on. Only seated players may subscribe. */
export const roomChannel = (code: string): string => `private-room.${code}`

/**
 * The matches this server process is running. Online matches use Stacks
 * realtime for delivery, which is a single-process contract: rooms live where
 * the broadcast hub does. Scaling beyond one process would need the
 * application-provided fan-out the realtime package describes.
 */
export class Rooms {
  private rooms = new Map<string, Room>()
  private timers = new Map<string, ReturnType<typeof setInterval>>()
  private reaper: ReturnType<typeof setInterval> | null = null

  constructor(private readonly publish: (code: string, event: string, data: unknown) => void = defaultPublish) {}

  create(host: { id: number, name: string }, seed?: number): Room {
    this.reap()
    if (this.rooms.size >= MAX_ROOMS) throw new RoomError('The server is full of matches. Try again shortly.', 503)
    for (const existing of this.rooms.values()) if (existing.status === 'lobby' && existing.host.userId === host.id) { this.drop(existing.code); break }
    let code = ''
    do { code = Array.from(crypto.getRandomValues(new Uint8Array(5)), byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('') } while (this.rooms.has(code))
    const room = new Room(code, host, seed ?? crypto.getRandomValues(new Uint32Array(1))[0]!)
    this.rooms.set(code, room)
    this.watch()
    return room
  }

  get(code: string): Room {
    const room = this.rooms.get(code.trim().toUpperCase())
    if (!room) throw new RoomError('No match has that code.', 404)
    return room
  }

  join(code: string, user: { id: number, name: string }): Room {
    const room = this.get(code)
    room.join(user)
    this.publish(room.code, 'lobby', room.describe())
    return room
  }

  start(code: string, userId: number): Room {
    const room = this.get(code)
    room.start(userId)
    this.publish(room.code, 'start', room.describe())
    this.timers.set(room.code, setInterval(() => this.tick(room), TURN_MS))
    return room
  }

  /** One turn of one match, published to its channel. A failing simulation ends the match instead of the process. */
  tick(room: Room): Turn | null {
    try {
      const turn = room.step()
      this.publish(room.code, 'turn', turn)
      if (room.status === 'over') this.finish(room)
      return turn
    }
    catch (error) {
      this.publish(room.code, 'error', { message: error instanceof Error ? error.message : 'The match stopped.' })
      this.finish(room)
      return null
    }
  }

  private finish(room: Room): void {
    const timer = this.timers.get(room.code)
    if (timer) clearInterval(timer)
    this.timers.delete(room.code)
    this.publish(room.code, 'over', room.describe())
  }

  private drop(code: string): void {
    const timer = this.timers.get(code)
    if (timer) clearInterval(timer)
    this.timers.delete(code)
    this.rooms.get(code)?.close()
    this.rooms.delete(code)
  }

  private watch(): void {
    if (this.reaper) return
    this.reaper = setInterval(() => this.reap(), 60_000)
    ;(this.reaper as { unref?: () => void }).unref?.()
  }

  reap(now = Date.now()): void {
    for (const [code, room] of this.rooms) {
      const idle = now - room.touched
      if ((room.status === 'lobby' && idle > LOBBY_TTL_MS) || (room.status === 'over' && idle > OVER_TTL_MS) || idle > IDLE_TTL_MS) this.drop(code)
    }
  }

  /** Stops every timer. Used when the process shuts down and between tests. */
  dispose(): void {
    for (const code of [...this.rooms.keys()]) this.drop(code)
    if (this.reaper) clearInterval(this.reaper)
    this.reaper = null
  }

  get size(): number { return this.rooms.size }
}

function defaultPublish(code: string, event: string, data: unknown): void {
  // The broadcast hub runs inside this process; it is created on first use.
  if (!getServer()) createBroadcastHub()
  emit(`room.${code}`, event, data, { private: true })
}

export const rooms = new Rooms()
