import { expect, test } from 'bun:test'
import { audit, createSession, describeMap, economicAI, observe, PUBLISHED_RULES, restore, ROMAN_ENGINEERING as rules, save } from '../../resources/game/engine'
import { neighbours } from '../../resources/game/engine/geometry'
import { RIVAL_MILITARY } from '../../resources/game/controller'

// Public observation and ordinary movement prove useful scouting and restore.
// They do not establish original difficulty or complete military AI.
async function captured() {
  const bytes = await Bun.file(new URL('../fixtures/ai-scout-frontier.json', import.meta.url)).arrayBuffer()
  const provenance = await Bun.file(new URL('../fixtures/ai-scout-frontier.provenance.json', import.meta.url)).json()
  expect(Bun.SHA256.hash(bytes, 'hex')).toBe(provenance.sha256)
  return restore(JSON.parse(new TextDecoder().decode(bytes)), PUBLISHED_RULES)
}
function coordinate(order: Record<string, unknown>, key: string): number {
  const value = order[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`Expected integer scout field: ${key}`)
  return value
}

test('ordinary scouting continues at known frontier after all six home rays are explored', async () => {
  const s = await captured(), before = s.checksum(), o = observe(s, 1)
  expect(o.view.tick % RIVAL_MILITARY.scoutEvery).toBe(0)
  expect(o.view.settlers.filter(t => t.owner === 1 && t.rank !== undefined).length).toBe(14)
  expect(o.view.explored.filter(v => !v).length).toBe(513)
  const scout = economicAI(1, { military: RIVAL_MILITARY }).decide(o).find(c => c.type === 'move-soldiers')
  expect(scout).toBeDefined()
  if (!scout) throw new Error('Expected a frontier scouting order')
  const target = coordinate(scout, 'y') * o.width + coordinate(scout, 'x')
  expect(o.explored(target)).toBe(true)
  expect(neighbours(o, target).some(tile => !o.explored(tile))).toBe(true)
  expect(s.checksum()).toBe(before)
})

test('the actual frontier march reveals more land than the unchanged control and matches a mid-march restore', async () => {
  const s = await captured(), control = await captured(), o = observe(s, 1)
  const scout = economicAI(1, { military: RIVAL_MILITARY }).decide(o).find(c => c.type === 'move-soldiers')
  expect(scout).toBeDefined()
  if (!scout) throw new Error('Expected a frontier scouting order')
  const seq = 1 + Math.max(-1, ...s.state.results.filter(r => r.player === 1).map(r => r.seq), ...s.state.pending.filter(r => r.player === 1).map(r => r.seq))
  expect(s.enqueue({ ...scout, type: 'move-soldiers', tick: s.state.tick, player: 1, seq })).toBeNull()
  s.advance(160); control.advance(160)
  expect(s.state.results.find(r => r.player === 1 && r.seq === seq)?.ok).toBe(true)
  const copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
  for (let tick = 0; tick < 3000; tick++) { s.advance(1); copy.advance(1); control.advance(1) }
  const view = s.view(1), unchanged = control.view(1)
  expect(view.explored.some((known, tile) => known === 1 && !o.view.explored[tile] && !unchanged.explored[tile])).toBe(true)
  expect(copy.checksum()).toBe(s.checksum())
  expect(audit(s.context)).toEqual([])
  expect(audit(control.context)).toEqual([])
}, 60000)

test('the public reachability forecast excludes a known island and foreign soldiers without changing state', () => {
  const s = createSession({ rules, seed: 5, map: describeMap(rules, { width: 96, height: 96, seed: 5, base: 'water', features: [
    { kind: 'terrain', id: 'grass', x: 40, y: 40, radius: 12 }, { kind: 'terrain', id: 'grass', x: 66, y: 40, radius: 5 },
  ] }), players: [
    { name: 'Rome', civilization: 'roman', start: { x: 40, y: 40 }, scenario: { buildings: [{ type: 'castle', x: 40, y: 40 }], settlers: [
      { profession: 'swordsman', x: 38, y: 48 }, { profession: 'swordsman', x: 39, y: 48 }, { profession: 'geologist', x: 64, y: 40 },
    ] } },
    { name: 'Rival', civilization: 'roman', start: { x: 66, y: 40 }, scenario: { buildings: [], settlers: [{ profession: 'swordsman', x: 68, y: 40 }] } },
  ] })
  expect(s.skipped).toEqual({})
  s.advance(160)
  const before = s.checksum(), o = observe(s, 1), soldier = o.view.settlers.find(t => t.owner === 1 && t.rank !== undefined)!, foreign = o.view.settlers.find(t => t.owner === 2)!
  expect(o.explored(40 * o.width + 64)).toBe(true)
  const region = o.reachable(soldier.id)
  expect(region.has(soldier.y * o.width + soldier.x)).toBe(true)
  expect(region.has(40 * o.width + 64)).toBe(false)
  expect([...region].every(tile => o.explored(tile))).toBe(true)
  expect(foreign).toBeDefined()
  expect(o.reachable(foreign.id).size).toBe(0)
  expect(s.checksum()).toBe(before)
})

test('a stricter client reachability view prevents an unusable fallback order', async () => {
  const s = await captured(), o = observe(s, 1), before = s.checksum()
  expect(economicAI(1, { military: RIVAL_MILITARY }).decide({ ...o, reachable: () => new Set<number>() }).some(c => c.type === 'move-soldiers')).toBe(false)
  expect(s.checksum()).toBe(before)
})

test('an explored rotation still advances on reachable known frontier when another home ray has unseen land', async () => {
  const s = await captured(), o = observe(s, 1), before = s.checksum()
  const center = o.view.buildings.find(b => b.owner === 1 && b.type === 'castle')!
  const hidden = center.y * o.width + center.x + 30
  expect(o.explored(hidden)).toBe(true)
  // Withhold an east-ray tile; this turn's south-west ray is still complete.
  const limited = { ...o, explored: (tile: number) => tile !== hidden && o.explored(tile) }
  const command = economicAI(1, { military: RIVAL_MILITARY }).decide(limited).find(c => c.type === 'move-soldiers')!
  expect(command).toBeDefined()
  expect(limited.explored(coordinate(command, 'y') * o.width + coordinate(command, 'x'))).toBe(true)
  expect(s.checksum()).toBe(before)
})

test('a genuinely fully explored map needs no frontier scouting order', () => {
  const s = createSession({ rules, seed: 5, map: describeMap(rules, { width: 24, height: 24, base: 'grass', seed: 5, features: [] }), players: [{
    name: 'Rome', civilization: 'roman', start: { x: 12, y: 12 }, scenario: { buildings: [{ type: 'castle', x: 12, y: 12 }], settlers: [
      { profession: 'swordsman', x: 10, y: 21 }, { profession: 'swordsman', x: 11, y: 21 },
    ] },
  }] })
  expect(s.skipped).toEqual({})
  s.advance(160)
  const o = observe(s, 1)
  expect(o.view.explored.every(tile => tile === 1)).toBe(true)
  expect(economicAI(1, { military: { ...RIVAL_MILITARY, scoutEvery: 80 } }).decide(o).some(c => c.type === 'move-soldiers')).toBe(false)
})

test('a failed ray march resumes at an observed reachable frontier without repeating the blocked destination', () => {
  const s = createSession({ rules, seed: 5, map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: Array.from({ length: 96 }, (_, x) => ({ kind: 'terrain' as const, id: 'water', x, y: 27, radius: 0 })) }), players: [{
    name: 'Rome', civilization: 'roman', start: { x: 40, y: 40 }, scenario: { buildings: [{ type: 'small-tower', x: 40, y: 40 }], settlers: [{ profession: 'swordsman', x: 38, y: 48 }, { profession: 'swordsman', x: 39, y: 48 }] },
  }] })
  const policy = { ...RIVAL_MILITARY, scoutEvery: 80 }, ai = economicAI(1, { military: policy })
  s.advance(480)
  const initial = observe(s, 1), planned = ai.decide(initial).find(c => c.type === 'move-soldiers')!
  expect(planned).toBeDefined()
  expect(initial.explored(coordinate(planned, 'y') * initial.width + coordinate(planned, 'x'))).toBe(true)
  // A prior ordinary player order can still fail. Recover from that state too.
  const scout = initial.view.settlers.find(p => p.rank !== undefined && !p.inside)!
  const first = { type: 'move-soldiers', soldiers: [scout.id], x: 40, y: 23 }
  expect(s.enqueue({ ...first, type: 'move-soldiers', tick: s.state.tick, player: 1, seq: 0 })).toBeNull()
  s.advance(480)
  expect(s.view(1).settlers.some(p => p.diagnostic === 'unreachable')).toBe(true)
  const o = observe(s, 1), next = ai.decide(o).find(c => c.type === 'move-soldiers')!
  expect(next).toBeDefined()
  const tile = coordinate(next, 'y') * o.width + coordinate(next, 'x')
  expect(o.explored(tile)).toBe(true)
  const ids = next.soldiers as number[]
  expect(o.reachable(ids[0]!).has(tile)).toBe(true)
  expect(s.enqueue({ ...next, type: 'move-soldiers', tick: s.state.tick, player: 1, seq: 1 })).toBeNull()
  s.advance(160)
  const copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
  s.advance(2000); copy.advance(2000)
  expect(s.view(1).explored.some((seen, t) => seen && !o.explored(t))).toBe(true)
  expect(s.checksum()).toBe(copy.checksum())
  expect(audit(s.context)).toEqual([])
  s.dispose(); copy.dispose()
})
