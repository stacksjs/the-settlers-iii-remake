import type { MapState, RulesProfile } from './engine'
import { DIRECTIONS } from './engine/geometry'

// MapObjectDrawer.nextFrame/drawPlayerBorderObject, pinned remake 6ad8c42.
export const borderPostImage = { key: 'border-post', file: 13, sequence: 65, frame: 0 } as const
export const borderReferencePaths = [
  'jsettlers.graphics/src/main/java/jsettlers/graphics/map/draw/MapObjectDrawer.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/map/MapContent.java',
  'jsettlers.logic/src/main/java/jsettlers/algorithms/borders/BordersThread.java',
  'jsettlers.logic/src/main/java/jsettlers/logic/map/grid/MainGrid.java',
  'jsettlers.logic/src/main/java/jsettlers/logic/map/grid/landscape/LandscapeGrid.java',
] as const

/** BordersThread ignores blocked landscape and neighbors beyond the map. */
export function borderPostAt(map: MapState, rules: RulesProfile, tile: number): boolean {
  const owner = map.owner[tile]
  if (!owner || !rules.terrain[map.terrain[tile]!]!.walkable) return false
  const x = tile % map.width, y = Math.floor(tile / map.width)
  return DIRECTIONS.some(([dx, dy]) => {
    const nx = x + dx, ny = y + dy
    if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) return false
    const neighbor = ny * map.width + nx
    return rules.terrain[map.terrain[neighbor]!]!.walkable && map.owner[neighbor] !== owner
  })
}
