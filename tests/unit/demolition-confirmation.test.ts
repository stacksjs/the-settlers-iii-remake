import { expect, test } from 'bun:test'
import { prepareDemolition } from '../../resources/game/demolition'
import type { Session } from '../../resources/game/engine'
import { audit, PUBLISHED_RULES, restore, save } from '../../resources/game/engine'
import { anchors, conserved, order, place, session, until } from '../fixtures/engine'

test('a completed workplace remains intact until its one-use confirmation is accepted', () => {
  const s = session({ goods: { plank: 30, stone: 30 } })
  const id = place(s, 'woodcutter', anchors.forest)
  until(s, () => s.state.buildings.get(id)!.phase === 'active', 6000)
  const before = s.checksum(), people = s.state.settlers.size
  const target = prepareDemolition(() => s, 1, id, building => { order(s, 'demolish', { building }); return null })!
  expect(target.name).toBe("Woodcutter's hut")
  expect(s.checksum()).toBe(before)
  expect(target.confirm()).toBeNull()
  expect(s.state.buildings.has(id)).toBe(false)
  expect(s.state.settlers.size).toBe(people)
  expect(conserved(s)).toBe(true)
  expect(audit(s.context)).toEqual([])
  const after = s.checksum()
  expect(target.confirm()).toContain('already been answered')
  expect(s.checksum()).toBe(after)
  expect(s.state.results.filter(result => result.type === 'demolish')).toHaveLength(1)
})

test('abandoning an unfinished site confirmation changes no state or command history', () => {
  const s = session({ goods: { plank: 30, stone: 30 } }), id = place(s, 'sawmill', anchors.west)
  expect(s.state.buildings.get(id)!.phase).not.toBe('active')
  const before = save(s)
  expect(prepareDemolition(() => s, 1, id, () => { throw new Error('Cancellation sent an order') })?.name).toBe('Sawmill')
  expect(save(s)).toEqual(before)
  const target = prepareDemolition(() => s, 1, id, building => { order(s, 'demolish', { building }); return null })!
  expect(target.confirm()).toBeNull()
  expect(s.state.buildings.has(id)).toBe(false)
  expect(conserved(s)).toBe(true)
  expect(audit(s.context)).toEqual([])
})

test('a removed building or replacement session cannot redirect a pending confirmation', () => {
  const s = session({ goods: { plank: 30, stone: 30 } }), first = place(s, 'sawmill', anchors.west), second = place(s, 'woodcutter', anchors.forest)
  let current: Session | null = s
  const send = (building: number) => { order(current!, 'demolish', { building }); return null }
  const removed = prepareDemolition(() => current, 1, first, send)!
  const replaced = prepareDemolition(() => current, 1, second, send)!
  order(s, 'demolish', { building: first })
  const before = s.checksum()
  expect(removed.confirm()).toContain('no longer available')
  expect(s.state.buildings.has(second)).toBe(true)
  expect(s.checksum()).toBe(before)
  current = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
  expect(current.state.buildings.has(second)).toBe(true)
  const restored = current.checksum()
  expect(replaced.confirm()).toContain('no longer available')
  expect(current.checksum()).toBe(restored)
  expect(current.state.results.filter(result => result.type === 'demolish')).toHaveLength(1)
})

test('unavailable, foreign and castle targets cannot create a confirmation; refused orders cannot repeat', () => {
  const s = session({ goods: { plank: 30, stone: 30 } }), id = place(s, 'woodcutter', anchors.forest)
  const send = () => 'That order was refused.'
  expect(prepareDemolition(() => null, 1, id, send)).toBeNull()
  expect(prepareDemolition(() => s, 1, -1, send)).toBeNull()
  expect(prepareDemolition(() => s, 2, id, send)).toBeNull()
  expect(prepareDemolition(() => s, 1, [...s.state.buildings.values()].find(b => b.type === 'castle')!.id, send)).toBeNull()
  const target = prepareDemolition(() => s, 1, id, send)!, before = s.checksum()
  expect(target.confirm()).toBe('That order was refused.')
  expect(target.confirm()).toContain('already been answered')
  expect(s.checksum()).toBe(before)
})

test('a tower captured while confirmation is open cannot be demolished by its former owner', () => {
  const s = session({ players: [
    { name: 'Rome', civilization: 'roman', start: anchors.castle, scenario: { buildings: [{ type: 'small-tower', x: 30, y: 42 }], settlers: [] } },
    { name: 'Enemy', civilization: 'roman', start: { x: 70, y: 40 }, scenario: { buildings: [], settlers: [{ profession: 'swordsman', x: 32, y: 46 }] } },
  ] })
  expect(s.skipped).toEqual({})
  const tower = [...s.state.buildings.values()].find(b => b.type === 'small-tower')!
  const target = prepareDemolition(() => s, 1, tower.id, () => { throw new Error('Former owner issued demolition') })!
  const soldier = [...s.state.settlers.values()].find(p => p.owner === 2 && p.soldier)!
  order(s, 'attack', { soldiers: [soldier.id], building: tower.id }, 2)
  until(s, () => tower.owner === 2, 1000)
  const before = s.checksum()
  expect(target.confirm()).toContain('no longer available')
  expect(s.checksum()).toBe(before)
  expect(s.state.buildings.has(tower.id)).toBe(true)
  expect(audit(s.context)).toEqual([])
})
