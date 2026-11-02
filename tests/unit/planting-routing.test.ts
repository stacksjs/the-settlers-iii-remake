import { expect, test } from 'bun:test'
import type { RulesProfile } from '../../resources/game/engine'
import type { MapFeature } from '../../resources/game/engine/map'
import { audit, createSession, describeMap, distance, PUBLISHED_RULES, record, restore, ROMAN_ENGINEERING as rules, rulesIdentity, save, validateRules, verify } from '../../resources/game/engine'
import { order } from '../fixtures/engine'

// Scenario maps and work-area commands catch impossible planting assignments.
// They do not establish original Gold planting radii, timing or distribution.
const center = { x: 48, y: 40 }
function planting(profile: RulesProfile = rules, options: { type?: 'forester' | 'grain-farm', barrier?: 'water' | 'trees' | 'none', ringRadius?: number } = {}) {
  const type = options.type ?? 'forester', barrier = options.barrier ?? 'water', ringRadius = options.ringRadius ?? 3
  const features: MapFeature[] = []
  if (barrier === 'water') features.push({ kind: 'terrain', id: 'water', ...center, radius: ringRadius }, { kind: 'terrain', id: 'grass', ...center, radius: 2 })
  if (barrier === 'trees') for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) if (distance({ x, y }, { x: 0, y: 0 }) === 3) features.push({ kind: 'object', id: 'tree', x: center.x + x, y: center.y + y, radius: 0 })
  const y = ringRadius > 3 ? 54 : 49
  const s = createSession({ rules: profile, seed: 5,
    map: describeMap(profile, { width: 96, height: 96, base: 'grass', features }),
    players: [{ name: 'Rome', civilization: 'roman', start: { x: 30, y: 40 }, scenario: {
      buildings: [{ type: 'castle', x: 30, y: 40 }, { type, x: 48, y }],
      settlers: [{ profession: profile.buildings.find(b => b.id === type)!.worker!, x: 53, y: y + 2 }],
    } }],
  })
  expect(s.skipped).toEqual({})
  const id = s.view(1).buildings.find(b => b.type === type)!.id
  order(s, 'work-area', { building: id, ...center })
  return { s, id }
}

test('a forester skips disconnected nearest tiles and plants on reachable ground within its working area', () => {
  const { s, id } = planting()
  try {
    s.advance(1000)
    const sapling = rules.objects.findIndex(object => object.id === 'sapling') + 1
    const planted = [...s.state.map.object.keys()].filter(tile => s.state.map.object[tile] === sapling)
    expect(planted.length).toBeGreaterThan(0)
    for (const tile of planted) {
      const point = { x: tile % 96, y: Math.floor(tile / 96) }
      expect(distance(point, center)).toBeGreaterThan(3)
      expect(distance(point, center)).toBeLessThanOrEqual(6)
      expect(s.state.map.owner[tile]).toBe(1)
    }
    expect(s.view(1).buildings.find(b => b.id === id)?.shortage).not.toBe('no-space')
    expect(audit(s.context)).toEqual([])
  }
  finally { s.dispose() }
})

test('cultivation also skips a ring of blocking trees before choosing where to sow', () => {
  const { s, id } = planting(rules, { type: 'grain-farm', barrier: 'trees' })
  try {
    const trees = [...s.state.map.object]
    s.advance(1000)
    const field = rules.objects.findIndex(object => object.id === 'field') + 1
    const planted = [...s.state.map.object.keys()].filter(tile => s.state.map.object[tile] === field)
    expect(planted.length).toBeGreaterThan(0)
    for (const tile of planted) {
      expect(distance({ x: tile % 96, y: Math.floor(tile / 96) }, center)).toBeGreaterThan(3)
      expect(distance({ x: tile % 96, y: Math.floor(tile / 96) }, center)).toBeLessThanOrEqual(5)
    }
    for (let tile = 0; tile < trees.length; tile++) if (trees[tile]) expect(s.state.map.object[tile]).toBe(trees[tile])
    expect(s.view(1).buildings.find(b => b.id === id)?.shortage).not.toBe('no-space')
    expect(audit(s.context)).toEqual([])
  }
  finally { s.dispose() }
})

test('a genuinely disconnected planting area reports no space without claiming or planting unreachable tiles', () => {
  const { s, id } = planting(rules, { ringRadius: 7 })
  try {
    s.advance(1000)
    expect(s.state.map.object.some(object => object > 0)).toBe(false)
    expect(s.state.claims.size).toBe(0)
    expect(s.view(1).buildings.find(b => b.id === id)?.shortage).toBe('no-space')
    expect(audit(s.context)).toEqual([])
  }
  finally { s.dispose() }
})

test('overlapping foresters keep distinct claims on owned empty planting ground', () => {
  const workArea = { x: 52, y: 40 }
  const s = createSession({ rules, seed: 5,
    map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: [{ kind: 'object', id: 'stone', x: 50, y: 42, radius: 0 }] }),
    players: [{ name: 'Rome', civilization: 'roman', start: { x: 30, y: 40 }, scenario: {
      buildings: [{ type: 'castle', x: 30, y: 40 }, { type: 'forester', x: 48, y: 49 }, { type: 'forester', x: 40, y: 46 }],
      settlers: [{ profession: 'forester', x: 53, y: 51 }, { profession: 'forester', x: 43, y: 48 }],
    } }, { name: 'Other', civilization: 'roman', start: { x: 75, y: 40 }, scenario: { buildings: [{ type: 'castle', x: 75, y: 40 }], settlers: [] } }],
  })
  try {
    expect(s.skipped).toEqual({})
    expect([...s.state.map.owner.keys()].some(tile => s.state.map.owner[tile] === 2 && distance({ x: tile % 96, y: Math.floor(tile / 96) }, workArea) <= 6)).toBe(true)
    const ids = s.view(1).buildings.filter(b => b.type === 'forester').map(b => b.id)
    for (const [seq, id] of ids.entries()) expect(s.enqueue({ tick: 0, player: 1, seq, type: 'work-area', building: id, ...workArea })).toBeNull()
    let claimed = false
    for (let tick = 0; tick < 1000; tick++) {
      s.advance(1)
      expect(s.state.results.every(result => result.ok)).toBe(true)
      const targets = new Set<number>()
      for (const person of s.state.settlers.values()) {
        const pending = person.program?.steps.slice(person.program.pc).find(op => op.op === 'do' && op.effect === 'plant')
        if (pending?.op !== 'do') continue
        const tile = Number(pending.args!.tile)
        expect(targets.has(tile)).toBe(false)
        targets.add(tile)
        expect(s.state.claims.get(tile)).toBe(person.id)
        expect(s.state.map.owner[tile]).toBe(1)
        expect(s.state.map.object[tile]).toBe(0)
        expect(distance({ x: tile % 96, y: Math.floor(tile / 96) }, workArea)).toBeLessThanOrEqual(6)
      }
      claimed ||= targets.size > 0
      expect(audit(s.context)).toEqual([])
    }
    expect(claimed).toBe(true)
    expect(s.state.map.object[42 * 96 + 50]).toBe(rules.objects.findIndex(object => object.id === 'stone') + 1)
    const sapling = rules.objects.findIndex(object => object.id === 'sapling') + 1
    const planted = [...s.state.map.object.keys()].filter(tile => s.state.map.object[tile] === sapling)
    expect(planted.length).toBeGreaterThan(0)
    expect(planted.every(tile => s.state.map.owner[tile] === 1)).toBe(true)
  }
  finally { s.dispose() }
})

test('a claimed planting trip retains its target and seeded choices across save, restore and replay', () => {
  const { s, id } = planting(), recorder = record(s)
  let copy: ReturnType<typeof restore> | undefined
  try {
    expect(recorder.enqueue({ tick: s.state.tick, player: 1, seq: 1, type: 'work-area', building: id, ...center })).toBeNull()
    for (let tick = 0; tick < 1000 && !s.state.claims.size; tick++) recorder.advance(1)
    expect(s.state.claims.size).toBe(1)
    copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
    recorder.advance(1000); copy.advance(1000)
    expect(copy.checksum()).toBe(s.checksum())
    expect(s.state.map.object.some(object => object > 0)).toBe(true)
    expect(verify(recorder.replay(), PUBLISHED_RULES)).toMatchObject({ ok: true, checksum: s.checksum() })
    expect(audit(s.context)).toEqual([])
    expect(audit(copy.context)).toEqual([])
  }
  finally { copy?.dispose(); s.dispose() }
})

test('published 0.17 saves and replays retain their disconnected planting behavior', () => {
  const legacy = PUBLISHED_RULES.find(profile => profile.version === '0.17.0')!
  const { s, id } = planting(legacy), recorder = record(s)
  let copy: ReturnType<typeof restore> | undefined
  try {
    expect(rulesIdentity(legacy).digest).toBe('2939e347b6e11f4f3a7d4ee578f6c07f3e79bdb1ab6d4e891b9144ff2f1a6189')
    recorder.advance(1000)
    copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
    recorder.advance(100); copy.advance(100)
    expect(s.state.map.object.some(object => object > 0)).toBe(false)
    expect(s.view(1).buildings.find(b => b.id === id)?.shortage).toBe('no-space')
    expect(copy.checksum()).toBe(s.checksum())
    expect(verify(recorder.replay(), PUBLISHED_RULES)).toMatchObject({ ok: true, checksum: s.checksum() })
    expect(audit(copy.context)).toEqual([])
  }
  finally { copy?.dispose(); s.dispose() }
})

test('unobstructed planting keeps the same seeded decisions as the published profile', () => {
  const current = planting(rules, { barrier: 'none' }).s
  const legacy = planting(PUBLISHED_RULES.find(profile => profile.version === '0.17.0')!, { barrier: 'none' }).s
  try {
    for (let tick = 0; tick < 1000; tick++) {
      current.advance(1); legacy.advance(1)
      expect(current.checksum()).toBe(legacy.checksum())
    }
    expect(current.state.map.object.some(object => object > 0)).toBe(true)
    expect(audit(current.context)).toEqual([])
    expect(audit(legacy.context)).toEqual([])
  }
  finally { current.dispose(); legacy.dispose() }
})

test('planting routing requires a supported policy and evidence', () => {
  const unknown = structuredClone(rules)
  Object.assign(unknown, { plantingRouting: 'teleport' })
  expect(() => validateRules(unknown)).toThrow('Unknown planting routing policy')
  const unevidenced = structuredClone(rules)
  delete unevidenced.evidence.plantingRouting
  expect(() => validateRules(unevidenced)).toThrow('plantingRouting has no evidence record')
})
