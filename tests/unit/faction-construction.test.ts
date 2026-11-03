import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MANUAL_CONSTRUCTION } from '../../resources/game/engine/manual-construction'
import { REFERENCE_FACTIONS } from '../../resources/game/engine/reference-factions'
import { REFERENCE_GEOMETRY } from '../../resources/game/engine/reference-geometry'
import { ROMAN_ENGINEERING } from '../../resources/game/engine/rules'
import { COMMON, ledger, MANUAL_SHA256, parseManual, RACES, referenceFilesFor, SPECIFIC } from '../../scripts/manual-construction'
import type { LedgerEntry, ManualCosts } from '../../scripts/manual-construction'

// Construction costs per civilization come from two sources that this project
// does not yet let decide each other: the preserved manual (class M) and the
// pinned reference remake (class E). The ledger records where they agree and
// where they do not. These tests keep the generated tables and the ledger
// current, and keep the engine's Roman costs equal to the manual's.
const manual = MANUAL_CONSTRUCTION as unknown as ManualCosts
const referenceFactions = REFERENCE_FACTIONS as unknown as Parameters<typeof ledger>[1]

describe('manual construction costs', () => {
  test('cover the 31 common buildings for all four civilizations', () => {
    expect(Object.keys(manual.common)).toHaveLength(31)
    for (const [name, costs] of Object.entries(manual.common)) {
      expect(Object.keys(costs), name).toEqual([...RACES])
      for (const cost of Object.values(costs)) expect(cost.every(n => Number.isInteger(n) && n >= 0), name).toBe(true)
    }
  })

  test('list each civilization\'s own buildings', () => {
    expect(Object.keys(manual.specific.roman).sort()).toEqual(['Catapult Hall', "Charcoal Maker's Hut", 'Large Temple', 'Small Temple', 'Winery'])
    expect(Object.keys(manual.specific.egyptian).sort()).toEqual(['Ballista Hall', 'Brewery', 'Gem Mine', 'Pyramid', 'Sphinx'])
    expect(Object.keys(manual.specific.asian).sort()).toEqual(['Cannon Hall', 'Distillery', "Gunpowder Maker's Hut", 'Large Pagoda', 'Rice Farm', 'Small Pagoda', 'Sulfur Mine'])
    expect(Object.keys(manual.specific.amazon).sort()).toEqual(["Alchemist's Den", "Beekeeper's Hut", 'Gem Mine', 'Gong Hall', 'Large Temple', "Mead Maker's Works", 'Small Temple', 'Sulfur Mine'])
  })

  test('stay equal to the pinned page: a changed page is refused rather than re-read', () => {
    expect(MANUAL_SHA256).toBe('10dcbad8d7c02a7873b263f1db81e7561368467f429c4b6b6113758122d65a9e')
    expect(() => parseManual('<html>no tables here</html>')).toThrow('expected cost tables')
  })

  test('every name the reference mapping uses is a name the manual prices', () => {
    for (const name of Object.values(COMMON)) expect(manual.common[name], name).toBeDefined()
    for (const race of RACES) for (const name of Object.values(SPECIFIC[race])) expect(manual.specific[race][name], `${race} ${name}`).toBeDefined()
  })
})

describe('the construction ledger', () => {
  const stored = JSON.parse(readFileSync(join(import.meta.dir, '../../docs/content/faction-construction-ledger.json'), 'utf8')) as LedgerEntry[]

  test('is exactly what the two generated tables produce', () => {
    expect(stored).toEqual(ledger(manual, referenceFactions))
  })

  test('records the disagreements between manual and reference without choosing', () => {
    const disagree = stored.filter(entry => entry.agrees === false).map(entry => `${entry.race}/${entry.reference}`)
    // The known Roman barracks conflict (issue 104) is among them, with both values kept.
    expect(disagree).toContain('roman/barrack')
    const barracks = stored.find(entry => entry.race === 'roman' && entry.reference === 'barrack')!
    expect(barracks.manual).toEqual([4, 5])
    expect(barracks.referenceCost).toEqual([5, 4])
    expect(stored.filter(entry => entry.agrees === true).length).toBeGreaterThan(stored.filter(entry => entry.agrees === false).length * 5)
  })

  test('names the buildings only one source has, rather than dropping them', () => {
    const only = stored.filter(entry => entry.agrees === null).map(entry => `${entry.race}:${entry.manualName ?? entry.reference}`).sort()
    expect(only).toEqual(expect.arrayContaining(['asian:Cannon Hall', "asian:Gunpowder Maker's Hut", 'amazon:Gong Hall', 'egyptian:Ballista Hall', 'roman:Catapult Hall', 'roman:donkey_farm']))
  })

  test('every reference definition appears exactly once per civilization', () => {
    for (const race of RACES) {
      const files = stored.filter(entry => entry.race === race && entry.reference).map(entry => entry.reference).sort()
      expect(files, race).toEqual(Object.keys(referenceFactions[race]!).sort())
    }
  })
})

describe('the engine\'s Roman costs', () => {
  test('equal the manual\'s, except where the engine documents otherwise', () => {
    const files = referenceFilesFor(REFERENCE_GEOMETRY)
    const differences: string[] = []
    for (const rule of ROMAN_ENGINEERING.buildings) {
      const file = files[rule.id]
      if (!file) continue
      const name = COMMON[file] ?? SPECIFIC.roman[file]
      const cost = COMMON[file] ? manual.common[name!]?.roman : manual.specific.roman[name!]
      if (!cost) { differences.push(`${rule.id}: not in the manual`); continue }
      if ((rule.cost.plank ?? 0) !== cost[0] || (rule.cost.stone ?? 0) !== cost[1]) differences.push(`${rule.id}: engine ${rule.cost.plank ?? 0}/${rule.cost.stone ?? 0}, manual ${cost[0]}/${cost[1]}`)
    }
    expect(differences).toEqual([])
  })
})
