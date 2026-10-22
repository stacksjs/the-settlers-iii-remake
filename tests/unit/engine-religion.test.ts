import type { Session } from '../../resources/game/engine'
import { describe, expect, test } from 'bun:test'
import { audit, checksum, createSession, restore, save } from '../../resources/game/engine'
import { anchors, building, landscape, order, place, rules, run, until } from '../fixtures/engine'

const goods = { plank: 60, stone: 60, log: 8, fish: 8, bread: 8, meat: 8, axe: 3, saw: 2, pickaxe: 4, shovel: 2, hammer: 4, scythe: 2, fishingrod: 2 }
// A hill east of the castle gives the slopes grapes need.
const hill = { x: 52, y: 32 }
function roman(extra: Record<string, number> = {}): Session {
  return createSession({ rules, map: landscape([{ kind: 'elevation', ...hill, radius: 5, amount: 14 }]), seed: 6, players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle, goods: { ...goods, ...extra } }] })
}
const religion = (s: Session) => s.state.players[0]!.religion
const ready = (s: Session, id: number, limit = 8000): void => { until(s, () => s.state.buildings.get(id)!.phase === 'active', limit) }

describe('Roman special production', () => {
  test('the charcoal maker turns five delivered planks into one coal', () => {
    const s = roman()
    const hut = place(s, 'charcoal-maker', anchors.west)
    ready(s, hut)
    until(s, () => (s.state.ledger[1]!.produced.coal ?? 0) >= 2, 4000)
    const worker = [...s.state.settlers.values()].find(p => p.workplace === hut)!
    expect(worker.profession).toBe('charcoal-burner')
    expect(worker.tool).toBeNull()
    // Every coal cost five planks beyond those the building itself consumed.
    const built = s.state.buildings.get(hut)!.used.plank!
    const forCoal = s.state.ledger[1]!.consumed.plank! - built
    expect(forCoal % 5).toBe(0)
    expect(forCoal / 5).toBeGreaterThanOrEqual(s.state.ledger[1]!.produced.coal! - 1)
    expect(audit(s.context)).toEqual([])
  }, 60_000)

  test('vines are planted only beside a slope, ripen and become wine', () => {
    const s = roman()
    const winery = place(s, 'winery', hill)
    ready(s, winery)
    order(s, 'work-area', { building: winery, ...hill })
    until(s, () => (s.state.ledger[1]!.produced.wine ?? 0) >= 1, 16_000)
    const map = s.state.map, vine = rules.objects.findIndex(o => o.id === 'vine') + 1, ripe = vine + 1
    let planted = 0
    for (let t = 0; t < map.width * map.height; t++) {
      if (map.object[t] !== vine && map.object[t] !== ripe) continue
      planted++
      const x = t % map.width, y = Math.floor(t / map.width)
      const steep = [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 0], [-1, -1]].some(([dx, dy]) => Math.abs(map.elevation[(y + dy!) * map.width + x + dx!]! - map.elevation[t]!) >= 2)
      expect(steep).toBe(true)
    }
    expect(planted).toBeGreaterThan(0)
    expect([...s.state.settlers.values()].find(p => p.workplace === winery)!.profession).toBe('winegrower')
    expect(audit(s.context)).toEqual([])
  }, 120_000)

  test('a winery on flat land finds nowhere to plant', () => {
    const s = roman()
    const winery = place(s, 'winery', anchors.west)
    ready(s, winery)
    run(s, 400)
    expect(s.state.buildings.get(winery)!.shortage).toBe('no-space')
    expect(s.state.map.object.some(o => o === rules.objects.findIndex(r => r.id === 'vine') + 1)).toBe(false)
  }, 60_000)
})

describe('temples, manna and promotion', () => {
  test('a small temple turns each delivered wine into one manna on its schedule, and saves mid-offering', () => {
    const s = roman({ wine: 3 })
    const temple = place(s, 'small-temple', anchors.west)
    ready(s, temple)
    until(s, () => (religion(s)?.manna ?? 0) >= 1, 2000)
    const first = s.state.tick
    // The next offering waits for the temple's schedule even though wine is there.
    const copy = restore(JSON.parse(JSON.stringify(save(s))), rules)
    run(s, rules.religion!.offerTicks - 2); copy.advance(rules.religion!.offerTicks - 2)
    expect(checksum(copy.state)).toBe(checksum(s.state))
    expect(religion(s)!.manna).toBe(1)
    until(s, () => religion(s)!.manna === 3, 2 * rules.religion!.offerTicks + 200)
    expect(s.state.tick - first).toBeGreaterThanOrEqual(2 * rules.religion!.offerTicks)
    expect(s.state.ledger[1]!.consumed.wine).toBe(3)
    run(s, rules.religion!.offerTicks + 10)
    expect(religion(s)!.manna).toBe(3)
    expect(audit(s.context)).toEqual([])
  }, 60_000)

  test('a large temple gives manna once, brings priests, and razing it forfeits further temple manna', () => {
    const s = roman()
    const temple = place(s, 'large-temple', anchors.south)
    ready(s, temple, 12_000)
    expect(religion(s)!.manna).toBe(8)
    const births = s.state.ledger[1]!.births
    until(s, () => [...s.state.settlers.values()].some(p => p.profession === 'priest'), rules.religion!.priestTicks + 10)
    expect(s.state.ledger[1]!.births).toBe(births + 1)
    order(s, 'demolish', { building: temple })
    expect(religion(s)!.templeLost).toBe(true)
    const again = place(s, 'large-temple', anchors.south)
    ready(s, again, 12_000)
    expect(religion(s)!.manna).toBe(8)
  }, 120_000)

  test('promotions cost rising manna, keep classes within a rank of each other, and spare serving soldiers', () => {
    const s = createSession({ rules, map: landscape(), seed: 1, players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle, scenario: { buildings: [{ type: 'castle', x: 40, y: 40 }], settlers: [{ profession: 'swordsman', x: 44, y: 46 }] } }] })
    s.state.players[0]!.religion = { manna: 200, produced: 200, promotions: 0, levels: {}, templeLost: false }
    const veteran = [...s.state.settlers.values()].find(p => p.soldier)!
    order(s, 'promote', { profession: 'bowman' })
    s.enqueue({ tick: s.state.tick, player: 1, seq: 900, type: 'promote', profession: 'bowman' })
    s.advance(1)
    expect(s.state.results.at(-1)!.reason).toBe('Promote the other soldier classes to this rank first.')
    order(s, 'promote', { profession: 'swordsman' })
    order(s, 'promote', { profession: 'pikeman' })
    order(s, 'promote', { profession: 'bowman' })
    expect(religion(s)!.manna).toBe(200 - 10 - 20 - 30 - 50)
    expect(s.view(1).religion).toEqual({ manna: 90, produced: 200, next: 60, ranks: { swordsman: 2, pikeman: 2, bowman: 3 } })
    expect(veteran.soldier!.rank).toBe(1)
    s.enqueue({ tick: s.state.tick, player: 1, seq: 901, type: 'promote', profession: 'bowman' })
    s.advance(1)
    expect(s.state.results.at(-1)!.reason).toBe('bowman soldiers already join at the highest rank.')
    const tampered = save(s)
    tampered.state.players[0]!.religion!.promotions = 9
    expect(() => restore(tampered, rules)).toThrow('religion is invalid')
  })
})
