import type { RulesProfile } from './rules'
import type { PlayerScenario, PlayerSetup, ScenarioPile } from './session'
import type { MapState } from './state'
import { holdsResource } from './landscapes'
import { emptyMap } from './map'

// Turns a decoded original map into an engine world. Class mappings follow the
// pinned reference remake's OriginalLandscape, EOriginalMapObjectType and
// material tables (paulwedeck/settlers-remake@6ad8c42): reference-remake
// evidence, not original observation. Records the engine cannot represent yet
// are counted in diagnostics instead of being approximated. Soldiers keep the
// class and rank the map gives them, including those stationed in buildings.

/** The decoded fields this builder reads; scripts/lib/s3-map.ts produces a superset. */
export interface OriginalMapInput {
  area: { size: number, elevation: ArrayLike<number>, landscape: ArrayLike<number>, objects: ArrayLike<number>, resourceType: ArrayLike<number>, resourceAmount: ArrayLike<number> }
  players: { index: number, civilization: number, startX: number, startY: number, name: string }[]
  settlers: { player: number, referenceName: string | null, x: number, y: number }[]
  /** Garrison counts by class and rank, as the original stores them per building. */
  buildings: { player: number, referenceName: string | null, x: number, y: number, soldiers?: Partial<Record<'sword1' | 'sword2' | 'sword3' | 'archer1' | 'archer2' | 'archer3' | 'spear1' | 'spear2' | 'spear3', number>> }[]
  stacks: { x: number, y: number, referenceName: string | null, amount: number }[]
}

const LANDSCAPE: Record<string, number[]> = {
  water: [0, 1, 2, 3, 4, 5, 6, 7, 96, 97, 98, 99], grass: [16], mountain: [17, 32, 33], desert: [20, 64, 65],
  moor: [21, 80, 81], swamp: [23, 144, 145], snow: [35, 128, 129], sand: [48],
}
// Original heights run 0..225; the reference scales them to 0..127 before projecting.
const HEIGHT_SCALE = 127 / 225
const RESOURCES = ['fish', 'coal', 'ironore', 'goldore', 'gems', 'sulfur']
const ROMAN = 0, FREE_CHOICE = 255
const supportedOriginalCivilization = (civilization: number): boolean => civilization === ROMAN || civilization === FREE_CHOICE

/** Roman v1 presentation slots keep source indices after unsupported players are omitted. */
export function originalPlayerSlots(players: OriginalMapInput['players']): number[] {
  const slots = players.filter(player => supportedOriginalCivilization(player.civilization)).map(player => player.index)
  if (slots.some(slot => !Number.isInteger(slot) || slot < 0 || slot >= 32) || new Set(slots).size !== slots.length) throw new Error('Invalid original player slots')
  return slots
}

const BUILDINGS: Record<string, string> = {
  STOCK: 'storage', LUMBERJACK: 'woodcutter', STONECUTTER: 'stonecutter', SAWMILL: 'sawmill', FORESTER: 'forester', COALMINE: 'coal-mine', GOLDMINE: 'gold-mine', IRONMINE: 'iron-mine',
  GOLDMELT: 'gold-smelter', Eisenschmelze: 'iron-smelter', TOOLSMITH: 'toolsmith', WEAPONSMITH: 'weaponsmith', TOWER: 'small-tower', Muehle: 'mill', CASTLE: 'castle', BAKER: 'bakery',
  Metzger: 'slaughterhouse', PIG_FARM: 'pig-farm', FARM: 'grain-farm', FISHER: 'fisher', LIVINGHOUSE_SMALL: 'small-residence', LIVINGHOUSE_MEDIUM: 'medium-residence', WATERWORKS: 'waterworks',
}
const PROFESSIONS: Record<string, string> = {
  BEARER: 'carrier', DIGGER: 'digger', BRICKLAYER: 'builder', LUMBERJACK: 'woodcutter', STONECUTTER: 'stonecutter', SAWMILLER: 'sawyer', FORESTER: 'forester', MELTER: 'smelter', MINER: 'miner',
  MILLER: 'miller', BAKER: 'baker', BUTCHER: 'butcher', FARMER: 'farmer', FISHERMAN: 'fisher', WATERWORKER: 'waterworker', GEOLOGIST: 'geologist', PIG_FARMER: 'pigfarmer', PIONEER: 'pioneer',
  // The original distinguishes no tool smith from weapon smith settler; the reference names both SMITH.
  SMITH: 'toolsmith',
}
const SOLDIERS: Record<string, [string, number]> = {
  SWORDSMAN_L1: ['swordsman', 1], SWORDSMAN_L2: ['swordsman', 2], SWORDSMAN_L3: ['swordsman', 3], PIKEMAN_L1: ['pikeman', 1], PIKEMAN_L2: ['pikeman', 2], PIKEMAN_L3: ['pikeman', 3],
  BOWMAN_L1: ['bowman', 1], BOWMAN_L2: ['bowman', 2], BOWMAN_L3: ['bowman', 3],
}
const GARRISON: Record<string, string> = { sword: 'swordsman', archer: 'bowman', spear: 'pikeman' }
const GOODS: Record<string, string> = {
  PLANK: 'plank', STONE: 'stone', TRUNK: 'log', BREAD: 'bread', COAL: 'coal', GOLDORE: 'goldore', IRONORE: 'ironore', FISH: 'fish', CROP: 'grain', GOLD: 'gold', IRON: 'iron',
  SPADE: 'shovel', HAMMER: 'hammer', AXE: 'axe', PICK: 'pickaxe', SAW: 'saw', FISHINGROD: 'fishingrod', SWORD: 'sword', BOW: 'bow', SPEAR: 'spear', FLOUR: 'flour', PIG: 'pig', MEAT: 'meat', WATER: 'water', SCYTHE: 'scythe',
}

export class OriginalLandscapeError extends Error {
  readonly code = 'unsupported-original-landscape'
  constructor(readonly landscape: number, readonly tile: number, readonly x: number, readonly y: number) { super(`Unsupported original landscape ${landscape} at (${x}, ${y}).`) }
}

export interface OriginalWorld { map: MapState, players: PlayerSetup[], piles: ScenarioPile[], diagnostics: Record<string, number> }

export function worldFromOriginal(rules: RulesProfile, input: OriginalMapInput): OriginalWorld {
  const size = input.area.size, map = emptyMap(size, size), diagnostics: Record<string, number> = {}
  const note = (key: string, n = 1): void => { diagnostics[key] = (diagnostics[key] ?? 0) + n }
  const terrain = new Map<number, number>()
  const sourceCatalog = rules.terrain.some(t => t.landscape)
  if (sourceCatalog) {
    for (const [index, rule] of rules.terrain.entries()) if (rule.landscape?.originalCode !== undefined) terrain.set(rule.landscape.originalCode, index)
  }
  else for (const [id, codes] of Object.entries(LANDSCAPE)) {
    const index = rules.terrain.findIndex(t => t.id === id)
    if (index < 0) throw new RangeError(`Rules profile lacks terrain ${id}`)
    for (const code of codes) terrain.set(code, index)
  }
  const tree = rules.objects.findIndex(o => o.id === 'tree') + 1, stone = rules.objects.findIndex(o => o.id === 'stone') + 1
  for (let t = 0; t < size * size; t++) {
    const code = input.area.landscape[t]!
    const kind = terrain.get(code)
    if (kind === undefined && sourceCatalog) throw new OriginalLandscapeError(code, t, t % size, Math.floor(t / size))
    if (kind === undefined) note(`landscape ${code} unmapped; drawn as grass`)
    map.terrain[t] = kind ?? terrain.get(16)!
    map.elevation[t] = Math.max(0, Math.min(255, Math.round(input.area.elevation[t]! * HEIGHT_SCALE)))
    const object = input.area.objects[t]!
    if ((object >= 68 && object <= 80) || object === 84) { map.object[t] = tree; map.objectAmount[t] = 1 }
    else if (object >= 115 && object <= 127) { map.object[t] = stone; map.objectAmount[t] = object - 114 }
    else if (object >= 1 && object <= 8) note('decorative objects not represented')
    else if (object) note(`object ${object} unclassified`)
    const amount = input.area.resourceAmount[t]!
    if (amount) {
      const good = RESOURCES[input.area.resourceType[t]!]
      const index = good ? rules.goods.indexOf(good) : -1
      if (index < 0) note(`resource ${good ?? input.area.resourceType[t]} not in the ${rules.id} profile`)
      else if (holdsResource(rules.terrain[map.terrain[t]!]!, good!)) { map.resource[t] = index + 1; map.resourceAmount[t] = amount }
      else note(`resource ${good} on mismatched terrain`)
    }
  }
  const players: PlayerSetup[] = [], numbering = new Map<number, number>()
  for (const p of input.players) {
    if (!supportedOriginalCivilization(p.civilization)) { note(`player ${p.index} civilization ${p.civilization} not implemented`); continue }
    numbering.set(p.index, players.length + 1)
    players.push({ name: p.name || `Player ${players.length + 1}`, civilization: 'roman', start: { x: p.startX, y: p.startY }, scenario: { buildings: [], settlers: [] } })
  }
  const scenarioOf = (player: number): PlayerScenario | null => { const n = numbering.get(player); return n ? players[n - 1]!.scenario! : null }
  for (const b of input.buildings) {
    const s = scenarioOf(b.player), type = BUILDINGS[b.referenceName ?? '']
    if (!s) { note('buildings of unsupported players'); continue }
    if (!type || !rules.buildings.some(r => r.id === type)) { note(`building ${b.referenceName} not in the ${rules.id} profile`); continue }
    s.buildings.push({ type, x: b.x, y: b.y })
    // Soldiers the map stations in a building arrive beside it and take their places in its garrison.
    for (const [key, count] of Object.entries(b.soldiers ?? {})) {
      if (!count) continue
      const profession = GARRISON[key.slice(0, -1)]!, rank = Number(key.slice(-1))
      if (!rules.military || !rules.professions.some(p => p.id === profession && p.soldier)) { note(`garrisoned ${profession} not in the ${rules.id} profile`, count); continue }
      for (let i = 0; i < count; i++) s.settlers.push({ profession, x: b.x, y: b.y, rank })
    }
  }
  for (const settler of input.settlers) {
    const s = scenarioOf(settler.player), soldier = SOLDIERS[settler.referenceName ?? '']
    const profession = soldier && rules.military && rules.professions.some(p => p.id === soldier[0] && p.soldier) ? soldier[0] : PROFESSIONS[settler.referenceName ?? '']
    if (!s) { note('settlers of unsupported players'); continue }
    if (!profession) { note(`settler ${settler.referenceName} not represented`); continue }
    s.settlers.push({ profession, x: settler.x, y: settler.y, ...(soldier && profession === soldier[0] ? { rank: soldier[1] } : {}) })
  }
  // Map piles belong to whoever owns their tile once the scenario's buildings stand.
  const piles: ScenarioPile[] = []
  for (const stack of input.stacks) {
    const good = GOODS[stack.referenceName ?? '']
    if (!good || !rules.goods.includes(good)) { note(`pile ${stack.referenceName} not in the ${rules.id} profile`); continue }
    piles.push({ good, x: stack.x, y: stack.y, amount: stack.amount })
  }
  // Maps without placed buildings (multiplayer starts) leave the opening to the start-resource setting,
  // which is an unverified engineering default here.
  for (const p of players) if (!p.scenario!.buildings.length) { if (p.scenario!.settlers.length) note('settlers without buildings use the default start'); delete p.scenario }
  return { map, players, piles, diagnostics }
}
