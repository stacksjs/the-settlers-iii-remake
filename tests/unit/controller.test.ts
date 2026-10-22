import { expect, test } from 'bun:test'
import { mapName, newSession, PLAYER, snapshot, status } from '../../resources/game/controller'
import { save } from '../../resources/game/engine'

test('every generated landscape has room for the castle and its settlers', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const session = newSession(seed)
    expect([...session.state.buildings.values()].map(b => b.type)).toEqual(['castle'])
    expect(session.state.settlers.size).toBe(38)
    expect(session.skipped).toEqual({})
  }
}, 60_000)

test('the control panel reports the simulation it is given', () => {
  const session = newSession(7)
  session.advance(40)
  const view = snapshot(session, [...session.state.buildings.values()][0]!.id, 'hello', 2, null, false, true)
  expect(view.population).toBe(session.state.settlers.size)
  expect(view.goods.find(g => g.key === 'plank')!.amount).toBe([...session.state.stacks.values()].filter(s => s.owner === PLAYER && s.good === 'plank').reduce((n, s) => n + s.amount, 0))
  expect(view.selected?.castle).toBe(true)
  expect(view.map).toBe(mapName(session))
  expect(view.time).toBe('0:02')
  expect(JSON.stringify(save(session)).length).toBeLessThan(2_000_000)
  expect(status('active', 'tool:axe', false, false, true)).toBe('Needs an axe')
  expect(status('building', 'tool:hammer', false, false, true)).toBe('Needs a hammer for its crew')
  expect(status('active', null, true, true, true)).toBe('Work paused')
  expect(status('building', null, false, false, true)).toBe('Builders are at work')
})
