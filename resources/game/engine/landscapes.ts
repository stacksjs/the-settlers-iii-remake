import type { TerrainRule } from './rules'
import { REFERENCE_LANDSCAPES } from './reference-landscapes'

/** Stable public names retain the existing authored-map vocabulary. */
const names: Record<string, string> = { GRASS: 'grass', MOUNTAIN: 'mountain', SAND: 'sand', DESERT: 'desert', MOOR: 'moor', SNOW: 'snow', MUD: 'swamp', WATER1: 'water' }
export const landscapeId = (name: string): string => names[name] ?? name.toLowerCase().replaceAll('_', '-').replace(/border/g, '-border').replace(/outer/g, '-outer').replace(/([a-z])(\d)/g, '$1-$2')

/** Source groups are decisions, not substitutes for the canonical identity. */
export const terrainIs = (terrain: TerrainRule, group: string): boolean => terrain.landscape ? terrain.landscape.groups.includes(group) : terrain.id === group
export const holdsResource = (terrain: TerrainRule, good: string): boolean => good === 'fish' ? terrain.water : terrain.landscape ? terrainIs(terrain, 'mountain') : !terrain.water
export const suppliesWater = (terrain: TerrainRule): boolean => terrain.landscape ? terrainIs(terrain, 'river') : terrain.water
export const materialKey = (image: number): string => ({ 0: 'terrain-grass', 17: 'terrain-water', 21: 'terrain-rock', 31: 'terrain-sand' })[image] ?? `terrain-source-${image}`

export function referenceTerrain(): TerrainRule[] {
  return REFERENCE_LANDSCAPES.map(source => ({
    id: landscapeId(source.name), walkable: !source.blocking, buildable: ['GRASS', 'EARTH', 'FLATTENED'].includes(source.name), water: source.water,
    // Movement costs remain engineering values, separate from source classification.
    moveCost: source.groups.some(group => group === 'mountain') || source.name === 'SNOW' || source.name === 'MOOR' ? 2 : source.name === 'MUD' ? 3 : 1,
    landscape: { ...source, groups: [...source.groups] },
  }))
}
