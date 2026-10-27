import { expect, test } from 'bun:test'
import { mapName, newSession, PLAYER, RIVAL_MILITARY, rivalSession, snapshot, status } from '../../resources/game/controller'
import { audit, createSession, economicAI, describeMap, PUBLISHED_RULES, restore, stepAI } from '../../resources/game/engine'
import { save } from '../../resources/game/engine'
import { anchors, landscape, order, place, rules, session as fixtureSession, until } from '../fixtures/engine'
import formatOne from '../fixtures/save-format-1.json'

test('building inspection follows the saved rules without inventing newer garrisons', () => {
  const migrated = restore(structuredClone(formatOne), PUBLISHED_RULES)
  const castle = [...migrated.state.buildings.values()].find(b => b.type === 'castle')!
  expect(snapshot(migrated, castle.id, '', 1).selected?.garrison).toBeNull()

  const older = PUBLISHED_RULES.find(profile => profile.version === '0.2.0')!
  const session = createSession({ rules: older, seed: 5, map: describeMap(older, { width: 96, height: 96, base: 'grass', features: [] }), players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle, goods: { plank: 10, stone: 10 } }] })
  const tower = place(session, 'small-tower', anchors.west)
  const restored = restore(structuredClone(save(session)), PUBLISHED_RULES)
  const before = restored.checksum()
  const panel = snapshot(restored, tower, '', 1).selected
  expect(panel?.garrison).toBeNull()
  expect(panel?.description).toBe('Claims land within 16 tiles once completed.')
  expect(restored.checksum()).toBe(before)

  const current = fixtureSession()
  const currentCastle = [...current.state.buildings.values()].find(b => b.type === 'castle')!
  expect(snapshot(current, currentCastle.id, '', 1).selected?.garrison).toBe('0 of 11 soldiers inside')
})

test('the recruitment panel counts delivered barracks weapons, following enlistment, restore and demolition', () => {
  const s = fixtureSession({ players: [
    { name: 'Rome', civilization: 'roman', start: anchors.castle, goods: { plank: 30, stone: 30, sword: 3, bow: 2 } },
    { name: 'Other player', civilization: 'roman', start: { x: 70, y: 70 }, goods: { plank: 30, stone: 30, sword: 7 } },
  ] })
  const figures = (session = s) => snapshot(session, null, '', 1).army.soldiers
  const swords = (session = s) => figures(session).find(item => item.name === 'swordsman')!
  expect(swords().weapon).toBe('sword')
  expect(swords().weapons).toBe(0)
  const otherBarracks = place(s, 'barracks', { x: 70, y: 58 }, 2)
  until(s, () => s.state.buildings.get(otherBarracks)!.phase === 'active', 6000)
  until(s, () => [...s.state.stacks.values()].filter(stack => stack.building === otherBarracks && stack.good === 'sword').reduce((sum, stack) => sum + stack.amount, 0) === 7, 3000)
  expect(swords().weapons).toBe(0)
  const barracks = place(s, 'barracks', anchors.west)
  until(s, () => s.state.buildings.get(barracks)!.phase === 'active', 6000)
  until(s, () => [...s.state.stacks.values()].filter(stack => stack.building === barracks && stack.good === 'sword').reduce((sum, stack) => sum + stack.amount, 0) === 3, 3000)
  until(s, () => [...s.state.stacks.values()].filter(stack => stack.building === barracks && stack.good === 'bow').reduce((sum, stack) => sum + stack.amount, 0) === 2, 3000)
  expect(swords().weapons).toBe(3)
  expect(figures().find(item => item.name === 'bowman')!.weapons).toBe(2)
  order(s, 'recruit', { profession: 'swordsman', count: 1 })
  until(s, () => swords().count === 1, 2000)
  expect(swords().weapons).toBe(2)
  const copy = restore(JSON.parse(JSON.stringify(save(s))), rules)
  expect(swords(copy)).toEqual(swords())
  order(s, 'demolish', { building: barracks })
  expect(swords().weapons).toBe(0)
  expect(s.view(1).goods.sword).toBe(2)
  expect(audit(s.context)).toEqual([])
}, 60_000)

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

test('rival landscapes start a computer player on the far side', () => {
  for (const seed of [0, 1, 2, 3, 4, 5, 0xFFFFFFFF]) {
    const session = rivalSession(seed)
    const castles = [...session.state.buildings.values()].filter(b => b.type === 'castle')
    expect(castles.map(b => b.owner)).toEqual([1, 2])
    expect(Math.abs(castles[0]!.x - castles[1]!.x)).toBeGreaterThanOrEqual(40)
    expect(session.state.players[1]!.controller).toBe('computer')
    expect(mapName(session)).toBe('Computer rival')
    expect(snapshot(session, null, '', 1).seed).toBe(seed)
    const copy = restore(JSON.parse(JSON.stringify(save(session))), PUBLISHED_RULES)
    expect(snapshot(copy, null, '', 1).seed).toBe(seed)
    expect(copy.checksum()).toBe(session.checksum())
  }
})

test('a new rival match ends when its last completed military building is lost and keeps the result after restore', () => {
  const session = rivalSession(2)
  expect(snapshot(session, null, '', 1).objectives).toEqual([{ id: 'eliminate-rival', text: 'Capture every enemy castle and tower. Keep at least one of your own.', status: 'open' }])
  const castle = [...session.state.buildings.values()].find(b => b.owner === PLAYER && b.type === 'castle')!
  order(session, 'demolish', { building: castle.id })
  session.advance(20)
  expect(session.view(1).mission?.outcome).toBe('lost')
  expect(session.view(2).mission?.outcome).toBe('won')
  expect(snapshot(session, null, '', 1).objectives[0]?.status).toBe('failed')
  const copy = restore(JSON.parse(JSON.stringify(save(session))), PUBLISHED_RULES)
  expect(copy.checksum()).toBe(session.checksum())
  expect(snapshot(copy, null, '', 1).outcome).toBe('lost')
  expect(audit(session.context)).toEqual([])
})

test('a rival checkpoint from before elimination remains a free settlement', () => {
  const legacy = createSession({ rules, map: landscape(), seed: 2, players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle }, { name: 'Computer', civilization: 'roman', controller: 'computer', start: { x: 80, y: 40 } }], content: { id: 'rival-128', digest: 'seed:2' } })
  const copy = restore(JSON.parse(JSON.stringify(save(legacy))), PUBLISHED_RULES)
  expect(copy.view(1).mission).toBeNull()
  expect(snapshot(copy, null, '', 1).outcome).toBe('playing')
  expect(snapshot(copy, null, '', 1).objectives).toEqual([])
  expect(copy.checksum()).toBe(legacy.checksum())
})

test('the computer rival guards its castle and scouts with ordinary, accepted commands', () => {
  const session = rivalSession(2), ai = economicAI(2, { military: RIVAL_MILITARY }), sequence = { next: 0 }
  const guard = [...session.state.settlers.values()].filter(p => p.owner === 2 && p.soldier)
  expect(guard.map(p => p.profession).sort()).toEqual(['bowman', 'bowman', 'swordsman', 'swordsman', 'swordsman', 'swordsman'])
  for (let tick = 0; tick < 4000; tick++) { stepAI(session, ai, sequence); session.advance(1) }
  expect(ai.results).toEqual([])
  expect(session.state.results.some(r => r.player === 2 && r.type === 'move-soldiers' && r.ok)).toBe(true)
  expect(audit(session.context)).toEqual([])
}, 120_000)
