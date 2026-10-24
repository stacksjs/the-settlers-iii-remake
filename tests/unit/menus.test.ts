import { describe, expect, test } from 'bun:test'
import { catalog, snapshot } from '../../resources/game/controller'
import { checksum, restore, save } from '../../resources/game/engine'
import { BUILDING_MENU, chooseMenu, initialMenu, MENUS, openMenu } from '../../resources/game/menus'
import { anchors, order, place, present, rules, session, until } from '../fixtures/engine'

describe('control center', () => {
  test('production figures follow actual work, exclude starting and enemy goods, and survive a checkpoint', () => {
    const s = session({ players: [
      { name: 'Rome', civilization: 'roman', start: anchors.castle, goods: { log: 20, plank: 50, stone: 50, hammer: 4, shovel: 4, saw: 2 } },
      { name: 'Rival', civilization: 'roman', start: { x: 76, y: 76 }, goods: { gold: 77, log: 20, plank: 50, stone: 50, hammer: 4, shovel: 4, saw: 2 } },
    ] })
    expect(snapshot(null, null, '', 1).production).toEqual([])
    const before = snapshot(s, null, '', 1).production
    expect(before).toBeArray()
    expect(before.find(g => g.key === 'plank')).toMatchObject({ stock: 50, produced: 0, consumed: 0 })
    expect(before.find(g => g.key === 'gold')?.stock).toBe(0)
    place(s, 'sawmill', anchors.west)
    place(s, 'sawmill', { x: 66, y: 78 }, 2)
    until(s, () => (s.state.ledger[1]!.produced.plank ?? 0) >= 4 && (s.state.ledger[2]!.produced.plank ?? 0) >= 4, 12000)
    const hash = checksum(s.state), stock = present(s, 1)
    const produced = snapshot(s, null, '', 1).production
    expect(produced.find(g => g.key === 'plank')?.produced).toBeGreaterThanOrEqual(4)
    expect(produced.find(g => g.key === 'plank')?.produced).toBe(s.state.ledger[1]!.produced.plank)
    expect(produced.find(g => g.key === 'plank')?.produced).not.toBe(s.state.ledger[1]!.produced.plank! + s.state.ledger[2]!.produced.plank!)
    expect(produced.find(g => g.key === 'log')?.consumed).toBeGreaterThan(0)
    for (const row of produced) expect(row.stock).toBe(stock[row.key] ?? 0)
    expect(checksum(s.state)).toBe(hash)
    const loaded = restore(save(s), rules)
    expect(snapshot(loaded, null, '', 1).production).toEqual(produced)
    expect(checksum(loaded.state)).toBe(hash)
  })

  test('replays the manual navigation: three main menus, their sub-menus, and the last sub-menu remembered', () => {
    let m = initialMenu()
    expect(m).toMatchObject({ main: 'buildings', sub: 'resources' })
    m = chooseMenu(m, 'military')
    m = openMenu(m, 'goods')
    expect(m).toMatchObject({ main: 'goods', sub: 'inventory' })
    m = chooseMenu(m, 'transport')
    m = openMenu(m, 'settlers')
    expect(m).toMatchObject({ main: 'settlers', sub: 'statistics' })
    m = openMenu(m, 'goods')
    expect(m.sub).toBe('transport')
    m = openMenu(m, 'buildings')
    expect(m.sub).toBe('military')
    // A sub-menu of another menu, or an unknown menu, changes nothing.
    expect(chooseMenu(m, 'transport')).toBe(m)
    expect(openMenu(m, 'diplomacy')).toBe(m)
  })

  test('every building the player can place appears in exactly one Buildings sub-menu', () => {
    for (const b of rules.buildings.filter(b => b.id !== 'castle')) {
      const menu = BUILDING_MENU[b.id]
      if (menu === undefined) throw new Error(`Placeable building ${b.id} has no control center menu`)
      expect(MENUS.buildings as readonly string[]).toContain(menu)
    }
    expect(catalog.every(item => (MENUS.buildings as readonly string[]).includes(item.menu))).toBe(true)
    // The manual's contents: mines and the tool smith under resources, the weapon smith under military, temples under misc.
    expect(BUILDING_MENU['iron-mine']).toBe('resources')
    expect(BUILDING_MENU.toolsmith).toBe('resources')
    expect(BUILDING_MENU.weaponsmith).toBe('military')
    expect(BUILDING_MENU['small-temple']).toBe('misc')
  })

  test('weapons take urgent orders and priorities like tools', () => {
    const s = session()
    order(s, 'urgent-tool', { tool: 'bow' })
    order(s, 'settings', { settings: { toolWeights: { sword: 4 } } })
    expect(s.state.players[0]!.settings.urgentTools).toEqual(['bow'])
    expect(s.state.players[0]!.settings.toolWeights.sword).toBe(4)
    s.enqueue({ tick: s.state.tick, player: 1, seq: 900, type: 'urgent-tool', tool: 'wine' })
    s.advance(1)
    expect(s.state.results.at(-1)!.reason).toBe('Unknown tool order.')
  })
})
