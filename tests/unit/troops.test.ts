import type { Command, Session } from '../../resources/game/engine'
import { describe, expect, test } from 'bun:test'
import { createSession } from '../../resources/game/engine'
import { createTroops, TYPE_RADIUS } from '../../resources/game/troops'
import { anchors, landscape, rules } from '../fixtures/engine'

function battlefield(): Session {
  return createSession({
    rules, map: landscape(), seed: 1,
    players: [
      { name: 'Rome', civilization: 'roman', start: anchors.castle, scenario: { buildings: [], settlers: [
        { profession: 'swordsman', x: 30, y: 70 }, { profession: 'swordsman', x: 31, y: 70 }, { profession: 'pikeman', x: 32, y: 70 },
        { profession: 'bowman', x: 30, y: 72 }, { profession: 'bowman', x: 31, y: 73 }, { profession: 'bowman', x: 30 + TYPE_RADIUS + 4, y: 72 },
      ] } },
      { name: 'Enemy', civilization: 'roman', start: { x: 80, y: 40 }, scenario: { buildings: [{ type: 'small-tower', x: 80, y: 40 }], settlers: [{ profession: 'swordsman', x: 82, y: 44 }] } },
    ],
  })
}
const ids = (s: Session, profession: string, owner = 1): number[] => [...s.state.settlers.values()].filter(p => p.owner === owner && p.profession === profession).map(p => p.id)

describe('troop selection and orders', () => {
  test('replays the marking sequence from the manual: rectangle, SHIFT to add, ALT for one type, and a click on nothing to clear', () => {
    const s = battlefield(), troops = createTroops(() => s, 1)
    const [sword1, sword2] = ids(s, 'swordsman'), [pike] = ids(s, 'pikeman'), [bow1, bow2, farBow] = ids(s, 'bowman')
    if (sword1 === undefined || sword2 === undefined || pike === undefined || bow1 === undefined || bow2 === undefined || farBow === undefined)
      throw new Error('The marking fixture requires two swordsmen, one pikeman and three bowmen')
    troops.band([sword1, sword2])
    expect(troops.selected()).toEqual([sword1, sword2])
    troops.click(pike, { shift: true })
    expect(troops.selected()).toEqual([sword1, sword2, pike])
    // ALT marks every bowman nearby, but not one beyond the type radius.
    troops.click(bow1, { alt: true })
    expect(troops.selected()).toEqual([bow1, bow2])
    expect(troops.selected()).not.toContain(farBow)
    // Enemies cannot be marked, and a plain click on nothing clears.
    troops.click(ids(s, 'swordsman', 2)[0]!, {})
    expect(troops.selected()).toEqual([])
    troops.band([sword1]); troops.click(null)
    expect(troops.selected()).toEqual([])
    troops.band([sword1]); troops.click(null, { shift: true })
    expect(troops.selected()).toEqual([sword1])
  })

  test('ALT + number stores a group, the number recalls it, and the number twice centers on it', () => {
    const s = battlefield(), troops = createTroops(() => s, 1)
    const bowmen = ids(s, 'bowman').slice(0, 2)
    troops.band(bowmen)
    expect(troops.key(3, { alt: true })).toBeNull()
    troops.clear()
    expect(troops.key(3)).toBeNull()
    expect(troops.selected()).toEqual(bowmen)
    const center = troops.key(3)!
    const people = bowmen.map(id => s.state.settlers.get(id)!)
    expect(center).toEqual({ x: Math.round((people[0]!.x + people[1]!.x) / 2), y: Math.round((people[0]!.y + people[1]!.y) / 2) })
    // Another group in between restarts the double press.
    expect(troops.key(4)).toBeNull()
    expect(troops.selected()).toEqual([])
    expect(troops.key(3)).toBeNull()
    expect(troops.key(0)).toBeNull()
  })

  test('right-click orders: move, CTRL forced, SHIFT waypoint, ALT patrol, enemy tower attack; the engine accepts each', () => {
    const s = battlefield(), troops = createTroops(() => s, 1)
    const swords = ids(s, 'swordsman')
    expect(troops.order({ x: 40, y: 70 })).toBeNull()
    troops.band(swords)
    const tower = [...s.state.buildings.values()].find(b => b.owner === 2)!
    const orders = [
      troops.order({ x: 40, y: 70 }),
      troops.order({ x: 44, y: 74 }, { shift: true }),
      troops.order({ x: 40, y: 70 }, { ctrl: true }),
      troops.order({ x: 36, y: 66 }, { alt: true }),
      troops.order({ x: tower.x, y: tower.y }),
    ]
    expect(orders).toEqual([
      { type: 'move-soldiers', soldiers: swords, x: 40, y: 70 },
      { type: 'move-soldiers', soldiers: swords, x: 44, y: 74, append: true },
      { type: 'move-soldiers', soldiers: swords, x: 40, y: 70, mode: 'forced' },
      { type: 'move-soldiers', soldiers: swords, x: 36, y: 66, mode: 'patrol' },
      { type: 'attack', soldiers: swords, building: tower.id },
    ])
    // Each move order is a legal command; the attack waits until the tower is in sight.
    let seq = 0
    for (const order of orders.slice(0, 4)) {
      expect(s.enqueue({ ...order!, tick: s.state.tick, player: 1, seq: seq++ } as Command)).toBeNull()
      s.advance(1)
      expect(s.state.results.at(-1)!.ok).toBe(true)
    }
    s.enqueue({ ...orders[4]!, tick: s.state.tick, player: 1, seq: seq++ } as Command)
    s.advance(1)
    expect(s.state.results.at(-1)!.reason).toBe('Choose a visible enemy military building.')
  })

  test('fallen soldiers leave the marked set and their groups', () => {
    const s = battlefield(), troops = createTroops(() => s, 1)
    const [sword1, sword2] = ids(s, 'swordsman')
    if (sword1 === undefined || sword2 === undefined)
      throw new Error('The fallen soldier fixture requires two swordsmen')
    troops.band([sword1, sword2]); troops.key(1, { alt: true })
    s.state.settlers.delete(sword1)
    expect(troops.selected()).toEqual([sword2])
    troops.clear(); troops.key(1)
    expect(troops.selected()).toEqual([sword2])
  })
})
