import { describe, expect, test } from 'bun:test'
import { createSession, observe } from '../../resources/game/engine'
import { alertTarget, fromMinimap, minimapPixels, minimapSize, PLAYER_RGB, toMinimap } from '../../resources/game/minimap'
import { anchors, landscape, rules } from '../fixtures/engine'

function rivals() {
  return createSession({
    rules, map: landscape(), seed: 1,
    players: [
      { name: 'Rome', civilization: 'roman', start: anchors.castle },
      { name: 'Enemy', civilization: 'roman', start: { x: 82, y: 82 }, scenario: { buildings: [{ type: 'small-tower', x: 82, y: 82 }], settlers: [{ profession: 'swordsman', x: 85, y: 86 }] } },
    ],
  })
}
const pixel = (pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number): number[] => {
  const p = toMinimap({ x, y }, height), size = minimapSize(width, height), i = (p.y * size.width + p.x) * 4
  return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!]
}

describe('overview map', () => {
  test('maps tiles onto the sheared overview and back', () => {
    for (const p of [{ x: 0, y: 0 }, { x: 95, y: 95 }, { x: 40, y: 13 }]) expect(fromMinimap(toMinimap(p, 96), 96)).toEqual(p)
    expect(minimapSize(96, 96)).toEqual({ width: 144, height: 96 })
  })

  test('shows only explored land, and other players only where this player can see them', () => {
    const s = rivals(), o = observe(s, 1)
    const pixels = minimapPixels(o, { territory: 'players', settlers: 'all', buildings: true })
    // The enemy tower and its soldier lie in unexplored land: nothing of theirs reaches the map.
    expect(pixel(pixels, 96, 96, 82, 82)).toEqual([10, 16, 14])
    expect(pixel(pixels, 96, 96, 85, 86)).toEqual([10, 16, 14])
    const enemy = PLAYER_RGB[2]!
    for (let i = 0; i < pixels.length; i += 4) expect([pixels[i], pixels[i + 1], pixels[i + 2]]).not.toEqual(enemy)
    // Rome's own castle is drawn.
    expect(pixel(pixels, 96, 96, anchors.castle.x, anchors.castle.y)).toEqual([247, 16, 0])
  })

  test('switches between player colours, land and sea, and terrain, and between settler displays', () => {
    const s = rivals(), o = observe(s, 1)
    const water = { x: 55, y: 42 }
    expect(pixel(minimapPixels(o, { territory: 'simple', settlers: 'none', buildings: false }), 96, 96, water.x, water.y)).toEqual([46, 86, 140])
    const topo = minimapPixels(o, { territory: 'topographic', settlers: 'none', buildings: false })
    expect(pixel(topo, 96, 96, anchors.mountain.x, anchors.mountain.y)).toEqual([118, 112, 104])
    const carrier = [...s.state.settlers.values()].find(p => p.owner === 1 && p.profession === 'carrier' && !p.inside)!
    const all = minimapPixels(o, { territory: 'simple', settlers: 'all', buildings: false })
    const military = minimapPixels(o, { territory: 'simple', settlers: 'military', buildings: false })
    expect(pixel(all, 96, 96, carrier.x, carrier.y)).toEqual([247, 16, 0])
    expect(pixel(military, 96, 96, carrier.x, carrier.y)).not.toEqual([247, 16, 0])
  })

  test('alerts point at their place only when the player may look there', () => {
    const s = rivals(), o = observe(s, 1), castle = [...s.state.buildings.values()].find(b => b.owner === 1)!
    const tower = [...s.state.buildings.values()].find(b => b.owner === 2)!
    expect(alertTarget(o, { tile: 40 * 96 + 40 })).toEqual({ x: 40, y: 40 })
    expect(alertTarget(o, { tile: 82 * 96 + 82 })).toBeNull()
    expect(alertTarget(o, { entity: castle.id })).toEqual({ x: castle.x, y: castle.y })
    expect(alertTarget(o, { entity: tower.id })).toBeNull()
    expect(alertTarget(o, {})).toBeNull()
  })
})

test('player identity uses the reference red and blue palette, rather than prototype minimap colors', () => {
  const s = rivals(), o = observe(s, 1)
  expect(pixel(minimapPixels(o, { territory: 'players', settlers: 'all', buildings: true }), 96, 96, anchors.castle.x, anchors.castle.y)).toEqual([247, 16, 0])
})
