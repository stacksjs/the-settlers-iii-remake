import { expect, test } from 'bun:test'
import { createSession, describeMap, ROMAN_ENGINEERING as rules } from '../../resources/game/engine'
import { scene } from '../../resources/game/scene'

test('elevation changes projection while source row depth orders bodies and their independent shadows', () => {
  const session = createSession({ rules, seed: 1, map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: [{ kind: 'elevation', x: 40, y: 60, radius: 0, amount: 200 }] }), players: [{ name: 'Rome', civilization: 'roman', start: { x: 20, y: 30 }, scenario: { buildings: [], settlers: [{ profession: 'geologist', x: 20, y: 30 }, { profession: 'geologist', x: 40, y: 60 }] } }] })
  const before = session.checksum(), items = scene(session, { player: 1 }), bodies = items.filter(item => item.kind === 'settler')
  // MapObjectDrawer.getZ uses map row, not height-adjusted view Y.
  expect(bodies.map(item => item.entity)).toEqual([1, 2])
  expect(bodies[1]!.view.y).toBeLessThan(bodies[0]!.view.y)
  const shadows = items.filter(item => item.kind === 'shadow')
  expect(shadows).toHaveLength(2)
  for (const body of bodies) {
    const shadow = shadows.find(item => item.entity === body.entity)!
    expect([shadow.sprite, shadow.frame, shadow.view, shadow.owner]).toEqual([body.sprite, body.frame, body.view, body.owner])
    // Ortho(-1,1) maps Z to fragment depth with factor -1/2. The
    // source's +20*z_per_y shadow offset is therefore 40 map rows back.
    expect(body.depth - shadow.depth).toBe(40)
  }
  expect(session.checksum()).toBe(before)
  session.dispose()
})
