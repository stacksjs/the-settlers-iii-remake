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

interface Own { id: string, name: string, category: string, file: string, worker: string | null, rest: Partial<BuildingRule> }

/**
 * A civilization's profile. `drop` names the Roman buildings it lacks, `own` the
 * buildings only it has, `goods` how reference goods are called in the engine.
 */
export function factionProfile(race: Exclude<Race, 'roman'>, options: {
  version: string, description: string, drop: string[], dropObjects: string[], dropProfessions: string[], dropGoods: string[]
  addGoods: string[], addProfessions: RulesProfile['professions'], own: Own[], goods: Record<string, string>, offering: string
  rename: Record<string, string>, evidence: Record<string, Evidence>, dropEvidence: RegExp
}): RulesProfile {
  const files = reference[race]
  const romanFile = (id: string): string | undefined => (REFERENCE_GEOMETRY as Record<string, { file: string }>)[id]?.file
  const buildings: BuildingRule[] = []
  for (const roman of ROMAN_ENGINEERING.buildings) {
    if (options.drop.includes(roman.id)) continue
    const file = romanFile(roman.id)
    const source = file ? files[file] : undefined
    if (!file || !source) throw new RangeError(`${race} has no reference definition for ${roman.id}`)
    // The Roman rule minus everything the reference defines per civilization: the civilization's own geometry replaces it whole.
    const { footprint: _f, protected: _p, door: _d, piles: _i, builders: _b, groundBorder: _g, ground: _r, footprintGround: _o, cost: _c, ...spec } = roman
    buildings.push({ ...defineFrom({ ...spec, name: options.rename[roman.id] ?? roman.name, cost: manualCost(race, file) } as never, source, options.goods),
      ...(roman.id === 'small-temple' ? { inputs: doorstep(options.offering) } : {}) } as BuildingRule)
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
  Object.assign(evidence, options.evidence)
  const base = ROMAN_ENGINEERING
  return validateRules({
    ...base,
    id: `${race}-engineering`,
    version: options.version,
    description: options.description,
    goods: [...base.goods.filter(g => !options.dropGoods.includes(g)), ...options.addGoods],
    objects: base.objects.filter(o => !options.dropObjects.includes(o.id)),
    professions: [...base.professions.filter(p => !options.dropProfessions.includes(p.id)), ...options.addProfessions],
    buildings,
    religion: base.religion ? { ...base.religion, offering: options.offering, interventions: undefined, castDistance: undefined } : undefined,
    evidence,
  } as RulesProfile)
}

export const EGYPTIAN_VERSION = '0.1.0'

/** The Egyptian engineering profile: no wine or charcoal; a brewery for kegs (the temple's offering) and a gem mine. */
export function egyptianProfile(): RulesProfile {
  const brewery = { id: 'brewery', name: 'Brewery', category: 'Egyptian', file: 'brewery', worker: 'brewer', rest: {
    inputs: { grain: 8, water: 8 }, outputs: doorstep('keg'), workflow: { kind: 'process' as const, inputs: { grain: 1, water: 1 }, outputs: { keg: 1 }, work: 60 },
  } }
  const gems = { id: 'gem-mine', name: 'Gem mine', category: 'Metal', file: 'gemsmine', worker: 'miner', rest: {
    inputs: { bread: 8, meat: 8, fish: 8 }, outputs: doorstep('gems'),
    workflow: { kind: 'extract' as const, resource: 'gems', output: 'gems', work: 70, radius: 2, food: { preferred: 'meat', accepted: ['bread', 'fish'], preferredCycles: 10, otherCycles: 2 } },
  } }
  return factionProfile('egyptian', {
    version: EGYPTIAN_VERSION,
    description: 'Egyptian economy mechanics: manual-candidate costs, reference geometry and the Roman engineering placeholders for every unobserved value.',
    drop: ['winery', 'charcoal-maker'],
    dropObjects: ['vine', 'ripe-vine'],
    dropProfessions: ['winegrower', 'charcoal-burner'],
    dropGoods: ['wine'],
    addGoods: ['keg', 'gems'],
    addProfessions: [{ id: 'brewer', tool: null, specialist: false }],
    own: [brewery, gems],
    goods: { 'reference:KEG': 'keg', 'reference:GEMS': 'gems' },
    offering: 'keg',
    rename: { 'small-temple': 'Sphinx', 'large-temple': 'Pyramid' },
    dropEvidence: /^(buildings\.(winery|charcoal-maker|small-temple\.door|barracks\.cost-discrepancy)|objects\.vine|religion\.interventions)/,
    evidence: {
      'goods': { class: 'M', source: 'docs/roadmap/evidence.md (jops.htm)', note: 'Egyptian goods follow the Roman chains with kegs from the brewery for the Sphinx and gems from the gem mine; the complete catalog requires decoded content.', owner: 'S3-059' },
      'religion.interventions': { class: 'U', source: 'engineering placeholder; not an original value', note: 'The Egyptian divine interventions are not implemented; this profile has none until they are observed.', owner: 'S3-059' },
      'religion.offerings': { class: 'E', source: `https://github.com/paulwedeck/settlers-remake/blob/${REVISION}/jsettlers.common/src/main/resources/jsettlers/common/buildings/egyptian/temple.xml`, note: 'The Sphinx takes kegs as its offering, as the reference defines; the manual names the Egyptian small temple and its offering only in general terms.' },
      'buildings.brewery.recipe': { class: 'E', source: `https://github.com/paulwedeck/settlers-remake/blob/${REVISION}/jsettlers.common/src/main/resources/jsettlers/common/buildings/egyptian/brewery.xml`, note: 'The brewery requests grain and water and offers kegs; quantities per cycle are unobserved.' },
      'buildings.gem-mine.recipe': { class: 'E', source: `https://github.com/paulwedeck/settlers-remake/blob/${REVISION}/jsettlers.common/src/main/resources/jsettlers/common/buildings/egyptian/gemsmine.xml`, note: 'The gem mine requests fish, meat and bread and offers gems, as the reference defines; preferred meal and cycles are unobserved.' },
    },
  })
}

if (import.meta.main) {
  const profile = egyptianProfile()
  const out = resolve(import.meta.dir, `../resources/game/engine/profiles/${profile.id}-${profile.version}.json`)
  await Bun.write(out, `${JSON.stringify(profile)}\n`)
  console.log(`Wrote ${profile.id} ${profile.version}: ${profile.buildings.length} buildings.`)
  void process
}
