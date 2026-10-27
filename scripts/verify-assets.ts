import { REFERENCE_LANDSCAPES } from '../resources/game/engine/reference-landscapes'
import { materialKey } from '../resources/game/engine/landscapes'
import { validatePlayerSlotCatalog } from '../resources/game/player-colors'
import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'
import { png } from '@stacksjs/ts-png'
import type { AtlasFrame } from '../resources/game/assets'
import { indexAtlasFrames } from '../resources/game/assets'
import { geologistImages } from '../resources/game/geologist-images'
import { interfaceImages } from '../resources/game/interface-assets'
import { surveySigns } from '../resources/game/survey-signs'
import { contentPolicy } from '../docs/content/policy'
import { inspectContentBundle } from './lib/content-provenance'

const directory = resolve(import.meta.dir, '../public/assets/settlers-original')
const manifest = await Bun.file(resolve(directory, 'manifest.json')).json() as { version: number, atlas: string, width: number, height: number, source: { sha256: string }, sprites: AtlasFrame[], playerSlots: unknown, missing?: unknown[] }
if (!/^sprites\.[a-f0-9]{64}\.png$/.test(manifest.atlas)) throw new Error('Invalid immutable atlas path')
const atlasBytes = Buffer.from(await Bun.file(resolve(directory, manifest.atlas)).arrayBuffer())
if (manifest.atlas !== `sprites.${Bun.SHA256.hash(atlasBytes, 'hex')}.png`) throw new Error('Atlas bytes differ from their content address')
const atlas = png.sync.read(atlasBytes)
validatePlayerSlotCatalog(manifest.playerSlots)
const frames = indexAtlasFrames(manifest.sprites, manifest.width, manifest.height)
for (const mask of manifest.sprites.filter(frame => frame.key.startsWith('torso:'))) for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) { const at = ((mask.y + y) * atlas.width + mask.x + x) * 4; if (atlas.data[at] !== atlas.data[at + 1] || atlas.data[at] !== atlas.data[at + 2]) throw new Error('Original clothing is not grayscale') }
for (const mask of manifest.sprites.filter(frame => frame.key.startsWith('shadow:'))) {
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    const at = ((mask.y + y) * atlas.width + mask.x + x) * 4
    if (atlas.data[at] || atlas.data[at + 1] || atlas.data[at + 2] || ![0, 136].includes(atlas.data[at + 3]!)) throw new Error('Original shadow pixels have invalid color or opacity')
  }
}
if (manifest.version !== 3 || manifest.width !== atlas.width || manifest.height !== atlas.height || !manifest.source.sha256) throw new Error('Invalid atlas provenance or dimensions')
const buildings = ['castle', 'storage', 'small-residence', 'medium-residence', 'small-tower', 'barracks', 'woodcutter', 'forester', 'stonecutter', 'sawmill', 'fisher', 'grain-farm', 'waterworks', 'mill', 'bakery', 'pig-farm', 'slaughterhouse', 'coal-mine', 'iron-mine', 'gold-mine', 'iron-smelter', 'gold-smelter', 'toolsmith', 'weaponsmith']
const goods = ['log', 'plank', 'stone', 'grain', 'flour', 'water', 'bread', 'pig', 'meat', 'fish', 'coal', 'ironore', 'goldore', 'iron', 'gold', 'hammer', 'shovel', 'axe', 'saw', 'pickaxe', 'scythe', 'fishingrod', 'sword']
const required = [...buildings.map(id => `building:${id}`), ...goods.flatMap(id => [`stack:${id}`, `carry:${id}`]), 'worker', 'sapling', 'crop', 'stone-deposit', ...new Set(REFERENCE_LANDSCAPES.map(source => materialKey(source.image)))]
for (const expected of surveySigns) {
  const images = frames.get(expected.key) ?? []
  if (images.length !== expected.frames || images.some((frame, index) => frame.frame !== index || frame.width !== 14 || frame.height !== 24 || frame.offsetX !== -8 || frame.offsetY !== -21)) throw new Error(`Invalid original survey frames ${expected.key}`)
}
for (const expected of geologistImages) {
  const images = frames.get(expected.key) ?? []
  if (images.length !== expected.frames || images.some((frame, index) => frame.frame !== index)) throw new Error(`Invalid original geologist frames ${expected.key}`)
}
for (const key of required) if (!frames.get(key)?.some(frame => frame.width && frame.height)) throw new Error(`Missing asset ${key}`)
for (const key of ['worker', ...goods.map(id => `carry:${id}`)]) if (frames.get(key)?.length !== 72) throw new Error(`Carrier ${key} needs twelve frames in each of six directions`)
for (const id of buildings) if (!(await Bun.file(resolve(directory, `${id}.png`)).exists())) throw new Error(`Missing building composite ${id}`)
if (!atlas.data.some((value, index) => index % 4 === 3 && value === 0) || !atlas.data.some((value, index) => index % 4 === 3 && value === 255)) throw new Error('Atlas must preserve transparent and opaque pixels')
const sounds = await Bun.file(resolve(directory, 'sounds.json')).json() as Record<string, string>
for (const [key, file] of Object.entries(sounds)) {
  const bytes = Buffer.from(await Bun.file(resolve(directory, file)).arrayBuffer())
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) !== bytes.length - 8 || bytes.readUInt32LE(40) !== bytes.length - 44 || bytes.readUInt16LE(20) !== 1 || bytes.readUInt16LE(22) !== 1 || bytes.readUInt16LE(34) !== 16) throw new Error(`Invalid PCM WAV ${key}`)
}
console.log(`Verified ${manifest.sprites.length} original sprite frames, RGBA transparency, source provenance and ${Object.keys(sounds).length} PCM WAV sounds.`)
if (!(await Bun.file(resolve(directory, 'ui-manifest.json')).exists())) throw new Error('Original interface images are missing. Run assets:import.')
const ui = await Bun.file(resolve(directory, 'ui-manifest.json')).json() as { version: number, images: typeof interfaceImages }
if (ui.version !== 1 || !Array.isArray(ui.images) || ui.images.length !== interfaceImages.length) throw new Error('Invalid original interface image catalog')
for (const expected of interfaceImages) {
  const images = ui.images.filter(image => image.key === expected.key)
  if (images.length !== 1 || Object.entries(expected).some(([key, value]) => images[0]![key as keyof typeof expected] !== value)) throw new Error(`Invalid original interface selector ${expected.key}`)
  const image = png.sync.read(Buffer.from(await Bun.file(resolve(directory, expected.path)).arrayBuffer()))
  if (image.width !== expected.width || image.height !== expected.height) throw new Error(`Invalid original interface dimensions ${expected.key}`)
}
console.log(`Verified ${interfaceImages.length} original interface images and their source selectors.`)
const provenance = await inspectContentBundle(directory, contentPolicy)
console.log(`Verified complete byte and input provenance for ${provenance.files.length} converted files. Redistribution evidence is checked separately by publication:check.`)
