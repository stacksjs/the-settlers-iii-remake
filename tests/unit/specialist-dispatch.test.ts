import { expect, test } from 'bun:test'
import type { RulesProfile } from '../../resources/game/engine'
import { audit, createSession, describeMap, PUBLISHED_RULES, record, restore, ROMAN_ENGINEERING as rules, save, validateRules, verify } from '../../resources/game/engine'
import { order } from '../fixtures/engine'

// Public scenario setup and commands exercise actual equipment and movement.
// These cases catch disconnected assignments, not original Gold timings.
function opening(profile: RulesProfile = rules, reachableTool = true) {
  const center = { x: 48, y: 28 }, ring = [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 0], [-1, -1]]
  const s = createSession({ rules: profile, seed: 5,
    map: describeMap(profile, { width: 96, height: 96, base: 'grass', features: ring.map(([x, y]) => ({ kind: 'terrain' as const, id: 'water', x: center.x + x!, y: center.y + y!, radius: 0 })) }),
    players: [{ name: 'Rome', civilization: 'roman', start: { x: 40, y: 40 }, scenario: {
      buildings: [{ type: 'castle', x: 40, y: 40 }],
      settlers: Array.from({ length: 12 }, (_, i) => ({ profession: 'carrier', x: 32 + i, y: 46 })),
    } }],
    piles: [{ ...center, good: 'shovel', amount: 1 }, ...(reachableTool ? [{ x: 32, y: 44, good: 'shovel', amount: 1 }] : [])],
  })
  expect(s.skipped).toEqual({})
  return s
}

test('specialist dispatch skips an isolated shovel and equips from reachable stock', () => {
  const s = opening()
  order(s, 'specialists', { profession: 'pioneer', x: 48, y: 25, count: 1 })
  s.advance(1000)
  expect(s.view(1).professions.pioneer).toBe(1)
  expect(s.view(1).stacks.find(p => p.tile === 28 * 96 + 48 && p.good === 'shovel')?.amount).toBe(1)
  expect(s.state.ledger[1]!.equipped.shovel).toBe(1)
  expect(audit(s.context)).toEqual([])
})

test('an unreachable tool or destination rejects dispatch without reserving goods', () => {
  for (const target of [{ x: 48, y: 25 }, { x: 48, y: 28 }]) {
    const s = opening(rules, target.y === 28)
    expect(s.enqueue({ tick: 0, player: 1, seq: 0, type: 'specialists', profession: 'pioneer', ...target, count: 1 })).toBeNull()
    s.advance(1)
    expect(s.state.results.at(-1)?.ok).toBe(false)
    expect(s.state.jobs.size).toBe(0)
    expect([...s.state.stacks.values()].every(p => p.reservedOut === 0)).toBe(true)
    expect(s.view(1).professions.pioneer ?? 0).toBe(0)
    expect(audit(s.context)).toEqual([])
  }
})

for (const profession of ['carrier', 'pioneer'] as const) {
  test(`an isolated ${profession} does not hide reachable settlers`, () => {
    const center = { x: 48, y: 28 }, ring = [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 0], [-1, -1]]
    const s = createSession({ rules, seed: 5,
      map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: ring.map(([x, y]) => ({ kind: 'terrain' as const, id: 'water', x: center.x + x!, y: center.y + y!, radius: 0 })) }),
      players: [{ name: 'Rome', civilization: 'roman', start: { x: 40, y: 40 }, scenario: {
        buildings: [{ type: 'castle', x: 40, y: 40 }],
        settlers: [{ profession, ...center }, ...Array.from({ length: 12 }, (_, i) => ({ profession: 'carrier', x: 32 + i, y: 46 }))],
      } }], piles: [{ x: 48, y: 31, good: 'shovel', amount: 1 }],
    })
    expect(s.skipped).toEqual({})
    order(s, 'specialists', { profession: 'pioneer', x: 48, y: 25, count: 1 })
    s.advance(1000)
    expect(s.view(1).settlers.find(p => p.x === center.x && p.y === center.y)?.profession).toBe(profession)
    expect(s.view(1).professions.pioneer).toBe(profession === 'pioneer' ? 2 : 1)
    expect(s.state.ledger[1]!.equipped.shovel).toBe(1)
    expect(audit(s.context)).toEqual([])
  })
}

test('reachable dispatch preserves carrier minimums and cannot reserve the same tool twice', () => {
  const s = opening()
  order(s, 'settings', { settings: { carrierRatio: 100 } })
  s.enqueue({ tick: s.state.tick, player: 1, seq: 20, type: 'specialists', profession: 'pioneer', x: 48, y: 25, count: 1 })
  s.advance(1)
  expect(s.state.results.at(-1)?.ok).toBe(false)
  expect(s.state.jobs.size).toBe(0)
  order(s, 'settings', { settings: { carrierRatio: 30 } })
  order(s, 'specialists', { profession: 'pioneer', x: 48, y: 25, count: 2 })
  expect([...s.state.jobs.values()].filter(j => j.kind === 'equip')).toHaveLength(1)
  s.advance(1000)
  expect(s.view(1).professions.pioneer).toBe(1)
  expect(audit(s.context)).toEqual([])
})

test('dispatch save and replay agree while published profiles retain their failed trip', () => {
  const s = opening(), recorder = record(s)
  recorder.enqueue({ tick: 0, player: 1, seq: 0, type: 'specialists', profession: 'pioneer', x: 48, y: 25, count: 1 })
  recorder.advance(1)
  const copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
  recorder.advance(1000); copy.advance(1000)
  expect(copy.checksum()).toBe(s.checksum())
  expect(verify(recorder.replay(), PUBLISHED_RULES)).toMatchObject({ ok: true, checksum: s.checksum() })
  const legacy = opening(PUBLISHED_RULES.find(p => p.version === '0.15.0')!)
  order(legacy, 'specialists', { profession: 'pioneer', x: 48, y: 25, count: 1 })
  legacy.advance(1000)
  expect(legacy.view(1).professions.pioneer ?? 0).toBe(0)
  expect(audit(copy.context)).toEqual([])
})

test('specialist dispatch is a validated evidenced policy', () => {
  const unknown = structuredClone(rules)
  Object.assign(unknown, { specialistDispatch: 'teleport' })
  expect(() => validateRules(unknown)).toThrow('Unknown specialist dispatch policy')
  const unrecorded = structuredClone(rules)
  delete unrecorded.evidence.specialistDispatch
  expect(() => validateRules(unrecorded)).toThrow('specialistDispatch has no evidence record')
})
