import { expect, test } from 'bun:test'
import type { Session } from '../../resources/game/engine'
import { audit, createSession, describeMap, PUBLISHED_RULES, restore, ROMAN_ENGINEERING as rules, save } from '../../resources/game/engine'
import { scene } from '../../resources/game/scene'

// Public scenario, survey command and scene seams prove what the player knows
// and draws. They do not prove original timing, mining balance or native pixels.
function survey(good: string | null, amount: number, second = false): Session {
  const at = { x: 5, y: 5 }
  const s = createSession({ rules, seed: 5, map: describeMap(rules, { width: 32, height: 32, base: 'grass', features: [
    { kind: 'terrain', id: 'mountain', ...at, radius: 0 },
    ...(good ? [{ kind: 'resource' as const, id: good, ...at, radius: 0, amount }] : []),
    ...(second ? [{ kind: 'terrain' as const, id: 'mountain', x: 25, y: 25, radius: 0 }, { kind: 'resource' as const, id: 'ironore', x: 25, y: 25, radius: 0, amount: 15 }] : []),
  ] }), players: [{ name: 'One', civilization: 'roman', start: at, scenario: { buildings: [], settlers: [{ profession: 'geologist', ...at }] } },
    ...(second ? [{ name: 'Two', civilization: 'roman', start: { x: 25, y: 25 }, scenario: { buildings: [], settlers: [{ profession: 'geologist', x: 25, y: 25 }] } }] : [])] })
  expect(s.skipped).toEqual({})
  expect(s.enqueue({ tick: 0, player: 1, seq: 0, type: 'specialists', profession: 'geologist', ...at, count: 1 })).toBeNull()
  if (second) expect(s.enqueue({ tick: 0, player: 2, seq: 0, type: 'specialists', profession: 'geologist', x: 25, y: 25, count: 1 })).toBeNull()
  s.advance(rules.survey.work + 2)
  return s
}

for (const [good, amount, sprite, frame] of [
  [null, 0, 'sign:empty', 0], ['coal', 0, 'sign:empty', 0],
  ['coal', 1, 'sign:coal', 0], ['coal', 2, 'sign:coal', 0], ['coal', 3, 'sign:coal', 1], ['coal', 15, 'sign:coal', 1], ['coal', 40, 'sign:coal', 1],
  ['ironore', 2, 'sign:ironore', 0], ['ironore', 3, 'sign:ironore', 1], ['goldore', 15, 'sign:goldore', 1],
] as const) {
  test(`a surveyed ${good ?? 'empty'} tile with ${amount} uses its original symbol and reference frame`, () => {
    const s = survey(good, amount), before = s.checksum(), knowledge = s.view(1).signs.find(x => x.tile === 5 * 32 + 5)!
    expect(knowledge).toBeDefined()
    expect(scene(s, { player: 1 }).find(x => x.kind === 'sign' && x.entity === knowledge.tile)).toMatchObject({ sprite, frame, amount })
    expect(s.checksum()).toBe(before)
    expect(s.state.ledger[1]?.produced ?? {}).toEqual({})
    expect(audit(s.context)).toEqual([])
  })
}

test('survey images survive save/reload, expire with knowledge, and never expose another player signs', () => {
  const s = survey('coal', 3, true), copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
  const marks = (session: Session, player = 1) => scene(session, { player }).filter(x => x.kind === 'sign')
  expect(marks(s)).toHaveLength(1)
  expect(marks(s)[0]).toMatchObject({ entity: 5 * 32 + 5, sprite: 'sign:coal', frame: 1 })
  expect(marks(s, 2)[0]).toMatchObject({ entity: 25 * 32 + 25, sprite: 'sign:ironore', frame: 1 })
  expect(marks(copy)).toEqual(marks(s))
  s.advance(rules.survey.signTicks + 1); copy.advance(rules.survey.signTicks + 1)
  expect(marks(s)).toEqual([])
  expect(marks(copy)).toEqual([])
  expect(copy.checksum()).toBe(s.checksum())
  expect(audit(s.context)).toEqual([])
})

test('unsupported positive survey material fails explicitly rather than pretending the deposit is empty', () => {
  const s = survey('grain', 3)
  expect(() => scene(s, { player: 1 })).toThrow('Unsupported surveyed resource: grain')
})
