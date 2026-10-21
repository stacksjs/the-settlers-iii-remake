export const SIZE = 28
export const RESOURCES = ['logs', 'planks', 'stone', 'fish', 'grain', 'flour', 'bread', 'ore', 'coal', 'iron', 'swords'] as const
export type Resource = typeof RESOURCES[number]
export type Stock = Record<Resource, number>
export type Kind = 'headquarters' | 'woodcutter' | 'sawmill' | 'quarry' | 'fishery' | 'farm' | 'mill' | 'bakery' | 'ironmine' | 'coalmine' | 'smelter' | 'smith' | 'barracks' | 'tower' | 'residence'
export type Terrain = 'grass' | 'forest' | 'rock' | 'water' | 'iron' | 'coal' | 'sand'
export interface Definition { name: string, category: string, cost: Partial<Stock>, seconds: number, build: number, input?: Partial<Stock>, output?: Partial<Stock>, near?: Terrain, description: string }
export const BUILDINGS: Record<Kind, Definition> = {
  headquarters: { name: 'Headquarters', category: 'Settlement', cost: {}, seconds: 0, build: 0, description: 'Your settlement heart. Protect it from raiders.' },
  woodcutter: { name: 'Woodcutter', category: 'Materials', cost: { planks: 2 }, seconds: 5, build: 4, output: { logs: 2 }, near: 'forest', description: 'Harvests 2 logs from nearby woodland.' },
  sawmill: { name: 'Sawmill', category: 'Materials', cost: { planks: 3, stone: 1 }, seconds: 6, build: 5, input: { logs: 2 }, output: { planks: 3 }, description: 'Turns 2 logs into 3 building planks.' },
  quarry: { name: 'Stonecutter', category: 'Materials', cost: { planks: 3 }, seconds: 7, build: 5, output: { stone: 2 }, near: 'rock', description: 'Cuts 2 stone from a nearby rock deposit.' },
  fishery: { name: 'Fishery', category: 'Food', cost: { planks: 4, stone: 1 }, seconds: 8, build: 5, output: { fish: 3 }, near: 'water', description: 'Lands 3 fish. Build near the river or coast.' },
  farm: { name: 'Grain farm', category: 'Food', cost: { planks: 5, stone: 2 }, seconds: 9, build: 7, output: { grain: 3 }, description: 'Grows 3 grain for your bread supply.' },
  mill: { name: 'Windmill', category: 'Food', cost: { planks: 4, stone: 3 }, seconds: 6, build: 6, input: { grain: 2 }, output: { flour: 2 }, description: 'Grinds 2 grain into 2 flour.' },
  bakery: { name: 'Bakery', category: 'Food', cost: { planks: 4, stone: 3 }, seconds: 7, build: 6, input: { flour: 2 }, output: { bread: 4 }, description: 'Bakes 4 bread. Miners and soldiers need food.' },
  ironmine: { name: 'Iron mine', category: 'Industry', cost: { planks: 5, stone: 4 }, seconds: 8, build: 8, input: { fish: 1 }, output: { ore: 2 }, near: 'iron', description: 'Miners eat 1 fish to extract 2 iron ore.' },
  coalmine: { name: 'Coal mine', category: 'Industry', cost: { planks: 5, stone: 4 }, seconds: 8, build: 8, input: { fish: 1 }, output: { coal: 3 }, near: 'coal', description: 'Miners eat 1 fish to extract 3 coal.' },
  smelter: { name: 'Iron smelter', category: 'Industry', cost: { planks: 5, stone: 5 }, seconds: 7, build: 8, input: { ore: 2, coal: 1 }, output: { iron: 2 }, description: 'Smelts 2 ore and 1 coal into 2 iron.' },
  smith: { name: 'Weaponsmith', category: 'Industry', cost: { planks: 5, stone: 5 }, seconds: 8, build: 8, input: { iron: 1, coal: 1 }, output: { swords: 1 }, description: 'Forges a sword from iron and coal.' },
  barracks: { name: 'Barracks', category: 'Military', cost: { planks: 6, stone: 5 }, seconds: 9, build: 10, input: { swords: 1, bread: 1 }, description: 'Trains a soldier with 1 sword and 1 bread.' },
  tower: { name: 'Guard tower', category: 'Military', cost: { planks: 4, stone: 4 }, seconds: 0, build: 8, description: 'Claims surrounding land and adds 2 defense.' },
  residence: { name: 'Residence', category: 'Settlement', cost: { planks: 5, stone: 3 }, seconds: 0, build: 6, description: 'Houses 6 more settlers for work and service.' },
}
export interface Building { id: number, kind: Kind, x: number, y: number, progress: number, built: number, enabled: boolean, cycles: number }
export interface World { version: 1, seed: number, tick: number, stock: Stock, buildings: Building[], soldiers: number, enemy: number, enemyHealth: number, health: number, nextRaid: number, raid: number, result: 'playing' | 'won' | 'lost', log: string[], nextId: number }
export function terrain(x: number, y: number, seed = 7): Terrain {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return 'water'
  if (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1) return 'water'
  const river = 17 + Math.round(Math.sin(y / 4) * 1.3)
  if (Math.abs(x - river) < 1 && y !== 13 && y !== 14) return 'water'
  if ((x - 9) ** 2 + (y - 13) ** 2 < 5 || (x - 23) ** 2 + (y - 10) ** 2 < 5) return 'grass'
  if ((x - 8) ** 2 + (y - 6) ** 2 < 6) return 'iron'
  if ((x - 13) ** 2 + (y - 9) ** 2 < 5) return 'coal'
  if ((x - 5) ** 2 + (y - 15) ** 2 < 7 || (x - 24) ** 2 + (y - 18) ** 2 < 6) return 'rock'
  const n = Math.abs(Math.sin(x * 127.1 + y * 311.7 + seed) * 43758.5453) % 1
  if ((x < 7 || y > 17 || y < 5) && n > 0.3) return 'forest'
  return n > 0.95 ? 'sand' : 'grass'
}
export function createWorld(seed = 7): World {
  return { version: 1, seed, tick: 0, stock: { logs: 12, planks: 32, stone: 24, fish: 14, grain: 0, flour: 0, bread: 12, ore: 0, coal: 0, iron: 0, swords: 0 }, buildings: [{ id: 1, kind: 'headquarters', x: 9, y: 13, built: 0, progress: 0, enabled: true, cycles: 0 }], soldiers: 3, enemy: 3, enemyHealth: 18, health: 20, nextRaid: 180, raid: 0, result: 'playing', log: ['A new shore. Establish a woodcutter, sawmill and stonecutter.'], nextId: 2 }
}
export const distance = (a: { x: number, y: number }, b: { x: number, y: number }): number => Math.hypot(a.x - b.x, a.y - b.y)
export function owned(world: World, x: number, y: number): boolean {
  return world.buildings.some(b => b.built === 0 && (b.kind === 'headquarters' || b.kind === 'tower') && distance(b, { x, y }) <= (b.kind === 'headquarters' ? 7 : 5))
}
export function population(world: World): number { return 18 + world.buildings.filter(b => b.kind === 'residence' && b.built === 0).length * 6 }
export function employed(world: World): number { return world.buildings.filter(b => !['headquarters', 'residence', 'tower'].includes(b.kind)).length + world.soldiers }
export function affordable(stock: Stock, cost: Partial<Stock>): boolean { return Object.entries(cost).every(([key, amount]) => stock[key as Resource] >= amount) }
function transfer(stock: Stock, cost: Partial<Stock>, sign: number): void { for (const [key, value] of Object.entries(cost)) stock[key as Resource] += value * sign }
export function placementError(world: World, kind: Kind, x: number, y: number): string | null {
  if (world.result !== 'playing') return 'This campaign has ended. Start a new island.'
  if (kind === 'headquarters') return 'You already have headquarters.'
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 1 || y < 1 || x >= SIZE - 1 || y >= SIZE - 1) return 'Choose a tile on the island.'
  if (world.buildings.some(b => b.x === x && b.y === y)) return 'There is already a building here.'
  if (!owned(world, x, y)) return 'Build inside your borders. Guard towers extend them.'
  if (!['grass', 'sand'].includes(terrain(x, y, world.seed))) return 'Choose clear ground.'
  const definition = BUILDINGS[kind]
  if (!affordable(world.stock, definition.cost)) return 'Not enough building materials.'
  if (!['residence', 'tower'].includes(kind) && employed(world) >= population(world)) return 'Build a residence for more settlers.'
  if (definition.near) {
    let found = false
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (Math.hypot(dx, dy) <= 3 && terrain(x + dx, y + dy, world.seed) === definition.near) found = true
    if (!found) return `Build within 3 tiles of ${definition.near}.`
  }
  return null
}
export function notify(world: World, text: string): void { world.log.unshift(text); world.log = world.log.slice(0, 30) }
export function place(world: World, kind: Kind, x: number, y: number): string | null {
  const error = placementError(world, kind, x, y)
  if (error) return error
  transfer(world.stock, BUILDINGS[kind].cost, -1)
  world.buildings.push({ id: world.nextId++, kind, x, y, built: BUILDINGS[kind].build, progress: 0, enabled: true, cycles: 0 })
  notify(world, `${BUILDINGS[kind].name} construction started.`)
  return null
}
export function status(world: World, b: Building): string {
  if (!b.enabled) return 'Work paused'
  if (b.built > 0) return 'Under construction'
  if (!BUILDINGS[b.kind].seconds) return 'Operational'
  if (!affordable(world.stock, BUILDINGS[b.kind].input ?? {})) return 'Waiting for supplies'
  if (b.kind === 'barracks' && employed(world) >= population(world)) return 'Needs settlers'
  return 'Working'
}
export function step(world: World, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 1) throw new RangeError('Step must be between 0 and 1 seconds')
  if (world.result !== 'playing') return
  world.tick += seconds
  for (const b of world.buildings) {
    if (!b.enabled) continue
    if (b.built > 0) { b.built = Math.max(0, b.built - seconds); if (b.built === 0) notify(world, `${BUILDINGS[b.kind].name} completed.`); continue }
    const def = BUILDINGS[b.kind]
    if (status(world, b) !== 'Working') continue
    b.progress += seconds
    if (b.progress >= def.seconds) {
      b.progress -= def.seconds
      transfer(world.stock, def.input ?? {}, -1)
      transfer(world.stock, def.output ?? {}, 1)
      if (b.kind === 'barracks') world.soldiers++
      b.cycles++
    }
  }
  if (world.tick >= world.nextRaid) {
    world.raid++
    const strength = 2 + world.raid * 2
    const towers = world.buildings.filter(b => b.kind === 'tower' && b.built === 0).length
    const defense = world.soldiers + towers * 2
    world.soldiers = Math.max(0, world.soldiers - Math.floor(strength / 3))
    const damage = Math.max(0, strength - defense)
    world.health = Math.max(0, world.health - damage)
    world.enemy += 2
    world.nextRaid += 150
    notify(world, damage ? `Raid repelled at a cost. Headquarters lost ${damage} strength.` : 'Your soldiers held the border. The raid was repelled.')
    if (world.health === 0) { world.result = 'lost'; notify(world, 'Your headquarters has fallen. A new island awaits.') }
  }
}
export function attack(world: World): string | null {
  if (world.result !== 'playing') return 'The campaign has ended.'
  if (world.soldiers < 4) return 'Train at least 4 soldiers before marching.'
  if (!world.buildings.some(b => b.kind === 'tower' && b.built === 0 && b.x >= 15)) return 'Build a guard tower near the river crossing first.'
  const damage = Math.max(1, world.soldiers - world.enemy)
  world.enemyHealth = Math.max(0, world.enemyHealth - damage)
  world.soldiers = Math.max(0, world.soldiers - Math.ceil(world.enemy / 2))
  world.enemy = Math.max(1, world.enemy - 1)
  notify(world, `Your expedition dealt ${damage} damage to the rival stronghold.`)
  if (world.enemyHealth === 0) { world.result = 'won'; notify(world, 'The valley is yours. Your settlement has prevailed!') }
  return null
}
export function demolish(world: World, id: number): void {
  const b = world.buildings.find(b => b.id === id)
  if (!b || b.kind === 'headquarters' || world.result !== 'playing') return
  world.buildings = world.buildings.filter(item => item.id !== id)
  for (const [key, amount] of Object.entries(BUILDINGS[b.kind].cost)) world.stock[key as Resource] += Math.floor(amount / 2)
  notify(world, `${BUILDINGS[b.kind].name} dismantled. Half the materials recovered.`)
}
/** Saves are untrusted input. Validate structure, bounds and unique occupancy before adoption. */
export function restore(value: unknown): World {
  if (!value || typeof value !== 'object') throw new Error('No saved campaign found.')
  const w = value as World
  const finite = (n: unknown, max = 1e9): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max
  if (w.version !== 1 || !Number.isInteger(w.seed) || !finite(w.tick) || !finite(w.health, 20) || !finite(w.enemyHealth, 18) || !finite(w.soldiers, 100000) || !finite(w.enemy, 100000) || !finite(w.raid) || !finite(w.nextRaid) || !['playing', 'won', 'lost'].includes(w.result)) throw new Error('Saved campaign is incompatible or damaged.')
  if (!w.stock || !RESOURCES.every(key => finite(w.stock[key])) || !Array.isArray(w.buildings) || w.buildings.length > SIZE * SIZE || !Array.isArray(w.log) || w.log.length > 30 || !w.log.every(line => typeof line === 'string' && line.length <= 300)) throw new Error('Saved campaign is damaged.')
  const positions = new Set<string>(), ids = new Set<number>()
  for (const b of w.buildings) {
    if (!Object.hasOwn(BUILDINGS, b.kind) || !Number.isInteger(b.x) || !Number.isInteger(b.y) || b.x < 1 || b.y < 1 || b.x >= SIZE - 1 || b.y >= SIZE - 1 || !finite(b.built, BUILDINGS[b.kind].build) || !finite(b.progress, Math.max(1, BUILDINGS[b.kind].seconds)) || !finite(b.cycles) || !Number.isInteger(b.id) || b.id < 1 || typeof b.enabled !== 'boolean' || positions.has(`${b.x},${b.y}`) || ids.has(b.id)) throw new Error('Saved buildings are damaged.')
    positions.add(`${b.x},${b.y}`); ids.add(b.id)
  }
  if (w.buildings.filter(b => b.kind === 'headquarters').length !== 1 || !Number.isInteger(w.nextId) || w.nextId <= Math.max(...ids)) throw new Error('Saved campaign is damaged.')
  return structuredClone(w)
}
