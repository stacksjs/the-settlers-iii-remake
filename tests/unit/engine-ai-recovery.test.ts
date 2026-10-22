import type { Session } from '../../resources/game/engine'
import { describe, expect, test } from 'bun:test'
import { audit, checksum, restore, save, createSession, diagnose, economicAI, findStart, generateMap, observe, stepAI } from '../../resources/game/engine'
import { anchors, landscape, rules } from '../fixtures/engine'

type Placed = { type: string, x: number, y: number }
const carriers = (n: number) => Array.from({ length: n }, (_, i) => ({ profession: 'carrier', x: 36 + (i % 8), y: 47 + Math.floor(i / 8) }))
/** A computer settlement made of scenario buildings and loose piles, so each test sets up exactly one deadlock. */
function computer(buildings: Placed[], piles: { good: string, amount: number }[] = [], settlers = carriers(16), map = landscape()): Session {
  const s = createSession({
    rules, map, seed: 3,
    players: [{ name: 'Computer', civilization: 'roman', controller: 'computer', start: anchors.castle, scenario: { buildings: [{ type: 'castle', x: 40, y: 40 }, ...buildings], settlers } }],
    piles: piles.map((p, i) => ({ ...p, x: 38 + (i % 4), y: 51 + Math.floor(i / 4) })),
  })
  expect(s.skipped).toEqual({})
  return s
}
const play = (s: Session, ticks: number, ai = economicAI(1, { interval: 20 }), seq = { next: 0 }): typeof ai => {
  for (let t = 0; t < ticks; t++) { stepAI(s, ai, seq); s.advance(1) }
  return ai
}
const mine = (s: Session) => s.state.results.filter(r => r.player === 1)

describe('AI deadlock recovery', () => {
  test('a missing tool becomes an urgent order, so the tool smith makes it before anything else', () => {
    const first = (withAI: boolean): string => {
      const s = computer([{ type: 'toolsmith', x: 31, y: 44 }, { type: 'woodcutter', x: 53, y: 51 }], [{ good: 'iron', amount: 4 }, { good: 'coal', amount: 4 }, { good: 'hammer', amount: 1 }])
      for (let t = 0; t < 4000 && !Object.keys(s.state.ledger[1]!.produced).some(g => rules.tools.includes(g)); t++) {
        if (withAI) stepAI(s, ai, seq)
        s.advance(1)
      }
      return Object.keys(s.state.ledger[1]!.produced).find(g => rules.tools.includes(g)) ?? ''
    }
    const ai = economicAI(1, { interval: 20 }), seq = { next: 0 }
    expect(first(false)).not.toBe('axe')
    expect(first(true)).toBe('axe')
  }, 60_000)

  test('a stonecutter whose granite is gone is torn down for its refund; a woodcutter beside a forester waits', () => {
    const s = computer([{ type: 'stonecutter', x: 30, y: 31 }, { type: 'woodcutter', x: 53, y: 51 }, { type: 'forester', x: 44, y: 54 }], [{ good: 'plank', amount: 8 }, { good: 'stone', amount: 8 }, { good: 'pickaxe', amount: 1 }, { good: 'axe', amount: 1 }, { good: 'shovel', amount: 1 }])
    // No granite anywhere: the stonecutter can only report that nothing is left.
    const stone = rules.objects.findIndex(o => o.id === 'stone') + 1, tree = rules.objects.findIndex(o => o.id === 'tree') + 1
    for (let t = 0; t < s.state.map.object.length; t++) { if (s.state.map.object[t] === stone || s.state.map.object[t] === tree) { s.state.map.object[t] = 0; s.state.map.objectAmount[t] = 0 } }
    const ai = play(s, 1200)
    expect(mine(s).some(r => r.type === 'demolish' && r.ok)).toBe(true)
    expect([...s.state.buildings.values()].some(b => b.type === 'stonecutter' && b.x === 30 && b.y === 31)).toBe(false)
    expect(s.state.ledger[1]!.recovered.plank).toBeGreaterThan(0)
    expect([...s.state.buildings.values()].some(b => b.type === 'woodcutter' && b.x === 53)).toBe(true)
    expect(ai.results).toEqual([])
    expect(audit(s.context)).toEqual([])
  }, 60_000)

  test('hungry mines put a fisher at the front of the build order', () => {
    const s = computer([{ type: 'coal-mine', x: 28, y: 28 }, { type: 'sawmill', x: 31, y: 44 }], [{ good: 'plank', amount: 8 }, { good: 'stone', amount: 8 }, { good: 'pickaxe', amount: 1 }])
    // The miners eat what they have, then the mine reports hunger; the computer then decides once.
    for (let t = 0; t < 3000 && !diagnose(observe(s, 1)).some(d => d.kind === 'food'); t++) s.advance(1)
    expect(diagnose(observe(s, 1)).find(d => d.kind === 'food')).toMatchObject({ recoverable: true })
    expect(economicAI(1).decide(observe(s, 1)).find(o => o.type === 'build')).toMatchObject({ building: 'fisher' })
  }, 60_000)

  test('buildings without workers put a residence at the front of the build order', () => {
    const s = computer([{ type: 'sawmill', x: 31, y: 44 }], [{ good: 'plank', amount: 8 }, { good: 'stone', amount: 8 }, { good: 'saw', amount: 1 }], [])
    for (let t = 0; t < 600 && !diagnose(observe(s, 1)).some(d => d.kind === 'population'); t++) s.advance(1)
    expect(diagnose(observe(s, 1)).some(d => d.kind === 'population')).toBe(true)
    expect(economicAI(1).decide(observe(s, 1)).find(o => o.type === 'build')).toMatchObject({ building: 'small-residence' })
  }, 60_000)

  test('with no planks or logs left, idle buildings are torn down to pay for a sawmill', () => {
    const s = computer([{ type: 'woodcutter', x: 49, y: 51 }, { type: 'medium-residence', x: 31, y: 44 }, { type: 'small-residence', x: 36, y: 54 }], [{ good: 'stone', amount: 8 }, { good: 'axe', amount: 1 }, { good: 'saw', amount: 1 }, { good: 'hammer', amount: 2 }, { good: 'shovel', amount: 2 }])
    const d = diagnose(observe(s, 1)).find(d => d.kind === 'materials')!
    expect(d).toMatchObject({ recoverable: true, recovery: { type: 'demolish' } })
    expect(s.state.buildings.get((d.recovery as { building: number }).building)!.type).toBe('medium-residence')
    const ai = play(s, 6000)
    expect([...s.state.buildings.values()].some(b => b.type === 'sawmill' && b.phase === 'active')).toBe(true)
    expect(s.state.ledger[1]!.produced.plank ?? 0).toBeGreaterThan(0)
    expect(ai.results).toEqual([])
    expect(audit(s.context)).toEqual([])
  }, 120_000)

  test('with no planks, logs or refunds left the economy is recognised as unrecoverable and no sites are ordered', () => {
    const s = computer([], [{ good: 'stone', amount: 8 }])
    const ai = play(s, 400)
    expect(ai.diagnosis).toEqual([expect.objectContaining({ kind: 'materials', recoverable: false, recovery: null })])
    expect(mine(s).filter(r => r.type === 'build')).toEqual([])
  })

  test('a full output doorstep puts storage first, with the same choices after a save', () => {
    const s = computer([{ type: 'sawmill', x: 31, y: 44 }], [{ good: 'log', amount: 40 }, { good: 'saw', amount: 1 }, { good: 'plank', amount: 8 }, { good: 'stone', amount: 8 }])
    for (let t = 0; t < 12000 && !diagnose(observe(s, 1)).some(d => d.kind === 'delivery'); t++) s.advance(1)
    expect(diagnose(observe(s, 1)).some(d => d.kind === 'delivery')).toBe(true)
    const before = checksum(s.state), restored = restore(save(s), rules)
    const first = economicAI(1).decide(observe(s, 1))
    expect(first.find(o => o.type === 'build')).toMatchObject({ building: 'storage' })
    expect(economicAI(1).decide(observe(restored, 1))).toEqual(first)
    expect(checksum(s.state)).toBe(before)
    expect(audit(s.context)).toEqual([])
  })

  test('a removed sawmill is rebuilt, so the supply of planks recovers', () => {
    const map = generateMap(rules, 96, 96, 21), start = findStart(rules, map, { x: 48, y: 48 }, 10)!
    const s = createSession({ rules, map, seed: 21, players: [{ name: 'Computer', civilization: 'roman', controller: 'computer', start }] })
    const ai = economicAI(1), seq = { next: 0 }
    const run = (ticks: number): void => { for (let t = 0; t < ticks; t++) { stepAI(s, ai, seq); s.advance(1) } }
    run(8000)
    const sawmill = [...s.state.buildings.values()].find(b => b.type === 'sawmill' && b.phase === 'active')!
    expect(sawmill).toBeDefined()
    // The supply route is cut through the same command a player would use.
    s.enqueue({ tick: s.state.tick, player: 1, seq: seq.next++, type: 'demolish', building: sawmill.id })
    run(1)
    const planks = s.state.ledger[1]!.produced.plank ?? 0
    run(10_000)
    expect([...s.state.buildings.values()].some(b => b.type === 'sawmill' && b.phase === 'active')).toBe(true)
    expect(s.state.ledger[1]!.produced.plank ?? 0).toBeGreaterThan(planks)
    expect(ai.results).toEqual([])
    expect(audit(s.context)).toEqual([])
  }, 180_000)
})
