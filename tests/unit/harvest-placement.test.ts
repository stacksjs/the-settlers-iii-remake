import { expect, test } from 'bun:test'
import { audit, findBuildingSite, observe, PUBLISHED_RULES, restore, save } from '../../resources/game/engine'
import { rivalSession } from '../../resources/game/controller'

// Public keyboard-site planning catches barren suggestions on ordinary maps.
// It does not prove a pointer playthrough, Gold rules or a completed skirmish.
for (const [type, seed, good] of [['woodcutter', 1, 'log'], ['stonecutter', 2, 'stone']] as const) {
  test(`the keyboard suggests a productive ${type} on the ordinary seed ${seed} rival map`, () => {
    const session = rivalSession(seed), before = session.checksum(), created = structuredClone(session.state.ledger[1]!.created)
    const castle = session.view(1).buildings.find(b => b.type === 'castle')!
    const found = findBuildingSite(session, 1, type, castle)
    expect(found).not.toBeNull()
    expect(session.placement(1, type, found!.x, found!.y)).toBeNull()
    expect(observe(session, 1).harvestable(type, found!.x, found!.y)).toBe(true)
    expect(session.checksum()).toBe(before)
    expect(session.enqueue({ tick: 0, player: 1, seq: 0, type: 'build', building: type, ...found! })).toBeNull()
    session.advance(1500)
    const copy = restore(JSON.parse(JSON.stringify(save(session))), PUBLISHED_RULES)
    session.advance(2500); copy.advance(2500)
    expect(session.view(1).buildings.find(b => b.type === type)?.phase).toBe('active')
    expect(session.state.ledger[1]!.produced[good] ?? 0).toBeGreaterThan(0)
    expect(session.state.ledger[1]!.created).toEqual(created)
    expect(session.state.results.every(r => r.ok)).toBe(true)
    expect(copy.checksum()).toBe(session.checksum())
    expect(audit(session.context)).toEqual([])
  })
}

test('without known granite the legal fallback does not invent a productive quarry', () => {
  const session = rivalSession(1), o = observe(session, 1), castle = o.view.buildings.find(b => b.type === 'castle')!
  expect(Array.from({ length: o.width * o.height }, (_, tile) => o.object(tile)).includes('stone')).toBe(false)
  const site = findBuildingSite(session, 1, 'stonecutter', castle)
  expect(site).not.toBeNull()
  expect(session.placement(1, 'stonecutter', site!.x, site!.y)).toBeNull()
  expect(o.harvestable('stonecutter', site!.x, site!.y)).toBe(false)
})
