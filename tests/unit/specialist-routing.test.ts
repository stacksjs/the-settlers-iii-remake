import { expect, test } from 'bun:test'
import type { RulesProfile } from '../../resources/game/engine'
import { audit, createSession, describeMap, PUBLISHED_RULES, restore, ROMAN_ENGINEERING, save, validateRules } from '../../resources/game/engine'
import { order, until } from '../fixtures/engine'

function mountain(profile: RulesProfile) {
  return createSession({
    rules: profile, seed: 5,
    map: describeMap(profile, { width: 96, height: 96, seed: 5, base: 'grass', features: [{ kind: 'terrain', id: 'mountain', x: 25, y: 25, radius: 7 }] }),
    players: [{ name: 'Rome', civilization: 'roman', start: { x: 40, y: 40 }, scenario: {
      buildings: [{ type: 'castle', x: 40, y: 40 }, { type: 'coal-mine', x: 25, y: 25 }],
      settlers: [{ profession: 'geologist', x: 22, y: 26 }],
    } }],
  })
}

test('a geologist surveys the reachable mountain around a mine and finishes after a mid-duty restore', () => {
  const session = mountain(ROMAN_ENGINEERING)
  expect(session.skipped).toEqual({})
  order(session, 'specialists', { profession: 'geologist', x: 22, y: 26, count: 1 })
  until(session, () => session.view(1).signs.length > 0, 1000)
  const copy = restore(JSON.parse(JSON.stringify(save(session))), ROMAN_ENGINEERING)
  session.advance(4000); copy.advance(4000)
  expect(session.view(1).settlers[0]?.diagnostic).toBe('duty complete')
  expect(session.view(1).signs.some(sign => sign.tile === 28 * 96 + 23)).toBe(true)
  expect(session.view(1).signs.some(sign => sign.tile === 25 * 96 + 25)).toBe(false)
  expect(copy.checksum()).toBe(session.checksum())
  expect(audit(session.context)).toEqual([])
})

test('published 0.8 checkpoints keep their original specialist routing after restore', () => {
  const legacy = PUBLISHED_RULES.find(profile => profile.version === '0.8.0')!
  const session = mountain(legacy)
  order(session, 'specialists', { profession: 'geologist', x: 22, y: 26, count: 1 })
  until(session, () => session.view(1).signs.length > 0, 1000)
  const copy = restore(JSON.parse(JSON.stringify(save(session))), PUBLISHED_RULES)
  session.advance(4000); copy.advance(4000)
  expect(copy.rules.version).toBe('0.8.0')
  expect(copy.view(1).settlers[0]?.diagnostic).toBe('unreachable')
  expect(copy.checksum()).toBe(session.checksum())
})

test('specialist routing policies must be known and carry evidence', () => {
  const unknown = JSON.parse(JSON.stringify(ROMAN_ENGINEERING))
  unknown.specialistRouting = 'teleport'
  expect(() => validateRules(unknown)).toThrow('Unknown specialist routing policy')
  const unrecorded = structuredClone(ROMAN_ENGINEERING)
  delete unrecorded.evidence.specialistRouting
  expect(() => validateRules(unrecorded)).toThrow('specialistRouting has no evidence record')
})

test('a survey duty skips an isolated mountain peak and continues on reachable land', () => {
  const session = createSession({ rules: ROMAN_ENGINEERING, seed: 5,
    map: describeMap(ROMAN_ENGINEERING, { width: 96, height: 96, seed: 5, base: 'grass', features: [
      { kind: 'terrain', id: 'mountain', x: 25, y: 25, radius: 7 },
      { kind: 'terrain', id: 'water', x: 25, y: 25, radius: 1 },
      { kind: 'terrain', id: 'mountain', x: 25, y: 25, radius: 0 },
    ] }),
    players: [{ name: 'Rome', civilization: 'roman', start: { x: 40, y: 40 }, scenario: { buildings: [{ type: 'castle', x: 40, y: 40 }], settlers: [{ profession: 'geologist', x: 22, y: 25 }] } }],
  })
  expect(session.skipped).toEqual({})
  order(session, 'specialists', { profession: 'geologist', x: 22, y: 25, count: 1 })
  session.advance(4000)
  expect(session.view(1).settlers[0]?.diagnostic).toBe('duty complete')
  expect(session.view(1).signs.some(sign => sign.tile === 25 * 96 + 25)).toBe(false)
  expect(session.view(1).signs.some(sign => sign.tile === 27 * 96 + 25)).toBe(true)
  expect(audit(session.context)).toEqual([])
})

test('a pioneer skips an unreachable water border and claims the adjacent land', () => {
  const session = createSession({ rules: ROMAN_ENGINEERING, seed: 5,
    map: describeMap(ROMAN_ENGINEERING, { width: 96, height: 96, seed: 5, base: 'grass', features: [{ kind: 'terrain', id: 'water', x: 65, y: 40, radius: 0 }] }),
    players: [{ name: 'Rome', civilization: 'roman', start: { x: 40, y: 40 }, scenario: { buildings: [{ type: 'castle', x: 40, y: 40 }], settlers: [{ profession: 'pioneer', x: 64, y: 40 }] } }],
  })
  expect(session.skipped).toEqual({})
  order(session, 'specialists', { profession: 'pioneer', x: 64, y: 40, count: 1 })
  session.advance(800)
  expect(session.view(1).owner[41 * 96 + 65]).toBe(1)
  expect(session.view(1).owner[40 * 96 + 65]).toBe(0)
  expect(session.view(1).settlers[0]?.diagnostic).not.toBe('unreachable')
  expect(audit(session.context)).toEqual([])
})
