import { DEFAULT_PLAYER_SLOTS, NEUTRAL_RGB, PLAYER_PALETTE, playerRGB } from './player-colors'
import type { RGB } from './player-colors'
import type { Observation, Point } from './engine'

// The overview map (manual: Menus in the Game, The Overview Map). It is drawn
// only from what the player may know: explored terrain, owners of explored
// land, and the buildings and settlers in the player's view. The map is sheared
// the way the playing area is, so the view rectangle matches the screen.

export type TerritoryMode = 'players' | 'simple' | 'topographic'
export type SettlerMode = 'military' | 'all' | 'none'
export interface MinimapOptions { territory: TerritoryMode, settlers: SettlerMode, buildings: boolean }

const TERRAIN: Record<string, [number, number, number]> = {
  grass: [86, 128, 58], water: [46, 86, 140], mountain: [118, 112, 104], desert: [196, 170, 112], moor: [96, 82, 58], swamp: [62, 82, 60], snow: [226, 230, 236], sand: [208, 190, 140],
}
const LAND: RGB = [96, 120, 70], SEA: RGB = [46, 86, 140], UNKNOWN: RGB = [10, 16, 14]
export const PLAYER_RGB = [NEUTRAL_RGB, ...PLAYER_PALETTE]

/** Pixel size of the sheared overview for a map. */
export const minimapSize = (width: number, height: number): { width: number, height: number } => ({ width: width + Math.ceil(height / 2), height })
/** Where a tile lands on the overview, and back. */
export const toMinimap = (p: Point, height: number): Point => ({ x: p.x - Math.floor(p.y / 2) + Math.ceil(height / 2), y: p.y })
export const fromMinimap = (p: Point, height: number): Point => ({ x: p.x + Math.floor(p.y / 2) - Math.ceil(height / 2), y: p.y })

/** RGBA pixels of the overview map for one player's observation. */
export function minimapPixels(o: Observation, options: MinimapOptions, slots: readonly number[] = DEFAULT_PLAYER_SLOTS): Uint8ClampedArray<ArrayBuffer> {
  const size = minimapSize(o.width, o.height), pixels = new Uint8ClampedArray(size.width * size.height * 4)
  const put = (p: Point, rgb: RGB, alpha = 255): void => {
    const at = toMinimap(p, o.height)
    if (at.x < 0 || at.y < 0 || at.x >= size.width || at.y >= size.height) return
    const i = (at.y * size.width + at.x) * 4
    if (alpha === 255) { pixels[i] = rgb[0]; pixels[i + 1] = rgb[1]; pixels[i + 2] = rgb[2] }
    else for (let c = 0; c < 3; c++) pixels[i + c] = Math.round((pixels[i + c]! * (255 - alpha) + rgb[c]! * alpha) / 255)
    pixels[i + 3] = 255
  }
  const kinds = new Map(o.rules.terrain.map(t => [t.id, t]))
  const colors = new Map(o.rules.terrain.filter(t => t.landscape).map(t => [t.id, t.landscape!.color.slice(1).match(/../g)!.map(c => Number.parseInt(c, 16)) as unknown as RGB]))
  for (let y = 0; y < o.height; y++) {
    for (let x = 0; x < o.width; x++) {
      const t = y * o.width + x, terrain = o.terrain(t)
      if (terrain === null) { put({ x, y }, UNKNOWN); continue }
      const water = kinds.get(terrain)?.water ?? false
      put({ x, y }, options.territory === 'topographic' ? colors.get(terrain) ?? TERRAIN[terrain] ?? LAND : water ? SEA : LAND)
      // Player colours show who holds explored land; the other modes leave the land itself.
      const owner = o.view.owner[t]!
      if (options.territory === 'players' && owner && !water) put({ x, y }, playerRGB(slots, owner), 150)
      // Fog: explored but not currently seen land is drawn darker.
      if (o.view.visible[t] !== 1) put({ x, y }, UNKNOWN, 90)
    }
  }
  if (options.buildings) for (const b of o.view.buildings) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) put({ x: b.x + dx!, y: b.y + dy! }, playerRGB(slots, b.owner))
  if (options.settlers !== 'none') {
    for (const s of o.view.settlers) {
      if (s.inside || (options.settlers === 'military' && s.rank === undefined)) continue
      put({ x: s.x, y: s.y }, playerRGB(slots, s.owner))
    }
  }
  return pixels
}

/** The tile an alert points at: its own tile, else the entity it names if the player can see it. */
export function alertTarget(o: Pick<Observation, 'explored' | 'view' | 'width'>, event: { tile?: number, entity?: number }): Point | null {
  if (event.tile !== undefined && o.explored(event.tile)) return { x: event.tile % o.width, y: Math.floor(event.tile / o.width) }
  const thing = event.entity === undefined ? undefined : o.view.buildings.find(b => b.id === event.entity) ?? o.view.settlers.find(s => s.id === event.entity)
  return thing ? { x: thing.x, y: thing.y } : null
}
