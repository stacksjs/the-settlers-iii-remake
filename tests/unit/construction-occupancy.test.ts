import { expect, test } from 'bun:test'
import type { RulesProfile } from '../../resources/game/engine'
import { audit, createSession, describeMap, PUBLISHED_RULES, record, restore, ROMAN_ENGINEERING as rules, save, validateRules, verify } from '../../resources/game/engine'
import { order, until } from '../fixtures/engine'

/** The command seam catches sites enclosing walkers, including their next tile. It does not qualify original construction rules. */
function crossing(from: { x: number, y: number }, target: { x: number, y: number }, profile: RulesProfile = rules) {
  const s = createSession({ rules: profile, seed: 5,
    map: describeMap(profile, { width: 96, height: 96, base: 'grass', features: [{ kind: 'terrain', id: 'mountain', x: 28, y: 28, radius: 7 }] }),
    players: [{ name: 'Rome', civilization: 'roman', start: { x: 40, y: 40 }, scenario: {
      buildings: [{ type: 'castle', x: 40, y: 40 }], settlers: [{ profession: 'geologist', ...from }],
    } }],
  })
  expect(s.skipped).toEqual({})
  order(s, 'specialists', { profession: 'geologist', ...target, count: 1 })
  expect(s.view(1).settlers[0]?.action).toBe('walking')
  return s
}

test('a site cannot enclose a geologist who has started walking out of its footprint', () => {
  const s = crossing({ x: 26, y: 26 }, { x: 25, y: 25 })
  expect(s.placement(1, 'iron-mine', 28, 28)).toBe('Settlers are crossing this site.')
  expect(s.enqueue({ tick: s.state.tick, player: 1, seq: 1, type: 'build', building: 'iron-mine', x: 28, y: 28 })).toBeNull()
  s.advance(1)
  expect(s.state.results.find(r => r.seq === 1)).toMatchObject({ ok: false, reason: 'Settlers are crossing this site.' })
  expect(s.view(1).buildings.some(b => b.type === 'iron-mine')).toBe(false)
  s.advance(20)
  expect(s.view(1).settlers[0]).toMatchObject({ x: 25, y: 25 })
  expect(s.placement(1, 'iron-mine', 28, 28)).toBeNull()
  expect(audit(s.context)).toEqual([])
})

test('a site reserves the destination of a step already in progress', () => {
  const s = crossing({ x: 25, y: 25 }, { x: 33, y: 33 })
  expect(s.view(1).settlers[0]).toMatchObject({ x: 25, y: 25, next: 26 * 96 + 26 })
  expect(s.placement(1, 'iron-mine', 28, 28)).toBe('Settlers are crossing this site.')
})

test('a mid-step save keeps construction enforcement and subsequent movement identical', () => {
  const s = crossing({ x: 26, y: 26 }, { x: 25, y: 25 }), copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
  for (const session of [s, copy]) {
    expect(session.placement(1, 'iron-mine', 28, 28)).toBe('Settlers are crossing this site.')
    session.enqueue({ tick: session.state.tick, player: 1, seq: 1, type: 'build', building: 'iron-mine', x: 28, y: 28 })
    session.advance(22)
    expect(session.state.results.find(r => r.seq === 1)?.ok).toBe(false)
    expect(session.placement(1, 'iron-mine', 28, 28)).toBeNull()
    expect(session.enqueue({ tick: session.state.tick, player: 1, seq: 2, type: 'build', building: 'iron-mine', x: 28, y: 28 })).toBeNull()
    session.advance(1)
    expect(session.state.results.find(r => r.seq === 2)?.ok).toBe(true)
    expect(audit(session.context)).toEqual([])
  }
  expect(copy.checksum()).toBe(s.checksum())
})

test('unrelated walkers do not block construction or keep a stale future path through a new site', () => {
  const s = crossing({ x: 23, y: 23 }, { x: 33, y: 33 })
  expect(s.placement(1, 'iron-mine', 28, 28)).toBeNull()
  order(s, 'build', { building: 'iron-mine', x: 28, y: 28 })
  until(s, () => s.view(1).settlers[0]?.x === 33 && s.view(1).settlers[0]?.y === 33, 400)
  expect(s.view(1).settlers[0]).toMatchObject({ x: 33, y: 33 })
  expect(s.view(1).settlers[0]?.diagnostic).not.toBe('unreachable')
  expect(audit(s.context)).toEqual([])
})

test('published 0.9 saves and replays preserve their former construction behavior', () => {
  const legacy = PUBLISHED_RULES.find(p => p.version === '0.9.0')!
  const s = crossing({ x: 28, y: 28 }, { x: 33, y: 33 }, legacy)
  const recorder = record(s), copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
  for (const session of [s, copy]) {
    expect(session.rules.version).toBe('0.9.0')
    expect(session.placement(1, 'iron-mine', 28, 28)).toBeNull()
    const command = { tick: session.state.tick, player: 1, seq: 1, type: 'build', building: 'iron-mine', x: 28, y: 28 }
    expect(session === s ? recorder.enqueue(command) : session.enqueue(command)).toBeNull()
    if (session === s) recorder.advance(200)
    else session.advance(200)
    expect(session.view(1).settlers[0]).toMatchObject({ x: 29, y: 29, inside: 0 })
    expect(audit(session.context)).toEqual([])
  }
  expect(copy.checksum()).toBe(s.checksum())
  expect(verify(recorder.replay(), PUBLISHED_RULES)).toMatchObject({ ok: true, checksum: s.checksum() })
})

test('construction occupancy policies must be known and carry evidence', () => {
  const unknown = JSON.parse(JSON.stringify(rules))
  unknown.constructionOccupancy = 'teleport'
  expect(() => validateRules(unknown)).toThrow('Unknown construction occupancy policy')
  const unrecorded = structuredClone(rules)
  delete unrecorded.evidence.constructionOccupancy
  expect(() => validateRules(unrecorded)).toThrow('constructionOccupancy has no evidence record')
})
