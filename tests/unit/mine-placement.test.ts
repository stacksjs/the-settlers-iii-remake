import { expect, test } from 'bun:test'
import type { PlayerView, Point } from '../../resources/game/engine'
import type { RulesProfile } from '../../resources/game/engine/rules'
import { audit, createSession, describeMap, distance, findBuildingSite, PUBLISHED_RULES, restore, ROMAN_ENGINEERING as rules, save, surveyedMineForecast } from '../../resources/game/engine'

const surveyedMineSite = (view: PlayerView, profile: RulesProfile, type: string, site: Point): boolean => surveyedMineForecast(view, profile, type)(site)

// Actual public survey and placement forecast, with an authored map. This
// catches barren mine suggestions; it does not establish Gold mining rules.
function surveyedIron() {
  const session = createSession({ rules, seed: 5, map: describeMap(rules, { width: 80, height: 80, base: 'grass', features: [
    { kind: 'terrain', id: 'mountain', x: 32, y: 40, radius: 4 }, { kind: 'resource', id: 'coal', x: 32, y: 40, radius: 4, amount: 40 },
    { kind: 'terrain', id: 'mountain', x: 48, y: 40, radius: 4 }, { kind: 'resource', id: 'ironore', x: 48, y: 40, radius: 0, amount: 40 },
  ] }), players: [{ name: 'Rome', civilization: 'roman', start: { x: 40, y: 40 }, scenario: { buildings: [{ type: 'castle', x: 40, y: 40 }], settlers: [{ profession: 'geologist', x: 48, y: 40 }] } }] })
  expect(session.skipped).toEqual({})
  expect(session.enqueue({ tick: 0, player: 1, seq: 0, type: 'specialists', profession: 'geologist', x: 48, y: 40, count: 1 })).toBeNull()
  // Let the actual survey finish, then send the geologist clear of the site.
  for (let tick = 0; tick < 5000 && (tick === 0 || session.view(1).settlers.some(s => s.busy)); tick++) session.advance(1)
  expect(session.enqueue({ tick: session.state.tick, player: 1, seq: 1, type: 'specialists', profession: 'geologist', x: 55, y: 46, count: 1 })).toBeNull()
  session.advance(1000)
  expect(session.view(1).signs).toContainEqual(expect.objectContaining({ tile: 3248, good: 'ironore', amount: 40 }))
  expect(session.placement(1, 'iron-mine', 48, 40)).toBeNull()
  return session
}

test('the mine chooser prefers a legal site within reach of surveyed iron over a barren mountain', () => {
  const session = surveyedIron(), before = session.checksum()
  const site = findBuildingSite(session, 1, 'iron-mine', { x: 40, y: 40 })
  expect(site).not.toBeNull()
  expect(session.placement(1, 'iron-mine', site!.x, site!.y)).toBeNull()
  // The independent scenario has one iron tile at (48,40); the profile mines
  // within two lattice steps. The old suggestion (45,36) is four steps away.
  expect(distance(site!, { x: 48, y: 40 })).toBeLessThanOrEqual(2)
  expect(session.checksum()).toBe(before)
  const copy = restore(JSON.parse(JSON.stringify(save(session))), PUBLISHED_RULES)
  expect(findBuildingSite(copy, 1, 'iron-mine', { x: 40, y: 40 })).toEqual(site)
  expect(copy.checksum()).toBe(before)
  expect(audit(session.context)).toEqual([])
  copy.dispose(); session.dispose()
})

test('the public forecast uses the exact extraction radius and rejects wrong, empty, expired and unexplored signs', () => {
  const session = surveyedIron(), view = session.view(1), before = session.checksum()
  expect(surveyedMineSite(view, rules, 'iron-mine', { x: 46, y: 38 })).toBe(true)
  expect(surveyedMineSite(view, rules, 'iron-mine', { x: 46, y: 37 })).toBe(false)
  expect(surveyedMineSite(view, rules, 'coal-mine', { x: 48, y: 40 })).toBe(false)
  expect(surveyedMineSite(view, rules, 'gold-mine', { x: 48, y: 40 })).toBe(false)
  expect(surveyedMineSite(view, rules, 'sawmill', { x: 48, y: 40 })).toBe(false)
  for (const signs of [[], [{ tile: 3248, good: 'ironore', amount: 0, until: view.tick + 10 }], [{ tile: 3248, good: 'ironore', amount: 40, until: view.tick }]])
    expect(surveyedMineSite({ ...view, signs }, rules, 'iron-mine', { x: 48, y: 40 })).toBe(false)
  expect(surveyedMineSite({ ...view, explored: new Uint8Array(view.explored.length) }, rules, 'iron-mine', { x: 48, y: 40 })).toBe(false)
  expect(surveyedMineSite({ ...view, owner: new Uint8Array(view.owner.length) }, rules, 'iron-mine', { x: 48, y: 40 })).toBe(false)
  for (const site of [{ x: -1, y: 40 }, { x: 80, y: 40 }, { x: 48, y: 80 }, { x: 48.5, y: 40 }]) expect(surveyedMineSite(view, rules, 'iron-mine', site)).toBe(false)
  expect(session.checksum()).toBe(before)
  session.dispose()
})

test('expired survey knowledge retains a legal speculative fallback without reading hidden reserves', () => {
  const session = surveyedIron()
  session.advance(rules.survey.signTicks + 1)
  expect(session.view(1).signs).toEqual([])
  const before = session.checksum(), site = findBuildingSite(session, 1, 'iron-mine', { x: 40, y: 40 })
  expect(site).toEqual({ x: 45, y: 36 })
  expect(session.placement(1, 'iron-mine', site!.x, site!.y)).toBeNull()
  expect(surveyedMineSite(session.view(1), rules, 'iron-mine', site!)).toBe(false)
  expect(session.checksum()).toBe(before)
  expect(session.enqueue({ tick: session.state.tick, player: 1, seq: 2, type: 'build', building: 'iron-mine', ...site! })).toBeNull()
  session.advance(1)
  expect(session.view(1).buildings).toContainEqual(expect.objectContaining({ type: 'iron-mine', ...site! }))
  session.dispose()
})

test('a foreign geologist cannot reveal a deposit to the chooser', () => {
  const session = createSession({ rules, seed: 5, map: describeMap(rules, { width: 96, height: 80, base: 'grass', features: [
    { kind: 'terrain', id: 'mountain', x: 70, y: 40, radius: 4 }, { kind: 'resource', id: 'ironore', x: 70, y: 40, radius: 0, amount: 40 },
  ] }), players: [
    { name: 'One', civilization: 'roman', start: { x: 25, y: 40 }, scenario: { buildings: [{ type: 'castle', x: 25, y: 40 }], settlers: [] } },
    { name: 'Two', civilization: 'roman', start: { x: 70, y: 50 }, scenario: { buildings: [{ type: 'castle', x: 70, y: 50 }], settlers: [{ profession: 'geologist', x: 70, y: 40 }] } },
  ] })
  expect(session.skipped).toEqual({})
  expect(session.enqueue({ tick: 0, player: 2, seq: 0, type: 'specialists', profession: 'geologist', x: 70, y: 40, count: 1 })).toBeNull()
  session.advance(rules.survey.work + 2)
  const before = session.checksum()
  expect(session.view(1).signs).toEqual([])
  expect(surveyedMineSite(session.view(1), rules, 'iron-mine', { x: 70, y: 40 })).toBe(false)
  expect(surveyedMineSite(session.view(2), rules, 'iron-mine', { x: 70, y: 40 })).toBe(true)
  expect(findBuildingSite(session, 1, 'iron-mine', { x: 25, y: 40 })).toBeNull()
  expect(session.checksum()).toBe(before)
  session.dispose()
})

test('the recommended surveyed mine completes and produces physical ore through normal construction and reload', () => {
  const session = createSession({ rules, seed: 5, map: describeMap(rules, { width: 80, height: 80, base: 'grass', features: [
    { kind: 'terrain', id: 'mountain', x: 32, y: 40, radius: 4 },
    { kind: 'terrain', id: 'mountain', x: 48, y: 40, radius: 4 },
    { kind: 'resource', id: 'ironore', x: 48, y: 40, radius: 0, amount: 40 },
  ] }), players: [{ name: 'Rome', civilization: 'roman', start: { x: 40, y: 40 } }] })
  expect(session.skipped).toEqual({})
  expect(session.enqueue({ tick: 0, player: 1, seq: 0, type: 'specialists', profession: 'geologist', x: 48, y: 40, count: 1 })).toBeNull()
  session.advance(3000)
  expect(session.view(1).signs).toContainEqual(expect.objectContaining({ tile: 3248, good: 'ironore', amount: 40 }))
  const site = findBuildingSite(session, 1, 'iron-mine', { x: 40, y: 40 })
  expect(site).not.toBeNull()
  expect(surveyedMineSite(session.view(1), rules, 'iron-mine', site!)).toBe(true)
  const created = structuredClone(session.state.ledger[1]!.created)
  expect(session.enqueue({ tick: session.state.tick, player: 1, seq: 1, type: 'build', building: 'iron-mine', ...site! })).toBeNull()
  session.advance(200)
  const copy = restore(JSON.parse(JSON.stringify(save(session))), PUBLISHED_RULES)
  session.advance(5000); copy.advance(5000)
  expect(session.view(1).buildings.find(b => b.type === 'iron-mine')).toMatchObject({ phase: 'active' })
  expect(session.state.ledger[1]!.produced.ironore ?? 0).toBeGreaterThan(0)
  expect(session.state.ledger[1]!.created).toEqual(created)
  expect(session.state.results.every(result => result.ok)).toBe(true)
  expect(copy.checksum()).toBe(session.checksum())
  expect(audit(session.context)).toEqual([])
  copy.dispose(); session.dispose()
})
