import { expect, test } from 'bun:test'
import { inspectBuildingAt, snapshot } from '../../resources/game/controller'
import { audit, createSession, describeMap, PUBLISHED_RULES, restore, ROMAN_ENGINEERING as rules, save } from '../../resources/game/engine'
import { order, until } from '../fixtures/engine'

// The public controller selects an actual session building. Browser input
// separately proves delivery to this seam; neither check measures Gold behavior.
test('a storage construction site can be inspected at its passable center', () => {
  const s = createSession({ rules, seed: 5, map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: [] }),
    players: [{ name: 'Rome', civilization: 'roman', start: { x: 48, y: 48 } }],
  })
  expect(s.skipped).toEqual({})
  order(s, 'build', { building: 'storage', x: 32, y: 48 })
  const storage = s.view(1).buildings.find(b => b.type === 'storage')!
  expect(storage).toBeDefined()
  const before = s.checksum()
  const id = inspectBuildingAt(s, 1, { x: 32, y: 48 })
  expect(id).toBe(storage.id)
  expect(snapshot(s, id, '', 0).selected).toMatchObject({ id: storage.id, type: 'storage', phase: 'building' })
  expect(s.checksum()).toBe(before)
  expect(audit(s.context)).toEqual([])
  s.dispose()
})

test('selection covers protected storage ground, blocked edges and the door while leaving unrelated ground empty', () => {
  const s = createSession({ rules, seed: 5, map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: [] }),
    players: [{ name: 'Rome', civilization: 'roman', start: { x: 48, y: 48 }, scenario: { buildings: [{ type: 'castle', x: 48, y: 48 }, { type: 'storage', x: 32, y: 48 }], settlers: [] } }],
  })
  expect(s.skipped).toEqual({})
  const storage = s.view(1).buildings.find(b => b.type === 'storage')!, castle = s.view(1).buildings.find(b => b.type === 'castle')!
  const before = s.checksum()
  // Independent literals from the pinned stock.xml: passable interior, outer
  // protected corner, blocked edge and door. The castle keeps its own panel.
  for (const [x, y] of [[32, 48], [33, 48], [27, 43], [30, 44], [32, 52]]) expect(inspectBuildingAt(s, 1, { x: x!, y: y! })).toBe(storage.id)
  expect(inspectBuildingAt(s, 1, { x: 48, y: 48 })).toBe(castle.id)
  expect(snapshot(s, inspectBuildingAt(s, 1, { x: 48, y: 48 }), '', 0).selected?.type).toBe('castle')
  for (const [x, y] of [[1, 1], [-1, 48], [96, 0], [126, 43], [31.5, 48], [NaN, 48]]) expect(inspectBuildingAt(s, 1, { x: x!, y: y! })).toBeNull()
  expect(snapshot(s, inspectBuildingAt(s, 1, { x: 1, y: 1 }), '', 0).selected).toBeNull()
  expect(s.checksum()).toBe(before)
  expect(audit(s.context)).toEqual([])
  s.dispose()
})

test('storage inspection survives a construction save, physical completion and a completed save without changing simulation state', () => {
  const s = createSession({ rules, seed: 5, map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: [] }),
    players: [{ name: 'Rome', civilization: 'roman', start: { x: 48, y: 48 } }],
  })
  order(s, 'build', { building: 'storage', x: 32, y: 48 })
  const id = s.view(1).buildings.find(b => b.type === 'storage')!.id
  const copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
  for (const live of [s, copy]) {
    const before = live.checksum()
    expect(snapshot(live, inspectBuildingAt(live, 1, { x: 32, y: 48 }), '', 0).selected).toMatchObject({ id, phase: 'building' })
    expect(live.checksum()).toBe(before)
    until(live, () => live.view(1).buildings.find(b => b.id === id)?.phase === 'active', 6000)
    const completed = live.checksum()
    expect(snapshot(live, inspectBuildingAt(live, 1, { x: 32, y: 48 }), '', 0).selected).toMatchObject({ id, phase: 'active', status: 'Ready' })
    expect(live.checksum()).toBe(completed)
    expect(audit(live.context)).toEqual([])
  }
  expect(copy.checksum()).toBe(s.checksum())
  const completedCopy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
  expect(snapshot(completedCopy, inspectBuildingAt(completedCopy, 1, { x: 32, y: 48 }), '', 0).selected).toEqual(snapshot(s, id, '', 0).selected)
  expect(completedCopy.checksum()).toBe(s.checksum())
  completedCopy.dispose(); copy.dispose(); s.dispose()
}, 30_000)

test('visible and concealed foreign storage areas never open the own-building inspector', () => {
  const s = createSession({ rules, seed: 5, map: describeMap(rules, { width: 64, height: 64, base: 'grass', features: [] }), players: [
    { name: 'Rome', civilization: 'roman', start: { x: 16, y: 16 }, scenario: { buildings: [{ type: 'storage', x: 16, y: 16 }], settlers: [{ profession: 'carrier', x: 31, y: 16 }] } },
    { name: 'Other', civilization: 'roman', start: { x: 48, y: 48 }, scenario: { buildings: [{ type: 'storage', x: 32, y: 16 }, { type: 'storage', x: 48, y: 48 }], settlers: [] } },
  ] })
  expect(s.skipped).toEqual({})
  expect(s.view(1).buildings.some(b => b.owner === 2 && b.x === 32)).toBe(true)
  expect(s.view(1).buildings.some(b => b.owner === 2 && b.x === 48)).toBe(false)
  const before = s.checksum()
  for (const [x, y] of [[32, 16], [30, 12], [48, 48]]) expect(inspectBuildingAt(s, 1, { x: x!, y: y! })).toBeNull()
  expect(snapshot(s, inspectBuildingAt(s, 1, { x: 32, y: 16 }), '', 0).selected).toBeNull()
  expect(inspectBuildingAt(s, 2, { x: 32, y: 16 })).toBe(s.view(2).buildings.find(b => b.x === 32)!.id)
  expect(s.checksum()).toBe(before)
  expect(audit(s.context)).toEqual([])
  s.dispose()
})

test('inspecting a passable storage center leaves ordinary movement through it intact', () => {
  const s = createSession({ rules, seed: 5, map: describeMap(rules, { width: 32, height: 32, base: 'grass', features: [] }),
    players: [{ name: 'Rome', civilization: 'roman', start: { x: 16, y: 16 }, scenario: { buildings: [{ type: 'storage', x: 16, y: 16 }], settlers: [{ profession: 'swordsman', x: 15, y: 16 }] } }],
  })
  expect(s.skipped).toEqual({})
  const soldier = s.view(1).settlers[0]!, before = s.checksum()
  expect(snapshot(s, inspectBuildingAt(s, 1, { x: 16, y: 16 }), '', 0).selected?.type).toBe('storage')
  expect(s.checksum()).toBe(before)
  order(s, 'move-soldiers', { soldiers: [soldier.id], x: 17, y: 16 })
  until(s, () => s.view(1).settlers[0]?.action === 'walking', 20)
  expect(s.view(1).settlers[0]).toMatchObject({ action: 'walking', next: 16 * 32 + 16 })
  until(s, () => s.view(1).settlers[0]?.x === 17, 100)
  expect(s.view(1).settlers[0]).toMatchObject({ x: 17, y: 16 })
  expect(audit(s.context)).toEqual([])
  s.dispose()
})
