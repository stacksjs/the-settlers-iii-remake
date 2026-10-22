import { describe, expect, test } from 'bun:test'
import { audit, createSession } from '../../resources/game/engine'
import { anchors, conserved, landscape, order, rules, run, until } from '../fixtures/engine'

describe('specialists', () => {
  test('an idle pioneer returns to carrying and sets his shovel down, and can be sent out again without new settlers', () => {
    const s = createSession({ rules, map: landscape(), seed: 1, players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle, goods: { plank: 10 }, settlers: { carrier: 12, pioneer: 1 } }] })
    const people = s.state.settlers.size
    const pioneer = [...s.state.settlers.values()].find(p => p.profession === 'pioneer')!
    expect(pioneer.tool).toBe('shovel')
    order(s, 'dismiss', { profession: 'pioneer', count: 1 })
    expect(pioneer.profession).toBe('carrier')
    expect(pioneer.tool).toBeNull()
    expect(s.state.ledger[1]!.recovered.shovel).toBe(1)
    expect([...s.state.stacks.values()].some(st => st.good === 'shovel' && st.amount === 1)).toBe(true)
    expect(conserved(s, 1)).toBe(true)
    // Sending a pioneer again equips a carrier with that same shovel.
    order(s, 'specialists', { profession: 'pioneer', x: 60, y: 40, count: 1 })
    until(s, () => [...s.state.settlers.values()].some(p => p.profession === 'pioneer' && p.tool === 'shovel'), 600)
    expect(s.state.settlers.size).toBe(people)
    expect(s.state.ledger[1]!.equipped.shovel).toBe(1)
    // A pioneer at work keeps working.
    run(s, 40)
    s.enqueue({ tick: s.state.tick, player: 1, seq: 900, type: 'dismiss', profession: 'pioneer', count: 1 })
    s.advance(1)
    expect(s.state.results.at(-1)!.reason).toBe('No idle pioneer can return to carrying.')
    expect(audit(s.context)).toEqual([])
  }, 60_000)

  test('thieves return to carrying without their disguise, and other professions cannot be dismissed', () => {
    const s = createSession({ rules, map: landscape(), seed: 1, players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle, settlers: { carrier: 12 } }] })
    order(s, 'thieves', { count: 1 })
    const thief = [...s.state.settlers.values()].find(p => p.profession === 'thief')!
    order(s, 'dismiss', { profession: 'thief', count: 1 })
    expect(thief.profession).toBe('carrier')
    expect(thief.thief).toBeUndefined()
    s.enqueue({ tick: s.state.tick, player: 1, seq: 900, type: 'dismiss', profession: 'swordsman', count: 1 })
    s.advance(1)
    expect(s.state.results.at(-1)!.reason).toBe('Malformed order to return specialists.')
  })
})
