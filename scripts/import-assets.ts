import { terrainReferencePaths, parseTerrainCatalog } from './reference-terrain'
import { TERRAIN_SOURCES, REFERENCE_TERRAIN } from '../resources/game/reference-terrain'
import { landscapeReferencePaths, parseLandscapes } from './reference-landscapes'
import { LANDSCAPE_SOURCES, REFERENCE_LANDSCAPES } from '../resources/game/engine/reference-landscapes'
import { materialKey } from '../resources/game/engine/landscapes'
import type { Sprite } from './lib/s3-dat'
import { Buffer } from 'node:buffer'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { png } from '@stacksjs/ts-png'
import { originalPlayerSlots } from '../resources/game/engine/original'
import { isPlayerSprite, playerColorReferences } from '../resources/game/player-colors'
import { shadowReferencePaths } from '../resources/game/shadow-images'
import { geologistImages, geologistReferencePaths } from '../resources/game/geologist-images'
import { interfaceImages, interfaceReferencePaths } from '../resources/game/interface-assets'
import { surveyReferencePaths, surveySigns } from '../resources/game/survey-signs'
import { S3Dat } from './lib/s3-dat'
import { decodeOriginalMap } from './lib/s3-map'
import { verifiedDownload } from './lib/verified-download'
import { writeContentManifest } from './lib/content-provenance'
import { borderPostImage, borderReferencePaths } from '../resources/game/border-posts'
import type { ContentCategory, ProvenanceInput, ProvenanceFile } from './lib/content-provenance'

const root = resolve(import.meta.dir, '..')
const reference = resolve(root, 'storage/reference')
const source = resolve(reference, 'demo')
const output = resolve(root, 'public/assets/settlers-original')
const revision = '6ad8c4230a4aa4cd21840f8cb59a38344e41c3e0'
const repository = 'https://github.com/paulwedeck/settlers-remake'
const download = 'https://archive.org/download/S3aDemoUs/s3a_demo_us.exe'
const sha1 = 'b6e9d8217e17fb0b9e028b0ad61542611a9eb07d'
const sha256 = 'ac87c418101aadeb2338f04ecc79a56bf816ce1c6c7adc40bb7dc435ca4e7f65'
const provenanceInputs = new Map<string, ProvenanceInput>()
const provenanceOutputs: Array<Omit<ProvenanceFile, 'sha256' | 'bytes'>> = []
const addInput = (id: string, kind: ProvenanceInput['kind'], path: string, bytes: Uint8Array, extra: { revision?: string, url?: string } = {}): string => {
  provenanceInputs.set(id, { id, kind, path, bytes: bytes.length, sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'), ...extra })
  return id
}
const converterPaths = ['scripts/import-assets.ts', 'scripts/lib/s3-dat.ts', 'scripts/lib/s3-map.ts', 'scripts/lib/content-provenance.ts', 'scripts/lib/verified-download.ts', 'resources/game/interface-assets.ts', 'resources/game/survey-signs.ts', 'resources/game/geologist-images.ts', 'resources/game/player-colors.ts', 'resources/game/shadow-images.ts', 'resources/game/engine/original.ts', 'scripts/reference-terrain.ts', 'resources/game/reference-terrain.ts', 'scripts/reference-landscapes.ts', 'resources/game/engine/reference-landscapes.ts', 'resources/game/engine/landscapes.ts', 'package.json', 'bun.lock']
converterPaths.push('resources/game/border-posts.ts')
const converterBytes = await Promise.all(converterPaths.map(path => readFile(resolve(root, path))))
const converterInputs = converterPaths.map((path, index) => addInput(`converter:${path}`, 'converter', path, converterBytes[index]!))
const addOutput = (path: string, categories: ContentCategory[], inputs: string[], selection: string[]): void => {
  provenanceOutputs.push({ path, categories: [...new Set(categories)], inputs: [...new Set([...converterInputs, ...colorReferences.map(path => `reference:${path}`), ...inputs])], selection: [...new Set(selection)] })
}
// Converted media is regenerated from scratch, so files from an earlier mapping never linger unmapped.
await rm(output, { recursive: true, force: true })
await mkdir(reference, { recursive: true }); await mkdir(output, { recursive: true })
const archivePath = resolve(reference, 's3a_demo_us.exe')
console.log('Verifying the original Amazons demo, downloading it if needed...')
await verifiedDownload(archivePath, download, sha256)
const extraction = Bun.spawnSync(['unzip', '-q', '-o', archivePath, 'Gfx/*', 'Snd/*', 'Map/TUTORIAL/T1.MAP', 'Readme.txt', '-d', source], { stdout: 'inherit', stderr: 'inherit' })
if (extraction.exitCode !== 0) throw new Error('Could not extract the demo data')
addInput('demo:Readme.txt', 'original-file', 'Readme.txt', await readFile(resolve(source, 'Readme.txt')))
const getReference = async (path: string): Promise<string> => {
  const url = `https://raw.githubusercontent.com/paulwedeck/settlers-remake/${revision}/${path}`
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Reference file unavailable: ${path}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  addInput(`reference:${path}`, 'reference-source', path, bytes, { revision, url })
  return new TextDecoder().decode(bytes)
}
await getReference('README.md')
await getReference('LICENSE.txt')
const colorReferences = ['jsettlers.common/src/main/java/jsettlers/common/Color.java', 'jsettlers.graphics/src/main/java/jsettlers/graphics/image/reader/DatFileType.java']
for (const path of colorReferences) await getReference(path)
const landscapeSources = await Promise.all(landscapeReferencePaths.map(async path => {
  const text = await getReference(path), expected = LANDSCAPE_SOURCES.find(source => source.path === path)
  if (!expected || provenanceInputs.get(`reference:${path}`)?.sha256 !== expected.sha256) throw new Error(`Landscape source hash differs: ${path}`)
  return text
}))
if (JSON.stringify(parseLandscapes(landscapeSources[0]!, landscapeSources[1]!, landscapeSources[2]!)) !== JSON.stringify(REFERENCE_LANDSCAPES)) throw new Error('Generated landscape catalog differs from pinned sources')
const terrainSources = await Promise.all(terrainReferencePaths.map(async path => {
  const text = landscapeReferencePaths.some(existing => existing === path) ? landscapeSources[landscapeReferencePaths.findIndex(existing => existing === path)]! : await getReference(path)
  if (provenanceInputs.get(`reference:${path}`)?.sha256 !== TERRAIN_SOURCES.find(source => source.path === path)?.sha256) throw new Error(`Terrain presentation source hash differs: ${path}`)
  return text
}))
if (JSON.stringify(parseTerrainCatalog(terrainSources[0]!, terrainSources[1]!, terrainSources[2]!)) !== JSON.stringify(REFERENCE_TERRAIN)) throw new Error('Generated terrain presentation differs from pinned sources')
const tutorialBytes = await readFile(resolve(source, 'Map/TUTORIAL/T1.MAP'))
const tutorialInput = addInput('demo:Map/TUTORIAL/T1.MAP', 'original-file', 'Map/TUTORIAL/T1.MAP', tutorialBytes)
const tutorial = decodeOriginalMap(new Uint8Array(tutorialBytes))
for (const path of playerColorReferences) await getReference(path)
for (const path of shadowReferencePaths) if (!provenanceInputs.has(`reference:${path}`)) await getReference(path)
for (const path of borderReferencePaths) if (!provenanceInputs.has(`reference:${path}`)) await getReference(path)
const mappingPath = 'jsettlers.graphics/src/main/resources/jsettlers/graphics/image/reader/versions/amazon_demo.json'
const mappings = JSON.parse(await getReference(mappingPath)).datFileMappings as ({ settlersMapping?: number[], guiMapping?: number[] } | null)[]
const datFiles = new Map<number, S3Dat>()
const datInputs = new Map<number, string>()
const names = await readdir(resolve(source, 'Gfx'))
async function dat(file: number): Promise<S3Dat> {
  if (!datFiles.has(file)) {
    const name = names.find(name => name.toLowerCase() === `siedler3_${String(file).padStart(2, '0')}.f8007e01f.dat`)
    if (!name) throw new Error(`Missing graphics file ${file}`)
    const bytes = await readFile(resolve(source, 'Gfx', name))
    datInputs.set(file, addInput(`demo:Gfx/${name}`, 'original-file', `Gfx/${name}`, bytes))
    datFiles.set(file, new S3Dat(bytes))
  }
  return datFiles.get(file)!
}
const entries: { key: string, frame: number, source: { file: number, sequence: number, actualSequence: number, section: number, frame: number, layerSequence?: number }, inputs: string[], selection: string[], sprite: Sprite, torso?: string | null, shadow?: string | null }[] = []
// Sprites the demo data does not contain are listed in the manifest rather than substituted.
const missing: { key: string, file: number, sequence: number, frame: number | null, reason: string }[] = []
async function sequence(key: string, file: number, gold: number, frames: number[] | 'all', references: string[] = [], optional = false): Promise<void> {
  const reader = await dat(file), actual = mappings[file]?.settlersMapping?.[gold] ?? gold
  if (actual < 0) {
    if (!optional) throw new Error(`Demo does not include required sprite ${key}`)
    missing.push({ key, file, sequence: gold, frame: null, reason: 'sequence absent from the demo mapping' }); return
  }
  const starts = reader.frames(actual)
  const selected = frames === 'all' ? starts.map((_, index) => index) : frames
  if (optional && !selected.length) { missing.push({ key, file, sequence: gold, frame: null, reason: 'sequence has no frames in the demo' }); return }
  for (const index of selected) {
    if (starts[index] === undefined && optional) { missing.push({ key, file, sequence: gold, frame: index, reason: 'frame absent from the demo' }); continue }
    if (starts[index] === undefined) throw new Error(`Missing frame ${key}:${index}`)
    entries.push({ key, frame: entries.filter(entry => entry.key === key).length, source: { file, sequence: gold, actualSequence: actual, section: 0x106, frame: index },
      inputs: [datInputs.get(file)!, `reference:${mappingPath}`, ...references], selection: [`${datInputs.get(file)}:section=0x106,gold-sequence=${gold},demo-sequence=${actual},frame=${index}`],
      sprite: (() => { try { return reader.decode(starts[index]!) } catch (error) { throw new Error(`Failed ${key} file ${file} sequence ${gold}/${actual} frame ${index}`, { cause: error }) } })() })
  }
}
// Engine building ids mapped to the reference remake's Roman building definitions.
const buildingFiles = {
  'castle': 'castle', 'storage': 'stock', 'small-residence': 'small_livinghouse', 'medium-residence': 'medium_livinghouse', 'small-tower': 'tower', 'barracks': 'barrack',
  'woodcutter': 'lumberjack', 'forester': 'forester', 'stonecutter': 'stonecutter', 'sawmill': 'sawmill', 'fisher': 'fisher', 'grain-farm': 'farm', 'waterworks': 'waterworks',
  'mill': 'mill', 'bakery': 'baker', 'pig-farm': 'pig_farm', 'slaughterhouse': 'slaughterhouse', 'coal-mine': 'coalmine', 'iron-mine': 'ironmine', 'gold-mine': 'goldmine',
  'iron-smelter': 'ironmelt', 'gold-smelter': 'goldmelt', 'toolsmith': 'toolsmith', 'weaponsmith': 'weaponsmith',
  'winery': 'winegrower', 'charcoal-maker': 'charcoal_burner', 'small-temple': 'temple', 'large-temple': 'big_temple', 'healers-hut': 'hospital',
  'large-tower': 'big_tower', 'lookout-tower': 'lookout_tower', 'large-residence': 'big_livinghouse',
}
const imported: string[] = []
for (const [key, name] of Object.entries(buildingFiles)) {
  const path = `jsettlers.common/src/main/resources/jsettlers/common/buildings/roman/${name}.xml`
  const xml = await getReference(path)
  const images = [...xml.matchAll(/<image\s+([^>]+)>/g)].map(match => Object.fromEntries([...match[1]!.matchAll(/(\w+)="([^"]*)"/g)].map(attr => [attr[1], attr[2]]))).filter(attrs => attrs.type === 'SETTLER')
  const final = images.filter(attrs => attrs.for === 'FINAL'), site = images.filter(attrs => attrs.for === 'BUILD')
  if (!final.length) throw new Error(`No original image mapping for ${name}`)
  const before = entries.length
  for (const image of final) await sequence(`building:${key}`, Number(image.file), Number(image.sequence), [Number(image.image)], [`reference:${path}`], true)
  for (const image of site) await sequence(`site:${key}`, Number(image.file), Number(image.sequence), [Number(image.image)], [`reference:${path}`], true)
  if (entries.slice(before).some(entry => entry.key === `building:${key}`)) imported.push(key)
}
// Goods: original pile sequences hold one image per pile size, carriers hold one walking cycle per direction.
// Sequence numbers come from the reference remake's EMaterialType and movables-ROMAN tables.
const goodsSprites: Record<string, { stack: number, carry: number }> = {
  log: { stack: 41, carry: 4 }, plank: { stack: 33, carry: 1 }, stone: { stack: 43, carry: 2 }, grain: { stack: 50, carry: 11 }, flour: { stack: 48, carry: 12 }, water: { stack: 77, carry: 15 },
  bread: { stack: 49, carry: 5 }, pig: { stack: 73, carry: 3 }, meat: { stack: 52, carry: 10 }, fish: { stack: 47, carry: 9 }, coal: { stack: 34, carry: 6 }, ironore: { stack: 39, carry: 8 },
  goldore: { stack: 36, carry: 7 }, iron: { stack: 42, carry: 13 }, gold: { stack: 37, carry: 14 }, hammer: { stack: 51, carry: 16 }, shovel: { stack: 55, carry: 21 }, axe: { stack: 46, carry: 35 },
  saw: { stack: 54, carry: 20 }, pickaxe: { stack: 53, carry: 17 }, scythe: { stack: 56, carry: 19 }, fishingrod: { stack: 66, carry: 18 }, sword: { stack: 59, carry: 24 },
  spear: { stack: 60, carry: 23 }, bow: { stack: 63, carry: 22 }, wine: { stack: 69, carry: 54 },
}
const materialTables = ['jsettlers.common/src/main/java/jsettlers/common/material/EMaterialType.java', 'jsettlers.graphics/src/main/resources/jsettlers/graphics/map/draw/settlerimages/movables-ROMAN.txt', 'jsettlers.graphics/src/main/resources/jsettlers/graphics/map/draw/settlerimages/movables.txt']
for (const path of materialTables) await getReference(path)
const materialRefs = materialTables.map(path => `reference:${path}`)
for (const [good, { stack, carry }] of Object.entries(goodsSprites)) {
  await sequence(`stack:${good}`, 1, stack, [0, 1, 2, 3, 4, 5, 6, 7], materialRefs, true)
  await sequence(`carry:${good}`, 10, carry, 'all', materialRefs, true)
}
await sequence('sapling', 1, 22, 'all', [], true)
await sequence('crop', 1, 23, [0, 1, 2, 3, 4, 5, 6, 7, 8], [], true)
// Vines: three growth steps then ripe grapes (reference MapObjectDrawer, objects file sequence 25).
await sequence('vine', 1, 25, [0, 1, 2, 3], [], true)
await sequence(borderPostImage.key, borderPostImage.file, borderPostImage.sequence, [borderPostImage.frame], borderReferencePaths.map(path => `reference:${path}`))
for (const [i, seq] of [1, 2, 4, 7, 8, 16, 17].entries()) await sequence(`tree-${i}`, 1, seq, [0])
await sequence('stone-deposit', 1, 31, [0, 4, 8])
for (const path of surveyReferencePaths) await getReference(path)
const surveyReferences = surveyReferencePaths.map(path => `reference:${path}`)
for (const image of surveySigns) await sequence(image.key, image.file, image.sequence, Array.from({ length: image.frames }, (_, frame) => frame), surveyReferences)
await sequence('worker', 10, 0, 'all')
for (const path of geologistReferencePaths) if (!provenanceInputs.has(`reference:${path}`)) await getReference(path)
for (const image of geologistImages) await sequence(image.key, image.file, image.sequence, Array.from({ length: image.frames }, (_, frame) => frame), geologistReferencePaths.map(path => `reference:${path}`))
// Roman soldiers by rank, from the reference remake's movables-ROMAN table (file 12, ranks 1 to 3).
const soldierSprites: Record<string, [number, number, number]> = { swordsman: [9, 11, 10], pikeman: [15, 17, 16], bowman: [21, 23, 22] }
for (const [profession, ranks] of Object.entries(soldierSprites)) for (const [rank, seq] of ranks.entries()) await sequence(`soldier:${profession}-${rank + 1}`, 12, seq, 'all', materialRefs, true)
// Strikes and shots: the ACTION1 sequences of the same table, one per rank.
const strikeSprites: Record<string, [number, number, number]> = { swordsman: [12, 13, 14], pikeman: [18, 19, 20], bowman: [24, 25, 26] }
for (const [profession, ranks] of Object.entries(strikeSprites)) for (const [rank, seq] of ranks.entries()) await sequence(`strike:${profession}-${rank + 1}`, 12, seq, 'all', materialRefs, true)
// Roman priests (the reference's MAGE): file 11, walking sequence 195.
await sequence('priest', 11, 195, 'all', materialRefs, true)
const torsoReferences = [
  'jsettlers.graphics/src/main/java/jsettlers/graphics/image/reader/AdvancedDatFileReader.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/image/reader/translator/TorsoTranslator.java',
  'jsettlers.graphics/src/main/java/jsettlers/graphics/image/SettlerImage.java',
]
for (const path of torsoReferences) await getReference(path)
// Preserve bodies and grayscale clothing separately. The painter applies the
// owning player's palette and gives opaque body pixels reference precedence.
const clothing: typeof entries = []
for (const entry of entries.filter(entry => isPlayerSprite(entry.key))) {
  entry.torso = null
  const reader = await dat(entry.source.file)
  if (!reader.has(entry.source.actualSequence, 0x3112)) continue
  const layerSequence = reader.layerSequence(entry.source.actualSequence, 0x3112)!
  const at = reader.frames(entry.source.actualSequence, 0x3112)[entry.source.frame]
  if (at === undefined) continue
  entry.torso = `torso:${entry.key}`
  entry.inputs.push(...torsoReferences.map(path => `reference:${path}`), ...playerColorReferences.map(path => `reference:${path}`))
  entry.selection.push('body=untinted,player-color=reference-runtime-slot')
  clothing.push({ key: entry.torso, frame: entry.frame, source: { ...entry.source, section: 0x3112, layerSequence },
    inputs: [...entry.inputs], selection: [`${datInputs.get(entry.source.file)}:section=0x3112,body-sequence=${entry.source.actualSequence},physical-torso-sequence=${layerSequence},frame=${entry.source.frame},grayscale=original`], sprite: reader.decode(at, 'torso') })
}
entries.push(...clothing)
// Movable shadow mappings are identity for files 10/11/12 before the
// reference's independent table alignment. They are not torso selectors.
const shadows: typeof entries = []
for (const entry of entries.filter(entry => isPlayerSprite(entry.key))) {
  entry.shadow = null
  if (![10, 11, 12, 13].includes(entry.source.file)) throw new Error(`Original player sprite shadow mapping is not implemented for DAT ${entry.source.file}`)
  const reader = await dat(entry.source.file), layerSequence = reader.layerSequence(entry.source.actualSequence, 0x5982)
  if (layerSequence === null) continue
  const at = reader.frames(entry.source.actualSequence, 0x5982)[entry.source.frame]
  if (at === undefined) continue
  entry.shadow = `shadow:${entry.key}`
  const references = shadowReferencePaths.map(path => `reference:${path}`)
  shadows.push({ key: entry.shadow, frame: entry.frame, source: { ...entry.source, section: 0x5982, layerSequence }, inputs: [datInputs.get(entry.source.file)!, `reference:${mappingPath}`, ...references],
    selection: [`${datInputs.get(entry.source.file)}:section=0x5982,body-sequence=${entry.source.actualSequence},physical-shadow-sequence=${layerSequence},frame=${entry.source.frame},alpha=136`], sprite: reader.decode(at, 'shadow') })
}
entries.push(...shadows)
for (let index = 0; index < REFERENCE_TERRAIN.positions.length; index++) {
  const landscape = await dat(0), at = landscape.frames(index, 0x2412)[0]!
  entries.push({ key: materialKey(index), frame: 0, source: { file: 0, sequence: index, actualSequence: index, section: 0x2412, frame: 0 },
    inputs: [datInputs.get(0)!, ...terrainReferencePaths.map(path => `reference:${path}`)], selection: [`${datInputs.get(0)}:section=0x2412,sequence=${index},frame=0,color=565`], sprite: landscape.decode(at, '565', 'landscape') })
}
const width = 1024
let x = 1, y = 1, row = 0
const records = entries.map(entry => {
  const { width: w, height: h, offsetX, offsetY } = entry.sprite
  if (x + w + 1 > width) { x = 1; y += row + 2; row = 0 }
  const result = { key: entry.key, frame: entry.frame, x, y, width: w, height: h, offsetX, offsetY, source: entry.source, inputs: entry.inputs, selection: entry.selection, ...(entry.torso !== undefined ? { torso: entry.torso } : {}), ...(entry.shadow !== undefined ? { shadow: entry.shadow } : {}) }
  x += w + 2; row = Math.max(row, h)
  return result
})
const height = y + row + 1, pixels = Buffer.alloc(width * height * 4)
for (const [index, entry] of entries.entries()) {
  const r = records[index]!
  for (let row = 0; row < r.height; row++) entry.sprite.data.copy(pixels, ((r.y + row) * width + r.x) * 4, row * r.width * 4, (row + 1) * r.width * 4)
}
const atlasBytes = png.sync.write({ width, height, data: pixels })
const atlasFile = `sprites.${Bun.SHA256.hash(atlasBytes, 'hex')}.png`
await Bun.write(resolve(output, atlasFile), atlasBytes)
await Bun.write(resolve(output, 'manifest.json'), JSON.stringify({ version: 3, playerSlots: [{ id: 'demo:Map/TUTORIAL/T1.MAP', digest: provenanceInputs.get(tutorialInput)!.sha256, slots: originalPlayerSlots(tutorial.players) }], atlas: atlasFile, width, height, source: { repository, revision, download, sha1, sha256 }, sprites: records, missing }, null, 2))
addOutput(atlasFile, ['buildings', 'terrain', 'vegetation-and-deposits', 'settlers-and-soldiers', 'goods-and-wares'], entries.flatMap(entry => entry.inputs), entries.flatMap(entry => entry.selection))
addOutput('manifest.json', ['generated-metadata'], [tutorialInput, ...entries.flatMap(entry => entry.inputs)], ['Original atlas selectors, dimensions, displacements and pinned source identities'])
console.log(`Converted ${records.length} original sprites into a ${width}x${height} transparent PNG atlas. ${missing.length} requested sprites are absent from the demo and listed in the manifest.`)

// Individual composites let STX's construction catalog use the same original artwork.
for (const key of imported) {
  const layers = entries.filter(entry => entry.key === `building:${key}`).map(entry => entry.sprite)
  const left = Math.min(...layers.map(s => s.offsetX)), top = Math.min(...layers.map(s => s.offsetY))
  const width = Math.max(...layers.map(s => s.offsetX + s.width)) - left, height = Math.max(...layers.map(s => s.offsetY + s.height)) - top
  const data = Buffer.alloc(width * height * 4)
  for (const s of layers) for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
    const from = (y * s.width + x) * 4
    if (s.data[from + 3]) s.data.copy(data, ((y + s.offsetY - top) * width + x + s.offsetX - left) * 4, from, from + 4)
  }
  await Bun.write(resolve(output, `${key}.png`), png.sync.write({ width, height, data }))
  const used = entries.filter(entry => entry.key === `building:${key}`)
  addOutput(`${key}.png`, ['buildings'], used.flatMap(entry => entry.inputs), used.flatMap(entry => entry.selection))
}

// Native images and browser images consume the same unmodified interface PNGs.
// Keep them separate from the world atlas so UI chrome does not change sprite indices.
for (const path of interfaceReferencePaths) await getReference(path)
const interfaceReferences = interfaceReferencePaths.map(path => `reference:${path}`)
const interfaceInputs: string[] = []
const interfaceSelections: string[] = []
await mkdir(resolve(output, 'ui'), { recursive: true })
for (const image of interfaceImages) {
  const reader = await dat(image.file)
  const mapping = image.section === 0x11306 ? mappings[image.file]?.guiMapping : mappings[image.file]?.settlersMapping
  const actual = mapping?.[image.sequence] ?? image.sequence
  if (actual < 0) throw new Error(`Demo does not include required interface image ${image.key}`)
  const at = reader.frames(actual, image.section)[image.frame]
  if (at === undefined) throw new Error(`Demo does not include required interface frame ${image.key}`)
  const sprite = reader.decode(at, '565', image.section === 0x11306 ? 'gui' : 'displaced')
  if (sprite.width !== image.width || sprite.height !== image.height) throw new Error(`Original interface image ${image.key} has unexpected dimensions ${sprite.width}x${sprite.height}`)
  await Bun.write(resolve(output, image.path), png.sync.write({ width: sprite.width, height: sprite.height, data: sprite.data }))
  const input = datInputs.get(image.file)!
  const selection = `${input}:section=0x${image.section.toString(16)},gold-sequence=${image.sequence},demo-sequence=${actual},frame=${image.frame},header=${image.section === 0x11306 ? 'gui' : 'displaced'},color=565`
  addOutput(image.path, ['interface-and-icons'], [input, `reference:${mappingPath}`, ...interfaceReferences], [selection])
  interfaceInputs.push(input)
  interfaceSelections.push(selection)
}
await Bun.write(resolve(output, 'ui-manifest.json'), JSON.stringify({ version: 1, source: { repository, revision, download, sha256 }, images: interfaceImages }, null, 2))
addOutput('ui-manifest.json', ['generated-metadata'], [...interfaceInputs, `reference:${mappingPath}`, ...interfaceReferences], interfaceSelections)
console.log(`Converted ${interfaceImages.length} original interface images, including all three reference panel resolutions.`)

// The original sound bank stores mono PCM. Write complete, browser-readable WAV headers.
const sounds = await readFile(resolve(source, 'Snd/Siedler3_00.dat'))
const soundInput = addInput('demo:Snd/Siedler3_00.dat', 'original-file', 'Snd/Siedler3_00.dat', sounds)
const soundFiles: Record<string, string> = {}
for (const [name, id] of Object.entries({ build: 1, wood: 0, click: 62, birds: 69, river: 71, raid: 80 })) {
  const group = sounds.readUInt32LE(0x24 + id * 4)
  if (group + 8 > sounds.length || sounds.readUInt32LE(group) < 1) throw new Error(`Missing original sound ${id}`)
  const at = sounds.readUInt32LE(group + 4), length = Math.floor(sounds.readUInt32LE(at) / 2) * 2 - 32, rate = sounds.readUInt32LE(at + 8)
  if (length <= 0 || at + 20 + length > sounds.length || rate < 8000 || rate > 96000) throw new Error('Invalid original PCM sound')
  const wav = Buffer.alloc(44 + length)
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + length, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28)
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(length, 40)
  sounds.copy(wav, 44, at + 20, at + 20 + length)
  soundFiles[name] = `${name}.wav`
  await Bun.write(resolve(output, `${name}.wav`), wav)
  addOutput(`${name}.wav`, [name === 'birds' || name === 'river' ? 'ambience' : 'sound-effects'], [soundInput], [`${soundInput}:group=${id},sample=0,pcm-offset=${at + 20},pcm-bytes=${length},rate=${rate},channels=1,bits=16`])
}
await Bun.write(resolve(output, 'sounds.json'), JSON.stringify(soundFiles, null, 2))
addOutput('sounds.json', ['generated-metadata'], [soundInput], ['Names and source group selectors for six converted PCM WAV files'])
// The demo's Roman tutorial map, decoded once so the browser can build an engine world from it.
// Original codes are kept; resources/game/engine/original.ts maps them with reference-remake evidence.

const layer = (values: ArrayLike<number>): string => Buffer.from(Uint8Array.from(values)).toString('base64')
await mkdir(resolve(output, 'maps'), { recursive: true })
await Bun.write(resolve(output, 'maps/t1.json'), JSON.stringify({
  version: 1, source: { path: 'Map/TUTORIAL/T1.MAP', sha256: provenanceInputs.get(tutorialInput)!.sha256, version: tutorial.format.version }, size: tutorial.area.size,
  layers: { elevation: layer(tutorial.area.elevation), landscape: layer(tutorial.area.landscape), objects: layer(tutorial.area.objects), resourceType: layer(tutorial.area.resourceType), resourceAmount: layer(tutorial.area.resourceAmount) },
  players: tutorial.players, settlers: tutorial.settlers, buildings: tutorial.buildings, stacks: tutorial.stacks,
}))
addOutput('maps/t1.json', ['tutorials'], [tutorialInput], [`${tutorialInput}:decoded-parts=${tutorial.parts.filter(part => part.decoded).map(part => part.type).join('+')},diagnostics=${tutorial.diagnostics.length}`])
console.log(`Converted the original tutorial map: ${tutorial.area.size}x${tutorial.area.size}, ${tutorial.players.length} players, ${tutorial.diagnostics.length} decoder diagnostics.`)
await writeContentManifest(output, { schemaVersion: 1, originalSource: { id: 'amazons-demo', sha256 }, inputs: [...provenanceInputs.values()], files: provenanceOutputs })
console.log(`Converted ${Object.keys(soundFiles).length} original sounds to PCM WAV.`)
console.log(`Recorded exact file hashes, source-file identities and conversion selectors for ${provenanceOutputs.length} files. Redistribution rights remain unverified.`)
