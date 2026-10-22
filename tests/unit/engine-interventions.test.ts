import type { Session } from '../../resources/game/engine'
import { describe, expect, test } from 'bun:test'
import { audit, checksum, createSession, restore, save } from '../../resources/game/engine'
import { anchors, building, conserved, landscape, order, place, rules, run, until } from '../fixtures/engine'

type Placed = { profession: string, x: number, y: number }
const desert = { x: 44, y: 60 }

const priest = (s: Session, owner = 1) => [...s.state.settlers.values()].find(p => p.owner === owner && p.profession === 'priest')!
const manna = (s: Session, amount: number, player = 1): void => { s.state.players[player - 1]!.religion = { manna: amount, produced: amount, promotions: 0, levels: {}, templeLost: false } }
const cast = (s: Session, spell: string, at: { x: number, y: number }, player = 1): void => order(s, 'cast', { priest: priest(s, player).id, spell, ...at }, player)
const events = (s: Session, type: string) => s.state.events.filter(e => e.type === type)

/** A session whose players each have a priest standing where the scenario puts it. */
function withPriests(rome: Placed[], enemy: Placed[], goods: Record<string, number> = {}): Session {
  return createSession({
    rules, map: landscape([{ kind: 'terrain', id: 'desert', ...desert, radius: 2 }]), seed: 4,
    players: [
      { name: 'Rome', civilization: 'roman', start: anchors.castle, scenario: { buildings: [{ type: 'castle', x: 40, y: 40 }], settlers: [{ profession: 'priest', x: 44, y: 46 }, ...rome] } },
      { name: 'Enemy', civilization: 'roman', start: { x: 80, y: 40 }, scenario: { buildings: [], settlers: [{ profession: 'priest', x: 80, y: 60 }, ...enemy] } },
    ],
    piles: Object.entries(goods).map(([good, amount], i) => ({ good, x: 36 + i, y: 48, amount })),
  })
}

describe('divine interventions', () => {
  test('the Magic Eye opens distant land for six seconds without the priest walking there, at a rising cost', () => {
    const s = withPriests([], [])
    manna(s, 25)
    const far = { x: 85, y: 85 }, tile = far.y * 96 + far.x, start = { x: priest(s).x, y: priest(s).y }
    expect(s.state.players[0]!.visible[tile]).toBe(0)
    cast(s, 'magic-eye', far)
    run(s, 10)
    expect(s.state.players[0]!.visible[tile]).toBe(1)
    expect({ x: priest(s).x, y: priest(s).y }).toEqual(start)
    expect(s.state.players[0]!.religion!.manna).toBe(15)
    expect(s.view(1).religion!.interventions.find(i => i.id === 'magic-eye')!.cost).toBe(11)
    run(s, 6 * rules.tickRate)
    expect(s.state.players[0]!.visible[tile]).toBe(0)
    expect(s.state.players[0]!.explored[tile]).toBe(1)
    expect(s.state.eyes).toEqual([])
  })

  test('Grassland Galore turns desert near the target into grass, once the priest has walked within reach', () => {
    const s = withPriests([], [])
    manna(s, 10)
    const deserts = (): number => s.state.map.terrain.filter(t => rules.terrain[t]!.id === 'desert').length
    expect(deserts()).toBeGreaterThan(0)
    cast(s, 'grassland-galore', desert)
    until(s, () => deserts() === 0, 600)
    expect(s.state.players[0]!.religion!.manna).toBe(0)
  })

  test('Gorgeous Growth halves the growing time of what the nearest forester plants while it lasts', () => {
    const s = createSession({ rules, map: landscape(), seed: 4, players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle, settlers: { carrier: 12, digger: 2, builder: 2, priest: 1, forester: 1 } }] })
    manna(s, 15)
    const forester = [...s.state.settlers.values()].find(p => p.profession === 'forester')!
    cast(s, 'gorgeous-growth', { x: forester.x, y: forester.y })
    run(s, 5)
    expect(forester.effects?.[0]).toMatchObject({ kind: 'growth', caster: 1 })
    const hut = place(s, 'forester', anchors.south)
    until(s, () => s.state.buildings.get(hut)!.phase === 'active', 6000)
    const sapling = rules.objects.findIndex(o => o.id === 'sapling') + 1, ticks = rules.objects[sapling - 1]!.grows!.ticks
    until(s, () => s.state.map.object.some(o => o === sapling), 3000)
    const tile = s.state.map.object.findIndex(o => o === sapling)
    const due = s.state.growth.find(([, t]) => t === tile)![0]
    expect(due - s.state.map.objectSince[tile]!).toBe(Math.floor(ticks / 2))
    expect(building(s, 'forester')).toBeDefined()
  }, 60_000)

  test("Festering Fear halves the blows of enemies fighting on the caster's land", () => {
    const blow = (fear: boolean): number => {
      const s = withPriests([{ profession: 'pikeman', x: 45, y: 50 }], [{ profession: 'swordsman', x: 47, y: 50 }])
      manna(s, 15)
      const ours = [...s.state.settlers.values()].find(p => p.owner === 1 && p.profession === 'pikeman')!
      order(s, 'move-soldiers', { soldiers: [ours.id], x: 45, y: 50 })
      if (fear) cast(s, 'festering-fear', { x: 47, y: 50 })
      const health = ours.soldier!.health
      until(s, () => ours.soldier!.health < health, 600)
      return health - ours.soldier!.health
    }
    expect(blow(true)).toBeLessThan(blow(false))
  })

  test('Heavenly Presents leave goods that the ledger records as given', () => {
    const s = withPriests([], [])
    manna(s, 2000)
    for (let i = 0; i < 6; i++) { cast(s, 'heavenly-presents', { x: 46, y: 48 }); until(s, () => !priest(s).cast, 300) }
    const given = Object.values(s.state.ledger[1]!.created).reduce((a, n) => a + n, 0)
    expect(given).toBeGreaterThan(0)
    expect(conserved(s, 1)).toBe(true)
    expect(events(s, 'intervention')).toHaveLength(6)
  })

  test("the Midas Touch turns up to forty of the player's iron into gold", () => {
    const s = withPriests([], [], { iron: 50 })
    manna(s, 20)
    cast(s, 'midas-touch', { x: 37, y: 48 })
    until(s, () => !priest(s).cast, 300)
    expect(s.state.ledger[1]!.consumed.iron).toBe(40)
    expect(s.state.ledger[1]!.produced.gold).toBe(40)
    expect(conserved(s, 1)).toBe(true)
  })

  test("Vanishing Resources halves the minerals under other players' land and spares the caster's own", () => {
    const s = withPriests([], [])
    manna(s, 25, 2); manna(s, 25, 1)
    const mountain = anchors.mountain, t = mountain.y * 96 + mountain.x, before = s.state.map.resourceAmount[t]!
    expect(before).toBeGreaterThan(1)
    // Rome's own priest cannot shrink Rome's mountain.
    cast(s, 'vanishing-resources', mountain)
    until(s, () => !priest(s).cast, 600)
    expect(s.state.map.resourceAmount[t]).toBe(before)
    cast(s, 'vanishing-resources', mountain, 2)
    until(s, () => !priest(s, 2).cast, 2000)
    expect(s.state.map.resourceAmount[t]).toBe(Math.floor(before / 2))
  }, 60_000)

  test('Conversion wins over up to ten enemy soldiers near the target, and the people ledger follows them', () => {
    const enemy = Array.from({ length: 12 }, (_, i) => ({ profession: 'swordsman', x: 50 + (i % 4), y: 52 + Math.floor(i / 4) }))
    const s = withPriests([], enemy)
    manna(s, 40)
    cast(s, 'conversion', { x: 51, y: 53 })
    until(s, () => !priest(s).cast, 300)
    expect([...s.state.settlers.values()].filter(p => p.owner === 1 && p.soldier)).toHaveLength(10)
    expect(s.state.ledger[1]!.joined).toBe(10)
    expect(s.state.ledger[2]!.left).toBe(10)
    expect(audit(s.context)).toEqual([])
  })

  test('not enough manna, foreign priests, unknown spells and far targets are refused or reported', () => {
    const s = withPriests([], [])
    manna(s, 5)
    cast(s, 'conversion', { x: 51, y: 53 })
    until(s, () => !priest(s).cast, 300)
    expect(events(s, 'spell-failed').at(-1)!.text).toBe('Conversion of the Barbarians needs 40 manna; you have 5')
    const refuse = (fields: Record<string, unknown>): string => { s.enqueue({ tick: s.state.tick, player: 1, seq: 9000 + s.state.tick, type: 'cast', ...fields }); s.advance(1); return s.state.results.at(-1)!.reason ?? 'accepted' }
    expect(refuse({ priest: priest(s, 2).id, spell: 'magic-eye', x: 1, y: 1 })).toBe('Choose one of your priests.')
    expect(refuse({ priest: priest(s).id, spell: 'thunder', x: 1, y: 1 })).toBe('Unknown intervention.')
    expect(refuse({ priest: priest(s).id, spell: 'magic-eye', x: -1, y: 1 })).toBe('Choose a tile on the map.')
  })

  test('a priest on his way saves and restores with his order, durations and eyes intact', () => {
    const s = withPriests([], [])
    manna(s, 50)
    cast(s, 'magic-eye', { x: 85, y: 85 })
    cast(s, 'grassland-galore', desert)
    run(s, 20)
    const copy = restore(JSON.parse(JSON.stringify(save(s))), rules)
    expect(copy.state.eyes).toEqual(s.state.eyes)
    expect(priest(copy).cast).toEqual(priest(s).cast)
    run(s, 400); copy.advance(400)
    expect(checksum(copy.state)).toBe(checksum(s.state))
  })
})

