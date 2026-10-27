import type { LandscapeRule } from './engine/rules'
import { REFERENCE_TERRAIN } from './reference-terrain'

/** Background's ordered identity selector. Texture aliases are not identities. */
export function sourceTerrainFace(left: LandscapeRule, apex: LandscapeRule, right: LandscapeRule, x: number, y: number, up: boolean) {
  let image = left.image
  let orientation: keyof typeof REFERENCE_TERRAIN.orientations = 'CONTINUOS'
  if (left.name !== apex.name || left.name !== right.name) {
    for (const family of REFERENCE_TERRAIN.families) {
      let first = 0, alternate = 0, second = 0
      for (const name of [left.name, apex.name, right.name]) {
        if (name === family.type1) first++
        else if (name === family.type1alt) alternate++
        if (name === family.type2) second++
      }
      if (first + alternate + second !== 3 || alternate === 2 || second === 0) continue
      image = family.base + (second === 2 ? 2 : 0) + ((up ? x * 37 + y * 17 : x) & 1)
      break
    }
    orientation = left.name === right.name ? 'ORIENTATION' : left.name === apex.name ? 'LEFT' : 'RIGHT'
  }
  const position = REFERENCE_TERRAIN.positions[image]
  if (!position) throw new RangeError('Unknown source terrain image')
  const period = (position[2] - 1) * 32
  const mod = (n: number): number => (n % period + period) % period
  const u = position[0] * 32 + (period ? mod(x * 16 - y * 8) : 0), v = position[1] * 32 + (period ? mod(y * 16) : 0)
  const coordinates = REFERENCE_TERRAIN.orientations[orientation][up ? 0 : 1]
  // The renderer's winding is source point 0,2,1 for both face directions.
  return { image, uv: [0, 4, 2].map(i => ({ u: coordinates[i]! + u, v: coordinates[i + 1]! + v })) }
}
