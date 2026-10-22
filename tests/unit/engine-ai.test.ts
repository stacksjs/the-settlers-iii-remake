import { describe, expect, test } from 'bun:test'
import { audit, checksum, createSession, economicAI, findStart, generateMap, observe, restore, save, stepAI } from '../../resources/game/engine'
import { rules } from '../fixtures/engine'

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
