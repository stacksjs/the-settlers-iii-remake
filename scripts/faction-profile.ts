// Generates resources/game/engine/profiles/egyptian-engineering-<version>.json.
//
// A civilization's engineering profile is the Roman one with that civilization's
// buildings: the manual's construction costs (class M) and the reference
// remake's geometry for that civilization (class E) replace the Roman ones, the
// buildings only Romans have go, and the buildings only the civilization has come
// in. Every timing, radius and capacity is still the Roman engineering
// placeholder (class U), because nothing has been observed for either side.
// Nothing here is a claim about the original game. See qualificationGaps().
import { resolve } from 'node:path'
import process from 'node:process'
import { COMMON, SPECIFIC } from '../resources/game/engine/faction-names'
import { DIRECTIONS } from '../resources/game/engine/geometry'
import { MANUAL_CONSTRUCTION } from '../resources/game/engine/manual-construction'
import { REFERENCE_FACTIONS } from '../resources/game/engine/reference-factions'
import { REFERENCE_GEOMETRY } from '../resources/game/engine/reference-geometry'
import { defineFrom, ROMAN_ENGINEERING, validateRules } from '../resources/game/engine/rules'
import type { BuildingRule, Evidence, Goods, ReferenceSource, RulesProfile } from '../resources/game/engine/rules'
import type { Cost, Race } from '../resources/game/engine/faction-names'

const REVISION = '6ad8c4230a4aa4cd21840f8cb59a38344e41c3e0'
const MANUAL = 'https://github.com/JakeSteam/settlers/blob/8426388935b436e65b0697ac401c4247ab097364/en/ec_build/building.htm'
const MANUAL_SHA = '10dcbad8d7c02a7873b263f1db81e7561368467f429c4b6b6113758122d65a9e'
const reference = REFERENCE_FACTIONS as unknown as Record<Race, Record<string, ReferenceSource & { sha256: string }>>
const manual = MANUAL_CONSTRUCTION as unknown as { common: Record<string, Record<Race, Cost>>, specific: Record<Race, Record<string, Cost>> }
const doorstep = (good: string): Goods => ({ [good]: 8 })

/** Wood (planks) and stone the manual prices the civilization's building at, from the reference file that names it. */
export function manualCost(race: Race, file: string): Goods {
  const common = COMMON[file], name = common ?? SPECIFIC[race][file]
  const cost = name ? (common ? manual.common[name]?.[race] : manual.specific[race][name]) : undefined
  if (!cost) throw new RangeError(`The manual has no ${race} price for ${file}`)
  return Object.fromEntries(Object.entries({ plank: cost[0], stone: cost[1] }).filter(([, n]) => n > 0))
}

export interface Own { id: string, name: string, category: string, file: string, worker: string | null, rest: Partial<BuildingRule> }

/**
 * A civilization's profile. `drop` names the Roman buildings it lacks, `own` the
 * buildings only it has, `goods` how reference goods are called in the engine.
 */
export function factionProfile(race: Exclude<Race, 'roman'>, options: {
  version: string, description: string, drop: string[], dropObjects: string[], dropProfessions: string[], dropGoods: string[]
  addGoods: string[], addObjects: RulesProfile['objects'], addProfessions: RulesProfile['professions'], own: Own[], goods: Record<string, string>, offering: string
  rename: Record<string, string>, evidence: Record<string, Evidence>, dropEvidence: RegExp
}): RulesProfile {
  const files = reference[race]
  const romanFile = (id: string): string | undefined => (REFERENCE_GEOMETRY as Record<string, { file: string }>)[id]?.file
  const buildings: BuildingRule[] = []
  let doorOverride = false
  for (const roman of ROMAN_ENGINEERING.buildings) {
    if (options.drop.includes(roman.id)) continue
    const file = romanFile(roman.id)
    const source = file ? files[file] : undefined
    if (!file || !source) throw new RangeError(`${race} has no reference definition for ${roman.id}`)
    // The Roman rule minus everything the reference defines per civilization: the civilization's own geometry replaces it whole.
    const { footprint: _f, protected: _p, door: _d, piles: _i, builders: _b, groundBorder: _g, ground: _r, footprintGround: _o, cost: _c, ...spec } = roman
    const built = { ...defineFrom({ ...spec, name: options.rename[roman.id] ?? roman.name, cost: manualCost(race, file) } as never, source, options.goods),
      ...(roman.id === 'small-temple' ? { inputs: doorstep(options.offering) } : {}) } as BuildingRule
    // Some reference temples put the door inside the footprint, where it only marks the offering bowl. As for the Roman small temple, the engine uses a tile at the offering bowl as the entrance.
    if (roman.id === 'small-temple' && built.footprint.some(([x, y]) => x === built.door[0] && y === built.door[1])) {
      const bowl = built.piles.find(pile => pile.role === 'input')
      if (!bowl) throw new RangeError(`${race} temple has neither a usable door nor an offering pile`)
      // The nearest tile that borders the footprint, to the bowl; ties go to the lower coordinates so the result is stable.
      const cells = new Set(built.footprint.map(([x, y]) => `${x},${y}`))
      const borders = (x: number, y: number): boolean => !cells.has(`${x},${y}`) && built.footprint.some(([fx, fy]) => DIRECTIONS.some(([dx, dy]) => fx + dx === x && fy + dy === y))
      const candidates: [number, number, number][] = []
      for (const [fx, fy] of built.footprint) for (const [dx, dy] of DIRECTIONS) {
        const x = fx + dx, y = fy + dy
        if (borders(x, y)) candidates.push([x, y, Math.abs(x - bowl.at[0]) + Math.abs(y - bowl.at[1])])
      }
      candidates.sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1])
      built.door = [candidates[0]![0], candidates[0]![1]]
      doorOverride = true
    }
    buildings.push(built)
  }
  for (const own of options.own) {
    const source = files[own.file]
    if (!source) throw new RangeError(`${race} has no reference definition for ${own.file}`)
    buildings.push(defineFrom({ id: own.id, name: own.name, category: own.category, cost: manualCost(race, own.file), worker: own.worker, ...own.rest } as never, source, options.goods))
  }
  const evidence: Record<string, Evidence> = {}
  for (const [path, item] of Object.entries(ROMAN_ENGINEERING.evidence)) if (!options.dropEvidence.test(path)) evidence[path] = item
  for (const building of buildings) {
    const file = options.own.find(o => o.id === building.id)?.file ?? romanFile(building.id)!
    evidence[`buildings.${building.id}.cost`] = { class: 'M', source: `${MANUAL}#Table of Building Materials (sha256 ${MANUAL_SHA})`, note: `${race} wood (planks) and stone columns of the building material tables.`, owner: 'S3-032' }
    evidence[`buildings.${building.id}.geometry`] = { class: 'E', source: `https://github.com/paulwedeck/settlers-remake/tree/${REVISION}/jsettlers.common/src/main/resources/jsettlers/common/buildings/${race} (sha256 ${files[file]!.sha256})`, note: `Blocked and protected tiles, door, pile positions and builder spots from the reference remake's ${race} definition; not yet compared with the original game.` }
    evidence[`buildings.${building.id}.timing`] = { class: 'U', source: 'engineering placeholder; not an original value', note: 'Levelling, construction and work-cycle durations are unobserved.', owner: 'S3-032' }
  }
  const dropped = new Set(options.drop)
  for (const path of Object.keys(evidence)) { const id = /^buildings\.([a-z-]+)\./.exec(path)?.[1]; if (id && dropped.has(id)) delete evidence[path] }
  if (doorOverride) evidence['buildings.small-temple.door'] = { class: 'U', source: 'engineering placeholder; not an original value', note: `The reference places the ${race} small temple door inside its footprint, where it only marks the offering bowl; the engine uses the nearest tile that borders the footprint to the offering bowl as the entrance until the original is observed.`, owner: 'S3-057' }
  Object.assign(evidence, options.evidence)
  const base = ROMAN_ENGINEERING
  return validateRules({
    ...base,
    id: `${race}-engineering`,
    version: options.version,
    description: options.description,
    goods: [...base.goods.filter(g => !options.dropGoods.includes(g)), ...options.addGoods],
    objects: [...base.objects.filter(o => !options.dropObjects.includes(o.id)), ...options.addObjects],
    professions: [...base.professions.filter(p => !options.dropProfessions.includes(p.id)), ...options.addProfessions],
    buildings,
    religion: base.religion ? { ...base.religion, offering: options.offering, interventions: undefined, castDistance: undefined } : undefined,
    evidence,
  } as RulesProfile)
}

export const EGYPTIAN_VERSION = '0.1.0'
export const ASIAN_VERSION = '0.1.0'
export const AMAZON_VERSION = '0.1.0'

const at = (race: Race, file: string): string => `https://github.com/paulwedeck/settlers-remake/blob/${REVISION}/jsettlers.common/src/main/resources/jsettlers/common/buildings/${race}/${file}.xml`
const E = (source: string, note: string): Evidence => ({ class: 'E', source, note })
const U = (note: string, owner: string): Evidence => ({ class: 'U', source: 'engineering placeholder; not an original value', note, owner })
const mine = (id: string, name: string, file: string, output: string, food: string[]): Own => ({ id, name, category: 'Metal', file, worker: 'miner', rest: {
  inputs: { bread: 8, meat: 8, fish: 8 }, outputs: doorstep(output),
  workflow: { kind: 'extract' as const, resource: output, output, work: 70, radius: 2, food: { preferred: food[0]!, accepted: ['bread', 'meat', 'fish'].filter(g => g !== food[0]), preferredCycles: 10, otherCycles: 2 } },
} })
const noWine = /^(buildings\.(winery|charcoal-maker|small-temple\.door|barracks\.cost-discrepancy)|objects\.vine|religion\.interventions)/
const interventions = (race: string, owner: string): [string, Evidence] => ['religion.interventions', U(`The ${race} divine interventions are not implemented; this profile has none until they are observed.`, owner)]

/** The Egyptian engineering profile: no wine or charcoal; a brewery for kegs (the Sphinx's offering) and a gem mine. */
export function egyptianProfile(): RulesProfile {
  const brewery: Own = { id: 'brewery', name: 'Brewery', category: 'Egyptian', file: 'brewery', worker: 'brewer', rest: {
    inputs: { grain: 8, water: 8 }, outputs: doorstep('keg'), workflow: { kind: 'process' as const, inputs: { grain: 1, water: 1 }, outputs: { keg: 1 }, work: 60 },
  } }
  return factionProfile('egyptian', {
    version: EGYPTIAN_VERSION,
    description: 'Egyptian economy mechanics: manual-candidate costs, reference geometry and the Roman engineering placeholders for every unobserved value.',
    drop: ['winery', 'charcoal-maker'], dropObjects: ['vine', 'ripe-vine'], dropProfessions: ['winegrower', 'charcoal-burner'], dropGoods: ['wine'],
    addGoods: ['keg', 'gems'], addObjects: [], addProfessions: [{ id: 'brewer', tool: null, specialist: false }],
    own: [brewery, mine('gem-mine', 'Gem mine', 'gemsmine', 'gems', ['meat'])],
    goods: { 'reference:KEG': 'keg', 'reference:GEMS': 'gems' }, offering: 'keg',
    rename: { 'small-temple': 'Sphinx', 'large-temple': 'Pyramid' }, dropEvidence: noWine,
    evidence: Object.fromEntries([
      ['goods', { class: 'M', source: 'docs/roadmap/evidence.md (jops.htm)', note: 'Egyptian goods follow the Roman chains with kegs from the brewery for the Sphinx and gems from the gem mine; the complete catalog requires decoded content.', owner: 'S3-059' } as Evidence],
      interventions('Egyptian', 'S3-059'),
      ['religion.offerings', E(at('egyptian', 'temple'), 'The Sphinx takes kegs as its offering, as the reference defines; the manual names the Egyptian small temple and its offering only in general terms.')],
      ['buildings.brewery.recipe', E(at('egyptian', 'brewery'), 'The brewery requests grain and water and offers kegs; quantities per cycle are unobserved.')],
      ['buildings.gem-mine.recipe', E(at('egyptian', 'gemsmine'), 'The gem mine requests fish, meat and bread and offers gems, as the reference defines; preferred meal and cycles are unobserved.')],
    ]),
  })
}

/** The Asian engineering profile: rice and liquor in place of wine, a sulfur mine, and no charcoal. Gunpowder and cannons are not in the reference. */
export function asianProfile(): RulesProfile {
  const grain = ROMAN_ENGINEERING.buildings.find(b => b.id === 'grain-farm')!.workflow
  if (grain.kind !== 'cultivate') throw new RangeError('The Roman grain farm is expected to cultivate')
  const riceFarm: Own = { id: 'rice-farm', name: 'Rice farm', category: 'Asian', file: 'rice_farm', worker: 'rice-farmer', rest: {
    outputs: doorstep('rice'), workflow: { ...grain, plant: 'rice-field', ripe: 'ripe-rice', output: 'rice' },
  } }
  const distillery: Own = { id: 'distillery', name: 'Distillery', category: 'Asian', file: 'distillery', worker: 'distiller', rest: {
    inputs: { rice: 8, coal: 8 }, outputs: doorstep('liquor'), workflow: { kind: 'process' as const, inputs: { rice: 1, coal: 1 }, outputs: { liquor: 1 }, work: 60 },
  } }
  return factionProfile('asian', {
    version: ASIAN_VERSION,
    description: 'Asian economy mechanics: manual-candidate costs, reference geometry and the Roman engineering placeholders for every unobserved value.',
    drop: ['winery', 'charcoal-maker'], dropObjects: ['vine', 'ripe-vine'], dropProfessions: ['winegrower', 'charcoal-burner'], dropGoods: ['wine'],
    addGoods: ['rice', 'liquor', 'sulfur'],
    addObjects: [{ id: 'rice-field', blocks: false, amount: 1, grows: { into: 'ripe-rice', ticks: 1600 } }, { id: 'ripe-rice', blocks: false, amount: 1 }],
    addProfessions: [{ id: 'rice-farmer', tool: 'scythe', specialist: false }, { id: 'distiller', tool: null, specialist: false }],
    own: [riceFarm, distillery, mine('sulfur-mine', 'Sulfur mine', 'sulfurmine', 'sulfur', ['bread'])],
    goods: { 'reference:RICE': 'rice', 'reference:LIQUOR': 'liquor', 'reference:SULFUR': 'sulfur' }, offering: 'liquor',
    rename: { 'small-temple': 'Small pagoda', 'large-temple': 'Large pagoda' }, dropEvidence: noWine,
    evidence: Object.fromEntries([
      ['goods', { class: 'M', source: 'docs/roadmap/evidence.md (jops.htm)', note: 'Asian goods follow the Roman chains with rice and liquor in place of wine and sulfur from the sulfur mine; the complete catalog requires decoded content.', owner: 'S3-060' } as Evidence],
      interventions('Asian', 'S3-060'),
      ['religion.offerings', E(at('asian', 'temple'), 'The small pagoda takes liquor as its offering, as the reference defines.')],
      ['objects.rice', U('Rice growth time is the Roman grain placeholder; planting ground is the grain farm\'s.', 'S3-060')],
      ['buildings.rice-farm.recipe', E(at('asian', 'rice_farm'), 'The rice farm offers rice; cultivation follows the grain farm placeholders.')],
      ['buildings.distillery.recipe', E(at('asian', 'distillery'), 'The distillery requests rice and coal and offers liquor; quantities per cycle are unobserved.')],
      ['buildings.sulfur-mine.recipe', E(at('asian', 'sulfurmine'), 'The sulfur mine offers sulfur; the reference also lists rice among its requests, which this profile does not require. Nothing in the reference uses the sulfur yet: the Asian gunpowder maker and cannon hall are not defined there.')],
    ]),
  })
}

/** The Amazon engineering profile: honey and mead in place of wine, an alchemist's den, gem and sulfur mines, and no charcoal. */
export function amazonProfile(): RulesProfile {
  const beekeeper: Own = { id: 'beekeeper', name: "Beekeeper's hut", category: 'Amazon', file: 'beekeeping', worker: 'beekeeper', rest: {
    outputs: doorstep('honey'), workflow: { kind: 'process' as const, inputs: {}, outputs: { honey: 1 }, work: 200 },
  } }
  const meadBrewery: Own = { id: 'mead-brewery', name: "Mead maker's works", category: 'Amazon', file: 'mead_brewery', worker: 'mead-brewer', rest: {
    inputs: { water: 8, honey: 8 }, outputs: doorstep('mead'), workflow: { kind: 'process' as const, inputs: { water: 1, honey: 1 }, outputs: { mead: 1 }, work: 60 },
  } }
  const alchemist: Own = { id: 'alchemist', name: "Alchemist's den", category: 'Amazon', file: 'laboratory', worker: 'alchemist', rest: {
    inputs: { sulfur: 8, gems: 8 }, outputs: { iron: 8, gold: 8 }, workflow: { kind: 'craft' as const, inputs: { sulfur: 1, gems: 1 }, choices: ['iron', 'gold'], work: 120 },
  } }
  return factionProfile('amazon', {
    version: AMAZON_VERSION,
    description: 'Amazon economy mechanics: manual-candidate costs, reference geometry and the Roman engineering placeholders for every unobserved value.',
    drop: ['winery', 'charcoal-maker'], dropObjects: ['vine', 'ripe-vine'], dropProfessions: ['winegrower', 'charcoal-burner'], dropGoods: ['wine'],
    addGoods: ['honey', 'mead', 'sulfur', 'gems'], addObjects: [],
    addProfessions: [{ id: 'beekeeper', tool: null, specialist: false }, { id: 'mead-brewer', tool: null, specialist: false }, { id: 'alchemist', tool: null, specialist: false }],
    own: [beekeeper, meadBrewery, alchemist, mine('gem-mine', 'Gem mine', 'gemsmine', 'gems', ['meat']), mine('sulfur-mine', 'Sulfur mine', 'sulfurmine', 'sulfur', ['bread'])],
    goods: { 'reference:HONEY': 'honey', 'reference:MEAD': 'mead', 'reference:SULFUR': 'sulfur', 'reference:GEMS': 'gems' }, offering: 'mead',
    rename: {}, dropEvidence: noWine,
    evidence: Object.fromEntries([
      ['goods', { class: 'M', source: 'docs/roadmap/evidence.md (jops.htm)', note: 'Amazon goods follow the Roman chains with honey and mead in place of wine, gems and sulfur from their mines, and metal from the alchemist; the complete catalog requires decoded content.', owner: 'S3-061' } as Evidence],
      interventions('Amazon', 'S3-061'),
      ['religion.offerings', E(at('amazon', 'temple'), 'The temple takes mead as its offering, as the reference defines.')],
      ['buildings.beekeeper.recipe', E(at('amazon', 'beekeeping'), 'The beekeeper offers honey with no input; the cycle time is a placeholder.')],
      ['buildings.mead-brewery.recipe', E(at('amazon', 'mead_brewery'), 'The mead maker requests water and honey and offers mead; quantities per cycle are unobserved.')],
      ['buildings.alchemist.recipe', E(at('amazon', 'laboratory'), 'The alchemist requests sulfur and gems and offers iron and gold, as the reference defines; the exchange rate is unobserved. The manual calls the building the Alchemist\'s Den.')],
      ['buildings.gem-mine.recipe', E(at('amazon', 'gemsmine'), 'The gem mine requests fish, meat and bread and offers gems; preferred meal and cycles are unobserved.')],
      ['buildings.sulfur-mine.recipe', E(at('amazon', 'sulfurmine'), 'The sulfur mine requests bread and offers sulfur; the reference also lists honey among its requests, which this profile does not require.')],
    ]),
  })
}

export const PROFILES = [egyptianProfile, asianProfile, amazonProfile]

if (import.meta.main) {
  for (const build of PROFILES) {
    const profile = build()
    await Bun.write(resolve(import.meta.dir, `../resources/game/engine/profiles/${profile.id}-${profile.version}.json`), `${JSON.stringify(profile)}\n`)
    console.log(`Wrote ${profile.id} ${profile.version}: ${profile.buildings.length} buildings.`)
  }
  void process
}
