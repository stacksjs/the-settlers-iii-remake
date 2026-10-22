import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'
import { png } from '@stacksjs/ts-png'
import type { AtlasFrame } from '../resources/game/assets'
import { contentPolicy } from '../docs/content/policy'
import { inspectContentBundle } from './lib/content-provenance'

const directory = resolve(import.meta.dir, '../public/assets/settlers-original')
const manifest = await Bun.file(resolve(directory, 'manifest.json')).json() as { version: number, width: number, height: number, source: { sha256: string }, sprites: AtlasFrame[], missing?: unknown[] }
const atlas = png.sync.read(Buffer.from(await Bun.file(resolve(directory, 'sprites.png')).arrayBuffer()))
if (manifest.version !== 1 || manifest.width !== atlas.width || manifest.height !== atlas.height || !manifest.source.sha256) throw new Error('Invalid atlas provenance or dimensions')
const buildings = ['castle', 'storage', 'small-residence', 'medium-residence', 'small-tower', 'barracks', 'woodcutter', 'forester', 'stonecutter', 'sawmill', 'fisher', 'grain-farm', 'waterworks', 'mill', 'bakery', 'pig-farm', 'slaughterhouse', 'coal-mine', 'iron-mine', 'gold-mine', 'iron-smelter', 'gold-smelter', 'toolsmith', 'weaponsmith']
const goods = ['log', 'plank', 'stone', 'grain', 'flour', 'water', 'bread', 'pig', 'meat', 'fish', 'coal', 'ironore', 'goldore', 'iron', 'gold', 'hammer', 'shovel', 'axe', 'saw', 'pickaxe', 'scythe', 'fishingrod', 'sword']
const required = [...buildings.map(id => `building:${id}`), ...goods.flatMap(id => [`stack:${id}`, `carry:${id}`]), 'worker', 'sapling', 'crop', 'stone-deposit', 'terrain-grass', 'terrain-water', 'terrain-sand', 'terrain-rock']
for (const key of required) if (!manifest.sprites.some(frame => frame.key === key && frame.width && frame.height)) throw new Error(`Missing asset ${key}`)
for (const key of ['worker', ...goods.map(id => `carry:${id}`)]) if (manifest.sprites.filter(frame => frame.key === key).length !== 72) throw new Error(`Carrier ${key} needs twelve frames in each of six directions`)
for (const id of buildings) if (!(await Bun.file(resolve(directory, `${id}.png`)).exists())) throw new Error(`Missing building composite ${id}`)
for (const f of manifest.sprites) if (![f.x, f.y, f.width, f.height, f.offsetX, f.offsetY].every(Number.isInteger) || f.x < 0 || f.y < 0 || f.width < 0 || f.height < 0 || f.x + f.width > atlas.width || f.y + f.height > atlas.height) throw new Error(`Invalid atlas frame ${f.key}:${f.frame}`)
if (!atlas.data.some((value, index) => index % 4 === 3 && value === 0) || !atlas.data.some((value, index) => index % 4 === 3 && value === 255)) throw new Error('Atlas must preserve transparent and opaque pixels')
const sounds = await Bun.file(resolve(directory, 'sounds.json')).json() as Record<string, string>
for (const [key, file] of Object.entries(sounds)) {
  const bytes = Buffer.from(await Bun.file(resolve(directory, file)).arrayBuffer())
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) !== bytes.length - 8 || bytes.readUInt32LE(40) !== bytes.length - 44 || bytes.readUInt16LE(20) !== 1 || bytes.readUInt16LE(22) !== 1 || bytes.readUInt16LE(34) !== 16) throw new Error(`Invalid PCM WAV ${key}`)
}
console.log(`Verified ${manifest.sprites.length} original sprite frames, RGBA transparency, source provenance and ${Object.keys(sounds).length} PCM WAV sounds.`)
const provenance = await inspectContentBundle(directory, contentPolicy)
console.log(`Verified complete byte and input provenance for ${provenance.files.length} converted files. Redistribution evidence is checked separately by publication:check.`)
