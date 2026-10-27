import { expect, test } from 'bun:test'
import type { OriginalMapInput } from '../../resources/game/engine'
import { anchors, conserved, landscape, order, place, run, session, until } from '../fixtures/engine'
import { route } from '../../resources/game/engine/routing'
import { checksum, createSession, describeMap, economicAI, stepAI, PUBLISHED_RULES, record, restore, rulesFor, save, verify, validateRules, RulesError, ROMAN_ENGINEERING as rules, worldFromOriginal } from '../../resources/game/engine'

const size = 32, first = 4 * size + 4, second = first + 1, river = first + 2
const authored = (swapped = false): OriginalMapInput => {
  const landscape = new Uint8Array(size * size).fill(16)
  landscape[first] = swapped ? 1 : 0; landscape[second] = swapped ? 0 : 1; landscape[river] = 96
  return { area: { size, landscape, elevation: new Uint8Array(size * size), objects: new Uint8Array(size * size), resourceType: new Uint8Array(size * size), resourceAmount: new Uint8Array(size * size) }, players: [], settlers: [], buildings: [], stacks: [] }
}

test('original WATER1 and WATER2 remain distinct canonical world terrain identities', () => {
  // OriginalLandscape maps0/1 to WATER1/WATER2; ELandscapeType uses image17/16.
  const a = worldFromOriginal(rules, authored()), b = worldFromOriginal(rules, authored(true))
  expect(a.map.terrain[first]).not.toBe(a.map.terrain[second])
  expect(a.map.terrain[first]).toBe(b.map.terrain[second])
  expect(a.map.terrain[second]).toBe(b.map.terrain[first])
})

test('original rivers are nonwater traversable land in the source catalog', () => {
  const world = worldFromOriginal(rules, authored()), terrain = rules.terrain[world.map.terrain[river]!]!
  expect(terrain.water).toBe(false)
  expect(terrain.walkable).toBe(true)
})

// Literal pairs transcribed from OriginalLandscape.java, independently of the generated table.
const mappings = [[0, 'water'], [1, 'water-2'], [2, 'water-3'], [3, 'water-4'], [4, 'water-5'], [5, 'water-6'], [6, 'water-7'], [7, 'water-8'],
  [16, 'grass'], [17, 'mountain-border-outer'], [20, 'desert-border-outer'], [21, 'moor-border-outer'], [23, 'mud-border-outer'], [32, 'mountain'], [33, 'mountain-border'], [35, 'snow-border-outer'],
  [48, 'sand'], [64, 'desert'], [65, 'desert-border'], [80, 'moor'], [81, 'moor-border'], [96, 'river-1'], [97, 'river-2'], [98, 'river-3'], [99, 'river-4'], [128, 'snow'], [129, 'snow-border'], [144, 'swamp'], [145, 'mud-border']] as const

test('all 29 original codes preserve their distinct terrain identities and source classifications', () => {
  const input = authored()
  for (const [i, [code]] of mappings.entries()) (input.area.landscape as Uint8Array)[i] = code
  const world = worldFromOriginal(rules, input)
  expect(mappings.map((_, i) => rules.terrain[world.map.terrain[i]!]!.id)).toEqual(mappings.map(([, id]) => id))
  expect(new Set(mappings.map((_, i) => world.map.terrain[i])).size).toBe(29)
  const blocked = rules.terrain.filter(t => !t.walkable).map(t => t.id)
  expect(blocked).toEqual(['snow', 'water', 'water-2', 'water-3', 'water-4', 'water-5', 'water-6', 'water-7', 'water-8', 'moor', 'moor-border', 'snow-border'])
  expect(rules.terrain.filter(t => t.buildable).map(t => t.id)).toEqual(['grass', 'earth', 'flattened'])
  expect(rules.terrain).toHaveLength(37)
  expect(new Set(rules.terrain.map(t => t.landscape!.image)).size).toBe(32)
})

test('unknown original landscape admission reports structured code and coordinates', () => {
  const input = authored(); (input.area.landscape as Uint8Array)[first] = 250
  try { worldFromOriginal(rules, input); throw new Error('Expected rejection') }
  catch (error) { expect(error).toMatchObject({ code: 'unsupported-original-landscape', landscape: 250, tile: first, x: 4, y: 4 }) }
})

test('original fish remain sea-only and ore remains mountain or inner mountain border only', () => {
  const input = authored(), codes = [0, 1, 96, 32, 33, 17, 16]
  for (const [i, code] of codes.entries()) {
    (input.area.landscape as Uint8Array)[i] = code
    ;(input.area.resourceType as Uint8Array)[i] = i < 3 ? 0 : 1
    ;(input.area.resourceAmount as Uint8Array)[i] = 4
  }
  const world = worldFromOriginal(rules, input)
  expect([...world.map.resourceAmount.slice(0, 7)]).toEqual([4, 4, 0, 4, 4, 0, 0])
  expect(world.diagnostics).toMatchObject({ 'resource fish on mismatched terrain': 1, 'resource coal on mismatched terrain': 2 })
})

test('waterworkers collect rivers instead of sea water through normal trips', () => {
  for (const [kind, expected] of [['river-1', true], ['water', false]] as const) {
    const map = landscape()
    for (let t = 0; t < map.terrain.length; t++) if (rules.terrain[map.terrain[t]!]!.water) { map.terrain[t] = rules.terrain.findIndex(v => v.id === kind); map.resource[t] = 0; map.resourceAmount[t] = 0 }
    const s = session({ map }), id = place(s, 'waterworks', anchors.water)
    order(s, 'work-area', { building: id, ...anchors.water })
    until(s, () => s.state.buildings.get(id)!.phase === 'active', 6000)
    if (expected) until(s, () => (s.state.ledger[1]!.produced.water ?? 0) > 0, 5000)
    else { run(s, 3000); expect(s.state.ledger[1]!.produced.water ?? 0).toBe(0); expect(s.state.buildings.get(id)!.shortage).toBe('no-resources') }
    expect(conserved(s)).toBe(true)
  }
}, 30_000)

test('land routes cross rivers but reject sea, moor and snow partitions', () => {
  for (const [kind, reachable] of [['river-1', true], ['mud-border', true], ['mountain-border-outer', true], ['water-2', false], ['moor-border', false], ['snow', false]] as const) {
    const map = describeMap(rules, { width: 32, height: 32, base: 'water', features: [
      { kind: 'terrain', id: 'grass', x: 4, y: 4, radius: 0 }, { kind: 'terrain', id: kind, x: 5, y: 4, radius: 0 }, { kind: 'terrain', id: 'grass', x: 6, y: 4, radius: 0 },
    ] })
    const s = createSession({ rules, map, seed: 1, players: [{ name: 'Viewer', civilization: 'roman', controller: 'observer', start: { x: 4, y: 4 }, scenario: { buildings: [], settlers: [] } }] })
    try { expect(route(s.context, 4 * 32 + 4, 4 * 32 + 6).ok).toBe(reachable) }
    finally { s.dispose() }
  }
})

test('mine origins require mountain or inner border and general sites keep source ground permissions', () => {
  const map = describeMap(rules, { width: 96, height: 96, base: 'grass', features: [{ kind: 'terrain', id: 'mountain-border-outer', ...anchors.mountain, radius: 5 }] })
  const s = session({ map }), tile = anchors.mountain.y * map.width + anchors.mountain.x
  expect(s.placement(1, 'coal-mine', anchors.mountain.x, anchors.mountain.y)).toContain('mountain')
  s.state.map.terrain[tile] = rules.terrain.findIndex(t => t.id === 'mountain-border')
  expect(s.placement(1, 'coal-mine', anchors.mountain.x, anchors.mountain.y)).toBeNull()
  expect(s.placement(1, 'storage', anchors.mountain.x, anchors.mountain.y)).toContain('grass')
  s.state.map.terrain.fill(rules.terrain.findIndex(t => t.id === 'earth'))
  expect(s.placement(1, 'storage', anchors.mountain.x, anchors.mountain.y)).toBeNull()
  const ring = rules.buildings.find(b => b.id === 'storage')!.protected[0]!
  s.state.map.terrain[(anchors.mountain.y + ring[1]) * map.width + anchors.mountain.x + ring[0]] = rules.terrain.findIndex(t => t.id === 'sand')
  expect(s.placement(1, 'storage', anchors.mountain.x, anchors.mountain.y)).toContain('open ground')
  s.dispose()
})

test('every source identity survives checksums, checkpoint restore and deterministic replay', () => {
  const map = describeMap(rules, { width: 96, height: 96, base: 'grass', features: [] })
  for (let i = 0; i < rules.terrain.length; i++) map.terrain[i] = i
  const s = session({ map }), before = checksum(s.state), envelope = save(s), restored = restore(JSON.parse(JSON.stringify(envelope)), PUBLISHED_RULES)
  expect([...restored.state.map.terrain.slice(0, 37)]).toEqual(Array.from({ length: 37 }, (_, i) => i))
  expect(restored.checksum()).toBe(before)
  const recorder = record(s); recorder.advance(40)
  expect(verify(recorder.replay(), PUBLISHED_RULES)).toEqual({ ok: true, ticks: 40, checksum: s.checksum() })
  const changed = restore(envelope, PUBLISHED_RULES)
  changed.state.map.terrain[0] = 15
  expect(changed.checksum()).not.toBe(before)
  s.dispose(); restored.dispose(); changed.dispose()
})

test('the published 0.13 profile retains its exact identity and old terrain rules in saves and replays', () => {
  const old = rulesFor({ id: 'roman-engineering', version: '0.13.0', digest: '546d722c064d653b3e0cccb5d5dcf217aa031e3abf0928f5a7e5da17aa184931' })!
  expect(old).toBeDefined(); expect(old.terrain).toHaveLength(8)
  const map = describeMap(old, { width: 96, height: 96, base: 'grass', features: [{ kind: 'terrain', id: 'sand', x: 28, y: 28, radius: 3 }] })
  const s = createSession({ rules: old, map, seed: 4, players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle }] })
  expect(s.placement(1, 'storage', 28, 28)).toBeNull()
  const restored = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
  expect(restored.rules).toBe(old)
  const recorder = record(s); recorder.advance(30)
  restored.advance(30)
  expect(restored.checksum()).toBe(s.checksum())
  expect(verify(recorder.replay(), PUBLISHED_RULES).ok).toBe(true)
  s.dispose(); restored.dispose()
})

test('Grassland Galore changes every source desert variant through a replayed command', () => {
  const target = { x: 44, y: 60 }, types = ['desert', 'desert-border', 'desert-border-outer', 'flattened-desert', 'sharp-flattened-desert']
  const features = types.map((id, i) => ({ kind: 'terrain' as const, id, x: 42 + i, y: 60, radius: 0 }))
  const map = describeMap(rules, { width: 96, height: 96, base: 'grass', features: [...features, { kind: 'terrain', id: 'earth', x: 44, y: 61, radius: 0 }] })
  const s = createSession({ rules, map, seed: 4, players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle, scenario: { buildings: [{ type: 'castle', ...anchors.castle }], settlers: [{ profession: 'priest', x: 44, y: 52 }] } }] })
  s.state.players[0]!.religion = { manna: 10, produced: 10, promotions: 0, levels: {}, templeLost: false }
  const recorder = record(s), priest = [...s.state.settlers.values()][0]!
  expect(recorder.enqueue({ type: 'cast', tick: 0, player: 1, seq: 0, priest: priest.id, spell: 'grassland-galore', ...target })).toBeNull()
  recorder.advance(4)
  expect(types.map((_, i) => rules.terrain[s.state.map.terrain[60 * 96 + 42 + i]!]!.id)).toEqual(types.map(() => 'grass'))
  expect(rules.terrain[s.state.map.terrain[61 * 96 + 44]!]!.id).toBe('earth')
  expect(verify(recorder.replay(), PUBLISHED_RULES).ok).toBe(true)
  const restored = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
  expect(restored.checksum()).toBe(s.checksum())
  expect(checksum(s.state)).toBe(s.checksum())
  s.dispose(); restored.dispose()
})

test('foresters plant flattened grass and decline earth through the normal working area', () => {
  for (const [ground, plants] of [['flattened', true], ['earth', false]] as const) {
    const work = { x: 52, y: 55 }, map = landscape([{ kind: 'terrain', id: ground, ...work, radius: 6 }])
    const s = session({ map }), hut = place(s, 'forester', { x: 40, y: 53 })
    order(s, 'work-area', { building: hut, ...work })
    until(s, () => s.state.buildings.get(hut)!.phase === 'active', 6000)
    if (plants) until(s, () => s.state.map.object.some(o => o === s.context.objectIndex.get('sapling')), 3000)
    else { run(s, 3000); expect(s.state.map.object.some(o => o === s.context.objectIndex.get('sapling'))).toBe(false); expect(s.state.buildings.get(hut)!.shortage).toBe('no-space') }
    expect(conserved(s)).toBe(true); s.dispose()
  }
}, 30_000)

test('the computer redirects a waterworker through a legal working-area command to an observed river', () => {
  const map = landscape([{ kind: 'terrain', id: 'river-1', x: 52, y: 38, radius: 0 }])
  const s = session({ map }), id = place(s, 'waterworks', { x: 40, y: 29 })
  until(s, () => s.state.buildings.get(id)!.phase === 'active', 6000)
  const ai = economicAI(1, { interval: 20 }), sequence = { next: 1 }
  for (let i = 0; i < 3000 && !(s.state.ledger[1]!.produced.water ?? 0); i++) { stepAI(s, ai, sequence); s.advance(1) }
  expect(s.state.results.some(result => result.type === 'work-area' && result.ok)).toBe(true)
  expect(s.state.ledger[1]!.produced.water ?? 0).toBeGreaterThan(0)
  expect(ai.results).toEqual([]); expect(conserved(s)).toBe(true)
  s.dispose()
})

test('source terrain admission rejects duplicate identities, code collisions and contradictory partitions', () => {
  const invalid: ((profile: typeof rules) => void)[] = [
    p => { p.terrain[1]!.landscape!.originalCode = 16 },
    p => { p.terrain[1]!.landscape!.name = 'GRASS' },
    p => { p.terrain.find(t => t.id === 'water-2')!.walkable = true },
    p => { p.terrain[0]!.landscape!.period = 65536 },
    p => { delete p.terrain[0]!.landscape },
  ]
  for (const mutate of invalid) { const profile = structuredClone(rules); mutate(profile); expect(() => validateRules(profile)).toThrow(RulesError) }
})

test('material-starved site crews can return to the real hammer pool and finish the bootstrap sawmill', () => {
  const map = landscape([45, 46, 47, 48].map(y => ({ kind: 'terrain' as const, id: 'river-1', x: 55, y, radius: 0 })))
  const piles = [{ good: 'stone', amount: 8 }, { good: 'axe', amount: 1 }, { good: 'saw', amount: 1 }, { good: 'hammer', amount: 2 }, { good: 'shovel', amount: 2 }]
  const s = createSession({ rules, map, seed: 3, players: [{ name: 'Computer', civilization: 'roman', controller: 'computer', start: anchors.castle, scenario: {
    buildings: [{ type: 'castle', ...anchors.castle }, { type: 'woodcutter', x: 49, y: 51 }, { type: 'medium-residence', x: 31, y: 44 }, { type: 'small-residence', x: 36, y: 54 }],
    settlers: Array.from({ length: 16 }, (_, i) => ({ profession: 'carrier', x: 36 + i % 8, y: 47 + Math.floor(i / 8) })),
  } }], piles: piles.map((p, i) => ({ ...p, x: 38 + i % 4, y: 51 + Math.floor(i / 4) })) })
  const ai = economicAI(1, { interval: 20 }), sequence = { next: 0 }
  for (let tick = 0; tick < 6000; tick++) { stepAI(s, ai, sequence); s.advance(1) }
  expect([...s.state.buildings.values()].some(b => b.type === 'sawmill' && b.phase === 'active')).toBe(true)
  expect(s.state.ledger[1]!.produced.plank ?? 0).toBeGreaterThan(0)
  expect(conserved(s)).toBe(true); expect(ai.results).toEqual([])
  expect([...s.state.settlers.values()].filter(p => p.tool === 'hammer')).toHaveLength(2)
  s.dispose()
})
