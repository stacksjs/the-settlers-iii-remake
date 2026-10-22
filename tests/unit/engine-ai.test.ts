import { describe, expect, test } from 'bun:test'
import { audit, checksum, createSession, economicAI, findStart, generateMap, observe, restore, save, stepAI } from '../../resources/game/engine'
import type { Session } from '../../resources/game/engine'
import { anchors, landscape, rules } from '../fixtures/engine'

function world(seed: number) {
  const map = generateMap(rules, 96, 96, seed)
  const start = findStart(rules, map, { x: 48, y: 48 }, 10)!
  return createSession({ rules, map, seed, players: [{ name: 'Computer', civilization: 'roman', controller: 'computer', start }] })
}

describe('economic AI', () => {
  test('builds and supplies a real economy from normal start stock using only legal commands', () => {
    const s = world(21), ai = economicAI(1), seq = { next: 0 }
    const before = s.state.settlers.size
    for (let tick = 0; tick < 20_000; tick++) {
      stepAI(s, ai, seq)
      s.advance(1)
      // Nothing is conjured: goods, people, tools and reservations stay accounted for.
      if (tick % 100 === 0) expect(audit(s.context)).toEqual([])
    }
    const types = new Set([...s.state.buildings.values()].filter(b => b.phase === 'active').map(b => b.type))
    for (const type of ['woodcutter', 'stonecutter', 'sawmill', 'forester']) expect(types.has(type)).toBe(true)
    const l = s.state.ledger[1]!
    expect(l.produced.log ?? 0).toBeGreaterThan(10)
    expect(l.produced.plank ?? 0).toBeGreaterThan(5)
    expect(l.produced.stone ?? 0).toBeGreaterThan(5)
    // Every settler beyond the start was born in a residence the AI built.
    expect(s.state.settlers.size).toBe(before + l.births)
    // Every action went through the command queue and was accepted.
    expect(s.state.results.length).toBeGreaterThan(5)
    expect(ai.results).toEqual([])
  }, 120_000)

  test('decides from its observation alone, so a restored game continues identically', () => {
    const a = world(7), ai = economicAI(1), seq = { next: 0 }
    for (let tick = 0; tick < 3000; tick++) { stepAI(a, ai, seq); a.advance(1) }
    const b = restore(JSON.parse(JSON.stringify(save(a))), rules), fresh = economicAI(1), seqB = { next: seq.next }
    for (let tick = 0; tick < 4000; tick++) { stepAI(a, ai, seq); a.advance(1); stepAI(b, fresh, seqB); b.advance(1) }
    expect(checksum(b.state)).toBe(checksum(a.state))
  }, 120_000)

  test('sees only what its player may know', () => {
    const s = world(3)
    const o = observe(s, 1)
    const unexplored = o.view.explored.findIndex(v => v === 0)
    expect(unexplored).toBeGreaterThanOrEqual(0)
    expect(o.terrain(unexplored)).toBeNull()
    expect(o.object(unexplored)).toBeNull()
    // Deposits are known only through the player's own survey signs.
    expect('resource' in o).toBe(false)
    expect(o.view.signs).toEqual([])
  })
})

describe('military AI', () => {
  // The computer holds the castle with soldiers; the other player has a tower out of its sight.
  function frontier(defenders = 1): Session {
    return createSession({
      rules, map: landscape(), seed: 13,
      players: [
        { name: 'Computer', civilization: 'roman', controller: 'computer', start: anchors.castle, scenario: { buildings: [{ type: 'castle', x: 40, y: 40 }], settlers: [{ profession: 'swordsman', x: 44, y: 46 }, { profession: 'swordsman', x: 45, y: 46 }, { profession: 'swordsman', x: 46, y: 46 }, { profession: 'pikeman', x: 47, y: 46 }] } },
        { name: 'Rome', civilization: 'roman', start: { x: 74, y: 40 }, scenario: { buildings: [{ type: 'small-tower', x: 74, y: 40 }], settlers: Array.from({ length: defenders }, (_, i) => ({ profession: 'swordsman', x: 76 + i, y: 44 })) } },
      ],
    })
  }

  test('scouts, attacks only what it has seen, and captures through ordinary commands', () => {
    const s = frontier(), ai = economicAI(1, { military: { attackAt: 3, scoutEvery: 400 } }), seq = { next: 0 }
    const tower = [...s.state.buildings.values()].find(b => b.owner === 2)!
    let sighted = -1
    for (let tick = 0; tick < 12_000 && tower.owner !== 1; tick++) {
      if (sighted < 0 && observe(s, 1).view.buildings.some(b => b.id === tower.id)) sighted = s.state.tick
      stepAI(s, ai, seq)
      s.advance(1)
      if (tick % 100 === 0) expect(audit(s.context)).toEqual([])
    }
    const mine = s.state.results.filter(r => r.player === 1)
    const firstAttack = mine.find(r => r.type === 'attack')
    // It never ordered an attack before the tower came into its view, and it scouted to find it.
    expect(sighted).toBeGreaterThan(0)
    expect(firstAttack!.tick).toBeGreaterThanOrEqual(sighted)
    expect(mine.some(r => r.type === 'move-soldiers')).toBe(true)
    expect(tower.owner).toBe(1)
    expect(ai.results).toEqual([])
  }, 120_000)

  test('meets enemy soldiers who march into its land', () => {
    // The tower keeps one soldier; the other marches in, ignoring everything on the way.
    const s = frontier(2), ai = economicAI(1, { military: { attackAt: 99, scoutEvery: 100_000 } }), seq = { next: 0 }
    for (let tick = 0; tick < 200; tick++) { stepAI(s, ai, seq); s.advance(1) }
    const raider = [...s.state.settlers.values()].filter(p => p.owner === 2 && p.soldier).at(-1)!
    s.enqueue({ tick: s.state.tick, player: 2, seq: 0, type: 'move-soldiers', soldiers: [raider.id], x: 50, y: 44, mode: 'forced' })
    s.advance(1)
    expect(s.state.results.at(-1)!.ok).toBe(true)
    for (let tick = 0; tick < 3000 && s.state.settlers.has(raider.id); tick++) { stepAI(s, ai, seq); s.advance(1) }
    expect(s.state.settlers.has(raider.id)).toBe(false)
    expect(s.state.results.some(r => r.player === 1 && r.type === 'move-soldiers' && r.ok)).toBe(true)
    expect(s.state.results.filter(r => r.player === 1).every(r => r.ok)).toBe(true)
  }, 120_000)

  test('decides the same way after a restore', () => {
    const a = frontier(), ai = economicAI(1, { military: { attackAt: 3, scoutEvery: 400 } }), seq = { next: 0 }
    for (let tick = 0; tick < 1500; tick++) { stepAI(a, ai, seq); a.advance(1) }
    const b = restore(JSON.parse(JSON.stringify(save(a))), rules), fresh = economicAI(1, { military: { attackAt: 3, scoutEvery: 400 } }), seqB = { next: seq.next }
    for (let tick = 0; tick < 2500; tick++) { stepAI(a, ai, seq); a.advance(1); stepAI(b, fresh, seqB); b.advance(1) }
    expect(checksum(b.state)).toBe(checksum(a.state))
  }, 120_000)
})
