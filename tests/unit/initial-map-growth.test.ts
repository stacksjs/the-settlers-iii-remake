import { expect, test } from 'bun:test'
import type { RulesProfile } from '../../resources/game/engine'
import { audit, createSession, describeMap, PUBLISHED_RULES, record, restore, ROMAN_ENGINEERING as rules, rulesIdentity, save, validateRules, verify } from '../../resources/game/engine'

// These are engineering-profile lifecycle checks, not original Gold timings.
const point = { x: 44, y: 44 }, tile = point.y * 64 + point.x
const object = (s: ReturnType<typeof createSession>) => s.rules.objects[s.state.map.object[tile]! - 1]?.id
function scenario(id: string, profile: RulesProfile = rules, start = { x: 16, y: 16 }) {
  return createSession({ rules: profile, seed: 1,
    map: describeMap(profile, { width: 64, height: 64, base: 'grass', features: [{ kind: 'object', id, ...point, radius: 0 }] }),
    players: [{ name: 'Rome', civilization: 'roman', start, scenario: { buildings: [{ type: 'castle', ...start }], settlers: [] } }],
  })
}

test('mature trees, stone and ripe crops have no growth timer', () => {
  for (const id of ['tree', 'stone', 'ripe-grain', 'ripe-vine']) {
    const s = scenario(id)
    try {
      expect(s.state.growth).toEqual([])
      s.advance(10801)
      expect(object(s)).toBe(id)
      expect(s.state.growth).toEqual([])
      expect(audit(s.context)).toEqual([])
    }
    finally { s.dispose() }
  }
})

test('scenario buildings clear initial growth before any timers are created', () => {
  const s = scenario('sapling', rules, point)
  try {
    expect(s.skipped).toEqual({})
    expect(object(s)).toBeUndefined()
    expect(s.state.growth).toEqual([])
    s.advance(2401)
    expect(object(s)).toBeUndefined()
    expect(audit(s.context)).toEqual([])
  }
  finally { s.dispose() }
})

test('mixed initial growth deadlines and equal-time tiles can be saved and restored in canonical order', () => {
  const s = createSession({ rules, seed: 1,
    map: describeMap(rules, { width: 64, height: 64, base: 'grass', features: [
      { kind: 'object', id: 'sapling', x: 46, y: 44, radius: 0 },
      { kind: 'object', id: 'vine', x: 43, y: 44, radius: 0 },
      { kind: 'object', id: 'field', x: 45, y: 44, radius: 0 },
      { kind: 'object', id: 'sapling', ...point, radius: 0 },
    ] }),
    players: [{ name: 'Rome', civilization: 'roman', start: { x: 16, y: 16 }, scenario: { buildings: [{ type: 'castle', x: 16, y: 16 }], settlers: [] } }],
  })
  try {
    expect(s.state.growth).toEqual([[1600, tile + 1], [2400, tile], [2400, tile + 2], [10800, tile - 1]])
    const copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
    try {
      expect(copy.checksum()).toBe(s.checksum())
      copy.advance(10801)
      expect([tile - 1, tile, tile + 1, tile + 2].map(at => rules.objects[copy.state.map.object[at]! - 1]?.id)).toEqual(['ripe-vine', 'tree', 'ripe-grain', 'tree'])
      expect(copy.state.growth).toEqual([])
      expect(audit(copy.context)).toEqual([])
    }
    finally { copy.dispose() }
  }
  finally { s.dispose() }
})

test('mid-growth restore preserves the original deadline and replays deterministically', () => {
  const s = scenario('sapling'), twin = scenario('sapling')
  try {
    const recorder = record(s)
    recorder.advance(1200)
    twin.advance(1200)
    expect(twin.checksum()).toBe(s.checksum())
    const copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
    try {
      copy.advance(1200)
      expect(object(copy)).toBe('sapling')
      copy.advance(1)
      expect(object(copy)).toBe('tree')
      recorder.advance(1201)
      twin.advance(1201)
      expect(s.checksum()).toBe(copy.checksum())
      expect(s.checksum()).toBe(twin.checksum())
      expect(verify(recorder.replay(), PUBLISHED_RULES).ok).toBe(true)
      expect(audit(s.context)).toEqual([])
      expect(audit(copy.context)).toEqual([])
    }
    finally { copy.dispose() }
  }
  finally { s.dispose(); twin.dispose() }
})

test('published 0.18.0 keeps its original static initial objects through save and replay', () => {
  const previous = PUBLISHED_RULES.find(profile => profile.version === '0.18.0')!
  expect(rulesIdentity(previous).digest).toBe('3cf77dcb95b710d1406627898c294fb16d07f1ca37aec6be607188d44b8dd03a')
  const s = scenario('sapling', previous)
  try {
    const recorder = record(s)
    recorder.advance(1200)
    const copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
    try {
      copy.advance(1201)
      recorder.advance(1201)
      expect(object(s)).toBe('sapling')
      expect(object(copy)).toBe('sapling')
      expect(s.state.growth).toEqual([])
      expect(copy.checksum()).toBe(s.checksum())
      expect(verify(recorder.replay(), PUBLISHED_RULES).ok).toBe(true)
      expect(audit(copy.context)).toEqual([])
    }
    finally { copy.dispose() }
  }
  finally { s.dispose() }
})

test('initial growth policy rejects unknown values and requires evidence', () => {
  const invalid = structuredClone(rules)
  Reflect.set(invalid, 'initialGrowth', 'immediate')
  expect(() => validateRules(invalid)).toThrow('Unknown initial growth policy')
  const unevidenced = structuredClone(rules)
  delete unevidenced.evidence.initialGrowth
  expect(() => validateRules(unevidenced)).toThrow('initialGrowth has no evidence record')
})

for (const [immature, mature, ticks] of [['sapling', 'tree', 2400], ['field', 'ripe-grain', 1600], ['vine', 'ripe-vine', 10800]] as const) {
  test(`an initial ${immature} matures at its engineering deadline`, () => {
    const s = scenario(immature)
    try {
      expect(s.skipped).toEqual({})
      expect(object(s)).toBe(immature)
      s.advance(ticks)
      expect(object(s)).toBe(immature)
      s.advance(1)
      expect(object(s)).toBe(mature)
      expect(audit(s.context)).toEqual([])
    }
    finally { s.dispose() }
  })
}
