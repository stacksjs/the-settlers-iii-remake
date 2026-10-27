import { expect, test } from 'bun:test'
import { checksum, createSession, describeMap, observe, openSession, PUBLISHED_RULES, record, restore, ROMAN_ENGINEERING as rules, save, validateRules, verify } from '../../resources/game/engine'
import { order, place, until } from '../fixtures/engine'
import { scene } from '../../resources/game/scene'
import { minimapPixels, minimapSize, toMinimap } from '../../resources/game/minimap'

test('a rival intervention cannot update the terrain known by an absent scout', () => {
  const session = createSession({ rules, seed: 1, map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: [{ kind: 'terrain', id: 'desert', x: 40, y: 40, radius: 2 }] }), players: [
    { name: 'Viewer', civilization: 'roman', start: { x: 10, y: 10 }, scenario: { buildings: [{ type: 'castle', x: 10, y: 10 }], settlers: [{ profession: 'swordsman', x: 40, y: 39 }] } },
    { name: 'Rival', civilization: 'roman', start: { x: 80, y: 80 }, scenario: { buildings: [{ type: 'castle', x: 80, y: 80 }, { type: 'large-temple', x: 12, y: 60 }, { type: 'large-temple', x: 75, y: 60 }], settlers: [{ profession: 'priest', x: 50, y: 50 }] } },
  ] })
  const recorder = record(session), tile = 40 * 96 + 40
  const soldier = [...session.state.settlers.values()].find(s => s.owner === 1)!, priest = [...session.state.settlers.values()].find(s => s.owner === 2)!
  const command = (type: string, fields: Record<string, unknown>, player = 1) => {
    const seq = recorder.replay().submissions.length
    const rejected = recorder.enqueue({ tick: session.state.tick, player, seq, type, ...fields } as Parameters<typeof session.enqueue>[0])
    expect(rejected).toBeNull(); recorder.advance(1)
    expect(session.state.results.at(-1)?.ok).toBe(true)
  }
  try {
    expect(observe(session, 1).terrain(tile)).toBe('desert')
    const pixels = (value: typeof session) => {
      const observation = observe(value, 1), point = toMinimap({ x: 40, y: 40 }, 96), at = (point.y * minimapSize(96, 96).width + point.x) * 4
      return [...minimapPixels(observation, { territory: 'topographic', settlers: 'none', buildings: false }).slice(at, at + 4)]
    }
    command('move-soldiers', { soldiers: [soldier.id], x: 65, y: 65 })
    for (let n = 0; n < 1000 && (soldier.x !== 65 || soldier.y !== 65 || soldier.step || session.state.players[0]!.visible[tile]); n++) recorder.advance(1)
    expect(session.state.players[0]!.visible[tile]).toBe(0)
    const rememberedOverview = pixels(session)
    command('cast', { priest: priest.id, spell: 'grassland-galore', x: 40, y: 40 }, 2)
    expect(rules.terrain[session.state.map.terrain[tile]!]!.id).toBe('grass')
    expect(observe(session, 1).terrain(tile)).toBe('desert')
    expect(pixels(session)).toEqual(rememberedOverview)
    expect(session.checksum()).toBe(checksum(session.state))
    const tampered = save(session), layer = Buffer.from(tampered.state.players[0]!.memory!.terrain, 'base64')
    layer[tile] = rules.terrain.findIndex(terrain => terrain.id === 'grass')
    tampered.state.players[0]!.memory!.terrain = layer.toString('base64')
    expect(() => restore(tampered, PUBLISHED_RULES)).toThrow('checksum does not match')
    const copy = restore(JSON.parse(JSON.stringify(save(session))), PUBLISHED_RULES)
    try { expect(observe(copy, 1).terrain(tile)).toBe('desert'); expect(copy.checksum()).toBe(session.checksum()) }
    finally { copy.dispose() }
    expect(verify(recorder.replay(), PUBLISHED_RULES)).toMatchObject({ ok: true, checksum: session.checksum() })
    order(session, 'move-soldiers', { soldiers: [soldier.id], x: 40, y: 39 })
    until(session, () => !!session.state.players[0]!.visible[tile], 1000)
    expect(observe(session, 1).terrain(tile)).toBe('grass')
  }
  finally { session.dispose() }
})

test('growing objects freeze their observed pose for one viewer while another sees the real growth', () => {
  const session = createSession({ rules, seed: 1, map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: [] }), players: [
    { name: 'Scout', civilization: 'roman', start: { x: 10, y: 10 }, scenario: { buildings: [{ type: 'castle', x: 10, y: 10 }], settlers: [{ profession: 'swordsman', x: 40, y: 39 }] } },
    { name: 'Farmer', civilization: 'roman', start: { x: 60, y: 60 }, scenario: { buildings: [{ type: 'castle', x: 60, y: 60 }, { type: 'grain-farm', x: 40, y: 40 }], settlers: [{ profession: 'farmer', x: 40, y: 44 }] } },
  ] })
  const scout = [...session.state.settlers.values()].find(s => s.owner === 1)!
  let tile = -1
  const crop = () => scene(session, { player: 1 }).find(item => item.tile === tile && item.kind === 'crop')
  try {
    expect(observe(session, 1).terrain(80 * 96 + 80)).toBeNull()
    expect(observe(session, 1).object(80 * 96 + 80)).toBeNull()
    const field = rules.objects.findIndex(o => o.id === 'field') + 1
    until(session, () => session.state.map.object.includes(field), 2000)
    tile = session.state.map.object.indexOf(field)
    const farm = [...session.state.buildings.values()].find(b => b.type === 'grain-farm')!
    order(session, 'suspend', { building: farm.id, suspended: true }, 2)
    order(session, 'move-soldiers', { soldiers: [scout.id], x: tile % 96, y: Math.floor(tile / 96) })
    until(session, () => !!session.state.players[0]!.visible[tile], 1000)
    order(session, 'move-soldiers', { soldiers: [scout.id], x: 65, y: 65 })
    until(session, () => scout.x === 65 && scout.y === 65 && !scout.step && !session.state.players[0]!.visible[tile], 1000)
    const frozen = crop()
    expect(frozen?.frame).toBeLessThan(7)
    session.advance(1600)
    expect(observe(session, 2).object(tile)).toBe('ripe-grain')
    expect(observe(session, 1).object(tile)).toBe('field')
    expect(crop()).toEqual(frozen)
    const copy = restore(JSON.parse(JSON.stringify(save(session))), PUBLISHED_RULES)
    try { expect(scene(copy, { player: 1 }).find(item => item.tile === tile && item.kind === 'crop')).toEqual(frozen) }
    finally { copy.dispose() }
    order(session, 'move-soldiers', { soldiers: [scout.id], x: tile % 96, y: Math.floor(tile / 96) })
    until(session, () => !!session.state.players[0]!.visible[tile], 1000)
    expect(observe(session, 1).object(tile)).toBe('ripe-grain')
    expect(crop()?.frame).toBe(7)
    expect(session.checksum()).toBe(checksum(session.state))
  }
  finally { session.dispose() }
})

test('hidden building poses survive a real enemy demolition without exposing live diagnostics', () => {
  const session = createSession({ rules, seed: 1, map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: [] }), players: [
    { name: 'Scout', civilization: 'roman', start: { x: 10, y: 10 }, scenario: { buildings: [{ type: 'castle', x: 10, y: 10 }], settlers: [{ profession: 'swordsman', x: 40, y: 44 }] } },
    { name: 'Rival', civilization: 'roman', start: { x: 70, y: 70 }, scenario: { buildings: [{ type: 'castle', x: 70, y: 70 }, { type: 'woodcutter', x: 40, y: 40 }], settlers: [] } },
  ] })
  const scout = [...session.state.settlers.values()].find(s => s.owner === 1)!, building = [...session.state.buildings.values()].find(b => b.type === 'woodcutter')!
  const pose = () => scene(session, { player: 1 }).find(item => item.kind === 'building' && item.entity === building.id)
  try {
    expect(pose()?.sprite).toBe('building:woodcutter')
    order(session, 'move-soldiers', { soldiers: [scout.id], x: 65, y: 50 })
    until(session, () => !session.view(1).buildings.some(b => b.id === building.id), 1000)
    const frozen = pose()
    expect(frozen).toBeDefined()
    order(session, 'demolish', { building: building.id }, 2)
    expect(session.state.buildings.has(building.id)).toBe(false)
    expect(pose()).toEqual(frozen)
    const remembered = session.view(1).remembered!.buildings.find(b => b.id === building.id)!
    expect(Object.keys(remembered).sort()).toEqual(['elevation', 'id', 'owner', 'phase', 'type', 'workRemaining', 'x', 'y'])
    const copy = restore(JSON.parse(JSON.stringify(save(session))), PUBLISHED_RULES)
    try { expect(scene(copy, { player: 1 }).find(item => item.kind === 'building' && item.entity === building.id)).toEqual(frozen) }
    finally { copy.dispose() }
    order(session, 'move-soldiers', { soldiers: [scout.id], x: 40, y: 44 })
    until(session, () => !!session.state.players[0]!.visible[40 * 96 + 40], 1000)
    expect(pose()).toBeUndefined()
  }
  finally { session.dispose() }
})

test('real construction grading does not refresh an absent scout’s map', () => {
  const session = createSession({ rules, seed: 1, map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: [{ kind: 'elevation', x: 30, y: 42, radius: 3, amount: 6 }] }), players: [
    { name: 'Scout', civilization: 'roman', start: { x: 10, y: 10 }, scenario: { buildings: [{ type: 'castle', x: 10, y: 10 }], settlers: [{ profession: 'swordsman', x: 30, y: 43 }] } },
    { name: 'Builder', civilization: 'roman', start: { x: 40, y: 40 } },
  ] })
  const tile = 42 * 96 + 30, scout = [...session.state.settlers.values()].find(s => s.owner === 1)!
  try {
    expect(observe(session, 1).elevation(tile)).toBe(6)
    order(session, 'move-soldiers', { soldiers: [scout.id], x: 70, y: 20 })
    until(session, () => scout.x === 70 && scout.y === 20 && !scout.step && !session.state.players[0]!.visible[tile], 1000)
    expect(observe(session, 1).reachable(scout.id).has(tile)).toBe(true)
    const id = place(session, 'sawmill', { x: 30, y: 42 }, 2), b = session.state.buildings.get(id)!
    expect([b.x, b.y]).toEqual([30, 42])
    until(session, () => b.phase !== 'leveling', 3000)
    expect(observe(session, 2).elevation(tile)).not.toBe(6)
    expect(observe(session, 1).elevation(tile)).toBe(6)
    expect(observe(session, 1).reachable(scout.id).has(tile)).toBe(true)
    const copy = restore(JSON.parse(JSON.stringify(save(session))), PUBLISHED_RULES)
    try { expect(observe(copy, 1).elevation(tile)).toBe(6) }
    finally { copy.dispose() }
    const door = session.view(2).buildings.find(item => item.id === b.id)!.door
    order(session, 'move-soldiers', { soldiers: [scout.id], x: door % 96, y: Math.floor(door / 96) })
    until(session, () => !!session.state.players[0]!.visible[tile], 1000)
    expect(observe(session, 1).elevation(tile)).toBe(observe(session, 2).elevation(tile))
    expect(session.checksum()).toBe(checksum(session.state))
  }
  finally { session.dispose() }
})

test('unseen pile changes retain only the observed material and quantity', () => {
  const session = createSession({ rules, seed: 1, map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: [] }), players: [
    { name: 'Scout', civilization: 'roman', start: { x: 10, y: 10 }, scenario: { buildings: [{ type: 'castle', x: 10, y: 10 }], settlers: [{ profession: 'swordsman', x: 40, y: 51 }] } },
    { name: 'Rival', civilization: 'roman', start: { x: 40, y: 40 }, scenario: { buildings: [{ type: 'castle', x: 40, y: 40 }], settlers: [{ profession: 'geologist', x: 40, y: 50 }] } },
  ], piles: [{ x: 40, y: 50, good: 'hammer', amount: 3 }] })
  const scout = [...session.state.settlers.values()].find(s => s.owner === 1)!, pile = [...session.state.stacks.values()].find(s => s.good === 'hammer' && s.tile === 50 * 96 + 40)!
  try {
    expect(session.skipped).toEqual({})
    order(session, 'move-soldiers', { soldiers: [scout.id], x: 70, y: 70 })
    until(session, () => !session.state.players[0]!.visible[pile.tile], 1000)
    const frozen = scene(session, { player: 1 }).find(item => item.kind === 'pile' && item.entity === pile.id)
    expect(frozen?.amount).toBe(3)
    order(session, 'dismiss', { profession: 'geologist', count: 1 }, 2)
    expect(pile.amount).toBe(4)
    expect(session.view(1).stacks.some(s => s.id === pile.id)).toBe(false)
    expect(scene(session, { player: 1 }).find(item => item.kind === 'pile' && item.entity === pile.id)).toEqual(frozen)
    const remembered = session.view(1).remembered!.stacks.find(s => s.id === pile.id)!
    expect(Object.keys(remembered).sort()).toEqual(['amount', 'elevation', 'good', 'id', 'owner', 'tile'])
    const copy = restore(JSON.parse(JSON.stringify(save(session))), PUBLISHED_RULES)
    try { expect(scene(copy, { player: 1 }).find(item => item.kind === 'pile' && item.entity === pile.id)).toEqual(frozen) }
    finally { copy.dispose() }
    order(session, 'move-soldiers', { soldiers: [scout.id], x: 40, y: 51 })
    until(session, () => !!session.state.players[0]!.visible[pile.tile], 1000)
    expect(scene(session, { player: 1 }).find(item => item.kind === 'pile' && item.entity === pile.id)?.amount).toBe(4)
  }
  finally { session.dispose() }
})

test('a surveyed marker freezes under fog until its tile is seen again', () => {
  const session = createSession({ rules, seed: 1, map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: [{ kind: 'terrain', id: 'mountain', x: 40, y: 40, radius: 0 }, { kind: 'resource', id: 'coal', x: 40, y: 40, radius: 0, amount: 2 }] }), players: [
    { name: 'Surveyor', civilization: 'roman', start: { x: 10, y: 10 }, scenario: { buildings: [{ type: 'castle', x: 10, y: 10 }], settlers: [{ profession: 'geologist', x: 40, y: 40 }] } },
  ] })
  const geologist = [...session.state.settlers.values()][0]!, tile = 40 * 96 + 40
  const marker = () => scene(session, { player: 1 }).find(item => item.kind === 'sign' && item.tile === tile)
  try {
    order(session, 'specialists', { profession: 'geologist', count: 1, x: 40, y: 40 })
    until(session, () => session.state.players[0]!.signs.length === 1 && !geologist.program, 1000)
    expect(marker()?.good).toBe('coal')
    order(session, 'specialists', { profession: 'geologist', count: 1, x: 70, y: 70 })
    until(session, () => geologist.x === 70 && geologist.y === 70 && !geologist.program && !session.state.players[0]!.visible[tile], 1000)
    const frozen = marker()
    expect(frozen).toBeDefined()
    session.advance(rules.survey.signTicks)
    expect(session.view(1).signs).toEqual([])
    expect(marker()).toEqual(frozen)
    const copy = restore(JSON.parse(JSON.stringify(save(session))), PUBLISHED_RULES)
    try { expect(scene(copy, { player: 1 }).find(item => item.kind === 'sign' && item.tile === tile)).toEqual(frozen) }
    finally { copy.dispose() }
    order(session, 'specialists', { profession: 'geologist', count: 1, x: 40, y: 40 })
    until(session, () => !!session.state.players[0]!.visible[tile], 1000)
    expect(marker()).toBeUndefined()
  }
  finally { session.dispose() }
})

test('a real hidden harvest cannot update map objects or the player’s prospective resource forecast', () => {
  const session = createSession({ rules, seed: 1, map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: [{ kind: 'object', id: 'tree', x: 35, y: 32, radius: 0, amount: 1 }] }), players: [
    { name: 'Scout', civilization: 'roman', start: { x: 10, y: 10 }, scenario: { buildings: [{ type: 'castle', x: 10, y: 10 }], settlers: [{ profession: 'swordsman', x: 35, y: 33 }] } },
    { name: 'Woodcutter', civilization: 'roman', start: { x: 60, y: 40 }, scenario: { buildings: [{ type: 'castle', x: 60, y: 40 }, { type: 'woodcutter', x: 42, y: 34 }], settlers: [{ profession: 'woodcutter', x: 42, y: 36 }] } },
  ] })
  const tile = 32 * 96 + 35, scout = [...session.state.settlers.values()].find(s => s.owner === 1)!
  const tree = () => scene(session, { player: 1 }).find(item => item.kind === 'tree' && item.tile === tile)
  try {
    expect(session.skipped).toEqual({})
    expect(observe(session, 1).object(tile)).toBe('tree')
    expect(observe(session, 1).harvestable('woodcutter', 30, 30)).toBe(true)
    order(session, 'move-soldiers', { soldiers: [scout.id], x: 65, y: 70 })
    until(session, () => !session.state.players[0]!.visible[tile], 1000)
    const frozen = tree()
    expect(frozen).toBeDefined()
    until(session, () => session.state.map.object[tile] === 0, 2000)
    expect(observe(session, 2).object(tile)).toBeNull()
    expect(observe(session, 1).object(tile)).toBe('tree')
    expect(observe(session, 1).harvestable('woodcutter', 30, 30)).toBe(true)
    expect(tree()).toEqual(frozen)
    order(session, 'move-soldiers', { soldiers: [scout.id], x: 35, y: 33 })
    until(session, () => !!session.state.players[0]!.visible[tile], 1000)
    expect(observe(session, 1).object(tile)).toBeNull()
    expect(observe(session, 1).harvestable('woodcutter', 30, 30)).toBe(false)
    expect(tree()).toBeUndefined()
  }
  finally { session.dispose() }
})

test('untrusted saves cannot invent or omit observed history, or add private fields to frozen poses', () => {
  const make = (profile = rules) => createSession({ rules: profile, seed: 1, map: describeMap(profile, { width: 8, height: 8, base: 'grass', features: [] }), players: [{ name: 'Observer', civilization: 'roman', controller: 'observer', start: { x: 4, y: 4 }, scenario: { buildings: [], settlers: [] } }] })
  const session = make(), original = save(session)
  const reject = (mutate: (value: typeof original) => void, message: string) => { const value = structuredClone(original); mutate(value); expect(() => restore(value, PUBLISHED_RULES)).toThrow(message) }
  try {
    reject(value => { delete value.state.players[0]!.memory }, 'no observed world')
    reject(value => { value.state.players[0]!.memory!.terrain = '' }, 'wrong size')
    reject(value => { Object.assign(value.state.players[0]!.memory!, { worker: 42 }) }, 'unknown fields')
    reject(value => { const layer = Buffer.from(value.state.players[0]!.memory!.terrain, 'base64'); layer[0] = 1; value.state.players[0]!.memory!.terrain = layer.toString('base64') }, 'not hidden')
    reject(value => { const layer = Buffer.from(value.state.players[0]!.memory!.age, 'base64'); layer[0] = 1; value.state.players[0]!.memory!.age = layer.toString('base64') }, 'remembered tile 0 is invalid')
    reject(value => { value.state.players[0]!.memory!.buildings.push({ id: 0, owner: 1, type: 'castle', x: 4, y: 4, phase: 'active', workRemaining: 0, elevation: 0 }) }, 'remembered building is invalid')
    reject(value => { value.state.players[0]!.memory!.stacks.push({ id: 0, owner: 1, tile: 0, good: 'plank', amount: 1, elevation: 0 }) }, 'remembered stack is invalid')
    reject(value => { value.state.players[0]!.memory!.signs.push({ tile: 0, good: 'coal', amount: 1, elevation: 0 }) }, 'remembered sign is invalid')
    const earlier = make(PUBLISHED_RULES.find(profile => profile.version === '0.14.0')!)
    try {
      const value = save(earlier)
      value.state.players[0]!.memory = original.state.players[0]!.memory
      expect(() => restore(value, PUBLISHED_RULES)).toThrow('memory does not belong')
      expect(() => openSession(rules, structuredClone(earlier.state), earlier.identity.content)).toThrow('observation history does not belong')
    }
    finally { earlier.dispose() }
    const unknown = structuredClone(rules); Object.assign(unknown, { worldMemory: 'live' })
    expect(() => validateRules(unknown)).toThrow('Unknown observed-world policy')
    const unevidenced = structuredClone(rules); delete unevidenced.evidence.worldMemory
    expect(() => validateRules(unevidenced)).toThrow('worldMemory has no evidence record')
  }
  finally { session.dispose() }
})

test('a scripted exploration grant records the world at the mission event', () => {
  const session = createSession({ rules, seed: 1, map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: [{ kind: 'terrain', id: 'desert', x: 40, y: 40, radius: 0 }, { kind: 'elevation', x: 40, y: 40, radius: 0, amount: 7 }, { kind: 'object', id: 'field', x: 40, y: 40, radius: 0 }] }), players: [
    { name: 'Viewer', civilization: 'roman', start: { x: 10, y: 10 }, scenario: { buildings: [{ type: 'castle', x: 10, y: 10 }], settlers: [] } },
  ], mission: { id: 'map-grant', version: 1, objectives: [{ id: 'find', player: 1, text: 'Receive the map' }], triggers: [{ id: 'grant', when: { kind: 'tick-at-least', tick: 1 }, then: [{ kind: 'reveal', player: 1, x: 40, y: 40, radius: 0 }, { kind: 'complete-objective', objective: 'find' }] }] } })
  const tile = 40 * 96 + 40
  try {
    expect(observe(session, 1).terrain(tile)).toBeNull()
    until(session, () => session.view(1).explored[tile] === 1, 100)
    expect(session.view(1).visible[tile]).toBe(0)
    expect(session.view(1).explored[tile]).toBe(1)
    expect(observe(session, 1).terrain(tile)).toBe('desert')
    expect(observe(session, 1).elevation(tile)).toBe(7)
    expect(observe(session, 1).object(tile)).toBe('field')
    const copy = restore(JSON.parse(JSON.stringify(save(session))), PUBLISHED_RULES)
    try { expect(observe(copy, 1).terrain(tile)).toBe('desert'); expect(copy.checksum()).toBe(session.checksum()) }
    finally { copy.dispose() }
    expect(session.checksum()).toBe(checksum(session.state))
  }
  finally { session.dispose() }
})
