import { expect, test } from 'bun:test'
import { audit, createSession, describeMap, distance, economicAI, observe, PUBLISHED_RULES, restore, ROMAN_ENGINEERING as rules, save, stepAI } from '../../resources/game/engine'
import { RIVAL_MILITARY } from '../../resources/game/controller'

/** Public AI/session commands prove real recovery. Scenario queries separately test known, neutral and unreachable ground. */
test('the captured normal settlement builds a usable hut and harvests neutral granite with a deterministic restore', async () => {
  const bytes = await Bun.file(new URL('../fixtures/ai-neutral-granite.json', import.meta.url)).arrayBuffer()
  expect(new Bun.CryptoHasher('sha256').update(bytes).digest('hex')).toBe('9dbb0e73241491b8a897554d56ede3034c8f9dbe1130ced53ca26cc5fe0356c5')
  const s = restore(JSON.parse(new TextDecoder().decode(bytes)), PUBLISHED_RULES), ai = economicAI(1, { military: RIVAL_MILITARY })
  const before = s.state.ledger[1]!.produced.stone!, created = { ...s.state.ledger[1]!.created }
  expect(s.state.tick).toBe(200000)
  expect(before).toBe(72)
  expect(s.placement(1, 'stonecutter', 11, 54)).toBeNull()
  expect(s.view(1).owner[61 * 128 + 11]).toBe(0)
  expect(ai.decide(observe(s, 1)).some(command => command.type === 'build' && command.building === 'stonecutter')).toBe(true)
  const copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES), fresh = economicAI(1, { military: RIVAL_MILITARY })
  const sequence = { next: 1 + Math.max(-1, ...s.state.results.filter(c => c.player === 1).map(c => c.seq), ...s.state.pending.filter(c => c.player === 1).map(c => c.seq)) }, copiedSequence = { ...sequence }
  for (let tick = 0; tick < 8000 && (s.state.ledger[1]!.produced.stone ?? 0) === before; tick++) {
    stepAI(s, ai, sequence); s.advance(1)
    stepAI(copy, fresh, copiedSequence); copy.advance(1)
  }
  expect(s.state.ledger[1]!.produced.stone!).toBeGreaterThan(before)
  expect(s.state.ledger[1]!.created).toEqual(created)
  expect(s.view(1).buildings.some(b => b.owner === 1 && b.type === 'stonecutter' && b.phase === 'active')).toBe(true)
  expect(copy.checksum()).toBe(s.checksum())
  expect(ai.results).toEqual([])
  expect(fresh.results).toEqual([])
  expect(audit(s.context)).toEqual([])
}, 60000)

function border(options: { enemy?: boolean, island?: boolean, hidden?: boolean } = {}) {
  const map = describeMap(rules, { width: 128, height: 96, seed: 5, base: 'grass', features: [
    ...(options.island ? [{ kind: 'terrain' as const, id: 'water', x: 65, y: 40, radius: 1 }, { kind: 'terrain' as const, id: 'grass', x: 65, y: 40, radius: 0 }] : []),
    { kind: 'object', id: 'stone', x: 65, y: 40, radius: 0 },
  ] })
  const s = createSession({ rules, map, seed: 5, players: [
    { name: 'Rome', civilization: 'roman', start: { x: 40, y: 40 }, scenario: { buildings: [{ type: 'castle', x: 40, y: 40 }, { type: 'sawmill', x: 31, y: 44 }], settlers: [
      ...Array.from({ length: 16 }, (_, i) => ({ profession: 'carrier', x: 36 + i % 8, y: 47 + Math.floor(i / 8) })),
      ...(options.hidden ? [] : [{ profession: 'geologist', x: 63, y: 40 }]),
    ] } },
    ...(options.enemy ? [{ name: 'Rival', civilization: 'roman', start: { x: 80, y: 40 }, settlers: {}, goods: {} }] : []),
  ], piles: [{ good: 'plank', amount: 16, x: 38, y: 51 }, { good: 'stone', amount: 3, x: 39, y: 51 }] })
  expect(s.skipped).toEqual({})
  expect(s.placement(1, 'stonecutter', 58, 40)).toBeNull()
  return s
}

test('known neutral granite is usable from owned adjacent land without claiming the blocked object tile', () => {
  const s = border(), before = s.checksum(), o = observe(s, 1)
  expect(o.explored(40 * 128 + 65)).toBe(true)
  expect(o.view.owner[40 * 128 + 65]).toBe(0)
  expect(o.harvestable('stonecutter', 58, 40)).toBe(true)
  expect(economicAI(1).decide(o).some(c => c.type === 'build' && c.building === 'stonecutter')).toBe(true)
  expect(s.checksum()).toBe(before)
})

test('a neutral resource across water is not a usable harvesting site', () => {
  const s = border({ island: true }), o = observe(s, 1)
  expect(o.object(40 * 128 + 65)).toBe('stone')
  expect(o.harvestable('stonecutter', 58, 40)).toBe(false)
  expect(economicAI(1).decide(o).some(c => c.type === 'build' && c.building === 'stonecutter')).toBe(false)
})

test('enemy-only or unexplored granite is excluded from economic site planning', () => {
  for (const options of [{ enemy: true }, { hidden: true }]) {
    const s = border(options), o = observe(s, 1)
    if (options.enemy) expect(o.view.owner[40 * 128 + 65]).toBe(2)
    else { expect(o.explored(40 * 128 + 65)).toBe(false); expect(o.object(40 * 128 + 65)).toBeNull() }
    expect(o.harvestable('stonecutter', 58, 40)).toBe(false)
    expect(economicAI(1).decide(o).some(c => c.type === 'build' && c.building === 'stonecutter')).toBe(false)
  }
})

test('a known neutral forest without an owned workplace still triggers timber expansion', () => {
  const s = createSession({ rules, seed: 5,
    map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: [{ kind: 'object', id: 'tree', x: 40, y: 70, radius: 2 }] }),
    players: [{ name: 'Rome', civilization: 'roman', start: { x: 40, y: 40 }, scenario: {
      buildings: [{ type: 'castle', x: 40, y: 40 }, { type: 'sawmill', x: 31, y: 44 }],
      settlers: [{ profession: 'geologist', x: 40, y: 63 }],
    } }],
    piles: [{ good: 'plank', amount: 16, x: 38, y: 51 }, { good: 'stone', amount: 12, x: 39, y: 51 }],
  })
  expect(s.skipped).toEqual({})
  const o = observe(s, 1)
  expect(o.object(68 * 96 + 40)).toBe('tree')
  expect(o.view.owner[68 * 96 + 40]).toBe(0)
  const orders = economicAI(1).decide(o)
  expect(orders.some(c => c.type === 'build' && c.building === 'woodcutter')).toBe(false)
  const tower = orders.find(c => c.type === 'build' && c.building === 'small-tower')
  expect(tower).toBeDefined()
  expect(distance({ x: Number(tower!.x), y: Number(tower!.y) }, { x: 40, y: 68 })).toBeLessThan(28)
})
