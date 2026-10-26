import { expect, test } from 'bun:test'
import { audit, createSession, describeMap, PUBLISHED_RULES, record, restore, ROMAN_ENGINEERING as rules, save, validateRules, verify } from '../../resources/game/engine'

// Public scenario goods and specialist dismissal catch an actual ownership
// transfer. Neither the ledger nor the world's goods are edited by the test.
function scenario(pileOwner: number) {
  return createSession({ rules, seed: 5, map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: [] }), players: [
    { name: 'One', civilization: 'roman', start: { x: 10, y: 10 }, scenario: { buildings: pileOwner === 1 ? [{ type: 'castle', x: 40, y: 40 }] : [], settlers: [{ profession: 'geologist', x: 40, y: 50 }] } },
    { name: 'Two', civilization: 'roman', start: { x: 70, y: 70 }, scenario: { buildings: pileOwner === 2 ? [{ type: 'castle', x: 40, y: 40 }] : [], settlers: [] } },
  ], piles: [{ x: 40, y: 50, good: 'hammer', amount: 3 }] })
}

test('a recovered tool stays owned by its player beside a foreign pile, including replay and restore', () => {
  const s = scenario(2), before = structuredClone(s.state.ledger), recorder = record(s)
  expect(s.skipped).toEqual({})
  expect(audit(s.context)).toEqual([])
  expect(recorder.enqueue({ tick: 0, player: 1, seq: 0, type: 'dismiss', profession: 'geologist', count: 1 })).toBeNull()
  recorder.advance(1)
  expect(s.state.results.at(-1)?.ok).toBe(true)
  const piles = [...s.state.stacks.values()].filter(p => p.good === 'hammer')
  expect(piles.find(p => p.owner === 2)?.amount).toBe(3)
  expect(piles.find(p => p.owner === 1)?.amount).toBe(1)
  expect(audit(s.context)).toEqual([])
  for (const owner of [1, 2]) expect(s.state.ledger[owner]?.created ?? {}).toEqual(before[owner]?.created ?? {})
  expect(verify(recorder.replay(), PUBLISHED_RULES)).toMatchObject({ ok: true, checksum: s.checksum() })
  const copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
  s.advance(40); copy.advance(40)
  expect(copy.checksum()).toBe(s.checksum())
  expect(audit(copy.context)).toEqual([])
})

test('a recovered tool still merges into a compatible same-owner pile', () => {
  const s = scenario(1)
  expect(s.enqueue({ tick: 0, player: 1, seq: 0, type: 'dismiss', profession: 'geologist', count: 1 })).toBeNull()
  s.advance(1)
  const piles = [...s.state.stacks.values()].filter(p => p.good === 'hammer')
  expect(piles.length).toBe(1)
  expect(piles[0]).toMatchObject({ owner: 1, amount: 4 })
  expect(audit(s.context)).toEqual([])
})

test('ground pile ownership is a validated evidenced merge policy', () => {
  const unknown = structuredClone(rules)
  Object.assign(unknown, { groundPileMerging: 'any-owner' })
  expect(() => validateRules(unknown)).toThrow('Unknown ground pile merging policy')
  const unrecorded = structuredClone(rules)
  delete unrecorded.evidence.groundPileMerging
  expect(() => validateRules(unrecorded)).toThrow('groundPileMerging has no evidence record')
})
