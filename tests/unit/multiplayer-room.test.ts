import { afterEach, expect, test } from 'bun:test'
import { findBuildingSite } from '../../resources/game/engine'
import type { Turn } from '../../app/Multiplayer/Room'
import { MAX_ORDERS_PER_TURN, Room, RoomError, sessionFromSnapshot, TURN_TICKS } from '../../app/Multiplayer/Room'
import { Rooms } from '../../app/Multiplayer/Rooms'

const host = { id: 1, name: 'West' }, guest = { id: 2, name: 'East' }
const registries: Rooms[] = []
const started = (): Room => {
  const room = new Room('ABCDE', host, 11)
  room.join(guest)
  room.start(host.id)
  return room
}
afterEach(() => { for (const registry of registries.splice(0)) registry.dispose() })

const siteFor = (room: Room, player: number, type: string) => {
  const mirror = sessionFromSnapshot(room.snapshot().envelope)
  const castle = [...mirror.state.buildings.values()].find(b => b.owner === player && b.type === 'castle')!
  const site = findBuildingSite(mirror, player, type, { x: castle.x, y: castle.y })
  mirror.dispose()
  return site!
}

test('a client that replays the published turns from the snapshot stays in step with the server on every turn', () => {
  const room = started()
  const mirror = sessionFromSnapshot(room.snapshot().envelope)
  const west = siteFor(room, 1, 'woodcutter'), east = siteFor(room, 2, 'woodcutter')
  const turns: Turn[] = []
  room.submit(host.id, 'build', { building: 'woodcutter', x: west.x, y: west.y })
  room.submit(guest.id, 'build', { building: 'woodcutter', x: east.x, y: east.y })
  for (let i = 0; i < 40; i++) turns.push(room.step())
  const orders = turns.flatMap(turn => turn.commands)
  expect(orders.map(command => command.player).sort()).toEqual([1, 2])
  for (const turn of turns) {
    expect(mirror.state.tick).toBe(turn.from)
    for (const command of turn.commands) expect(mirror.enqueue(command)).toBeNull()
    mirror.advance(turn.ticks)
    expect(mirror.checksum()).toBe(turn.checksum)
  }
  expect([...mirror.state.buildings.values()].filter(b => b.type === 'woodcutter').map(b => b.owner).sort()).toEqual([1, 2])
  mirror.dispose(); room.close()
})

test('whose order it is comes from the seat and never from the request', () => {
  const room = started()
  const east = siteFor(room, 2, 'woodcutter')
  room.submit(guest.id, 'build', { building: 'woodcutter', x: east.x, y: east.y, player: 1, tick: 99999, seq: 7, type: 'demolish' })
  const turn = room.step()
  expect(turn.commands).toHaveLength(1)
  expect(turn.commands[0]).toMatchObject({ player: 2, type: 'build', seq: 0, tick: turn.from })
  room.close()
})

test('the engine refuses an order on the other player’s ground on every copy of the world, with the same reason', () => {
  const room = started()
  const mirror = sessionFromSnapshot(room.snapshot().envelope)
  const west = siteFor(room, 1, 'woodcutter')
  room.submit(guest.id, 'build', { building: 'woodcutter', x: west.x, y: west.y })
  const turn = room.step()
  // Orders are validated when they run, so the order travels and every client reaches the same refusal.
  expect(turn.commands).toHaveLength(1)
  for (const command of turn.commands) expect(mirror.enqueue(command)).toBeNull()
  mirror.advance(turn.ticks)
  expect(mirror.checksum()).toBe(turn.checksum)
  const result = mirror.state.results.find(entry => entry.player === 2 && entry.seq === 0)
  expect(result?.ok).toBe(false)
  expect(result?.reason).toBeTruthy()
  expect([...mirror.state.buildings.values()].some(b => b.type === 'woodcutter')).toBe(false)
  mirror.dispose(); room.close()
})

test('only seated players order, only the host starts, and a full or running room takes nobody new', () => {
  const room = new Room('ABCDE', host, 11)
  expect(() => room.start(host.id)).toThrow('second player')
  room.join(guest)
  expect(room.join(guest).player).toBe(2)
  expect(() => room.join({ id: 3, name: 'Late' })).toThrow('full')
  expect(() => room.start(guest.id)).toThrow('Only the host')
  expect(() => room.submit(host.id, 'build', {})).toThrow('not running')
  room.start(host.id)
  expect(() => room.submit(99, 'build', {})).toThrow('not in this match')
  expect(() => room.submit(host.id, 'Build Now!', {})).toThrow('not valid')
  expect(() => room.submit(host.id, 'build', { blob: 'x'.repeat(4000) })).toThrow('too large')
  try { room.join({ id: 4, name: 'Later' }) } catch (error) { expect((error as RoomError).status).toBe(409) }
  room.close()
})

test('one player cannot flood a turn', () => {
  const room = started()
  for (let i = 0; i < MAX_ORDERS_PER_TURN; i++) room.submit(host.id, 'settings', { settings: {} })
  expect(() => room.submit(host.id, 'settings', { settings: {} })).toThrow('Too many')
  room.submit(guest.id, 'settings', { settings: {} })
  room.step()
  room.submit(host.id, 'settings', { settings: {} })
  room.close()
})

test('turns are numbered in a row and a client that missed some can fetch them or is told to take a snapshot', () => {
  const room = started()
  for (let i = 0; i < 5; i++) room.step()
  expect(room.turnsSince(2)!.map(turn => turn.n)).toEqual([3, 4, 5])
  expect(room.turnsSince(5)).toEqual([])
  for (let i = 0; i < 300; i++) room.step()
  expect(room.turnsSince(2)).toBeNull()
  expect(room.snapshot().turn).toBe(305)
  expect(room.snapshot().tick).toBe(305 * TURN_TICKS)
  room.close()
})

test('the registry publishes the lobby, the start and every turn on the match’s channel, and stops its clock when told to', async () => {
  const seen: { code: string, event: string }[] = []
  const registry = new Rooms((code, event) => { seen.push({ code, event }) })
  registries.push(registry)
  const room = registry.create(host, 5)
  expect(room.code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/)
  registry.join(room.code.toLowerCase(), guest)
  registry.start(room.code, host.id)
  await Bun.sleep(700)
  registry.dispose()
  const events = seen.map(entry => entry.event)
  expect(events.slice(0, 2)).toEqual(['lobby', 'start'])
  expect(events.filter(event => event === 'turn').length).toBeGreaterThanOrEqual(2)
  const after = seen.length
  await Bun.sleep(400)
  expect(seen.length).toBe(after)
  expect(() => registry.get('NOPE1')).toThrow('No match has that code')
})

test('a host who opens a second lobby replaces the first, so abandoned codes do not pile up', () => {
  const registry = new Rooms(() => {})
  registries.push(registry)
  const first = registry.create(host, 1), second = registry.create(host, 2)
  expect(registry.size).toBe(1)
  expect(() => registry.get(first.code)).toThrow('No match')
  expect(registry.get(second.code)).toBe(second)
})

test('a client on other game rules refuses the snapshot with a clear reason instead of playing a different game', () => {
  const room = started()
  const envelope = structuredClone(room.snapshot().envelope) as { rules: { version: string } }
  envelope.rules.version = 'other-rules'
  expect(() => sessionFromSnapshot(envelope)).toThrow('which this build does not provide')
  room.close()
})

test('when one side loses its last castle the match ends, the other seat has won, and the room stops taking turns', () => {
  const room = started()
  const mirror = sessionFromSnapshot(room.snapshot().envelope)
  const castle = [...mirror.state.buildings.values()].find(b => b.owner === 2 && b.type === 'castle')!
  mirror.dispose()
  room.submit(guest.id, 'demolish', { building: castle.id })
  let turns = 0
  while (room.status === 'running' && turns++ < 40) room.step()
  expect(room.status).toBe('over')
  expect(room.outcomeOf(1)).toBe('won')
  expect(room.outcomeOf(2)).toBe('lost')
  expect(() => room.step()).toThrow('not running')
  expect(() => room.submit(host.id, 'settings', { settings: {} })).toThrow('not running')
  expect(room.describe().outcome).toEqual({ 1: 'won', 2: 'lost' })
  room.close()
})

test('a guest who leaves the lobby frees the seat, and a host who leaves closes the match for everyone', () => {
  const seen: string[] = []
  const registry = new Rooms((_code, event) => { seen.push(event) })
  registries.push(registry)
  const room = registry.create(host, 9)
  registry.join(room.code, guest)
  registry.leave(room.code, guest.id)
  expect(room.seats).toHaveLength(1)
  registry.join(room.code, { id: 3, name: 'Third' })
  expect(room.seats.map(seat => seat.name)).toEqual(['West', 'Third'])
  registry.leave(room.code, host.id)
  expect(seen).toEqual(['lobby', 'lobby', 'lobby', 'closed'])
  expect(() => registry.get(room.code)).toThrow('No match')
})
