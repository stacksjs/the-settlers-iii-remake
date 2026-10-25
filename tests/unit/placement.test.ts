import { expect, test } from 'bun:test'
import { createSession, describeMap, findBuildingSite, ROMAN_ENGINEERING as rules } from '../../resources/game/engine'

const origin = { x: 40, y: 40 }
function remoteClearing(clearing = true) {
  const castle = rules.buildings.find(b => b.id === 'castle')!
  const features = [...castle.footprint, ...castle.protected, castle.door, ...castle.piles.map(p => p.at), ...castle.builders]
    .map(([dx, dy]) => ({ kind: 'terrain' as const, id: 'grass', x: origin.x + dx!, y: origin.y + dy!, radius: 0 }))
  if (clearing) features.push({ kind: 'terrain', id: 'grass', x: 60, y: 43, radius: 6 })
  return createSession({ rules, seed: 5, map: describeMap(rules, { width: 96, height: 96, base: 'water', features }), players: [{ name: 'Rome', civilization: 'roman', start: origin, settlers: {}, goods: {} }] })
}

test('keyboard construction finds a permitted site beyond the former thirteen-tile search', () => {
  const session = remoteClearing(), before = session.checksum()
  expect(session.skipped).toEqual({})
  expect(session.placement(1, 'woodcutter', 58, 41)).toBeNull()
  const found = findBuildingSite(session, 1, 'woodcutter', origin)
  expect(found).toEqual({ x: 58, y: 41 })
  expect(session.checksum()).toBe(before)
  expect(session.enqueue({ tick: session.state.tick, player: 1, seq: 0, type: 'build', building: 'woodcutter', ...found! })).toBeNull()
  session.advance(1)
  expect(session.view(1).buildings.find(b => b.type === 'woodcutter')).toMatchObject({ x: 58, y: 41 })
})

test('searching from a map corner stays on the map and keeps the nearest-site ordering', () => {
  const session = remoteClearing()
  expect(findBuildingSite(session, 1, 'woodcutter', { x: 0, y: 0 })).toEqual({ x: 58, y: 41 })
  expect(findBuildingSite(session, 1, 'woodcutter', { x: 95, y: 95 })).toEqual({ x: 60, y: 43 })
})

test('a full search cannot invent a site where no land is suitable or belongs to the player', () => {
  expect(findBuildingSite(remoteClearing(false), 1, 'woodcutter', origin)).toBeNull()
  expect(findBuildingSite(remoteClearing(), 2, 'woodcutter', origin)).toBeNull()
})
