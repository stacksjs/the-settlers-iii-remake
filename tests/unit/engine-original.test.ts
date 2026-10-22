import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { checksum, createSession, PUBLISHED_RULES, restore, save, worldFromOriginal } from '../../resources/game/engine'
import { decodeOriginalMap } from '../../scripts/lib/s3-map'
import { DEMO_ARCHIVE, loadDemoMaps } from '../../scripts/maps'
import { conserved, rules, run } from '../fixtures/engine'

const archive = existsSync(DEMO_ARCHIVE)

describe('worlds from original maps', () => {
  test.skipIf(!archive)('the demo maps become engine worlds with original terrain, deposits and Roman scenarios', async () => {
    const { maps } = await loadDemoMaps()
    for (const demo of maps) {
      const decoded = decodeOriginalMap(demo.bytes)
      const world = worldFromOriginal(rules, decoded)
      expect(world.map.width).toBe(decoded.area.size)
      // Every landscape code the demo uses is classified; nothing silently becomes grass.
      expect(Object.keys(world.diagnostics).filter(k => k.startsWith('landscape'))).toEqual([])
      const water = rules.terrain.findIndex(t => t.id === 'water')
      const sea = [...decoded.area.landscape].filter(code => code <= 7 || (code >= 96 && code <= 99)).length
      expect(world.map.terrain.filter(t => t === water).length).toBe(sea)
      expect(world.map.object.some(Boolean)).toBe(true)
      expect(world.map.resource.some(Boolean)).toBe(true)
      expect(Math.max(...world.map.elevation)).toBeLessThanOrEqual(Math.round(225 * 127 / 225))
      if (!world.players.length) continue
      const session = createSession({ rules, map: world.map, seed: 1, players: world.players, piles: world.piles, content: { id: demo.path, digest: demo.sha256 } })
      const placed = [...session.state.buildings.values()].length
      if (world.players.some(p => p.scenario?.buildings.length)) expect(placed).toBeGreaterThan(0)
      expect(session.state.map.owner.some(Boolean)).toBe(true)
      run(session, 400)
      for (const p of session.state.players) expect(conserved(session, p.id)).toBe(true)
      const copy = restore(JSON.parse(JSON.stringify(save(session))), rules)
      expect(copy.identity.content).toEqual({ id: demo.path, digest: demo.sha256 })
      copy.advance(20); session.advance(20)
      expect(checksum(copy.state)).toBe(checksum(session.state))
    }
  }, 120_000)

  test('unsupported civilizations and records are reported, not approximated', () => {
    const size = 32, area = { size, elevation: new Uint8Array(size * size).fill(90), landscape: new Uint8Array(size * size).fill(16), objects: new Uint8Array(size * size), resourceType: new Uint8Array(size * size), resourceAmount: new Uint8Array(size * size) }
    area.landscape[5] = 250; area.objects[6] = 40; area.objects[7] = 70; area.objects[8] = 120; area.resourceType[9] = 4; area.resourceAmount[9] = 3
    const world = worldFromOriginal(rules, {
      area,
      players: [{ index: 0, civilization: 3, startX: 5, startY: 5, name: 'Amazons' }, { index: 1, civilization: 0, startX: 20, startY: 20, name: 'Rome' }],
      settlers: [{ player: 1, referenceName: 'BEARER', x: 20, y: 21 }, { player: 1, referenceName: 'SWORDSMAN_L3', x: 20, y: 22 }, { player: 1, referenceName: 'MAGE', x: 20, y: 23 }, { player: 0, referenceName: 'BEARER', x: 5, y: 6 }],
      buildings: [{ player: 1, referenceName: 'TOWER', x: 20, y: 20, soldiers: { archer2: 1, sword1: 0 } }, { player: 1, referenceName: 'WINEGROWER', x: 10, y: 10 }],
      stacks: [{ x: 22, y: 24, referenceName: 'PLANK', amount: 8 }, { x: 22, y: 25, referenceName: 'WINE', amount: 2 }],
    })
    expect(world.players).toHaveLength(1)
    // Soldiers keep their class and rank, including those the map stations in a building.
    expect(world.players[0]!.scenario).toEqual({ buildings: [{ type: 'small-tower', x: 20, y: 20 }], settlers: [{ profession: 'bowman', x: 20, y: 20, rank: 2 }, { profession: 'carrier', x: 20, y: 21 }, { profession: 'swordsman', x: 20, y: 22, rank: 3 }] })
    expect(world.diagnostics).toMatchObject({ 'landscape 250 unmapped; drawn as grass': 1, 'object 40 unclassified': 1, 'player 0 civilization 3 not implemented': 1, 'settler MAGE not represented': 1, 'settlers of unsupported players': 1, 'building WINEGROWER not in the roman-engineering profile': 1, 'pile WINE not in the roman-engineering profile': 1, 'resource gems not in the roman-engineering profile': 1 })
    expect(world.map.elevation[0]).toBe(Math.round(90 * 127 / 225))
    expect(world.map.objectAmount[8]).toBe(6)
    expect(world.map.object[7]).toBe(rules.objects.findIndex(o => o.id === 'tree') + 1)
    const session = createSession({ rules, map: world.map, seed: 2, players: world.players, piles: world.piles })
    expect([...session.state.buildings.values()].map(b => b.type)).toEqual(['small-tower'])
    expect(session.state.ledger[1]!.created).toEqual({ plank: 8 })
    expect(session.skipped).toEqual({})
    const army = [...session.state.settlers.values()].filter(p => p.soldier).map(p => [p.profession, p.soldier!.rank, p.tool])
    expect(army).toEqual([['bowman', 2, 'bow'], ['swordsman', 3, 'sword']])
    // Profiles without soldiers report them instead of approximating them as civilians.
    const older = worldFromOriginal(PUBLISHED_RULES.find(r => !r.military)!, { area, players: [{ index: 1, civilization: 0, startX: 20, startY: 20, name: 'Rome' }], settlers: [{ player: 1, referenceName: 'SWORDSMAN_L1', x: 20, y: 22 }], buildings: [{ player: 1, referenceName: 'TOWER', x: 20, y: 20, soldiers: { spear1: 2 } }], stacks: [] })
    expect(older.diagnostics).toMatchObject({ 'settler SWORDSMAN_L1 not represented': 1, 'garrisoned pikeman not in the roman-engineering profile': 2 })
  })
})
