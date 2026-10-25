import { expect, test } from 'bun:test'
import { audit, createSession, describeMap, economicAI, observe, PUBLISHED_RULES, restore, ROMAN_ENGINEERING as rules, save } from '../../resources/game/engine'

const policy = { attackAt: 99, scoutEvery: 80 }
function frontier(castleTroops = 2, enemy?: 'building' | 'intruder') {
  const s = createSession({ rules, map: describeMap(rules, { width: 128, height: 96, base: 'grass', seed: 5, features: [] }), seed: 5, players: [{
    name: 'Rome', civilization: 'roman', start: { x: 40, y: 40 }, scenario: {
      buildings: [{ type: 'small-tower', x: 40, y: 40 }, { type: 'castle', x: 65, y: 40 }],
      settlers: [{ profession: 'swordsman', x: 42, y: 43 }, ...Array.from({ length: castleTroops }, (_, i) => ({ profession: 'swordsman', x: 64 + i, y: 44 }))],
    },
  }, ...(enemy ? [{ name: 'Rival', civilization: 'roman', start: { x: 110, y: 80 }, scenario: { buildings: enemy === 'building' ? [{ type: 'small-tower', x: 82, y: 40 }] : [], settlers: enemy === 'intruder' ? [{ profession: 'swordsman', x: 110, y: 80 }] : [] } }] : [])] })
  expect(s.skipped).toEqual({})
  s.advance(160)
  const view = s.view(1), tower = view.buildings.find(b => b.type === 'small-tower')!, castle = view.buildings.find(b => b.type === 'castle')!
  expect(tower.garrison).toBe(1)
  expect(castle.garrison).toBe(castleTroops)
  expect(view.settlers.every(p => p.inside)).toBe(true)
  if (enemy === 'intruder') {
    const intruder = s.view(2).settlers.find(p => p.owner === 2)!
    expect(s.enqueue({ tick: s.state.tick, player: 2, seq: 0, type: 'move-soldiers', soldiers: [intruder.id], x: 50, y: 44, mode: 'forced' })).toBeNull()
    for (let tick = 0; tick < 3000 && !s.view(1).settlers.some(p => p.owner === 2 && s.view(1).owner[p.y * 128 + p.x] === 1); tick++) s.advance(1)
  }
  return { s, tower, castle }
}

test('scouting uses a spare castle troop while preserving the sole tower guard', () => {
  const { s, tower, castle } = frontier(), o = observe(s, 1)
  const scout = economicAI(1, { military: policy }).decide(o).find(order => order.type === 'move-soldiers')!
  expect(scout).toBeDefined()
  expect(s.enqueue({ tick: s.state.tick, player: 1, seq: 0, ...scout })).toBeNull()
  s.advance(1)
  expect(s.state.results.at(-1)).toMatchObject({ type: 'move-soldiers', ok: true })
  expect((scout.soldiers as number[]).every(id => o.view.settlers.find(p => p.id === id)!.inside === castle.id)).toBe(true)
  expect(s.view(1).buildings.find(b => b.id === tower.id)!.garrison).toBe(1)
  expect(s.view(1).buildings.find(b => b.id === castle.id)!.garrison).toBe(1)
  expect(audit(s.context)).toEqual([])
})

test('scouting leaves only-guard garrisons alone instead of enqueueing a guaranteed refusal', () => {
  const { s } = frontier(1)
  const before = s.checksum()
  const orders = economicAI(1, { military: policy }).decide(observe(s, 1))
  expect(orders.some(order => order.type === 'move-soldiers')).toBe(false)
  expect(s.checksum()).toBe(before)
})

test('a ready outside troop remains preferred to garrison troops', () => {
  const { s, castle } = frontier()
  const sent = s.view(1).settlers.find(p => p.inside === castle.id)!
  expect(s.enqueue({ tick: s.state.tick, player: 1, seq: 0, type: 'move-soldiers', soldiers: [sent.id], x: 64, y: 55 })).toBeNull()
  s.advance(320)
  expect(s.state.results.find(r => r.seq === 0)).toMatchObject({ ok: true })
  expect(s.view(1).settlers.find(p => p.id === sent.id)).toMatchObject({ inside: 0, action: 'idle' })
  const scout = economicAI(1, { military: policy }).decide(observe(s, 1)).find(order => order.type === 'move-soldiers')!
  expect(scout.soldiers).toEqual([sent.id])
})

test('a restored policy chooses the same movable scout and keeps the same subsequent state', () => {
  const { s } = frontier(), copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
  const first = economicAI(1, { military: policy }).decide(observe(s, 1)).find(order => order.type === 'move-soldiers')!
  const second = economicAI(1, { military: policy }).decide(observe(copy, 1)).find(order => order.type === 'move-soldiers')!
  expect(first).toBeDefined()
  expect(second).toEqual(first)
  for (const session of [s, copy]) {
    expect(session.enqueue({ tick: session.state.tick, player: 1, seq: 0, ...first })).toBeNull()
    session.advance(400)
    expect(session.state.results.find(r => r.seq === 0)).toMatchObject({ type: 'move-soldiers', ok: true })
    expect(audit(session.context)).toEqual([])
  }
  expect(copy.checksum()).toBe(s.checksum())
})


test('attacks keep a guard in every garrison and wait when none can leave', () => {
  for (const troops of [1, 2]) {
    const { s, tower, castle } = frontier(troops, 'building'), o = observe(s, 1)
    expect(o.view.buildings.some(b => b.owner === 2)).toBe(true)
    const attack = economicAI(1, { military: { ...policy, attackAt: 1 } }).decide(o).find(order => order.type === 'attack')
    if (troops === 1) expect(attack).toBeUndefined()
    else {
      expect(attack).toBeDefined()
      expect((attack!.soldiers as number[]).length).toBe(1)
      expect((attack!.soldiers as number[]).every(id => o.view.settlers.find(p => p.id === id)!.inside === castle.id)).toBe(true)
      expect(s.enqueue({ tick: s.state.tick, player: 1, seq: 0, ...attack! })).toBeNull()
      s.advance(1)
      expect(s.state.results.at(-1)).toMatchObject({ type: 'attack', ok: true })
      expect(s.view(1).buildings.find(b => b.id === tower.id)!.garrison).toBe(1)
      expect(s.view(1).buildings.find(b => b.id === castle.id)!.garrison).toBe(1)
      expect(audit(s.context)).toEqual([])
    }
  }
})

test('defense chooses a movable troop and keeps sole guards inside', () => {
  for (const troops of [1, 2]) {
    const { s, tower, castle } = frontier(troops, 'intruder'), o = observe(s, 1)
    expect(o.view.settlers.some(p => p.owner === 2 && o.view.owner[p.y * o.width + p.x] === 1)).toBe(true)
    const defense = economicAI(1, { military: policy }).decide(o).find(order => order.type === 'move-soldiers')
    if (troops === 1) expect(defense).toBeUndefined()
    else {
      expect(defense).toBeDefined()
      expect((defense!.soldiers as number[]).length).toBe(1)
      expect((defense!.soldiers as number[]).every(id => o.view.settlers.find(p => p.id === id)!.inside === castle.id)).toBe(true)
      expect(s.enqueue({ tick: s.state.tick, player: 1, seq: 0, ...defense! })).toBeNull()
      s.advance(1)
      expect(s.state.results.at(-1)).toMatchObject({ type: 'move-soldiers', ok: true })
      expect(s.view(1).buildings.find(b => b.id === tower.id)!.garrison).toBe(1)
      expect(s.view(1).buildings.find(b => b.id === castle.id)!.garrison).toBe(1)
      expect(audit(s.context)).toEqual([])
    }
  }
})
