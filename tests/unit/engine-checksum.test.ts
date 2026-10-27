import type { Session } from '../../resources/game/engine'
import { describe, expect, test } from 'bun:test'
import { checksum, createSession, describeMap, findStart, generateMap, PUBLISHED_RULES, restore, save, SAVE_VERSION } from '../../resources/game/engine'
import { anchors, landscape, order, place, rules } from '../fixtures/engine'

/** Advances tick by tick, requiring the incremental checksum to equal a full recomputation every time. */
function equal(s: Session, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    s.advance(1)
    const fast = s.checksum(), full = checksum(s.state)
    if (fast !== full) throw new Error(`Incremental checksum ${fast} differs from ${full} at tick ${s.state.tick}`)
  }
}

describe('incremental checksums', () => {
  test('equal a full recomputation every tick through levelling, harvest, planting, growth, mining, pioneers, sight, a mission reveal and restores', () => {
    let s = createSession({
      rules, map: landscape(), seed: 31,
      players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle }],
      mission: { id: 'reveal', version: 1, objectives: [{ id: 'cut', player: 1, text: 'Build a woodcutter' }], triggers: [{ id: 'cut', when: { kind: 'buildings-at-least', player: 1, building: 'woodcutter', count: 1 }, then: [{ kind: 'complete-objective', objective: 'cut' }, { kind: 'reveal', player: 1, x: 85, y: 85, radius: 4 }] }] },
    })
    order(s, 'settings', { settings: { stored: ['log', 'stone', 'coal'] } })
    order(s, 'specialists', { profession: 'pioneer', x: 64, y: 40, count: 2 })
    for (const [type, near] of [['woodcutter', anchors.forest], ['forester', anchors.south], ['stonecutter', anchors.granite], ['coal-mine', anchors.mountain], ['sawmill', anchors.north]] as const) place(s, type, near)
    for (let round = 0; round < 6; round++) {
      equal(s, 1000)
      // A restored session starts with every chunk marked and still agrees.
      const next = restore(JSON.parse(JSON.stringify(save(s))), rules)
      expect(next.checksum()).toBe(s.checksum())
      s = next
    }
    const l = s.state.ledger[1]!
    for (const good of ['log', 'stone']) expect(l.produced[good] ?? 0).toBeGreaterThan(0)
    expect(s.state.mission!.objectives.cut).toBe('complete')
  }, 300_000)

  test('equal a full recomputation through combat and a capture that redraws borders', () => {
    const s = createSession({
      rules, map: landscape(), seed: 9,
      players: [
        { name: 'Rome', civilization: 'roman', start: anchors.castle, scenario: { buildings: [{ type: 'castle', x: 40, y: 40 }], settlers: [{ profession: 'swordsman', x: 44, y: 46 }, { profession: 'swordsman', x: 45, y: 46 }, { profession: 'swordsman', x: 46, y: 46 }] } },
        { name: 'Enemy', civilization: 'roman', start: { x: 80, y: 40 }, scenario: { buildings: [{ type: 'small-tower', x: 80, y: 40 }], settlers: [{ profession: 'swordsman', x: 84, y: 44 }] } },
      ],
    })
    equal(s, 200)
    const ours = [...s.state.settlers.values()].filter(p => p.owner === 1 && p.soldier).map(p => p.id).slice(0, 2)
    order(s, 'move-soldiers', { soldiers: ours, x: 77, y: 43 })
    const arrived = (): boolean => ours.every(id => s.state.settlers.get(id)?.soldier?.order === -2)
    for (let i = 0; i < 2000 && !arrived(); i++) equal(s, 1)
    expect(arrived()).toBe(true)
    const tower = [...s.state.buildings.values()].find(b => b.owner === 2)!
    order(s, 'attack', { soldiers: ours, building: tower.id })
    for (let i = 0; i < 4000 && tower.owner !== 1; i++) equal(s, 1)
    expect(tower.owner).toBe(1)
    equal(s, 100)
  }, 300_000)

  test('a write that bypasses change tracking is caught by the comparison', () => {
    const s = createSession({ rules, map: landscape(), seed: 2, players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle }] })
    expect(s.checksum()).toBe(checksum(s.state))
    s.state.map.elevation[5] = s.state.map.elevation[5]! + 1
    expect(s.checksum()).not.toBe(checksum(s.state))
  })

  test('format 2 saves verify under their own checksum and are written as format 3', async () => {
    // Written by the engine at 73e7abe with rules 0.4.0, before checksums were chunked.
    const fixture = (await import('../fixtures/save-format-2.json')).default as unknown as ReturnType<typeof save>
    expect(fixture.version).toBe(2)
    const restored = restore(structuredClone(fixture), PUBLISHED_RULES)
    expect(restored.state.tick).toBe(fixture.tick)
    restored.advance(50)
    const current = save(restored)
    expect(current.version).toBe(SAVE_VERSION)
    expect(restore(JSON.parse(JSON.stringify(current)), PUBLISHED_RULES).checksum()).toBe(restored.checksum())
    const tampered = structuredClone(fixture)
    tampered.state.settlers[0]!.x += 1
    expect(() => restore(tampered, PUBLISHED_RULES)).toThrow('checksum does not match')
  })

  test('per-tick cost on the largest supported map follows what changed, not the map size', () => {
    const size = 1024, map = generateMap(rules, size, size, 4), start = findStart(rules, map, { x: size / 2, y: size / 2 }, 10)!
    const s = createSession({ rules, map, seed: 4, players: [{ name: 'Rome', civilization: 'roman', start }] })
    const time = (work: () => void, runs: number): number => { const begin = performance.now(); for (let i = 0; i < runs; i++) work(); return (performance.now() - begin) / runs }
    s.checksum()
    const full = time(() => checksum(s.state), 3)
    // Ticks that touch only a few chunks: the session rehashes those and the entities.
    const incremental = time(() => { s.advance(1); s.checksum() }, 20) - time(() => s.advance(1), 20)
    console.log(`checksum on ${size}x${size}: full ${full.toFixed(1)} ms, incremental per tick ${incremental.toFixed(2)} ms`)
    expect(s.checksum()).toBe(checksum(s.state))
    expect(incremental).toBeLessThan(full / 5)
  }, 300_000)
})

test('the format-three checksum retains little-endian UTF-16 text including surrogate pairs', () => {
  // Keep the independently derived pre-memory oracle and its original rules.
  const original = PUBLISHED_RULES.find(profile => profile.version === '0.14.0')!
  const s = createSession({ rules: original, seed: 5, map: describeMap(original, { width: 8, height: 8, base: 'grass', features: [] }), players: [{ name: 'Romé 🏰', civilization: 'roman', controller: 'observer', start: { x: 4, y: 4 }, scenario: { buildings: [], settlers: [] } }] })
  // Independent Python oracle: FNV over64*(eight zero layer bytes + fog3),
  // then LE32(8,8,1,1912944901) followed by1564 canonical UTF-16-LE entity bytes.
  expect(s.checksum()).toBe('d41b5e96')
  expect(checksum(s.state)).toBe('d41b5e96')
  s.dispose()
})
