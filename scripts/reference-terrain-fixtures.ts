// Regenerate numeric browser goldens with the pinned Java selector itself.
// Requires a JDK only for regeneration, never for the game or its CI checks.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { TERRAIN_SOURCES } from '../resources/game/reference-terrain'
import { landscapeRevision } from './reference-landscapes'

const sources = await Promise.all(TERRAIN_SOURCES.slice(0, 3).map(async source => {
  const response = await fetch(`https://raw.githubusercontent.com/paulwedeck/settlers-remake/${landscapeRevision}/${source.path}`, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Reference unavailable: ${source.path}`)
  const bytes = await response.bytes()
  if (Bun.SHA256.hash(bytes, 'hex') !== source.sha256) throw new Error('Fixture source hash differs')
  return new TextDecoder().decode(bytes)
}))
const background = sources[0]!, strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
// This independent extraction generates inputs only. Expected images and UVs
// come from javac executing the source selection and phase code verbatim.
const types = (await import('../resources/game/engine/reference-landscapes')).REFERENCE_LANDSCAPES
const table = background.match(/private final TextureIntersections\[\] borderTextures = [\s\S]*?\n\s*\};/)![0]
const families = [...strip(table).matchAll(/new TextureIntersections\(([^)]+)\)/g)].map(m => m[1]!.split(',').slice(0, -1).map(s => s.trim().replace('ELandscapeType.', '')))
interface Case { label: string, names: string[], x: number, y: number, up: boolean, heights: number[], expected?: number[] }
const cases: Case[] = []
function add(label: string, names: string[], up: boolean, parity: number, heights = [0, 0, 0]): void {
  const n = cases.length, page = Math.floor(n / 30), slot = n % 30
  let x = 20 + page % 6 * 30 + slot % 5 * 3
  const y = 20 + Math.floor(page / 6) * 30 + Math.floor(slot / 5) * 3
  x += parity ^ ((x + (up ? y : 0)) & 1)
  cases.push({ label, names, x, y, up, heights })
}
families.forEach((family, i) => {
  const first = family[0]!, second = family[family.length - 1]!
  for (const up of [true, false]) for (const parity of [0, 1]) for (const pair of [first, second]) {
    const single = pair === first ? second : first
    for (const names of [[pair, single, pair], [pair, pair, single], [single, pair, pair]]) add(`family-${i}-${pair}-${names.indexOf(single)}`, names, up, parity)
  }
})
for (const river of ['RIVER1', 'RIVER2', 'RIVER3', 'RIVER4']) {
  const names = ['GRASS', 'SAND', river]
  for (const up of [true, false]) for (const parity of [0, 1]) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (a !== b) add(`three-identities-${river}`, [names[a]!, names[b]!, names[3 - a - b]!], up, parity)
}
for (const type of types) for (const up of [true, false]) for (const parity of [0, 1]) add(`uniform-${type.name}`, [type.name, type.name, type.name], up, parity)
for (const up of [true, false]) for (const parity of [0, 1]) {
  for (const names of [['GRASS', 'SAND', 'RIVER1'], ['SAND', 'RIVER1', 'SAND'], ['RIVER1', 'RIVER2', 'RIVER1'], ['SNOW', 'WATER8', 'DESERT'], ['GRASS', 'WATER2', 'GRASS'], ['WATER5', 'WATER4', 'WATER5']]) add('alternate-or-unmatched', names, up, parity)
  add('unequal-height', ['WATER1', 'WATER2', 'WATER1'], up, parity, [1, 2, 0])
}
const directory = await mkdtemp(resolve(tmpdir(), 'settlers-reference-terrain-'))
try {
  const positions = background.match(/private static final int\[\]\[\] TEXTURE_POSITIONS = [\s\S]*?\n\s*\};/)?.[0] ?? background.match(/(?:public|private) static final int\[\]\[\] TEXTURE_POSITIONS[\s\S]*?\n\s*\};/)?.[0]
  if (!positions) throw new Error('Missing original atlas positions')
  const intersections = background.slice(background.indexOf('private static class TextureIntersections'), background.indexOf('public Background('))
  const selection = background.slice(background.indexOf('\t\tfloat[] texturePos;', background.indexOf('private void addTriangleToGeometry')), background.indexOf('\n\n\t\t{', background.indexOf('private void addTriangleToGeometry')))
  const modulo = background.match(/private static int realModulo\(int number, int modulo\) \{[\s\S]*?\n\t\}/)![0]
  const java = `package jsettlers.graphics.map.draw;
import java.util.*;
public class TerrainProbe {
  static final int TEXTURE_SIZE=1024, TEXTURE_GRID=32;
  enum ELandscapeType { ${types.map(t => `${t.name}(${t.image})`).join(',')}; final int image; ELandscapeType(int image){this.image=image;} int getImageNumber(){return image;} }
  ${positions}
  ${intersections}
  ${table}
  ${modulo}
  float[] select(ELandscapeType leftLandscape, ELandscapeType aLandscape, ELandscapeType rightLandscape, int x1, int y, boolean up, int useSecondParameter) {
    ${selection}
    return new float[]{textureIndex,texturePos[0]+addDx,texturePos[1]+addDy,texturePos[2]+addDx,texturePos[3]+addDy,texturePos[4]+addDx,texturePos[5]+addDy};
  }
  public static void main(String[] args) { TerrainProbe probe=new TerrainProbe(); Scanner in=new Scanner(System.in); while(in.hasNextLine()){String[] p=in.nextLine().split(" "); int x=Integer.parseInt(p[3]),y=Integer.parseInt(p[4]);boolean up=Boolean.parseBoolean(p[5]);System.out.println(Arrays.toString(probe.select(ELandscapeType.valueOf(p[0]),ELandscapeType.valueOf(p[1]),ELandscapeType.valueOf(p[2]),x,y,up,up?x*37+y*17:x)));} }
}`
  const javaFiles = ['TerrainProbe.java', 'ETextureOrientation.java', 'DrawConstants.java']
  await Promise.all([java, sources[1]!, sources[2]!].map((source, i) => Bun.write(resolve(directory, javaFiles[i]!), source)))
  const compile = Bun.spawn(['javac', '-d', directory, ...javaFiles.map(file => resolve(directory, file))], { stdout: 'inherit', stderr: 'inherit' })
  if (await compile.exited !== 0) throw new Error('Reference Java fixture compilation failed')
  const run = Bun.spawn(['java', '-cp', directory, 'jsettlers.graphics.map.draw.TerrainProbe'], { stdin: new Blob([cases.map(c => [...c.names, c.x, c.y, c.up].join(' ')).join('\n') + '\n']), stdout: 'pipe', stderr: 'inherit' })
  const lines = (await new Response(run.stdout).text()).trim().split('\n')
  if (await run.exited !== 0 || lines.length !== cases.length) throw new Error('Reference Java fixture execution failed')
  cases.forEach((c, i) => { c.expected = JSON.parse(lines[i]!) })
  const catalogPositions = [...strip(positions).matchAll(/\{\s*(\d+),\s*(\d+),\s*(\d+)\s*\}/g)].map(m => [Number(m[1]), Number(m[2]), Number(m[3])])
  await Bun.write(resolve(import.meta.dir, '../tests/fixtures/terrain-transition-cases.json'), JSON.stringify({ revision: landscapeRevision, sources: TERRAIN_SOURCES.slice(0, 3), oracle: 'Pinned Java selection, orientations and phase executed with javac; numeric metadata only', positions: catalogPositions, families: families.length, cases }, null, 2) + '\n')
  console.log(`Executed pinned Java selector for ${cases.length} independent browser cases.`)
}
finally { await rm(directory, { recursive: true, force: true }) }
