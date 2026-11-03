import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RulesProfile } from '../../resources/game/engine'
import { AMAZON_ENGINEERING as amazon, ASIAN_ENGINEERING as asian, audit, createSession, describeMap, EGYPTIAN_ENGINEERING as egyptian, PUBLISHED_RULES, qualificationGaps, restore, ROMAN_ENGINEERING, rulesIdentity, save } from '../../resources/game/engine'
import { MANUAL_CONSTRUCTION } from '../../resources/game/engine/manual-construction'
import { amazonProfile, asianProfile, egyptianProfile } from '../../scripts/faction-profile'
import { conserved, run, site, until } from '../fixtures/engine'

// The Egyptian profile is engineering data, not an original-game claim: the
// manual's Egyptian construction costs (class M), the reference remake's
// Egyptian geometry (class E) and the Roman placeholders for everything
// unobserved (class U). These tests check that it is what the generator says it
// is, that it differs from the Roman one where the Egyptians do, and that the
// Egyptian economy really runs in the simulation.
const frozen = JSON.parse(readFileSync(join(import.meta.dir, '../../resources/game/engine/profiles/egyptian-engineering-0.1.0.json'), 'utf8'))

describe('the Egyptian engineering profile', () => {
  test('is exactly what the generator produces, and is published', () => {
    expect(frozen).toEqual(JSON.parse(JSON.stringify(egyptianProfile())))
    expect(PUBLISHED_RULES.filter(rules => rules.id === 'egyptian-engineering')).toHaveLength(1)
    expect(egyptian.fidelity).toBe('engineering')
    expect(rulesIdentity(egyptian).id).toBe('egyptian-engineering')
    expect(rulesIdentity(egyptian).digest).not.toBe(rulesIdentity(ROMAN_ENGINEERING).digest)
  })

  test('never qualifies a release: nothing in it is an original observation', () => {
    expect(qualificationGaps(egyptian).length).toBeGreaterThan(50)
    expect(Object.values(egyptian.evidence).some(item => item.class === 'O')).toBe(false)
  })

  test('lacks what only the Romans have and has what only the Egyptians have', () => {
    const ids = egyptian.buildings.map(b => b.id)
    expect(ids).not.toContain('winery')
    expect(ids).not.toContain('charcoal-maker')
    expect(ids).toEqual(expect.arrayContaining(['brewery', 'gem-mine']))
    expect(egyptian.goods).not.toContain('wine')
    expect(egyptian.goods).toEqual(expect.arrayContaining(['keg', 'gems']))
    expect(egyptian.religion?.offering).toBe('keg')
    expect(egyptian.religion?.interventions).toBeUndefined()
    expect(egyptian.buildings.find(b => b.id === 'small-temple')).toMatchObject({ name: 'Sphinx', inputs: { keg: 8 } })
    expect(egyptian.buildings.find(b => b.id === 'large-temple')?.name).toBe('Pyramid')
  })

  test('prices every building at the manual\'s Egyptian cost, even where the reference differs', () => {
    const manual = MANUAL_CONSTRUCTION as unknown as { common: Record<string, { egyptian: [number, number] }>, specific: { egyptian: Record<string, [number, number]> } }
    const specific = (name: string): number[] => manual.specific.egyptian[name]!
    const cost = (id: string) => { const b = egyptian.buildings.find(b => b.id === id)!; return [b.cost.plank ?? 0, b.cost.stone ?? 0] }
    expect(cost('sawmill')).toEqual(manual.common.Sawmill!.egyptian)
    // The reference gives the Egyptian woodcutter 1 plank and 3 stone; the manual says 2 and 2.
    expect(cost('woodcutter')).toEqual(manual.common["Woodcutter's Hut"]!.egyptian)
    expect(cost('woodcutter')).toEqual([2, 2])
    expect(cost('small-temple')).toEqual(specific('Sphinx'))
    expect(cost('large-temple')).toEqual(specific('Pyramid'))
    expect(cost('brewery')).toEqual(specific('Brewery'))
    expect(cost('gem-mine')).toEqual(specific('Gem Mine'))
  })

  test('uses the Egyptian geometry, which differs from the Roman one', () => {
    const roman = ROMAN_ENGINEERING.buildings.find(b => b.id === 'castle')!
    const own = egyptian.buildings.find(b => b.id === 'castle')!
    expect(own.footprint).not.toEqual(roman.footprint)
    expect(egyptian.evidence['buildings.castle.geometry']!.source).toContain('/egyptian')
  })
})

type Features = Parameters<typeof describeMap>[1]['features']
function economyOf(profile: RulesProfile, civilization: string, options: { buildings: { type: string, near: { x: number, y: number } }[], goods?: Record<string, number>, features?: Features }) {
  const map = describeMap(profile, { width: 96, height: 96, base: 'grass', seed: 5, features: options.features ?? [] })
  const start = { x: 40, y: 40 }, settlers = Array.from({ length: 14 }, (_, i) => ({ profession: 'carrier', x: 44 + (i % 7), y: 48 + Math.floor(i / 7) }))
  // Scenario players start with what the scenario lists, so goods go down as piles on their land.
  const piles = Object.entries(options.goods ?? {}).map(([good, amount], i) => ({ good, amount, x: 44 + i, y: 44 }))
  const create = (buildings: { type: string, x: number, y: number }[]) => createSession({ rules: profile, seed: 5, map, players: [{ name: 'Thebes', civilization, start, scenario: { buildings: [{ type: 'castle', ...start }, ...buildings], settlers } }], piles })
  // Find real sites with the engine's own placement test, one building at a time, so the scenario never depends on a guessed coordinate.
  const placed: { type: string, x: number, y: number }[] = []
  for (const wanted of options.buildings) placed.push({ type: wanted.type, ...site(create(placed), wanted.type, wanted.near) })
  const s = create(placed)
  expect(s.skipped).toEqual({})
  return s
}

describe('the Egyptian economy in the simulation', () => {
  test('the brewery turns grain and water into kegs, conserving every good', () => {
    const s = economyOf(egyptian, 'egyptian', { buildings: [{ type: 'brewery', near: { x: 34, y: 42 } }], goods: { grain: 8, water: 8, plank: 4 } })
    until(s, () => (s.state.ledger[1]!.produced.keg ?? 0) > 0, 4000)
    expect(s.state.ledger[1]?.consumed?.grain).toBeGreaterThan(0)
    expect(s.state.ledger[1]?.consumed?.water).toBeGreaterThan(0)
    run(s, 200)
    expect(conserved(s)).toBe(true)
    expect(audit(s.context)).toEqual([])
  })

  test('the Sphinx turns kegs into manna', () => {
    const s = economyOf(egyptian, 'egyptian', { buildings: [{ type: 'small-temple', near: { x: 34, y: 42 } }], goods: { keg: 8 } })
    until(s, () => (s.state.players[0]!.religion?.manna ?? 0) > 0, 6000)
    expect(s.state.ledger[1]?.consumed?.keg).toBeGreaterThan(0)
    expect(conserved(s)).toBe(true)
  })

  test('the gem mine brings up gems from gem deposits, fed like the other mines', () => {
    const s = economyOf(egyptian, 'egyptian', {
      buildings: [{ type: 'gem-mine', near: { x: 30, y: 33 } }], goods: { bread: 8, meat: 8, fish: 8, pickaxe: 2 },
      features: [{ kind: 'terrain', id: 'mountain', x: 28, y: 30, radius: 5 }, { kind: 'resource', id: 'gems', x: 28, y: 30, radius: 5, amount: 3 }],
    })
    until(s, () => (s.state.ledger[1]!.produced.gems ?? 0) > 0, 8000)
    expect(conserved(s)).toBe(true)
  })

  test('saves and replays under the Egyptian profile', () => {
    const s = economyOf(egyptian, 'egyptian', { buildings: [{ type: 'brewery', near: { x: 34, y: 42 } }], goods: { grain: 8, water: 8, plank: 4 } })
    run(s, 300)
    const copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
    run(s, 200); run(copy, 200)
    expect(copy.checksum()).toBe(s.checksum())
    expect(copy.rules.id).toBe('egyptian-engineering')
  })
})

// The same checks, for the profiles whose differences are not the Egyptians'.
const stored = (id: string): unknown => JSON.parse(readFileSync(join(import.meta.dir, `../../resources/game/engine/profiles/${id}-engineering-0.1.0.json`), 'utf8'))
const manualFor = (race: 'asian' | 'amazon') => MANUAL_CONSTRUCTION as unknown as { common: Record<string, Record<string, [number, number]>>, specific: Record<string, Record<string, [number, number]>> } & { race?: typeof race }

describe.each([
  ['asian', asian, asianProfile, { has: ['rice-farm', 'distillery', 'sulfur-mine'], goods: ['rice', 'liquor', 'sulfur'], offering: 'liquor', small: 'Small pagoda', large: 'Large pagoda' }],
  ['amazon', amazon, amazonProfile, { has: ['beekeeper', 'mead-brewery', 'alchemist', 'gem-mine', 'sulfur-mine'], goods: ['honey', 'mead', 'sulfur', 'gems'], offering: 'mead', small: 'Small temple', large: 'Large temple' }],
] as const)('the %s engineering profile', (race, profile: RulesProfile, build, expected) => {
  test('is exactly what the generator produces, and is published once', () => {
    expect(stored(race)).toEqual(JSON.parse(JSON.stringify(build())))
    expect(PUBLISHED_RULES.filter(rules => rules.id === `${race}-engineering`)).toHaveLength(1)
    expect(profile.fidelity).toBe('engineering')
    expect(rulesIdentity(profile).digest).not.toBe(rulesIdentity(ROMAN_ENGINEERING).digest)
  })

  test('never qualifies a release and has no divine interventions yet', () => {
    expect(qualificationGaps(profile).length).toBeGreaterThan(50)
    expect(Object.values(profile.evidence).some(item => item.class === 'O')).toBe(false)
    expect(profile.religion?.interventions).toBeUndefined()
  })

  test('lacks wine and charcoal, and has its own buildings, goods and offering', () => {
    const ids = profile.buildings.map(b => b.id)
    expect(ids).not.toContain('winery')
    expect(ids).not.toContain('charcoal-maker')
    expect(ids).toEqual(expect.arrayContaining([...expected.has]))
    expect(profile.goods).not.toContain('wine')
    expect(profile.goods).toEqual(expect.arrayContaining([...expected.goods]))
    expect(profile.religion?.offering).toBe(expected.offering)
    expect(profile.buildings.find(b => b.id === 'small-temple')).toMatchObject({ name: expected.small, inputs: { [expected.offering]: 8 } })
    expect(profile.buildings.find(b => b.id === 'large-temple')?.name).toBe(expected.large)
  })

  test('prices every building at the manual\'s cost for the race, wherever the reference differs', () => {
    const manual = manualFor(race)
    const cost = (id: string) => { const b = profile.buildings.find(b => b.id === id)!; return [b.cost.plank ?? 0, b.cost.stone ?? 0] }
    const common = (name: string): number[] => manual.common[name]![race]!
    const specific = (name: string): number[] => manual.specific[race]![name]!
    expect(cost('sawmill')).toEqual(common('Sawmill'))
    expect(cost('castle')).toEqual(common('Castle'))
    if (race === 'asian') { expect(cost('large-temple')).toEqual(specific('Large Pagoda')); expect(cost('large-residence')).toEqual(common('Large Residence')) }
    if (race === 'amazon') { expect(cost('alchemist')).toEqual(specific("Alchemist's Den")); expect(cost('coal-mine')).toEqual(common('Coal Mine')) }
  })

  test('gives every temple a door that borders it, even where the reference puts the door inside', () => {
    const temple = profile.buildings.find(b => b.id === 'small-temple')!
    expect(temple.footprint.some(([x, y]) => x === temple.door[0] && y === temple.door[1])).toBe(false)
    if (race === 'amazon') expect(profile.evidence['buildings.small-temple.door']?.class).toBe('U')
  })
})

describe('the Asian economy in the simulation', () => {
  test('the distillery turns rice and coal into liquor, and the small pagoda turns liquor into manna', () => {
    const s = economyOf(asian, 'asian', { buildings: [{ type: 'distillery', near: { x: 34, y: 42 } }, { type: 'small-temple', near: { x: 34, y: 52 } }], goods: { rice: 8, coal: 8 } })
    until(s, () => (s.state.players[0]!.religion?.manna ?? 0) > 0, 12000)
    expect(s.state.ledger[1]?.consumed?.rice).toBeGreaterThan(0)
    expect(s.state.ledger[1]?.consumed?.liquor).toBeGreaterThan(0)
    expect(conserved(s)).toBe(true)
    expect(audit(s.context)).toEqual([])
  })

  test('the rice farm grows and harvests rice', () => {
    const s = economyOf(asian, 'asian', { buildings: [{ type: 'rice-farm', near: { x: 34, y: 42 } }], goods: { scythe: 2 } })
    until(s, () => (s.state.ledger[1]?.produced?.rice ?? 0) > 0, 12000)
    expect(conserved(s)).toBe(true)
  })

  test('the sulfur mine brings up sulfur', () => {
    const s = economyOf(asian, 'asian', {
      buildings: [{ type: 'sulfur-mine', near: { x: 30, y: 33 } }], goods: { bread: 8, meat: 8, fish: 8, pickaxe: 2 },
      features: [{ kind: 'terrain', id: 'mountain', x: 28, y: 30, radius: 5 }, { kind: 'resource', id: 'sulfur', x: 28, y: 30, radius: 5, amount: 3 }],
    })
    until(s, () => (s.state.ledger[1]?.produced?.sulfur ?? 0) > 0, 8000)
    expect(conserved(s)).toBe(true)
  })

  test('saves and replays under the Asian profile', () => {
    const s = economyOf(asian, 'asian', { buildings: [{ type: 'distillery', near: { x: 34, y: 42 } }], goods: { rice: 8, coal: 8 } })
    run(s, 300)
    const copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
    run(s, 200); run(copy, 200)
    expect(copy.checksum()).toBe(s.checksum())
    expect(copy.rules.id).toBe('asian-engineering')
  })
})

describe('the Amazon economy in the simulation', () => {
  test('honey and water become mead, and the temple turns mead into manna', () => {
    const s = economyOf(amazon, 'amazon', { buildings: [{ type: 'beekeeper', near: { x: 34, y: 42 } }, { type: 'mead-brewery', near: { x: 34, y: 52 } }, { type: 'small-temple', near: { x: 46, y: 30 } }], goods: { water: 8 } })
    until(s, () => (s.state.players[0]!.religion?.manna ?? 0) > 0, 20000)
    expect(s.state.ledger[1]?.produced?.honey).toBeGreaterThan(0)
    expect(s.state.ledger[1]?.consumed?.honey).toBeGreaterThan(0)
    expect(s.state.ledger[1]?.consumed?.mead).toBeGreaterThan(0)
    expect(conserved(s)).toBe(true)
    expect(audit(s.context)).toEqual([])
  })

  test('the gem and sulfur mines bring up their goods', () => {
    const s = economyOf(amazon, 'amazon', {
      buildings: [{ type: 'gem-mine', near: { x: 30, y: 33 } }, { type: 'sulfur-mine', near: { x: 24, y: 28 } }], goods: { bread: 8, meat: 8, fish: 8, pickaxe: 4 },
      features: [{ kind: 'terrain', id: 'mountain', x: 28, y: 30, radius: 7 }, { kind: 'resource', id: 'gems', x: 30, y: 33, radius: 3, amount: 3 }, { kind: 'resource', id: 'sulfur', x: 24, y: 28, radius: 3, amount: 3 }],
    })
    until(s, () => (s.state.ledger[1]?.produced?.gems ?? 0) > 0 && (s.state.ledger[1]?.produced?.sulfur ?? 0) > 0, 16000)
    expect(conserved(s)).toBe(true)
  })

  test('saves and replays under the Amazon profile', () => {
    const s = economyOf(amazon, 'amazon', { buildings: [{ type: 'beekeeper', near: { x: 34, y: 42 } }], goods: {} })
    run(s, 400)
    const copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
    run(s, 200); run(copy, 200)
    expect(copy.checksum()).toBe(s.checksum())
    expect(copy.rules.id).toBe('amazon-engineering')
  })
})
