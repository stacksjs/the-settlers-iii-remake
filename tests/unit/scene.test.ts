import { describe, expect, test } from 'bun:test'
import { createSession, generateMap, toView } from '../../resources/game/engine'
import { area, indexOf } from '../../resources/game/engine/geometry'
import { scene, spriteDirection } from '../../resources/game/scene'
import { anchors, place, rules, session, until } from '../fixtures/engine'

describe('render scene', () => {
  test('settlers face the way they walk: engine directions map onto the original sprite order', () => {
    // movables.txt: SOUTH_WEST 0, WEST 12, NORTH_WEST 24, NORTH_EAST 36, EAST 48, SOUTH_EAST 60.
    const original = { 'south-west': 0, 'west': 12, 'north-west': 24, 'north-east': 36, 'east': 48, 'south-east': 60 }
    const engine = ['north-east', 'east', 'south-east', 'south-west', 'west', 'north-west'] as const
    engine.forEach((name, dir) => expect(spriteDirection(dir) * 12).toBe(original[name]))
  })

  test('draws exactly the settlers, cargo, piles and sites the simulation holds', () => {
    const s = session()
    const id = place(s, 'sawmill', anchors.west)
    until(s, () => [...s.state.settlers.values()].some(p => p.cargo === 'plank' && p.action === 'walking'), 2000)
    const items = scene(s, { player: 1 })
    const settlers = items.filter(i => i.kind === 'settler')
    const outside = [...s.state.settlers.values()].filter(p => !p.inside)
    expect(settlers.map(i => i.entity).sort((a, b) => a - b)).toEqual(outside.map(p => p.id).sort((a, b) => a - b))
    for (const item of settlers) {
      const p = s.state.settlers.get(item.entity)!
      expect(item.sprite).toBe(p.cargo ? `carry:${p.cargo}` : 'worker')
      expect(Math.floor(item.frame / 12)).toBe(spriteDirection(p.dir))
      // A walking settler is drawn between the tile it left and the tile it enters.
      const from = toView(p.x, p.y, s.state.map.elevation[p.y * 96 + p.x]!)
      const to = p.next >= 0 ? toView(p.next % 96, Math.floor(p.next / 96), s.state.map.elevation[p.next]!) : from
      expect(item.view.x).toBeGreaterThanOrEqual(Math.min(from.x, to.x) - 1e-9)
      expect(item.view.x).toBeLessThanOrEqual(Math.max(from.x, to.x) + 1e-9)
    }
    expect(settlers.some(i => i.sprite === 'carry:plank')).toBe(true)
    const piles = items.filter(i => i.kind === 'pile')
    const stacks = [...s.state.stacks.values()].filter(st => st.amount > 0)
    expect(piles.map(i => i.entity).sort((a, b) => a - b)).toEqual(stacks.map(st => st.id).sort((a, b) => a - b))
    for (const item of piles) { const st = s.state.stacks.get(item.entity)!; expect([item.good, item.amount, item.frame]).toEqual([st.good, st.amount, Math.min(8, st.amount) - 1]) }
    // Goods drawn on the ground plus goods drawn in hands equal the settlement's totals.
    const drawn: Record<string, number> = {}
    for (const i of piles) drawn[i.good!] = (drawn[i.good!] ?? 0) + i.amount!
    for (const i of settlers) if (i.good) drawn[i.good] = (drawn[i.good] ?? 0) + 1
    expect(drawn).toEqual(s.view(1).goods)
    const site = items.find(i => i.entity === id)!
    const b = s.state.buildings.get(id)!
    expect(site.kind).toBe('site')
    expect(site.reveal).toBe(b.phase === 'building' ? (7 - b.workRemaining) / 7 : 0)
    until(s, () => b.phase === 'active', 4000)
    expect(scene(s, { player: 1 }).find(i => i.entity === id)).toMatchObject({ kind: 'building', sprite: 'building:sawmill' })
  }, 30_000)

  test('a paused simulation draws the same scene: nothing moves or works on its own', () => {
    const s = session()
    place(s, 'woodcutter', anchors.forest)
    until(s, () => [...s.state.settlers.values()].some(p => p.action === 'walking'), 500)
    const first = scene(s, { player: 1 }), second = scene(s, { player: 1 })
    expect(second).toEqual(first)
    s.advance(1)
    const moved = scene(s, { player: 1 }).filter(i => i.kind === 'settler')
    const before = new Map(first.filter(i => i.kind === 'settler').map(i => [i.entity, i.view]))
    // Only settlers the simulation moved are drawn somewhere else.
    for (const item of moved) {
      const p = s.state.settlers.get(item.entity)!
      if (p.action !== 'walking' && before.has(item.entity) && p.program === null) expect(item.view).toEqual(before.get(item.entity)!)
    }
  })

  test('foreign settlers and buildings never reach the scene outside a player sight', () => {
    const map = generateMap(rules, 96, 64, 4)
    for (const [x, y] of [[20, 30], [76, 30]] as const) for (const t of area(map, { x, y }, 11)) { map.terrain[t] = 0; map.object[t] = 0; map.elevation[t] = 0 }
    const s = createSession({ rules, map, seed: 9, players: [{ name: 'A', civilization: 'roman', start: { x: 20, y: 30 } }, { name: 'B', civilization: 'roman', start: { x: 76, y: 30 } }] })
    s.advance(20)
    const items = scene(s, { player: 1 })
    expect(items.filter(i => i.kind === 'settler' || i.kind === 'building' || i.kind === 'pile').every(i => i.owner === 1)).toBe(true)
    expect(items.some(i => i.view.x === toView(76, 30).x)).toBe(false)
    // An observer-free check of sight: what player two sees is its own business.
    expect(scene(s, { player: 2 }).filter(i => i.kind === 'settler').every(i => i.owner === 2)).toBe(true)
    expect(indexOf(map, 76, 30)).toBeGreaterThan(0)
  })
  test('soldiers wear their rank and show their health; arrows in flight are drawn where they fly', () => {
    const s = createSession({
      rules, map: session().state.map, seed: 1,
      players: [
        { name: 'Rome', civilization: 'roman', start: anchors.castle, scenario: { buildings: [{ type: 'castle', x: 40, y: 40 }], settlers: [{ profession: 'bowman', x: 40, y: 54, rank: 2 }] } },
        { name: 'Enemy', civilization: 'roman', start: anchors.castle, scenario: { buildings: [], settlers: [{ profession: 'pikeman', x: 40, y: 64, rank: 3 }] } },
      ],
    })
    const bowman = [...s.state.settlers.values()].find(p => p.profession === 'bowman')!
    s.enqueue({ tick: 0, player: 1, seq: 0, type: 'move-soldiers', soldiers: [bowman.id], x: 40, y: 54 })
    until(s, () => (s.state.projectiles ?? []).length > 0, 400)
    s.advance(5)
    const items = scene(s, { player: 1 })
    const soldiers = items.filter(i => i.kind === 'settler' && i.rank)
    // The bowman who just shot plays his rank's shot, facing the pikeman to the south-west (sprite direction 0).
    expect(soldiers.map(i => [i.sprite, i.health])).toEqual([['strike:bowman-2', 1], ['soldier:pikeman-3', expect.any(Number)]])
    expect(soldiers[0]!.frame).toBe(0)
    expect(soldiers[0]!.progress).toBeGreaterThan(0)
    expect(soldiers[0]!.progress).toBeLessThan(1)
    const arrow = items.find(i => i.kind === 'arrow')!
    const p = s.state.projectiles![0]!
    expect(arrow.entity).toBe(p.id)
    // Between its ends, raised along a curve.
    expect(arrow.view.y).toBeLessThan(Math.max(arrow.from!.y, arrow.to!.y))
  })
})
