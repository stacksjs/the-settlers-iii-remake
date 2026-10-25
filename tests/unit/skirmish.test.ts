import { expect, test } from 'bun:test'
import { audit, createSession, restore, save } from '../../resources/game/engine'
import { RIVAL_MISSION } from '../../resources/game/skirmish'
import { landscape, order, place, rules, until } from '../fixtures/engine'

// Public session commands and views cover elimination, capture and persistence.
// These scenarios do not establish original Gold balance or browser input delivery.
test('capturing the last enemy castle wins for either side, including a mid-attack restore', () => {
  for (const attacker of [1, 2]) {
    const defender = attacker === 1 ? 2 : 1
    const session = createSession({ rules, map: landscape(), seed: 9, mission: RIVAL_MISSION, players: [1, 2].map(player => ({
      name: `Player ${player}`, civilization: 'roman', start: { x: player === 1 ? 40 : 80, y: 40 },
      scenario: {
        buildings: [{ type: 'castle', x: player === 1 ? 40 : 80, y: 40 }],
        settlers: Array.from({ length: player === attacker ? 3 : 1 }, (_, i) => ({ profession: 'swordsman', x: (player === 1 ? 44 : 84) + i, y: 46 })),
      },
    })) })
    expect(session.skipped).toEqual({})
    const ours = [...session.state.buildings.values()].find(b => b.owner === attacker)!
    const theirs = [...session.state.buildings.values()].find(b => b.owner === defender)!
    const soldiers = [...session.state.settlers.values()].filter(s => s.owner === attacker).slice(0, 2)
    until(session, () => [...session.state.settlers.values()].every(s => s.inside !== 0), 1000)
    order(session, 'move-soldiers', { soldiers: soldiers.map(s => s.id), x: theirs.x - 6, y: 44 }, attacker)
    until(session, () => soldiers.every(s => s.soldier?.order === -2), 2000)
    order(session, 'attack', { soldiers: soldiers.map(s => s.id), building: theirs.id }, attacker)
    const copy = restore(JSON.parse(JSON.stringify(save(session))), rules)
    until(session, () => session.view(attacker).mission?.outcome === 'won', 4000)
    copy.advance(session.state.tick - copy.state.tick)
    expect(theirs.owner).toBe(attacker)
    expect(ours.owner).toBe(attacker)
    expect(session.view(defender).mission?.outcome).toBe('lost')
    expect(session.view(1).mission?.objectives[0]?.status).toBe(attacker === 1 ? 'complete' : 'failed')
    expect(copy.checksum()).toBe(session.checksum())
    expect(audit(session.context)).toEqual([])
  }
})

test('a surviving completed tower prevents elimination after the castle is demolished', () => {
  const session = createSession({ rules, map: landscape(), seed: 4, mission: RIVAL_MISSION, players: [
    { name: 'Rome', civilization: 'roman', start: { x: 40, y: 40 }, scenario: { settlers: [], buildings: [{ type: 'castle', x: 40, y: 40 }, { type: 'small-tower', x: 30, y: 42 }] } },
    { name: 'Rival', civilization: 'roman', start: { x: 80, y: 40 } },
  ] })
  expect(session.skipped).toEqual({})
  const castle = [...session.state.buildings.values()].find(b => b.owner === 1 && b.type === 'castle')!
  const tower = [...session.state.buildings.values()].find(b => b.type === 'small-tower')!
  order(session, 'demolish', { building: castle.id })
  session.advance(20)
  expect(session.view(1).mission?.outcome).toBe('playing')
  order(session, 'demolish', { building: tower.id })
  session.advance(20)
  expect(session.view(1).mission?.outcome).toBe('lost')
  expect(session.view(2).mission?.outcome).toBe('won')
})

test('simultaneous elimination gives neither player a win', () => {
  const session = createSession({ rules, map: landscape(), seed: 2, mission: RIVAL_MISSION, players: [
    { name: 'Rome', civilization: 'roman', start: { x: 40, y: 40 } },
    { name: 'Rival', civilization: 'roman', start: { x: 80, y: 40 } },
  ] })
  for (const castle of session.state.buildings.values()) {
    expect(session.enqueue({ tick: 0, seq: 0, player: castle.owner, type: 'demolish', building: castle.id })).toBeNull()
  }
  session.advance(20)
  expect(session.view(1).mission?.outcome).toBe('lost')
  expect(session.view(2).mission?.outcome).toBe('lost')
  const copy = restore(JSON.parse(JSON.stringify(save(session))), rules)
  copy.advance(40)
  expect(copy.view(1).mission?.outcome).toBe('lost')
  expect(copy.view(2).mission?.outcome).toBe('lost')
  expect(copy.view(1).mission?.objectives[0]?.status).toBe('failed')
})

test('an unfinished tower cannot keep a defeated player in the match', () => {
  const session = createSession({ rules, map: landscape(), seed: 2, mission: RIVAL_MISSION, players: [
    { name: 'Rome', civilization: 'roman', start: { x: 40, y: 40 } },
    { name: 'Rival', civilization: 'roman', start: { x: 80, y: 40 } },
  ] })
  const tower = place(session, 'small-tower', { x: 30, y: 42 })
  expect(session.state.buildings.get(tower)?.phase).not.toBe('active')
  const castle = [...session.state.buildings.values()].find(b => b.owner === 1 && b.type === 'castle')!
  order(session, 'demolish', { building: castle.id })
  session.advance(20)
  expect(session.view(1).mission?.outcome).toBe('lost')
  expect(session.view(2).mission?.outcome).toBe('won')
})
