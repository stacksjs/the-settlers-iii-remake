import { expect, test } from 'bun:test'
import type { RulesProfile } from '../../resources/game/engine'
import { audit, createSession, describeMap, PUBLISHED_RULES, record, restore, ROMAN_ENGINEERING as rules, save, validateRules, verify } from '../../resources/game/engine'
import { order } from '../fixtures/engine'

// Public scenario and command boundaries exercise actual resident arrivals.
// This checks engineering pause semantics, not original Gold birth timing.
function residence(profile: RulesProfile = rules, otherPlayer = false) {
  const s = createSession({ rules: profile, seed: 5,
    map: describeMap(profile, { width: 96, height: 96, base: 'grass', features: [] }),
    players: [{ name: 'Rome', civilization: 'roman', start: { x: 40, y: 40 }, scenario: {
      buildings: [{ type: 'castle', x: 40, y: 40 }, { type: 'small-residence', x: 30, y: 42 }],
      settlers: Array.from({ length: 6 }, (_, i) => ({ profession: 'carrier', x: 44 + i, y: 48 })),
    } }, ...(otherPlayer ? [{ name: 'Second', civilization: 'roman', start: { x: 76, y: 76 }, scenario: { buildings: [{ type: 'castle', x: 76, y: 76 }], settlers: [] } }] : [])],
  })
  expect(s.skipped).toEqual({})
  s.advance(40)
  const b = s.view(1).buildings.find(b => b.type === 'small-residence')!
  expect(s.state.ledger[1]!.births).toBe(1)
  return { s, id: b.id }
}

test('paused residences stop adding settlers and resume with their remaining arrival interval', () => {
  const { s, id } = residence()
  order(s, 'suspend', { building: id, suspended: true })
  s.advance(399)
  expect(s.state.tick).toBe(440)
  expect(s.view(1).buildings.find(b => b.id === id)?.suspended).toBe(true)
  expect(s.state.ledger[1]!.births).toBe(1)
  order(s, 'suspend', { building: id, suspended: false })
  s.advance(159)
  expect(s.state.tick).toBe(600)
  expect(s.state.ledger[1]!.births).toBe(1)
  s.advance(1)
  expect(s.state.ledger[1]!.births).toBe(2)
  expect(audit(s.context)).toEqual([])
})

test('repeated pause and resume orders do not reset or double-transform the resident clock', () => {
  const { s, id } = residence()
  order(s, 'suspend', { building: id, suspended: true })
  order(s, 'suspend', { building: id, suspended: true })
  s.advance(398)
  order(s, 'suspend', { building: id, suspended: false })
  order(s, 'suspend', { building: id, suspended: false })
  s.advance(158)
  expect(s.state.tick).toBe(600)
  expect(s.state.ledger[1]!.births).toBe(1)
  s.advance(1)
  expect(s.state.ledger[1]!.births).toBe(2)
  expect(audit(s.context)).toEqual([])
})

test('a mid-pause save and replay preserve the remaining interval and population ledger', () => {
  const { s, id } = residence(), recorder = record(s)
  expect(recorder.enqueue({ tick: 40, player: 1, seq: 0, type: 'suspend', building: id, suspended: true })).toBeNull()
  recorder.advance(200)
  const copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
  recorder.advance(200); copy.advance(200)
  expect(copy.checksum()).toBe(s.checksum())
  expect(s.state.ledger[1]!.births).toBe(1)
  for (const target of [recorder, copy]) expect(target.enqueue({ tick: 440, player: 1, seq: 1, type: 'suspend', building: id, suspended: false })).toBeNull()
  recorder.advance(160); copy.advance(160)
  expect(s.state.ledger[1]!.births).toBe(1)
  recorder.advance(1); copy.advance(1)
  expect(s.state.ledger[1]!.births).toBe(2)
  expect(copy.checksum()).toBe(s.checksum())
  expect(verify(recorder.replay(), PUBLISHED_RULES)).toMatchObject({ ok: true, checksum: s.checksum() })
  expect(audit(copy.context)).toEqual([])
})

test('a foreign or malformed pause cannot change a residence arrival deadline', () => {
  const { s, id } = residence(rules, true)
  expect(s.enqueue({ tick: 40, player: 2, seq: 0, type: 'suspend', building: id, suspended: true })).toBeNull()
  expect(s.enqueue({ tick: 40, player: 1, seq: 0, type: 'suspend', building: id, suspended: 'yes' })).toBeNull()
  s.advance(1)
  expect(s.state.results.slice(-2).every(result => !result.ok)).toBe(true)
  expect(s.view(1).buildings.find(b => b.id === id)?.suspended).toBe(false)
  s.advance(159)
  expect(s.state.ledger[1]!.births).toBe(1)
  s.advance(1)
  expect(s.state.ledger[1]!.births).toBe(2)
  expect(audit(s.context)).toEqual([])
})

test('demolishing a paused residence cannot create any remaining residents', () => {
  const { s, id } = residence()
  order(s, 'suspend', { building: id, suspended: true })
  s.advance(199)
  order(s, 'demolish', { building: id })
  s.advance(2000)
  expect(s.view(1).buildings.some(b => b.id === id)).toBe(false)
  expect(s.state.ledger[1]!.births).toBe(1)
  expect(audit(s.context)).toEqual([])
})

test('published 0.16 saves and replays retain their previous paused residence arrivals', () => {
  const legacy = PUBLISHED_RULES.find(profile => profile.version === '0.16.0')!
  const { s, id } = residence(legacy), recorder = record(s)
  expect(recorder.enqueue({ tick: 40, player: 1, seq: 0, type: 'suspend', building: id, suspended: true })).toBeNull()
  recorder.advance(200)
  const copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
  recorder.advance(200); copy.advance(200)
  expect(s.state.ledger[1]!.births).toBe(3)
  expect(copy.checksum()).toBe(s.checksum())
  expect(verify(recorder.replay(), PUBLISHED_RULES)).toMatchObject({ ok: true, checksum: s.checksum() })
})

test('residence pause semantics must be validated and evidenced', () => {
  const unknown = structuredClone(rules)
  Object.assign(unknown, { residenceSuspension: 'discard-progress' })
  expect(() => validateRules(unknown)).toThrow('Unknown residence suspension policy')
  const unrecorded = structuredClone(rules)
  delete unrecorded.evidence.residenceSuspension
  expect(() => validateRules(unrecorded)).toThrow('residenceSuspension has no evidence record')
})
