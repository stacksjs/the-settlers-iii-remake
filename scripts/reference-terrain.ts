// Reference-remake presentation evidence, independent of immutable simulation rules.
import { resolve } from 'node:path'
import { REFERENCE_LANDSCAPES } from '../resources/game/engine/reference-landscapes'
import { landscapeRevision } from './reference-landscapes'

export const terrainReferencePaths = [
  'jsettlers.graphics/src/main/java/jsettlers/graphics/map/draw/Background.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/map/draw/ETextureOrientation.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/map/draw/DrawConstants.java',
  'go.graphics/src/main/java/go/graphics/TextureHandle.java',
  'go.graphics.swing/src/main/java/go/graphics/swing/opengl/LWJGLDrawContext.java',
  'go.graphics.swing/src/main/glsl/go/graphics/swing/gl33/background.frag',
] as const
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
export function parseTerrainCatalog(background: string, orientation: string, constants: string) {
  const values = new Map([...constants.matchAll(/(?:int|float)\s+([A-Z_]+)\s*=\s*([\d.]+)f?;/g)].map(m => [m[1]!, Number(m[2])]))
  if (values.get('TEXTUREUNIT_X') !== 16 || values.get('TEXTUREUNIT_Y') !== 16 || values.get('TEXTURE_BORDER_OFFSET') !== 0.5 || values.get('DISTANCE_X') !== 16) throw new Error('Unsupported reference terrain units')
  const positions = [...strip(background.match(/TEXTURE_POSITIONS\s*=\s*\{([\s\S]*?)\n\s*\};/)?.[1] ?? '').matchAll(/\{\s*(\d+),\s*(\d+),\s*(\d+)\s*\}/g)].map(m => [Number(m[1]), Number(m[2]), Number(m[3])])
  if (positions.length !== 235 || positions.some(([x, y, size]) => !size || size > 5 || x! + size > 32 || y! + size > 32)) throw new Error('Incomplete reference terrain positions')
  const families = [...strip(background.match(/borderTextures = new TextureIntersections\[\] \{([\s\S]*?)\n\s*\};/)?.[1] ?? '').matchAll(/new TextureIntersections\(([^)]+)\)/g)].map(m => {
    const args = m[1]!.split(',').map(s => s.trim().replace('ELandscapeType.', '')), base = Number(args.pop())
    const [type1, type1alt, type2] = args.length === 2 ? [args[0]!, args[0]!, args[1]!] : args
    if (![2, 3].includes(args.length) || !Number.isInteger(base) || base < 0 || base + 3 >= positions.length || ![type1, type1alt, type2].every(name => REFERENCE_LANDSCAPES.some(t => t.name === name))) throw new Error('Invalid reference terrain family')
    return { type1: type1!, type1alt: type1alt!, type2: type2!, base }
  })
  if (families.length !== 41) throw new Error('Incomplete reference terrain families')
  // These source expressions contain only constants and the four arithmetic
  // operators. Parse that grammar, never execute downloaded source code.
  const arithmetic = (text: string): number => {
    const tokens = text.replace(/DrawConstants\.([A-Z_]+)/g, (_, key) => {
      const value = values.get(key); if (value === undefined) throw new Error(`Unknown terrain constant ${key}`); return String(value)
    }).replace(/\s/g, '').match(/\d+(?:\.\d+)?|[+*/-]/g) ?? []
    if (tokens.join('') !== text.replace(/DrawConstants\.([A-Z_]+)/g, (_, key) => String(values.get(key))).replace(/\s/g, '')) throw new Error('Unsupported terrain expression')
    let at = 0
    const number = (): number => { const value = Number(tokens[at++]); if (!Number.isFinite(value)) throw new Error('Invalid terrain number'); return value }
    const product = (): number => { let value = number(); while (tokens[at] === '*' || tokens[at] === '/') { const op = tokens[at++], other = number(); value = op === '*' ? value * other : value / other }; return value }
    let value = product()
    while (at < tokens.length) { const op = tokens[at++], other = product(); if (op !== '+' && op !== '-') throw new Error('Invalid terrain operator'); value += op === '+' ? other : -other }
    if (!Number.isFinite(value)) throw new Error('Invalid terrain coordinate')
    return value
  }
  const arrays = new Map([...strip(orientation).matchAll(/float\[\]\s+(\w+)\s*=\s*new float\[\]\s*\{([^}]+)\}/g)].map(m => [m[1]!, m[2]!.split(',').map(arithmetic)]))
  const orientations = Object.fromEntries([...strip(orientation).matchAll(/float\[\]\[\]\s+(\w+)\s*=\s*\{([^}]+)\}/g)].map(m => [m[1]!, m[2]!.split(',').map(name => arrays.get(name.trim()))])) as Record<string, number[][]>
  if (Object.keys(orientations).sort().join() !== 'CONTINUOS,LEFT,ORIENTATION,RIGHT' || Object.values(orientations).some(pair => pair.length !== 2 || pair.some(uv => uv?.length !== 6))) throw new Error('Incomplete reference terrain orientations')
  return { positions, families, orientations }
}
if (import.meta.main) {
  const inputs = await Promise.all(terrainReferencePaths.map(async path => {
    const response = await fetch(`https://raw.githubusercontent.com/paulwedeck/settlers-remake/${landscapeRevision}/${path}`, { signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`Reference terrain source unavailable: ${path}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    return { path, sha256: Bun.SHA256.hash(bytes, 'hex'), text: new TextDecoder().decode(bytes) }
  }))
  const catalog = parseTerrainCatalog(inputs[0]!.text, inputs[1]!.text, inputs[2]!.text)
  await Bun.write(resolve(import.meta.dir, '../resources/game/reference-terrain.ts'), `// Generated by scripts/reference-terrain.ts from paulwedeck/settlers-remake@${landscapeRevision}
// MIT, see third-party/settlers-remake-LICENSE.txt. Reference-remake evidence, not original observation.
export const TERRAIN_SOURCES = ${JSON.stringify(inputs.map(({ path, sha256 }) => ({ path, sha256 })), null, 2)} as const
export const REFERENCE_TERRAIN = ${JSON.stringify(catalog, null, 2)} as const
`)
  console.log(`Generated ${catalog.positions.length} atlas positions and ${catalog.families.length} ordered terrain families.`)
}
