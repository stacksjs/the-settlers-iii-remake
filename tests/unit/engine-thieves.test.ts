import type { Session } from '../../resources/game/engine'
import { describe, expect, test } from 'bun:test'
import { audit, checksum, createSession, restore, save } from '../../resources/game/engine'
import { createTroops } from '../../resources/game/troops'
import { anchors, conserved, landscape, order, place, rules, run, until } from '../fixtures/engine'

type Placed = { profession: string, x: number, y: number }
const tile = (x: number, y: number): number => y * 96 + x

/** Rome at the castle with its own people; the enemy holds a castle to the east with a pile of planks before it. */
function border(enemy: Placed[] = [], romeSettlers: Record<string, number> = { carrier: 20, digger: 2, builder: 2 }): Session {
  return createSession({
    rules, map: landscape(), seed: 8,
    players: [
      { name: 'Rome', civilization: 'roman', start: anchors.castle, settlers: romeSettlers },
      { name: 'Enemy', civilization: 'roman', start: { x: 80, y: 40 }, scenario: { buildings: [{ type: 'castle', x: 80, y: 40 }], settlers: enemy } },
    ],
    piles: [{ good: 'plank', x: 74, y: 46, amount: 6 }],
  })
}
const thief = (s: Session) => [...s.state.settlers.values()].find(p => p.owner === 1 && p.profession === 'thief')!

describe('thieves', () => {
  test('carriers become thieves without a tool, keeping the carrier ratio, and pass for carriers with other players', () => {
    const s = border()
    const carriers = (): number => [...s.state.settlers.values()].filter(p => p.owner === 1 && p.profession === 'carrier').length
    const before = carriers()
    order(s, 'thieves', { count: 1 })
    expect(carriers()).toBe(before - 1)
    const t = thief(s)
    expect(t.tool).toBeNull()
    expect(t.thief).toMatchObject({ health: 100, uncovered: [], steal: false })
    // The enemy sees a carrier wherever it can see him.
    s.state.players[1]!.visible.fill(1)
    expect(s.view(2).settlers.find(p => p.id === t.id)!.profession).toBe('carrier')
    expect(s.view(1).settlers.find(p => p.id === t.id)!.profession).toBe('thief')
  })

  test('a pilfering thief takes one good from foreign land, walks home slowly and sets it down on his own land', () => {
    const s = border()
    order(s, 'thieves', { count: 1 })
    const t = thief(s), home = { x: t.x, y: t.y }
    order(s, 'thief', { thief: t.id, x: 74, y: 46, steal: true })
    until(s, () => t.cargo === 'plank', 3000)
    expect(s.state.ledger[2]!.lost).toEqual({ plank: 1 })
    expect(s.state.ledger[1]!.gained).toEqual({ plank: 1 })
    // Each step home takes twice as long while he carries the loot.
    until(s, () => t.action === 'walking', 50)
    expect(t.stepTicks % 2).toBe(0)
    expect(t.stepTicks).toBeGreaterThanOrEqual(2 * rules.movement.ticksPerStep)
    until(s, () => !t.cargo, 4000)
    expect(s.state.map.owner[tile(t.x, t.y)]).toBe(1)
    expect([...s.state.stacks.values()].some(st => st.owner === 1 && st.good === 'plank' && st.role === 'ground' && st.amount > 0)).toBe(true)
    expect(conserved(s, 1)).toBe(true)
    expect(conserved(s, 2)).toBe(true)
    expect(audit(s.context)).toEqual([])
    void home
  }, 60_000)

  test('a soldier who comes near sees through the disguise and runs the thief down; the loot stays with the thief\'s player', () => {
    const s = border([{ profession: 'swordsman', x: 76, y: 47 }, { profession: 'swordsman', x: 77, y: 47 }, { profession: 'swordsman', x: 78, y: 47 }, { profession: 'swordsman', x: 79, y: 47 }, { profession: 'swordsman', x: 80, y: 47 }, { profession: 'swordsman', x: 81, y: 47 }])
    order(s, 'thieves', { count: 1 })
    const t = thief(s)
    order(s, 'thief', { thief: t.id, x: 74, y: 46, steal: true })
    until(s, () => !s.state.settlers.has(t.id), 6000)
    expect(t.thief!.uncovered).toEqual([2])
    expect(s.state.ledger[1]!.deaths).toBe(1)
    expect(s.state.events.some(e => e.player === 1 && e.type === 'thief-seen')).toBe(true)
    // Whatever he had taken lies where he fell, still his player's.
    expect(conserved(s, 1)).toBe(true)
    expect(conserved(s, 2)).toBe(true)
    expect(audit(s.context)).toEqual([])
  }, 60_000)

  test('another order interrupts a theft, and thieves save and restore with their disguise', () => {
    const s = border()
    order(s, 'thieves', { count: 1 })
    const t = thief(s)
    order(s, 'thief', { thief: t.id, x: 74, y: 46, steal: true })
    run(s, 40)
    order(s, 'thief', { thief: t.id, x: 50, y: 40 })
    expect(t.thief!.steal).toBe(false)
    const copy = restore(JSON.parse(JSON.stringify(save(s))), rules)
    s.advance(300); copy.advance(300)
    expect(checksum(copy.state)).toBe(checksum(s.state))
    expect(t.cargo).toBeNull()
    const refuse = (fields: Record<string, unknown>): string => { s.enqueue({ tick: s.state.tick, player: 1, seq: 9000 + s.state.tick, type: 'thief', ...fields }); s.advance(1); return s.state.results.at(-1)!.reason ?? 'accepted' }
    expect(refuse({ thief: 1, x: 1, y: 1 })).toBe('Choose one of your thieves.')
    expect(refuse({ thief: t.id, x: 1, y: 1, steal: 'yes' })).toBe('Malformed thief order.')
    const tampered = save(s)
    tampered.state.settlers.find(p => p.id === t.id)!.thief!.health = 500
    expect(() => restore(tampered, rules)).toThrow('thief state is invalid')
  })
})

describe('healers', () => {
  function clinic(): { s: Session, hut: number, soldier: number } {
    const s = createSession({
      rules, map: landscape(), seed: 2,
      players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle, settlers: { carrier: 20, digger: 2, builder: 2, healer: 1, swordsman: 2 }, goods: { plank: 30, stone: 30 } }],
    })
    const hut = place(s, 'healers-hut', anchors.west)
    until(s, () => s.state.buildings.get(hut)!.phase === 'active' && !!s.state.buildings.get(hut)!.worker, 6000)
    // A wounded soldier standing outside; the wound is fixture state, the treatment is the game's.
    const soldier = [...s.state.settlers.values()].find(p => p.soldier)!
    order(s, 'move-soldiers', { soldiers: [soldier.id], x: 46, y: 46 })
    until(s, () => !soldier.inside && soldier.soldier!.order === -2, 600)
    soldier.soldier!.health = 40
    return { s, hut, soldier: soldier.id }
  }

  test('the healer calls the wounded soldier to his hut and restores full health', () => {
    const { s, hut, soldier } = clinic()
    const p = s.state.settlers.get(soldier)!
    until(s, () => p.soldier!.treatment === hut, 200)
    until(s, () => p.soldier!.health === 100, 3000)
    expect(p.soldier!.treatment).toBeUndefined()
    expect(s.state.events.some(e => e.type === 'healed')).toBe(true)
    expect(audit(s.context)).toEqual([])
  }, 60_000)

  test('a move order interrupts the treatment, and TAB keeps only wounded soldiers marked', () => {
    const { s, hut, soldier } = clinic()
    const p = s.state.settlers.get(soldier)!
    until(s, () => p.soldier!.treatment === hut, 200)
    order(s, 'move-soldiers', { soldiers: [soldier], x: 50, y: 50, mode: 'forced' })
    expect(p.soldier!.treatment).toBeUndefined()
    expect(p.soldier!.health).toBe(40)
    const troops = createTroops(() => s, 1), healthy = [...s.state.settlers.values()].find(x => x.soldier && x.id !== soldier)!
    troops.band([soldier, healthy.id])
    troops.wounded()
    expect(troops.selected()).toEqual([soldier])
  }, 60_000)
})
