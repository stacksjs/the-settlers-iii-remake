import { describe, expect, test } from 'bun:test'
import { REFERENCE_REVISION } from '../../resources/game/engine/reference-geometry'
import { REFERENCE_FACTIONS as GENERATED, REFERENCE_FACTIONS_REVISION } from '../../resources/game/engine/reference-factions'
import type { ReferenceGeometry } from '../../scripts/reference-geometry'

const REFERENCE_FACTIONS = GENERATED as unknown as Record<string, Record<string, ReferenceGeometry>>

// The Egyptian, Asian and Amazon building tables are generated from the same
// pinned reference remake as the Roman one. They are class E evidence: what the
// reference defines, not what the original game does. These tests keep the
// generated data honest (complete, from the same revision, internally coherent)
// without claiming more than that.
const civilizations = Object.entries(REFERENCE_FACTIONS)

describe('reference faction building tables', () => {
  test('come from the same pinned revision as the Roman table', () => {
    expect(REFERENCE_FACTIONS_REVISION).toBe(REFERENCE_REVISION)
  })

  test('cover every building the reference defines for the three civilizations', () => {
    expect(Object.keys(REFERENCE_FACTIONS)).toEqual(['egyptian', 'asian', 'amazon'])
    expect(civilizations.map(([name, buildings]) => [name, Object.keys(buildings).length])).toEqual([['egyptian', 36], ['asian', 37], ['amazon', 39]])
  })

  test('every civilization has the shared core buildings and its own', () => {
    for (const [name, buildings] of civilizations) {
      for (const core of ['castle', 'stock', 'tower', 'big_tower', 'lookout_tower', 'lumberjack', 'sawmill', 'stonecutter', 'toolsmith', 'weaponsmith'])
        expect(Object.keys(buildings), `${name} ${core}`).toContain(core)
    }
    // Buildings the Roman table does not have, so the engine cannot treat the factions as Romans with new names.
    expect(Object.keys(REFERENCE_FACTIONS.egyptian!)).toEqual(expect.arrayContaining(['brewery', 'gemsmine', 'donkey_farm', 'market_place', 'harbor', 'dockyard']))
  })

  test('every definition is a coherent building', () => {
    for (const [name, buildings] of civilizations) {
      for (const [file, building] of Object.entries(buildings)) {
        const label = `${name}/${file}`
        expect(building.file, label).toBe(file)
        expect(building.sha256, label).toMatch(/^[0-9a-f]{64}$/)
        expect(building.blocked.length, `${label} blocks something`).toBeGreaterThan(0)
        expect(building.door, label).toHaveLength(2)
        for (const stack of building.construction) {
          expect(stack.required, `${label} construction ${stack.good}`).toBeGreaterThan(0)
          expect(Number.isInteger(stack.required), label).toBe(true)
        }
      }
    }
  })

  test('only the temple has its door inside its own footprint, as the Roman small temple does', () => {
    // A property of the reference data, recorded so any other building doing it is noticed.
    const inside = civilizations.flatMap(([name, buildings]) => Object.entries(buildings)
      .filter(([, building]) => building.blocked.some(tile => tile.join(',') === building.door.join(',')))
      .map(([file]) => `${name}/${file}`))
    expect(inside).toEqual(['amazon/temple'])
  })

  test('buildings that take materials to construct list them, and mines are marked', () => {
    for (const [name, buildings] of civilizations) {
      for (const [file, building] of Object.entries(buildings)) {
        if (file === 'castle' || file === 'stock' || file === 'tower') expect(building.construction.length, `${name}/${file}`).toBeGreaterThan(0)
        if (file.endsWith('mine')) expect(building.mine, `${name}/${file}`).toBe(true)
      }
    }
  })

  test('definition hashes are unique within a civilization', () => {
    for (const [name, buildings] of civilizations) {
      const hashes = Object.values(buildings).map(building => building.sha256)
      expect(new Set(hashes).size, name).toBe(hashes.length)
    }
  })
})
