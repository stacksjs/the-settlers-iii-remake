import { expect, test } from 'bun:test'
import type { RulesProfile } from '../../resources/game/engine'
import { audit, createSession, describeMap, PUBLISHED_RULES, record, restore, ROMAN_ENGINEERING as rules, save, validateRules, verify } from '../../resources/game/engine'
import { order } from '../fixtures/engine'

// The public scenario and command boundary exercises real recruitment, routes,
// tools and construction. No worker, goods, territory or clock is rewritten.
function opening(profile: RulesProfile = rules, reachableBuilder = false) {
  const s = createSession({ rules: profile, seed: 5, map: describeMap(profile, { width: 96, height: 96, base: 'grass', features: [] }), players: [{
    name: 'Rome', civilization: 'roman', start: { x: 40, y: 40 }, settings: { builderLimit: reachableBuilder ? 2 : 12 }, scenario: {
      buildings: [{ type: 'castle', x: 40, y: 40 }],
      settlers: [{ profession: 'builder', x: 40, y: 10 }, ...(reachableBuilder ? [{ profession: 'builder', x: 40, y: 58 }] : []),
        ...Array.from({ length: 12 }, (_, i) => ({ profession: 'carrier', x: 32 + i, y: 46 }))],
    },
  }], piles: [{ x: 38, y: 44, good: 'plank', amount: 4 }, { x: 39, y: 44, good: 'stone', amount: 4 }, { x: 40, y: 44, good: 'hammer', amount: 2 }] })
  expect(s.skipped).toEqual({})
  expect(s.view(1).owner[10 * 96 + 40]).toBe(0)
  expect(s.placement(1, 'storage', 40, 22)).toBeNull()
  order(s, 'build', { building: 'storage', x: 40, y: 22 })
  return s
}

test('an unreachable idle builder does not prevent reachable carriers from building with actual tools', () => {
  const s = opening(), created = structuredClone(s.state.ledger[1]!.created)
  s.advance(5000)
  expect(s.view(1).buildings.find(b => b.type === 'storage')?.phase).toBe('active')
  expect(s.view(1).settlers.find(p => p.profession === 'builder' && p.y === 10)?.x).toBe(40)
  expect(s.state.ledger[1]!.created).toEqual(created)
  expect(audit(s.context)).toEqual([])
})

test('a farther reachable builder is preferred over an unreachable skilled worker without taking a new hammer', () => {
  const s = opening(rules, true)
  let mostBuilders = 0
  for (let tick = 0; tick < 5000; tick++) { s.advance(1); mostBuilders = Math.max(mostBuilders, s.view(1).professions.builder ?? 0) }
  expect(mostBuilders).toBe(2)
  expect(s.view(1).buildings.find(b => b.type === 'storage')?.phase).toBe('active')
  expect(s.view(1).goods.hammer).toBe(2)
  expect(audit(s.context)).toEqual([])
})


test('the current staffing correction survives save and replay while legacy profiles keep the stalled behavior', () => {
  const legacy = opening(PUBLISHED_RULES.find(p => p.version === '0.12.0')!)
  legacy.advance(5000)
  expect(legacy.view(1).buildings.find(b => b.type === 'storage')?.phase).toBe('building')
  const s = opening(), recorder = record(s), copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
  recorder.advance(5000); copy.advance(5000)
  expect(s.view(1).buildings.find(b => b.type === 'storage')?.phase).toBe('active')
  expect(copy.checksum()).toBe(s.checksum())
  expect(verify(recorder.replay(), PUBLISHED_RULES)).toMatchObject({ ok: true, checksum: s.checksum() })
  expect(audit(copy.context)).toEqual([])
})

test('staffing routing is a validated evidenced rule', () => {
  const unknown = structuredClone(rules)
  Object.assign(unknown, { staffingRouting: 'teleport' })
  expect(() => validateRules(unknown)).toThrow('Unknown staffing routing policy')
  const unrecorded = structuredClone(rules)
  delete unrecorded.evidence.staffingRouting
  expect(() => validateRules(unrecorded)).toThrow('staffingRouting has no evidence record')
})

function islandOpening(profile: RulesProfile, blocked: 'tool' | 'carrier', reachableTool = true) {
  const center = { x: 48, y: 28 }, ring = [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 0], [-1, -1]]
  const s = createSession({ rules: profile, seed: 5, map: describeMap(profile, { width: 96, height: 96, base: 'grass', features: ring.map(([x, y]) => ({ kind: 'terrain' as const, id: 'water', x: center.x + x!, y: center.y + y!, radius: 0 })) }), players: [{
    name: 'Rome', civilization: 'roman', start: { x: 40, y: 40 }, scenario: {
      buildings: [{ type: 'castle', x: 40, y: 40 }],
      settlers: [...(blocked === 'carrier' ? [{ profession: 'carrier', ...center }] : []), ...Array.from({ length: 12 }, (_, i) => ({ profession: 'carrier', x: 32 + i, y: 46 }))],
    },
  }], piles: [{ x: 38, y: 44, good: 'plank', amount: 4 }, { x: 39, y: 44, good: 'stone', amount: 4 },
    ...(blocked === 'tool' ? [{ ...center, good: 'hammer', amount: 2 }] : []), ...(reachableTool ? [{ x: 40, y: 28, good: 'hammer', amount: 2 }] : [])] })
  expect(s.skipped).toEqual({})
  order(s, 'build', { building: 'storage', x: 40, y: 22 })
  return s
}

for (const blocked of ['tool', 'carrier'] as const) {
  test(`a disconnected ${blocked} is skipped before assigning an equipment trip`, () => {
    const s = islandOpening(rules, blocked), created = structuredClone(s.state.ledger[1]!.created)
    let unreachable = false
    for (let tick = 0; tick < 5000; tick++) { s.advance(1); unreachable ||= s.view(1).settlers.some(p => p.diagnostic === 'unreachable') }
    expect(unreachable).toBe(false)
    expect(s.view(1).buildings.find(b => b.type === 'storage')?.phase).toBe('active')
    if (blocked === 'tool') expect(s.view(1).stacks.find(p => p.tile === 28 * 96 + 48 && p.good === 'hammer')?.amount).toBe(2)
    else expect(s.view(1).settlers.find(p => p.x === 48 && p.y === 28)?.profession).toBe('carrier')
    expect(s.state.ledger[1]!.created).toEqual(created)
    expect(audit(s.context)).toEqual([])
  })
}

test('no reachable tool means no reservations, grants or worker relocation', () => {
  const s = islandOpening(rules, 'tool', false), before = structuredClone(s.state.ledger[1]!.created)
  s.advance(1000)
  expect(s.view(1).buildings.find(b => b.type === 'storage')).toMatchObject({ phase: 'building', shortage: 'tool:hammer' })
  expect(s.view(1).professions.builder ?? 0).toBe(0)
  expect(s.view(1).goods.hammer).toBe(2)
  expect([...s.state.stacks.values()].filter(p => p.good === 'hammer').every(p => p.reservedOut === 0)).toBe(true)
  expect(s.state.ledger[1]!.created).toEqual(before)
  expect(audit(s.context)).toEqual([])
})
