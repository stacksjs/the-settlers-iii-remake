import type { Session } from '../../resources/game/engine'
import { describe, expect, test } from 'bun:test'
import { checksum, createSession, restore, save } from '../../resources/game/engine'
import { anchors, landscape, order, rules, run } from '../fixtures/engine'

/** A castle with a tool smith and a weapon smith that both want coal, and eight coal to share. */
function smiths(): Session {
  const settlers = Array.from({ length: 12 }, (_, i) => ({ profession: 'carrier', x: 36 + (i % 6), y: 48 + Math.floor(i / 6) }))
  return createSession({
    rules, map: landscape(), seed: 2,
    players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle, scenario: { buildings: [{ type: 'castle', x: 40, y: 40 }, { type: 'toolsmith', x: 31, y: 44 }, { type: 'weaponsmith', x: 50, y: 46 }], settlers } }],
    piles: [{ good: 'coal', x: 38, y: 52, amount: 8 }],
  })
}
const coalAt = (s: Session, type: string): number => [...s.state.stacks.values()].filter(st => st.good === 'coal' && st.role === 'input' && s.state.buildings.get(st.building)?.type === type).reduce((n, st) => n + st.amount + st.reservedIn, 0)

describe('distribution of goods', () => {
  test('equal shares split a good between the building types that use it', () => {
    const s = smiths()
    run(s, 400)
    expect(coalAt(s, 'toolsmith')).toBe(4)
    expect(coalAt(s, 'weaponsmith')).toBe(4)
  })

  test('a share of zero sends a type nothing, and larger shares receive proportionally more', () => {
    const none = smiths()
    order(none, 'settings', { settings: { distribution: { coal: { toolsmith: 0 } } } })
    run(none, 400)
    expect(coalAt(none, 'toolsmith')).toBe(0)
    expect(coalAt(none, 'weaponsmith')).toBe(8)
    const weighted = smiths()
    order(weighted, 'settings', { settings: { distribution: { coal: { toolsmith: 3, weaponsmith: 1 } } } })
    run(weighted, 400)
    expect(coalAt(weighted, 'toolsmith')).toBe(6)
    expect(coalAt(weighted, 'weaponsmith')).toBe(2)
    expect(weighted.state.players[0]!.delivered!.coal).toEqual({ toolsmith: 6, weaponsmith: 2 })
  })

  test('shares are validated and saved', () => {
    const s = smiths()
    const refuse = (distribution: unknown): string => { s.enqueue({ tick: s.state.tick, player: 1, seq: 900 + s.state.tick, type: 'settings', settings: { distribution } }); s.advance(1); return s.state.results.at(-1)!.reason ?? 'accepted' }
    expect(refuse({ coal: { sawmill: 2 } })).toBe('Distribution shares must be 0 to 10 for buildings that use the good.')
    expect(refuse({ coal: { toolsmith: 11 } })).toBe('Distribution shares must be 0 to 10 for buildings that use the good.')
    order(s, 'settings', { settings: { distribution: { coal: { toolsmith: 2 } } } })
    run(s, 100)
    const copy = restore(JSON.parse(JSON.stringify(save(s))), rules)
    s.advance(200); copy.advance(200)
    expect(checksum(copy.state)).toBe(checksum(s.state))
    expect(copy.state.players[0]!.settings.distribution).toEqual({ coal: { toolsmith: 2 } })
  })
})
