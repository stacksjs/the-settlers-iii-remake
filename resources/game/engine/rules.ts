import { landscapeId, referenceTerrain } from './landscapes'
import { DIRECTIONS } from './geometry'
import { REFERENCE_GEOMETRY } from './reference-geometry'
import { digest } from './hash'

/** Evidence classes defined by docs/fidelity/gold-edition-specification.md. */
export type EvidenceClass = 'M' | 'O' | 'E' | 'U'
export interface Evidence { class: EvidenceClass, source: string, note: string, owner?: string }
export type Goods = Record<string, number>
export type Offset = readonly [number, number]

export interface LandscapeRule {
  name: string, image: number, color: string, water: boolean, blocking: boolean, originalCode?: number
  continuous: boolean, period: number, groups: string[]
}
export interface TerrainRule { id: string, walkable: boolean, buildable: boolean, water: boolean, moveCost: number, landscape?: LandscapeRule }
export interface ObjectRule { id: string, blocks: boolean, amount: number, grows?: { into: string, ticks: number } }
/** Combat values per rank (index 0 is rank 1). Ranges are lattice steps; attackTicks is the time between blows or shots. */
export interface SoldierRule { weapon: string, health: number[], strength: number[], range: [number, number], attackTicks: number, ranged: boolean }
export interface ProfessionRule { id: string, tool: string | null, specialist: boolean, soldier?: SoldierRule }
export interface MineFood { preferred: string, accepted: string[], preferredCycles: number, otherCycles: number }
export type Workflow =
  | { kind: 'none' }
  | { kind: 'process', inputs: Goods, outputs: Goods, work: number }
  | { kind: 'harvest', object: string, output: string, work: number, radius: number }
  | { kind: 'plant', object: string, work: number, radius: number }
  | {
    kind: 'cultivate', plant: string, ripe: string, output: string, work: number, radius: number
    /** Plantings need a neighbour at least this many elevation units higher or lower, with no planting along that slope. */
    slope?: number
    /** Terrain the planted tile and its neighbours must all have. */
    ground?: string[], groundRadius?: number
  }
  | { kind: 'extract', resource: string, output: string, work: number, radius: number, food?: MineFood }
  | { kind: 'craft', inputs: Goods, choices: string[], work: number }
export interface Pile { role: 'construction' | 'input' | 'output' | 'storage', good: string | null, at: Offset }
export interface BuildingRule {
  id: string, name: string, category: string, cost: Goods
  /** Tiles the building blocks, tiles kept free around it, its entrance, pile positions and builder spots. */
  footprint: Offset[], protected: Offset[], door: Offset, piles: Pile[], builders: Offset[]
  levelWork: number, buildWork: number, worker: string | null, inputs: Goods, outputs: Goods, workflow: Workflow
  storage?: { piles: number, capacity: number }, residents?: { count: number, interval: number }, territory?: number, vision: number, military?: boolean
  /** Required origin ground. Older profiles also use it to admit nonbuildable footprint tiles. */
  ground?: string[]
  /** General site and protected-border ground; absent in older profiles. Mines constrain their origin separately. */
  footprintGround?: string[]
  /** Outer edge of the complete source protected area, tested against general ground. */
  groundBorder?: Offset[]
  /** Soldiers a military building holds: infantry at the door, bowmen on the walls. */
  garrison?: { infantry: number, bowmen: number }
  /** A small temple turns delivered offerings into manna; a large temple brings priests. */
  temple?: 'small' | 'large'
  /** A healer calls wounded soldiers within radius of the work area to the heal spot and treats one every ticks. */
  heal?: { radius: number, spot: Offset, ticks: number }
}
/**
 * A divine intervention. Its manna cost rises by a tenth of the base for each
 * earlier use. Radius, limit, seconds and percent mean what the intervention's
 * effect says; from and to name goods or terrain it converts.
 */
export interface InterventionRule {
  id: 'magic-eye' | 'grassland-galore' | 'gorgeous-growth' | 'festering-fear' | 'heavenly-presents' | 'midas-touch' | 'vanishing-resources' | 'conversion'
  name: string, manna: number, presence: boolean, radius: number
  limit?: number, seconds?: number, percent?: number, amount?: number, from?: string, to?: string
}
export interface RulesProfile {
  id: string, version: string, fidelity: 'engineering' | 'original', description: string
  tickRate: number, goods: string[], tools: string[], foods: string[]
  terrain: TerrainRule[], objects: ObjectRule[], professions: ProfessionRule[], buildings: BuildingRule[]
  movement: { ticksPerStep: number, slopeTicks: number, maxClimb: number, searchLimit: number, waitTicks: number, retries: number }
  logistics: { carrierCapacity: number, groundPileCapacity: number, assignmentInterval: number, assignmentsPerPass: number }
  population: { carrierRatio: number, builderLimit: number, diggerLimit: number }
  demolition: { refundFraction: [number, number] }
  territory: { pioneerWork: number, pioneerRadius: number }
  visibility: { settler: number, interval: number }
  /** Earlier profiles draw explored fields from the live world. */
  worldMemory?: 'last-seen'
  survey: { radius: number, work: number, signTicks: number }
  /** Absent in earlier profiles, whose duty loop chose the nearest tile even when blocked. */
  specialistRouting?: 'reachable'
  /** Earlier profiles only checked the resting occupancy index when placing a site. */
  constructionOccupancy?: 'current-and-next'
  /** Earlier profiles chose nearby resting tiles without checking the movement route. */
  restingRouting?: 'reachable'
  /** Earlier profiles kept surplus construction professions after their caps fell. */
  constructionReassignment?: 'surplus-idle'
  /** Earlier profiles kept builders waiting at material-starved sites while other sites had work. */
  constructionWaiting?: 'release-idle'
  /** Earlier ground drops could merge compatible goods from different players. */
  groundPileMerging?: 'same-owner'
  /** Earlier profiles selected idle workers and tool offers before checking their work routes. */
  staffingRouting?: 'reachable'
  /** Absent in profiles published before soldiers existed. */
  military?: {
    searchRadius: number, recruitWork: number, defendRadius: number, towerRange: number, ranks: number
    /**
     * Fighting strength from wealth, absent before 0.4.0: blows and arrows deal
     * log2(stock + start) / doublings of their strength, where stock counts the
     * player's available good and start (hundredths, by number of players) is
     * the stock a player is assumed to begin with. On their own land soldiers
     * never fall below ownGround thousandths.
     */
    wealth?: { good: string, start: number[], doublings: number, ownGround: number }
  }
  /**
   * Offerings, manna and promotion, absent before 0.5.0. A small temple takes one
   * offering every offerTicks for one manna; promotions cost the listed manna in
   * order; a large temple gives completionManna once and a priest every
   * priestTicks up to priestLimit.
   */
  /**
   * Thieves, absent before 0.7.0: their health, how near an enemy soldier must come
   * to see through the disguise, how far from the target they look for goods, and
   * how much longer each step takes while they carry loot.
   */
  thieves?: { profession: string, health: number, uncover: number, search: number, slowdown: number }
  religion?: {
    offering: string, offerTicks: number, promotions: number[], completionManna: number, priestTicks: number, priestLimit: number, priest: string
    /** Divine interventions and how near a priest must stand to cast those that need him present. Absent before 0.6.0. */
    interventions?: InterventionRule[], castDistance?: number
  }
  evidence: Record<string, Evidence>
}

export class RulesError extends Error {
  constructor(readonly problems: string[]) { super(`Invalid rules profile: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? ` (+${problems.length - 5} more)` : ''}`) }
}

const required = ['tickRate', 'goods', 'terrain', 'objects', 'professions', 'movement', 'logistics', 'population', 'demolition', 'territory', 'visibility', 'survey'] as const

/** Rejects missing, dangling or contradictory definitions before a session can use them. */
export function validateRules(rules: RulesProfile): RulesProfile {
  const problems: string[] = []
  const positive = (value: unknown, label: string, zero = false): void => {
    const minimum = zero ? 0 : 1
    if (!Number.isInteger(value) || (value as number) < minimum) problems.push(`${label} must be a ${zero ? 'non-negative' : 'positive'} integer`)
  }
  const unique = (ids: string[], label: string): Set<string> => {
    const seen = new Set<string>()
    for (const id of ids) { if (!/^[a-z][a-z0-9-]*$/.test(id)) problems.push(`${label} id ${JSON.stringify(id)} is malformed`); if (seen.has(id)) problems.push(`${label} ${id} is defined more than once`); seen.add(id) }
    return seen
  }
  if (!rules.id || !/^\d+\.\d+\.\d+$/.test(rules.version)) problems.push('Profile needs an id and semantic version')
  const goods = unique(rules.goods, 'good'), terrain = unique(rules.terrain.map(t => t.id), 'terrain'), objects = unique(rules.objects.map(o => o.id), 'object')
  const professions = unique(rules.professions.map(p => p.id), 'profession'); unique(rules.buildings.map(b => b.id), 'building')
  const good = (id: string, label: string): void => { if (!goods.has(id)) problems.push(`${label} references unknown good ${id}`) }
  const amounts = (map: Goods, label: string): void => { for (const [id, n] of Object.entries(map)) { good(id, label); positive(n, `${label} ${id}`) } }
  for (const id of [...rules.tools, ...rules.foods]) good(id, 'tool/food list')
  if (!terrain.size || !rules.terrain.some(t => t.walkable) || !rules.terrain.some(t => t.buildable)) problems.push('Terrain needs walkable and buildable kinds')
  if (rules.terrain.length > 256) problems.push('Terrain exceeds the canonical byte-index capacity')
  const sourceCodes = new Set<number>(), sourceNames = new Set<string>()
  for (const t of rules.terrain) {
    positive(t.moveCost, `terrain ${t.id} move cost`)
    if (t.buildable && !t.walkable) problems.push(`terrain ${t.id} is buildable but not walkable`)
    const s = t.landscape
    if (!s) { if (rules.terrain.some(t => t.landscape)) problems.push(`terrain ${t.id} has no source identity`); continue }
    if (!/^[A-Z][A-Z_0-9]*$/.test(s.name) || sourceNames.has(s.name)) problems.push(`terrain ${t.id} has an invalid or duplicate source identity`)
    sourceNames.add(s.name)
    if (!/^#[a-f0-9]{6}$/.test(s.color)) problems.push(`terrain ${t.id} has an invalid source color`)
    positive(s.image, `terrain ${t.id} image`, true)
    if (s.originalCode !== undefined) {
      if (!Number.isInteger(s.originalCode) || s.originalCode < 0 || s.originalCode > 255 || sourceCodes.has(s.originalCode)) problems.push(`terrain ${t.id} has an invalid or duplicate original code`)
      sourceCodes.add(s.originalCode)
    }
    if (t.water !== s.water || t.walkable === s.blocking || (s.water && !s.blocking)) problems.push(`terrain ${t.id} contradicts its source partition`)
    if (![32, 64, 96, 128].includes(s.period) || (!s.continuous && s.period !== 32)) problems.push(`terrain ${t.id} has an invalid material phase`)
    if (new Set(s.groups).size !== s.groups.length || s.groups.some(g => !['grass', 'mountain', 'desert', 'river'].includes(g))) problems.push(`terrain ${t.id} has invalid source groups`)
  }
  for (const o of rules.objects) { positive(o.amount, `object ${o.id} amount`); if (o.grows) { positive(o.grows.ticks, `object ${o.id} growth`); if (!objects.has(o.grows.into) || o.grows.into === o.id) problems.push(`object ${o.id} grows into invalid ${o.grows.into}`) } }
  for (const p of rules.professions) if (p.tool !== null && !rules.tools.includes(p.tool)) problems.push(`profession ${p.id} needs unknown tool ${p.tool}`)
  for (const p of rules.professions) {
    const soldier = p.soldier
    if (!soldier) continue
    good(soldier.weapon, `soldier ${p.id}`)
    if (!rules.military) { problems.push(`soldier ${p.id} needs a military section`); continue }
    if (soldier.health.length !== rules.military.ranks || soldier.strength.length !== rules.military.ranks || ![...soldier.health, ...soldier.strength].every(n => Number.isFinite(n) && n > 0)) problems.push(`soldier ${p.id} needs positive health and strength for each rank`)
    if (!Number.isInteger(soldier.range[0]) || !Number.isInteger(soldier.range[1]) || soldier.range[0] < 0 || soldier.range[1] < Math.max(1, soldier.range[0])) problems.push(`soldier ${p.id} has an invalid range`)
    positive(soldier.attackTicks, `soldier ${p.id} attack`)
  }
  for (const id of ['carrier', 'builder', 'digger']) if (!professions.has(id)) problems.push(`profession ${id} is required`)
  for (const b of rules.buildings) {
    const label = `building ${b.id}`, cells = new Set(b.footprint.map(([x, y]) => `${x},${y}`))
    if (!cells.size || cells.size !== b.footprint.length) problems.push(`${label} footprint must list each tile once`)
    if (b.protected.some(([x, y]) => cells.has(`${x},${y}`)) || b.piles.some(p => cells.has(`${p.at[0]},${p.at[1]}`)) || b.builders.some(([x, y]) => cells.has(`${x},${y}`))) problems.push(`${label} protected tiles, piles and builder spots must lie outside the footprint`)
    for (const pile of b.piles) if (pile.good !== null && !goods.has(pile.good) && !pile.good.startsWith('reference:')) problems.push(`${label} pile uses unknown good ${pile.good}`)
    if (cells.has(`${b.door[0]},${b.door[1]}`) || !b.footprint.some(([x, y]) => DIRECTIONS.some(([dx, dy]) => x + dx === b.door[0] && y + dy === b.door[1]))) problems.push(`${label} door must border its footprint`)
    amounts(b.cost, `${label} cost`); amounts(b.inputs, `${label} input capacity`); amounts(b.outputs, `${label} output capacity`)
    positive(b.levelWork, `${label} level work`); positive(b.buildWork, `${label} build work`); positive(b.vision, `${label} vision`, true)
    if (b.worker !== null && !professions.has(b.worker)) problems.push(`${label} needs unknown profession ${b.worker}`)
    const w = b.workflow
    if (w.kind !== 'none' && b.worker === null) problems.push(`${label} has a workflow without a worker`)
    if (w.kind === 'process' || w.kind === 'craft') { amounts(w.inputs, `${label} recipe`); for (const id of Object.keys(w.inputs)) if (!b.inputs[id]) problems.push(`${label} has no input capacity for ${id}`) }
    if (w.kind === 'process') { amounts(w.outputs, `${label} recipe`); for (const id of Object.keys(w.outputs)) if (!b.outputs[id]) problems.push(`${label} has no output capacity for ${id}`) }
    if (w.kind === 'craft') for (const id of w.choices) if (!b.outputs[id]) problems.push(`${label} cannot store crafted ${id}`)
    if ((w.kind === 'harvest' || w.kind === 'plant') && !objects.has(w.object)) problems.push(`${label} uses unknown object ${w.object}`)
    if (w.kind === 'cultivate' && (!objects.has(w.plant) || !objects.has(w.ripe))) problems.push(`${label} uses unknown crop objects`)
    if (w.kind === 'cultivate') { if (w.groundRadius !== undefined) positive(w.groundRadius, `${label} ground radius`); if (w.slope !== undefined) positive(w.slope, `${label} slope`); for (const id of w.ground ?? []) if (!terrain.has(id)) problems.push(`${label} requires unknown terrain ${id}`) }
    if (b.temple === 'small' && !b.inputs[rules.religion?.offering ?? '']) problems.push(`${label} needs a religion and an offering input`)
    if (b.heal) { positive(b.heal.radius, `${label} heal radius`); positive(b.heal.ticks, `${label} heal time`); if (cells.has(`${b.heal.spot[0]},${b.heal.spot[1]}`)) problems.push(`${label} heal spot lies in the footprint`) }
    if ((w.kind === 'harvest' || w.kind === 'cultivate' || w.kind === 'extract') && !b.outputs[w.output]) problems.push(`${label} cannot store ${w.output}`)
    if (w.kind === 'extract') { if (!goods.has(w.resource) && w.resource !== 'water') problems.push(`${label} extracts unknown ${w.resource}`); if (w.food) { good(w.food.preferred, label); w.food.accepted.forEach(id => good(id, label)); positive(w.food.preferredCycles, `${label} meal`); positive(w.food.otherCycles, `${label} meal`); if (![w.food.preferred, ...w.food.accepted].every(id => b.inputs[id])) problems.push(`${label} has no input capacity for its food`) } }
    if (w.kind !== 'none') positive(w.work, `${label} work`)
    if (b.storage) { positive(b.storage.piles, `${label} storage piles`); positive(b.storage.capacity, `${label} storage capacity`) }
    if (b.residents) { positive(b.residents.count, `${label} residents`); positive(b.residents.interval, `${label} resident interval`) }
    if (b.territory !== undefined) positive(b.territory, `${label} territory`)
    if (b.garrison && (!b.military || !Number.isInteger(b.garrison.infantry) || !Number.isInteger(b.garrison.bowmen) || b.garrison.infantry < 1 || b.garrison.bowmen < 0)) problems.push(`${label} garrison needs a military building with at least one infantry place`)
    for (const id of [...b.ground ?? [], ...b.footprintGround ?? []]) if (!terrain.has(id)) problems.push(`${label} requires unknown terrain ${id}`)
  }
  positive(rules.tickRate, 'tick rate')
  const { wealth, ...military } = rules.military ?? {}
  for (const [section, values] of Object.entries({ movement: rules.movement, logistics: rules.logistics, territory: rules.territory, visibility: rules.visibility, survey: rules.survey, ...(rules.military ? { military } : {}) })) for (const [key, value] of Object.entries(values)) positive(value, `${section}.${key}`, key === 'slopeTicks' || key === 'retries')
  if (rules.thieves) {
    const t = rules.thieves
    if (!professions.has(t.profession)) problems.push(`thief profession ${t.profession} is unknown`)
    for (const key of ['health', 'uncover', 'search', 'slowdown'] as const) positive(t[key], `thieves.${key}`)
  }
  if (rules.religion) {
    const r = rules.religion, classes = rules.professions.filter(p => p.soldier).length
    good(r.offering, 'religion offering')
    if (!professions.has(r.priest)) problems.push(`religion priest ${r.priest} is not a profession`)
    for (const key of ['offerTicks', 'completionManna', 'priestTicks', 'priestLimit'] as const) positive(r[key], `religion.${key}`)
    r.promotions.forEach(n => positive(n, 'religion promotion'))
    if (rules.military && r.promotions.length !== classes * (rules.military.ranks - 1)) problems.push('religion needs one promotion cost for each class and rank above the first')
    if (r.interventions) {
      if (r.castDistance === undefined) problems.push('religion interventions need a cast distance')
      else positive(r.castDistance, 'religion.castDistance')
      unique(r.interventions.map(i => i.id), 'intervention')
      for (const i of r.interventions) {
        for (const key of ['manna', 'radius'] as const) positive(i[key], `intervention ${i.id} ${key}`)
        for (const key of ['limit', 'seconds', 'percent', 'amount'] as const) if (i[key] !== undefined) positive(i[key], `intervention ${i.id} ${key}`)
        if (i.id === 'midas-touch') { good(i.from ?? '', `intervention ${i.id}`); good(i.to ?? '', `intervention ${i.id}`) }
        if (i.id === 'grassland-galore' && (!terrain.has(i.from ?? '') || !terrain.has(i.to ?? ''))) problems.push(`intervention ${i.id} converts unknown terrain`)
      }
    }
  }
  if (wealth) {
    good(wealth.good, 'military wealth')
    if (!wealth.start.length || wealth.start.length > 32) problems.push('military wealth needs a start amount for each number of players')
    for (const n of wealth.start) positive(n, 'military wealth start')
    positive(wealth.doublings, 'military wealth doublings'); positive(wealth.ownGround, 'military wealth own ground')
  }
  if (rules.logistics.carrierCapacity !== 1) problems.push('Only single-good carrier loads are supported')
  if (rules.specialistRouting !== undefined && rules.specialistRouting !== 'reachable') problems.push('Unknown specialist routing policy')
  if (rules.constructionOccupancy !== undefined && rules.constructionOccupancy !== 'current-and-next') problems.push('Unknown construction occupancy policy')
  if (rules.restingRouting !== undefined && rules.restingRouting !== 'reachable') problems.push('Unknown resting routing policy')
  if (rules.constructionReassignment !== undefined && rules.constructionReassignment !== 'surplus-idle') problems.push('Unknown construction reassignment policy')
  if (rules.constructionWaiting !== undefined && rules.constructionWaiting !== 'release-idle') problems.push('Unknown construction waiting policy')
  if (rules.groundPileMerging !== undefined && rules.groundPileMerging !== 'same-owner') problems.push('Unknown ground pile merging policy')
  if (rules.staffingRouting !== undefined && rules.staffingRouting !== 'reachable') problems.push('Unknown staffing routing policy')
  if (rules.worldMemory !== undefined && rules.worldMemory !== 'last-seen') problems.push('Unknown observed-world policy')
  if (!Number.isInteger(rules.population.carrierRatio) || rules.population.carrierRatio < 0 || rules.population.carrierRatio > 100) problems.push('Carrier ratio must be a percentage')
  const [refund, of] = rules.demolition.refundFraction
  if (!Number.isInteger(refund) || !Number.isInteger(of) || of < 1 || refund < 0 || refund > of) problems.push('Demolition refund must be a fraction between 0 and 1')
  const paths = Object.keys(rules.evidence)
  for (const key of [...required, ...(rules.specialistRouting ? ['specialistRouting'] : []), ...(rules.constructionOccupancy ? ['constructionOccupancy'] : []), ...(rules.restingRouting ? ['restingRouting'] : []), ...(rules.constructionReassignment ? ['constructionReassignment'] : []), ...(rules.constructionWaiting ? ['constructionWaiting'] : []), ...(rules.groundPileMerging ? ['groundPileMerging'] : []), ...(rules.staffingRouting ? ['staffingRouting'] : []), ...(rules.worldMemory ? ['worldMemory'] : []), ...(rules.military ? ['military'] : []), ...rules.buildings.map(b => `buildings.${b.id}`)]) if (!paths.some(path => path === key || path.startsWith(`${key}.`))) problems.push(`${key} has no evidence record`)
  for (const [path, item] of Object.entries(rules.evidence)) {
    if (!['M', 'O', 'E', 'U'].includes(item.class) || !item.source || !item.note) problems.push(`evidence ${path} is incomplete`)
    if (item.class === 'U' && !item.owner) problems.push(`unverified ${path} must name its owning issue`)
  }
  if (rules.fidelity === 'original') for (const [path, item] of Object.entries(rules.evidence)) if (item.class === 'U' || item.class === 'E') problems.push(`original profile cannot rely on ${item.class} evidence at ${path}`)
  if (problems.length) throw new RulesError(problems)
  return rules
}

export const rulesDigest = (rules: RulesProfile): string => digest(rules)
export const rulesIdentity = (rules: RulesProfile): { id: string, version: string, digest: string } => ({ id: rules.id, version: rules.version, digest: rulesDigest(rules) })
export const building = (rules: RulesProfile, id: string): BuildingRule => { const found = rules.buildings.find(b => b.id === id); if (!found) throw new RangeError(`Unknown building ${id}`); return found }
/** Goods a smith makes to order: tools, and the weapons soldiers carry (manual: Goods menu, Tools and Weapons). */
export const crafted = (rules: RulesProfile): string[] => [...rules.tools, ...rules.professions.flatMap(p => p.soldier ? [p.soldier.weapon] : [])]
export const profession = (rules: RulesProfile, id: string): ProfessionRule => { const found = rules.professions.find(p => p.id === id); if (!found) throw new RangeError(`Unknown profession ${id}`); return found }

/** Release qualification refuses profiles that still contain unverified or engineering-only values. */
export function qualificationGaps(rules: RulesProfile): string[] {
  return Object.entries(rules.evidence).filter(([, item]) => item.class === 'U' || item.class === 'E' || item.class === 'M').map(([path, item]) => `${path}: ${item.class} (${item.owner ?? item.source})`)
}

const MANUAL = 'https://github.com/JakeSteam/settlers/blob/8426388935b436e65b0697ac401c4247ab097364/en'
const sources = {
  military: `${MANUAL}/military/military.htm (sha256 1609d51c59a335194f10be6d2cf51c612f3b1fe28ae507c5e2a8aafa922911f7)`,
  table: `${MANUAL}/ec_build/building.htm#Table of Building Materials (sha256 10dcbad8d7c02a7873b263f1db81e7561368467f429c4b6b6113758122d65a9e)`,
  demolish: `${MANUAL}/ec_build/building.htm#General Comments on the Buildings (sha256 10dcbad8d7c02a7873b263f1db81e7561368467f429c4b6b6113758122d65a9e)`,
  economy: `${MANUAL}/ec_basic/basics.htm (sha256 a6a10487a4818f87e7d622d730190cb2077b12dcab99852d428f149c6d53c899)`,
  jobs: `${MANUAL}/ec_jobs/jops.htm (sha256 ae9aa52d18a480546cc36be74f10c61efd2e89dd24a78b6db98bb2d6b5b988f0)`,
  reference: 'https://github.com/paulwedeck/settlers-remake/tree/6ad8c4230a4aa4cd21840f8cb59a38344e41c3e0',
  spec: 'docs/roadmap/specification.md',
}
const U = (note: string, owner: string): Evidence => ({ class: 'U', source: 'engineering placeholder; not an original value', note, owner })
const M = (source: string, note: string, owner: string): Evidence => ({ class: 'M', source, note, owner })
const E = (source: string, note: string): Evidence => ({ class: 'E', source, note })

type Spec = Omit<BuildingRule, 'levelWork' | 'buildWork' | 'vision' | 'inputs' | 'outputs' | 'workflow' | 'footprint' | 'protected' | 'door' | 'piles' | 'builders'> & Partial<Pick<BuildingRule, 'inputs' | 'outputs' | 'workflow' | 'vision' | 'door'>>
// Footprints, doors, pile positions and builder spots come from the pinned reference remake definitions.
const geometry = (id: string): Pick<BuildingRule, 'footprint' | 'protected' | 'door' | 'piles' | 'builders' | 'groundBorder'> => {
  const g = (REFERENCE_GEOMETRY as Record<string, (typeof REFERENCE_GEOMETRY)[keyof typeof REFERENCE_GEOMETRY]>)[id]
  if (!g) throw new RangeError(`No reference geometry for ${id}`)
  const piles: Pile[] = [
    ...g.construction.map(c => ({ role: 'construction' as const, good: c.good, at: c.at as Offset })),
    ...g.piles.map(p => ({ role: p.good === '*' ? 'storage' as const : p.role === 'offer' ? 'output' as const : 'input' as const, good: p.good === '*' ? null : p.good, at: p.at as Offset })),
  ]
  // The reference coal mine lists builder spots on its own blocked tiles; those cannot be reached and are dropped.
  const blocked = new Set(g.blocked.map(([x, y]) => `${x},${y}`))
  const protectedArea = [...g.blocked, ...g.protected], area = new Set(protectedArea.map(([x, y]) => `${x},${y}`))
  const border = new Map<string, Offset>()
  for (const [x, y] of protectedArea) for (const [dx, dy] of DIRECTIONS) { const key = `${x + dx},${y + dy}`; if (!area.has(key)) border.set(key, [x + dx, y + dy]) }
  return { groundBorder: [...border.values()], footprint: g.blocked.map(o => o as Offset), protected: g.protected.map(o => o as Offset), door: g.door as Offset, piles, builders: g.builders.filter(([x, y]) => !blocked.has(`${x},${y}`)).map(o => o as Offset) }
}
const define = (spec: Spec): BuildingRule => {
  const source = REFERENCE_GEOMETRY[spec.id as keyof typeof REFERENCE_GEOMETRY]
  const ground = source.ground.map(landscapeId)
  return { ...geometry(spec.id), levelWork: 20, buildWork: 30, vision: 6, inputs: {}, outputs: {}, workflow: { kind: 'none' }, ...spec,
    ground: source.mine ? ['mountain', 'mountain-border'] : ground, footprintGround: ground }
}
const cost = (plank: number, stone: number): Goods => Object.fromEntries(Object.entries({ plank, stone }).filter(([, n]) => n > 0))
const doorstep = (good: string): Goods => ({ [good]: 8 })
const meal = (preferred: string): MineFood => ({ preferred, accepted: ['bread', 'meat', 'fish'].filter(id => id !== preferred), preferredCycles: 10, otherCycles: 2 })

/**
 * Roman engineering profile. Construction costs, doorstep and storage capacities,
 * tool requirements, construction-first delivery, preferred meals and the half
 * demolition refund are manual candidates (M) transcribed from the pinned
 * manual. Every timing, radius, footprint, population and movement value is an
 * explicit engineering placeholder (U) owned by the issue that must observe it.
 * This profile never qualifies a release; see qualificationGaps().
 */
export const ROMAN_ENGINEERING: RulesProfile = validateRules({
  id: 'roman-engineering',
  version: '0.15.0',
  fidelity: 'engineering',
  description: 'Roman M1 economy mechanics with manual-candidate costs and explicit placeholders for unobserved values.',
  tickRate: 20,
  goods: ['log', 'plank', 'stone', 'grain', 'flour', 'water', 'bread', 'pig', 'meat', 'fish', 'coal', 'ironore', 'goldore', 'iron', 'gold', 'hammer', 'shovel', 'axe', 'saw', 'pickaxe', 'scythe', 'fishingrod', 'sword', 'spear', 'bow', 'wine'],
  tools: ['hammer', 'shovel', 'axe', 'saw', 'pickaxe', 'scythe', 'fishingrod'],
  foods: ['bread', 'meat', 'fish'],
  terrain: referenceTerrain(),
  objects: [
    { id: 'tree', blocks: true, amount: 1 },
    { id: 'sapling', blocks: true, amount: 1, grows: { into: 'tree', ticks: 2400 } },
    { id: 'stone', blocks: true, amount: 12 },
    { id: 'field', blocks: false, amount: 1, grows: { into: 'ripe-grain', ticks: 1600 } },
    { id: 'vine', blocks: false, amount: 1, grows: { into: 'ripe-vine', ticks: 10800 } },
    { id: 'ripe-vine', blocks: false, amount: 1 },
    { id: 'ripe-grain', blocks: false, amount: 1 },
    { id: 'sign', blocks: false, amount: 1 },
  ],
  professions: [
    { id: 'carrier', tool: null, specialist: false }, { id: 'digger', tool: 'shovel', specialist: false }, { id: 'builder', tool: 'hammer', specialist: false },
    { id: 'woodcutter', tool: 'axe', specialist: false }, { id: 'forester', tool: null, specialist: false }, { id: 'stonecutter', tool: 'pickaxe', specialist: false },
    { id: 'sawyer', tool: 'saw', specialist: false }, { id: 'fisher', tool: 'fishingrod', specialist: false }, { id: 'farmer', tool: 'scythe', specialist: false },
    { id: 'waterworker', tool: null, specialist: false }, { id: 'miller', tool: null, specialist: false }, { id: 'baker', tool: null, specialist: false },
    { id: 'pigfarmer', tool: null, specialist: false }, { id: 'butcher', tool: null, specialist: false }, { id: 'miner', tool: 'pickaxe', specialist: false },
    { id: 'smelter', tool: null, specialist: false }, { id: 'toolsmith', tool: 'hammer', specialist: false }, { id: 'weaponsmith', tool: 'hammer', specialist: false },
    { id: 'geologist', tool: 'hammer', specialist: true }, { id: 'pioneer', tool: 'shovel', specialist: true },
    // Reference-remake EMovableType health and strength by rank; attack timing and ranges from its Constants.
    { id: 'swordsman', tool: null, specialist: true, soldier: { weapon: 'sword', health: [100, 120, 150], strength: [10, 14, 20], range: [0, 1], attackTicks: 20, ranged: false } },
    { id: 'pikeman', tool: null, specialist: true, soldier: { weapon: 'spear', health: [200, 240, 300], strength: [4, 5, 6], range: [0, 2], attackTicks: 20, ranged: false } },
    { id: 'bowman', tool: null, specialist: true, soldier: { weapon: 'bow', health: [100, 120, 150], strength: [5, 6, 7], range: [7, 15], attackTicks: 24, ranged: true } },
    { id: 'winegrower', tool: null, specialist: false }, { id: 'charcoal-burner', tool: null, specialist: false }, { id: 'priest', tool: null, specialist: true },
    { id: 'thief', tool: null, specialist: true }, { id: 'healer', tool: null, specialist: false },
  ],
  buildings: [
    define({ id: 'castle', name: 'Castle', category: 'Military', cost: cost(8, 12), worker: null, storage: { piles: 6, capacity: 8 }, territory: 24, vision: 24, military: true, garrison: { infantry: 5, bowmen: 6 } }),
    define({ id: 'storage', name: 'Storage area', category: 'Misc', cost: cost(2, 2), worker: null, storage: { piles: 6, capacity: 8 } }),
    define({ id: 'small-residence', name: 'Small residence', category: 'Misc', cost: cost(2, 3), worker: null, residents: { count: 6, interval: 200 } }),
    define({ id: 'medium-residence', name: 'Medium residence', category: 'Misc', cost: cost(5, 8), worker: null, residents: { count: 15, interval: 120 } }),
    define({ id: 'small-tower', name: 'Small guard tower', category: 'Military', cost: cost(2, 3), worker: null, territory: 16, vision: 16, military: true, garrison: { infantry: 1, bowmen: 2 } }),
    define({ id: 'large-tower', name: 'Large guard tower', category: 'Military', cost: cost(5, 5), worker: null, territory: 20, vision: 20, military: true, garrison: { infantry: 3, bowmen: 3 } }),
    define({ id: 'lookout-tower', name: 'Lookout tower', category: 'Military', cost: cost(2, 4), worker: null, vision: 30 }),
    define({ id: 'large-residence', name: 'Large residence', category: 'Misc', cost: cost(15, 24), worker: null, residents: { count: 30, interval: 80 } }),
    define({ id: 'woodcutter', name: "Woodcutter's hut", category: 'Building', cost: cost(2, 2), worker: 'woodcutter', outputs: doorstep('log'), workflow: { kind: 'harvest', object: 'tree', output: 'log', work: 60, radius: 7 } }),
    define({ id: 'forester', name: "Forester's hut", category: 'Building', cost: cost(3, 1), worker: 'forester', workflow: { kind: 'plant', object: 'sapling', work: 40, radius: 6 } }),
    define({ id: 'stonecutter', name: "Stonecutter's hut", category: 'Building', cost: cost(2, 3), worker: 'stonecutter', outputs: doorstep('stone'), workflow: { kind: 'harvest', object: 'stone', output: 'stone', work: 80, radius: 7 } }),
    define({ id: 'sawmill', name: 'Sawmill', category: 'Building', cost: cost(3, 4), worker: 'sawyer', inputs: doorstep('log'), outputs: doorstep('plank'), workflow: { kind: 'process', inputs: { log: 1 }, outputs: { plank: 1 }, work: 50 } }),
    define({ id: 'fisher', name: "Fisherman's hut", category: 'Food', cost: cost(3, 2), worker: 'fisher', outputs: doorstep('fish'), workflow: { kind: 'extract', resource: 'fish', output: 'fish', work: 80, radius: 6 } }),
    define({ id: 'grain-farm', name: 'Grain farm', category: 'Food', cost: cost(6, 6), worker: 'farmer', outputs: doorstep('grain'), workflow: { kind: 'cultivate', plant: 'field', ripe: 'ripe-grain', output: 'grain', work: 40, radius: 5, ground: ['grass', 'earth'], groundRadius: 2 } }),
    define({ id: 'waterworks', name: 'Waterworks', category: 'Food', cost: cost(3, 4), worker: 'waterworker', outputs: doorstep('water'), workflow: { kind: 'extract', resource: 'water', output: 'water', work: 50, radius: 5 } }),
    define({ id: 'mill', name: 'Grain mill', category: 'Food', cost: cost(3, 3), worker: 'miller', inputs: doorstep('grain'), outputs: doorstep('flour'), workflow: { kind: 'process', inputs: { grain: 1 }, outputs: { flour: 1 }, work: 50 } }),
    define({ id: 'bakery', name: 'Bakery', category: 'Food', cost: cost(4, 5), worker: 'baker', inputs: { flour: 8, water: 8 }, outputs: doorstep('bread'), workflow: { kind: 'process', inputs: { flour: 1, water: 1 }, outputs: { bread: 1 }, work: 60 } }),
    define({ id: 'pig-farm', name: 'Pig farm', category: 'Food', cost: cost(6, 6), worker: 'pigfarmer', inputs: { grain: 8, water: 8 }, outputs: doorstep('pig'), workflow: { kind: 'process', inputs: { grain: 1, water: 1 }, outputs: { pig: 1 }, work: 120 } }),
    define({ id: 'slaughterhouse', name: 'Slaughterhouse', category: 'Food', cost: cost(4, 4), worker: 'butcher', inputs: doorstep('pig'), outputs: doorstep('meat'), workflow: { kind: 'process', inputs: { pig: 1 }, outputs: { meat: 1 }, work: 60 } }),
    define({ id: 'coal-mine', name: 'Coal mine', category: 'Metal', cost: cost(4, 1), worker: 'miner', inputs: { bread: 8, meat: 8, fish: 8 }, outputs: doorstep('coal'), workflow: { kind: 'extract', resource: 'coal', output: 'coal', work: 70, radius: 2, food: meal('bread') } }),
    define({ id: 'iron-mine', name: 'Iron mine', category: 'Metal', cost: cost(4, 1), worker: 'miner', inputs: { bread: 8, meat: 8, fish: 8 }, outputs: doorstep('ironore'), workflow: { kind: 'extract', resource: 'ironore', output: 'ironore', work: 70, radius: 2, food: meal('meat') } }),
    define({ id: 'gold-mine', name: 'Gold mine', category: 'Metal', cost: cost(5, 1), worker: 'miner', inputs: { bread: 8, meat: 8, fish: 8 }, outputs: doorstep('goldore'), workflow: { kind: 'extract', resource: 'goldore', output: 'goldore', work: 70, radius: 2, food: meal('fish') } }),
    define({ id: 'iron-smelter', name: 'Iron smelting works', category: 'Metal', cost: cost(4, 6), worker: 'smelter', inputs: { ironore: 8, coal: 8 }, outputs: doorstep('iron'), workflow: { kind: 'process', inputs: { ironore: 1, coal: 1 }, outputs: { iron: 1 }, work: 80 } }),
    define({ id: 'gold-smelter', name: 'Gold smelting works', category: 'Metal', cost: cost(4, 6), worker: 'smelter', inputs: { goldore: 8, coal: 8 }, outputs: doorstep('gold'), workflow: { kind: 'process', inputs: { goldore: 1, coal: 1 }, outputs: { gold: 1 }, work: 80 } }),
    define({ id: 'toolsmith', name: "Tool smith's works", category: 'Metal', cost: cost(3, 5), worker: 'toolsmith', inputs: { iron: 8, coal: 8 }, outputs: { hammer: 8, shovel: 8, axe: 8, saw: 8, pickaxe: 8, scythe: 8, fishingrod: 8 }, workflow: { kind: 'craft', inputs: { iron: 1, coal: 1 }, choices: ['hammer', 'shovel', 'axe', 'saw', 'pickaxe', 'scythe', 'fishingrod'], work: 90 } }),
    define({ id: 'weaponsmith', name: "Weapon smith's works", category: 'Metal', cost: cost(5, 7), worker: 'weaponsmith', inputs: { iron: 8, coal: 8 }, outputs: { sword: 8, spear: 8, bow: 8 }, workflow: { kind: 'craft', inputs: { iron: 1, coal: 1 }, choices: ['sword', 'spear', 'bow'], work: 90 } }),
    define({ id: 'barracks', name: 'Barracks', category: 'Military', cost: cost(4, 5), worker: null, inputs: { sword: 8, spear: 8, bow: 8 } }),
    define({ id: 'winery', name: 'Winery', category: 'Roman', cost: cost(4, 4), worker: 'winegrower', outputs: doorstep('wine'), workflow: { kind: 'cultivate', plant: 'vine', ripe: 'ripe-vine', output: 'wine', work: 40, radius: 4, slope: 2, ground: ['grass', 'earth'], groundRadius: 1 } }),
    define({ id: 'charcoal-maker', name: "Charcoal maker's hut", category: 'Roman', cost: cost(3, 4), worker: 'charcoal-burner', inputs: doorstep('plank'), outputs: doorstep('coal'), workflow: { kind: 'process', inputs: { plank: 5 }, outputs: { coal: 1 }, work: 100 } }),
    define({ id: 'small-temple', name: 'Small temple', category: 'Roman', cost: cost(5, 8), worker: null, inputs: doorstep('wine'), temple: 'small', door: [7, 5] }),
    define({ id: 'large-temple', name: 'Large temple', category: 'Roman', cost: cost(8, 14), worker: null, temple: 'large' }),
    define({ id: 'healers-hut', name: "Healer's hut", category: 'Military', cost: cost(3, 3), worker: 'healer', heal: { radius: 20, spot: [4, 4], ticks: 80 } }),
  ],
  movement: { ticksPerStep: 8, slopeTicks: 1, maxClimb: 4, searchLimit: 40000, waitTicks: 6, retries: 4 },
  logistics: { carrierCapacity: 1, groundPileCapacity: 8, assignmentInterval: 4, assignmentsPerPass: 16 },
  population: { carrierRatio: 30, builderLimit: 12, diggerLimit: 8 },
  demolition: { refundFraction: [1, 2] },
  territory: { pioneerWork: 30, pioneerRadius: 1 },
  visibility: { settler: 5, interval: 10 },
  worldMemory: 'last-seen',
  survey: { radius: 3, work: 30, signTicks: 6000 },
  specialistRouting: 'reachable',
  constructionOccupancy: 'current-and-next',
  restingRouting: 'reachable',
  constructionReassignment: 'surplus-idle',
  constructionWaiting: 'release-idle',
  groundPileMerging: 'same-owner',
  staffingRouting: 'reachable',
  military: {
    searchRadius: 30, recruitWork: 40, defendRadius: 2, towerRange: 25, ranks: 3,
    wealth: { good: 'gold', start: [2900, 2200, 1400, 1025, 800, 600, 500, 470, 420, 380, 330, 310, 290, 270, 260, 240, 230, 220, 210, 200, 190, 180, 170, 160, 150, 140, 130, 120, 110], doublings: 9, ownGround: 1000 },
  },
  thieves: { profession: 'thief', health: 100, uncover: 3, search: 30, slowdown: 2 },
  religion: {
    offering: 'wine', offerTicks: 600, promotions: [10, 20, 30, 50, 60, 30], completionManna: 8, priestTicks: 6000, priestLimit: 100, priest: 'priest', castDistance: 10,
    interventions: [
      { id: 'magic-eye', name: 'The Magic Eye', manna: 10, presence: false, radius: 10, seconds: 6 },
      { id: 'grassland-galore', name: 'Grassland Galore', manna: 10, presence: true, radius: 7, from: 'desert', to: 'grass' },
      { id: 'gorgeous-growth', name: 'Gorgeous Growth', manna: 15, presence: true, radius: 10, limit: 1, seconds: 300, percent: 50 },
      { id: 'festering-fear', name: 'Festering Fear', manna: 15, presence: true, radius: 10, limit: 20, seconds: 30, percent: 50 },
      { id: 'heavenly-presents', name: 'Heavenly Presents', manna: 20, presence: true, radius: 3, limit: 5, amount: 8 },
      { id: 'midas-touch', name: 'The Midas Touch', manna: 20, presence: true, radius: 10, limit: 40, from: 'iron', to: 'gold' },
      { id: 'vanishing-resources', name: 'Vanishing Resources', manna: 25, presence: true, radius: 5, percent: 50 },
      { id: 'conversion', name: 'Conversion of the Barbarians', manna: 40, presence: true, radius: 10, limit: 10 },
    ],
  },
  evidence: {
    'specialistRouting': E(sources.spec, 'Automatic specialist duties choose the nearest reachable candidate through the normal movement router. This is engineering recovery behavior, not a Gold executable observation.'),
    'constructionOccupancy': E('https://github.com/stacksjs/the-settlers-iii-remake/issues/193', 'Construction rejects outside settlers on the footprint or already stepping onto it. This prevents physical enclosure during movement; original Gold construction behavior remains unobserved.'),
    'restingRouting': E('https://github.com/stacksjs/the-settlers-iii-remake/issues/201', 'Resting settlers choose a free tile reachable through the ordinary movement edges and civilian territory constraints. This prevents impossible repeated resting orders; original Gold crowd behavior remains unobserved.'),
    'constructionReassignment': E('https://github.com/paulwedeck/settlers-remake/blob/6ad8c4230a4aa4cd21840f8cb59a38344e41c3e0/jsettlers.logic/src/main/java/jsettlers/logic/map/grid/partition/manager/PartitionManager.java', 'Return surplus jobless builders and diggers to carriers through physical tool recovery. The pinned remake reconciles profession caps periodically and drops the real tool; this engineering profile uses its existing staffing cadence and absolute limits. Exact original Gold timing and percentage behavior remain unobserved. See issue204.'),
    'groundPileMerging': E('https://github.com/stacksjs/the-settlers-iii-remake/issues/205', 'A physical ground drop merges only into a compatible pile owned by the dropping player. This protects per-player conservation without transferring or granting goods. Exact original Gold ground-pile behavior remains unobserved.'),
    'staffingRouting': E('https://github.com/stacksjs/the-settlers-iii-remake/issues/206', 'Choose idle skilled workers and real tool/carrier pairs whose routes to the actual work destination succeed through the ordinary movement router. Unreachable workers remain where they are. This is engineering staffing behavior, not an original Gold observation.'),
    'worldMemory': E('https://github.com/paulwedeck/settlers-remake/blob/6ad8c4230a4aa4cd21840f8cb59a38344e41c3e0/jsettlers.logic/src/main/java/jsettlers/algorithms/fogofwar/FogOfWar.java', 'Freeze landscape, height and persistent map-object poses on loss of sight, as recordHidden and HiddenMapObject do. Renewed sight clears the snapshot. Current building visibility still uses this engine\'s any-footprint policy. Supported objects are its trees, stone, growing plants, building poses, piles and survey-marker poses. Player forecasts use the same router with remembered terrain and obstruction inputs, while actual movement still reads the world. Fleeting settlers, effects and airborne arrows are not remembered. This is pinned remake evidence, not original Gold observations.'),
    'tickRate': U('Original clock rate and speed settings are unobserved; 20 ticks per second is an engineering choice.', 'S3-002'),
    'goods': M(sources.jobs, 'Roman goods named by the occupations and production chains; complete catalog requires decoded content.', 'S3-007'),
    'tools': M(sources.jobs, 'Tool requirements: builders hammer, diggers shovel, woodcutter axe, stonecutter and miner pick, farmer scythe, fisherman rod, smiths hammer.', 'S3-031'),
    'terrain': E(`${sources.reference}/jsettlers.common/src/main/java/jsettlers/common/landscape/ELandscapeType.java and OriginalLandscape.java`, 'All 37 source identities, 29 original codes, source partition flags, resource groups, material selectors and phase policies follow the pinned reference remake.'),
    'constructionWaiting': E(sources.spec, 'Builders without materials return to the available crew, allowing earlier supplied sites to reuse their real tools instead of deadlocking behind a starved site.'),
    'terrain.moveCost': U('Traversal costs are engineering placeholders, not original observations.', 'S3-026'),
    'buildings.ground': E(`${sources.reference}/jsettlers.common/src/main/resources/jsettlers/common/buildings/roman and BuildingVariant.java#getRequiredGroundTypeAt`, 'Roman XML ground sets apply to sites and their protected border; mine origins require mountain or inner mountain border.'),
    'production.ground': E(`${sources.reference}/jsettlers.logic/src/main/java/jsettlers/logic/map/grid/MainGrid.java`, 'Tree planting requires grass or flattened grass; corn requires grass or earth within two tiles and vines within one. Waterworkers collect rivers and fishers sea water.'),
    'objects': U('Tree regrowth, stone quantity and crop timing are unobserved.', 'S3-041'),
    'professions': M(sources.jobs, 'Occupation and tool pairing; specialist status follows the manual occupation descriptions.', 'S3-031'),
    'professions.geologist.tool': U('Geologist tool is not explicit in the manual text.', 'S3-048'),
    'professions.pioneer.tool': U('Pioneer tool requirement is not stated in the manual text.', 'S3-048'),
    'movement': U('Movement, slope and occupancy timings are placeholders; the reference remake documents changed movement speed.', 'S3-027'),
    'movement.searchLimit': E(sources.spec, 'Bounded routing search is an engineering safety limit.'),
    'logistics.groundPileCapacity': M(sources.economy, 'Craftsmen stop when eight goods lie before the door; storage areas hold six piles of eight.', 'S3-029'),
    'logistics.carrierCapacity': U('Single-good carrier loads match observed sprites but are not yet an admitted observation.', 'S3-030'),
    'logistics.assignmentInterval': E(sources.spec, 'Scheduling cadence is an engineering decision and is not original behavior.'),
    'logistics.constructionFirst': M(sources.economy, 'Delivery of goods to building sites has priority over delivery to storage areas.', 'S3-034'),
    'population': M(sources.economy, 'Minimum carrier ratio applies to newly added settlers; builder and digger ratios are player controls.', 'S3-035'),
    'population.values': U('Default ratios and limits are placeholders.', 'S3-035'),
    'demolition': M(sources.demolish, 'Half of the materials needed for construction become available after demolition.', 'S3-033'),
    'territory': U('Territory radii and pioneer work rate are unobserved.', 'S3-038'),
    'visibility': U('Vision radii and refresh cadence are placeholders.', 'S3-036'),
    'survey': U('Geologist survey radius, timing and sign lifetime are unobserved.', 'S3-037'),
    'professions.soldiers': E(`${sources.reference}/jsettlers.common/src/main/java/jsettlers/common/movable/EMovableType.java and jsettlers.logic/src/main/java/jsettlers/logic/constants/Constants.java`, 'Soldier health and strength by rank, melee and pike reach, bow range 7 to 15 and 25 from towers, and one second between blows (1.2 for bows) follow the reference remake; not original observations.'),
    'military': U('Recruitment time, search radius in this engine and defence reach are placeholders; the search radius and tower bow range follow reference constants.', 'S3-053'),
    'military.wealth': E(`${sources.reference}/jsettlers.logic/src/main/java/jsettlers/logic/player/CombatStrengthInformation.java and SoldierMovable.java#getCombatStrength`, 'Damage scales with ln(gold + start) / (9 ln 2) by number of players, at least full strength on own ground, as the reference computes it; the manual confirms only that gold strengthens soldiers.'),
    'religion': E(`${sources.reference}/jsettlers.logic/src/main/java/jsettlers/logic/buildings/others/TempleBuilding.java, buildings/spawn/BigTemple.java and player/MannaInformation.java`, 'One wine every 30 seconds for one manna, promotion costs 10, 20, 30, 50, 60, 30 in order with no class more than a rank ahead of another, 8 manna once for a completed large temple and at most 100 priests per large temple follow the reference remake.'),
    'religion.interventions': M(`${sources.military} (Jupiter's Acts of Divine Intervention)`, 'Eight Roman interventions and what each does: the Magic Eye lifts fog and needs no priest nearby, Grassland Galore turns desert to grass, Gorgeous Growth speeds grain and grapes, Festering Fear halves enemy damage in your homeland for a short time, Heavenly Presents rains goods, the Midas Touch turns iron into gold, Vanishing Resources halves enemy mine resources, and Conversion wins enemy soldiers over.', 'S3-058'),
    'religion.interventions.values': E(`${sources.reference}/jsettlers.common/src/main/java/jsettlers/common/movable/ESpellType.java, EEffectType.java and jsettlers.logic/src/main/java/jsettlers/logic/movable/military/MageMovable.java`, 'Manna costs rising by a tenth per use, radii, limits, a 6 second eye, a 300 second growth effect at double speed, 30 seconds of half damage, up to 5 gift piles of up to 8 goods, up to 40 iron, half resources, up to 10 converted soldiers and a 10 tile casting distance follow the reference remake.'),
    'thieves': M(`${MANUAL}/in_menu/menu.htm#Moving and Using Thieves (sha256 6823c1be372ce3c6905d09753d867ecd637e6cd2c5bfa3e26ea5fd161be516bb)`, 'Thieves are converted from carriers, look like carriers to opponents until they come too near an enemy soldier, who then pursues them, pilfer goods when ordered with ALT, and are slow while carrying loot home.', 'S3-055'),
    'thieves.values': E(`${sources.reference}/jsettlers.logic/src/main/java/jsettlers/logic/movable/specialist/ThiefMovable.java and jsettlers.common/src/main/java/jsettlers/common/movable/EMovableType.java`, 'Health 100 and a 30 tile search for goods on foreign land follow the reference remake. The uncovering distance of 3 and the doubled step time while carrying are placeholders.'),
    'buildings.healers-hut.heal': E(`${sources.reference}/jsettlers.logic/src/main/java/jsettlers/logic/movable/civilian/HealerMovable.java and buildings/roman/hospital.xml`, 'The healer calls the most wounded soldier of his player within 20 tiles of the work area to the heal spot and restores full health, one treatment per four seconds; the manual confirms healers return wounded soldiers to health. Soldiers carrying out an order are not called, since the manual has the player send wounded soldiers to the healer.'),
    'religion.offerings': M(`${MANUAL}/ec_build/building.htm#Small Temple (sha256 10dcbad8d7c02a7873b263f1db81e7561368467f429c4b6b6113758122d65a9e)`, 'The small temple transforms wine offerings into manna; promotion needs manna, every promotion costing more than the one before.', 'S3-057'),
    'religion.priestTicks': M(`${MANUAL}/ec_build/building.htm#Large Temple (sha256 10dcbad8d7c02a7873b263f1db81e7561368467f429c4b6b6113758122d65a9e)`, 'A new priest every five minutes once a large temple stands; the reference remake uses ten minutes.', 'S3-057'),
    'objects.vine': E(`${sources.reference}/jsettlers.logic/src/main/java/jsettlers/logic/objects/growing/Wine.java and map/grid/MainGrid.java#isWinePlantable`, 'Vines ripen after nine minutes and are planted on grass beside a height difference of two, with no vine along that slope. Withering after three unharvested minutes is not modelled yet.'),
    'buildings.winery.workflow': M(`${MANUAL}/ec_build/building.htm#Winery (sha256 10dcbad8d7c02a7873b263f1db81e7561368467f429c4b6b6113758122d65a9e)`, 'Grapes grow on sloping terrain in the selected work area; the wine-grower needs no tool. The reference work radius is 4.', 'S3-056'),
    'buildings.small-temple.door': U('The reference places the small temple door inside its footprint, where it only marks the offering bowl; the engine uses the wine pile as the entrance until the original is observed.', 'S3-057'),
    'buildings.charcoal-maker.recipe': M(`${MANUAL}/ec_build/building.htm#Charcoal Maker's hut (sha256 10dcbad8d7c02a7873b263f1db81e7561368467f429c4b6b6113758122d65a9e)`, 'Five boards make one piece of charcoal, usable wherever coal is needed.', 'S3-056'),
    'military.promotion': M(sources.military, 'Promotion affects soldiers recruited afterwards; existing soldiers keep their rank.', 'S3-057'),
    'buildings.garrison': E(`${sources.reference}/jsettlers.common/src/main/resources/jsettlers/common/buildings/roman (occupyer entries)`, 'A small tower holds one infantry place and two bowman places, a large tower three and three, the castle five and six.'),
    'buildings.vision': U('Building sight is scaled from the reference view distances (tower 38, large tower 40, castle 40, lookout 50) to this engine\'s placeholder settler sight; territory radii of the towers are unobserved.', 'S3-036'),
    'buildings.large-residence.residents': U('Resident count and arrival interval are unobserved.', 'S3-035'),
    'buildings.barracks.cost-discrepancy': U('The manual table gives 4 planks and 5 stone; the reference definition gives 5 planks and 4 stone. The manual candidate is used until observed.', 'S3-007'),
    ...Object.fromEntries([
      'castle', 'storage', 'small-residence', 'medium-residence', 'small-tower', 'woodcutter', 'forester', 'stonecutter', 'sawmill', 'fisher', 'grain-farm', 'waterworks', 'mill', 'bakery', 'pig-farm', 'slaughterhouse',
      'coal-mine', 'iron-mine', 'gold-mine', 'iron-smelter', 'gold-smelter', 'toolsmith', 'weaponsmith', 'barracks', 'winery', 'charcoal-maker', 'small-temple', 'large-temple', 'healers-hut', 'large-tower', 'lookout-tower', 'large-residence',
    ].flatMap(id => [
      [`buildings.${id}.cost`, M(sources.table, 'Roman wood (planks) and stone columns of the building material table.', 'S3-032')],
      [`buildings.${id}.geometry`, E(`${sources.reference}/jsettlers.common/src/main/resources/jsettlers/common/buildings/roman (sha256 ${(REFERENCE_GEOMETRY as Record<string, { sha256: string }>)[id]!.sha256})`, 'Blocked and protected tiles, door, pile positions and builder spots from the reference remake definition; not yet compared with original building data.')],
      [`buildings.${id}.timing`, U('Levelling, construction and work-cycle durations are unobserved.', 'S3-032')],
    ])),
    'buildings.storage.storage': M(sources.economy, 'A storage area has six piles of eight pieces each.', 'S3-034'),
    'buildings.castle.storage': U('Castle storage behavior is unobserved; it reuses storage-area piles as a placeholder.', 'S3-034'),
    'buildings.small-residence.residents': U('Resident counts and arrival intervals are unobserved.', 'S3-035'),
    'buildings.medium-residence.residents': U('Resident counts and arrival intervals are unobserved.', 'S3-035'),
    'buildings.mines.food': M(sources.jobs, 'Preferred meals: iron miners meat, coal miners bread, gold miners fish; the economy page cites ten versus two descents for a gold miner.', 'S3-043'),
    'buildings.recipes': M(sources.economy, 'Production chains: farm, mill, waterworks, bakery; farm, pig farm, slaughterhouse; iron and coal mines, smelting, tool and weapon smiths. Quantities per cycle are unobserved.', 'S3-042'),
  },
})
