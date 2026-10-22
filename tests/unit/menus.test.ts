import { describe, expect, test } from 'bun:test'
import { catalog } from '../../resources/game/controller'
import { BUILDING_MENU, chooseMenu, initialMenu, MENUS, openMenu } from '../../resources/game/menus'
import { order, rules, session } from '../fixtures/engine'

describe('control center', () => {
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
    for (const b of rules.buildings.filter(b => b.id !== 'castle')) expect(MENUS.buildings as readonly string[]).toContain(BUILDING_MENU[b.id])
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
