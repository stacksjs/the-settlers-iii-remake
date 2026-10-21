import { describe, expect, test } from 'bun:test'
import { BUILDINGS, attack, createWorld, owned, place, placementError, restore, step, type Kind, type World } from '../../resources/game/simulation'
import { project, unproject } from '../../resources/game/renderer'

function advance(w: World, seconds: number): void { for (let i = 0; i < seconds * 20; i++) step(w, 0.05) }
function build(w: World, kind: Kind, x: number, y: number): void { expect(place(w, kind, x, y)).toBeNull(); advance(w, BUILDINGS[kind].build + 1) }
function rich(w: World): void { for (const key of Object.keys(w.stock)) w.stock[key as keyof typeof w.stock] = 1000 }

describe('campaign economy', () => {
  test('construction spends once and production consumes inputs before yielding output', () => {
    const w = createWorld()
    build(w, 'sawmill', 9, 14)
    const planks = w.stock.planks, logs = w.stock.logs
    advance(w, 7)
    expect(w.stock.planks).toBe(planks + 3)
    expect(w.stock.logs).toBe(logs - 2)
    w.stock.logs = 0
    advance(w, 60)
    expect(w.stock.planks).toBe(planks + 3)
    expect(w.stock.logs).toBe(0)
  })
  test('rejects occupied, distant, unsupported and unaffordable placement without changing state', () => {
    const w = createWorld(), before = structuredClone(w)
    expect(place(w, 'sawmill', 9, 13)).toContain('already')
    expect(place(w, 'sawmill', 23, 22)).toContain('borders')
    expect(place(w, 'ironmine', 9, 14)).toContain('iron')
    expect(w).toEqual(before)
    w.stock.planks = 0
    expect(place(w, 'sawmill', 9, 14)).toContain('materials')
    expect(placementError(w, 'tower', NaN, 2)).toContain('tile')
  })
  test('completed towers expand the frontier and residences add workforce', () => {
    const w = createWorld(); rich(w)
    expect(owned(w, 18, 13)).toBe(false)
    build(w, 'tower', 15, 13)
    expect(owned(w, 18, 13)).toBe(true)
    build(w, 'residence', 10, 13)
    expect(w.buildings.find(b => b.kind === 'residence')?.built).toBe(0)
  })
  test('full food and weapons supply chain trains soldiers and can win a campaign', () => {
    const w = createWorld(); rich(w)
    build(w, 'tower', 15, 13)
    for (const [kind, x, y] of [['farm', 10, 13], ['mill', 9, 14], ['bakery', 10, 14], ['smelter', 11, 14], ['smith', 11, 13], ['barracks', 12, 13], ['residence', 12, 14]] as const) build(w, kind, x, y)
    w.soldiers = 25
    expect(attack(w)).toBeNull()
    expect(w.result).toBe('won')
    const before = structuredClone(w); advance(w, 60); expect(w).toEqual(before)
  })
  test('unprotected settlements eventually lose to growing raids', () => {
    const w = createWorld(); advance(w, 1400)
    expect(w.result).toBe('lost'); expect(w.health).toBe(0)
  })
  test('saved campaigns round-trip and reject malformed data or duplicate occupancy', () => {
    const w = createWorld(); advance(w, 15)
    expect(restore(JSON.parse(JSON.stringify(w)))).toEqual(w)
    expect(() => restore({ ...w, health: NaN })).toThrow()
    expect(() => restore({ ...w, buildings: [...w.buildings, { ...w.buildings[0], id: 2 }] })).toThrow()
    expect(() => restore({ ...w, stock: { ...w.stock, logs: -1 } })).toThrow()
    expect(() => step(w, Infinity)).toThrow()
  })
  test('isometric picking round-trips across camera zoom and pan', () => {
    for (const zoom of [0.4, 1, 2.8]) for (let x = 0; x < 28; x++) for (let y = 0; y < 28; y++) {
      const camera = { x: 615, y: -47, zoom }, screen = project(x, y, camera)
      expect(unproject(screen.x, screen.y, camera)).toEqual({ x, y })
    }
  })
})

for (const seed of [1, 2, 3]) test(`fresh island ${seed} supplies every production chain and defeats the rival without grants`, () => {
  const w = createWorld(seed)
  const commission = (kind: Kind): void => {
    for (let wait = 0; wait < 240; wait++) {
      for (let y = 1; y < 27; y++) for (let x = 1; x < 27; x++) {
        if (!placementError(w, kind, x, y)) { build(w, kind, x, y); return }
      }
      advance(w, 1)
    }
    throw new Error(`Economy cannot commission ${kind}`)
  }
  for (const kind of ['woodcutter', 'sawmill', 'quarry', 'fishery', 'farm', 'mill', 'bakery', 'ironmine', 'coalmine', 'smelter', 'smith', 'barracks', 'residence', 'residence'] as Kind[]) commission(kind)
  let wait = 0
  while (placementError(w, 'tower', 15, 13) && wait++ < 240) advance(w, 1)
  build(w, 'tower', 15, 13)
  for (let i = 0; i < 6 && w.result === 'playing'; i++) {
    while (w.soldiers < 12 && w.result === 'playing') advance(w, 1)
    expect(attack(w)).toBeNull()
  }
  expect(w.result).toBe('won')
  expect(w.buildings.find(b => b.kind === 'ironmine')!.cycles).toBeGreaterThan(0)
  expect(w.buildings.find(b => b.kind === 'barracks')!.cycles).toBeGreaterThan(0)
})

test('pausing work suspends construction and production until resumed', () => {
  const w = createWorld()
  expect(place(w, 'sawmill', 9, 14)).toBeNull()
  const b = w.buildings.at(-1)!
  b.enabled = false
  advance(w, 30)
  expect(b.built).toBe(BUILDINGS.sawmill.build)
  b.enabled = true
  advance(w, 6)
  expect(b.built).toBe(0)
  b.enabled = false
  const stock = structuredClone(w.stock)
  advance(w, 20)
  expect(w.stock).toEqual(stock)
})
