import type { Sprite } from './lib/s3-dat'
import { Buffer } from 'node:buffer'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { png } from '@stacksjs/ts-png'
import { S3Dat } from './lib/s3-dat'

const root = resolve(import.meta.dir, '..')
const reference = resolve(root, 'storage/reference')
const source = resolve(reference, 'demo')
const output = resolve(root, 'public/assets/settlers-original')
const revision = '6ad8c4230a4aa4cd21840f8cb59a38344e41c3e0'
const repository = 'https://github.com/paulwedeck/settlers-remake'
const download = 'https://archive.org/download/S3aDemoUs/s3a_demo_us.exe'
const sha1 = 'b6e9d8217e17fb0b9e028b0ad61542611a9eb07d'
const sha256 = 'ac87c418101aadeb2338f04ecc79a56bf816ce1c6c7adc40bb7dc435ca4e7f65'
await mkdir(reference, { recursive: true }); await mkdir(output, { recursive: true })
const archivePath = resolve(reference, 's3a_demo_us.exe')
const archive = Bun.file(archivePath)
if (!(await archive.exists())) {
  console.log('Downloading the original Amazons demo...')
  const response = await fetch(download, { signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`Demo download failed: ${response.status}`)
  await Bun.write(archive, response)
}
if (new Bun.CryptoHasher('sha256').update(await archive.arrayBuffer()).digest('hex') !== sha256) throw new Error('Demo checksum does not match the pinned original')
const extraction = Bun.spawnSync(['unzip', '-q', '-o', archivePath, 'Gfx/*', 'Snd/*', 'Readme.txt', '-d', source], { stdout: 'inherit', stderr: 'inherit' })
if (extraction.exitCode !== 0) throw new Error('Could not extract the demo data')
const getReference = async (path: string): Promise<string> => {
  const response = await fetch(`https://raw.githubusercontent.com/paulwedeck/settlers-remake/${revision}/${path}`)
  if (!response.ok) throw new Error(`Reference file unavailable: ${path}`)
  return response.text()
}
const mappings = JSON.parse(await getReference('jsettlers.graphics/src/main/resources/jsettlers/graphics/image/reader/versions/amazon_demo.json')).datFileMappings as ({ settlersMapping: number[] } | null)[]
const datFiles = new Map<number, S3Dat>()
const names = await readdir(resolve(source, 'Gfx'))
async function dat(file: number): Promise<S3Dat> {
  if (!datFiles.has(file)) {
    const name = names.find(name => name.toLowerCase() === `siedler3_${String(file).padStart(2, '0')}.f8007e01f.dat`)
    if (!name) throw new Error(`Missing graphics file ${file}`)
    datFiles.set(file, new S3Dat(await readFile(resolve(source, 'Gfx', name))))
  }
  return datFiles.get(file)!
}
const entries: { key: string, frame: number, source: { file: number, sequence: number, frame: number }, sprite: Sprite }[] = []
async function sequence(key: string, file: number, gold: number, frames: number[] | 'all'): Promise<void> {
  const reader = await dat(file), actual = mappings[file]?.settlersMapping[gold] ?? gold
  if (actual < 0) throw new Error(`Demo does not include required sprite ${key}`)
  const starts = reader.frames(actual)
  const selected = frames === 'all' ? starts.map((_, index) => index) : frames
  for (const index of selected) {
    if (starts[index] === undefined) throw new Error(`Missing frame ${key}:${index}`)
    entries.push({ key, frame: entries.filter(entry => entry.key === key).length, source: { file, sequence: gold, frame: index }, sprite: (() => { try { return reader.decode(starts[index]!) } catch (error) { throw new Error(`Failed ${key} file ${file} sequence ${gold}/${actual} frame ${index}`, { cause: error }) } })() })
  }
}
const buildingFiles = { headquarters: 'castle', woodcutter: 'lumberjack', sawmill: 'sawmill', quarry: 'stonecutter', fishery: 'fisher', farm: 'farm', mill: 'mill', bakery: 'baker', ironmine: 'ironmine', coalmine: 'coalmine', smelter: 'ironmelt', smith: 'weaponsmith', barracks: 'barrack', tower: 'tower', residence: 'small_livinghouse' }
for (const [key, name] of Object.entries(buildingFiles)) {
  const xml = await getReference(`jsettlers.common/src/main/resources/jsettlers/common/buildings/roman/${name}.xml`)
  const images = [...xml.matchAll(/<image\s+([^>]+)>/g)].map(match => Object.fromEntries([...match[1]!.matchAll(/(\w+)="([^"]*)"/g)].map(attr => [attr[1], attr[2]]))).filter(attrs => attrs.for === 'FINAL' && attrs.type === 'SETTLER')
  if (!images.length) throw new Error(`No original image mapping for ${name}`)
  for (const image of images) await sequence(key, Number(image.file), Number(image.sequence), [Number(image.image)])
}
for (const [i, seq] of [1, 2, 4, 7, 8, 16, 17].entries()) await sequence(`tree-${i}`, 1, seq, [0])
await sequence('stone-deposit', 1, 31, [0, 4, 8])
await sequence('worker', 10, 0, 'all')
const worker = await dat(10)
const torsoFrames = worker.frames(mappings[10]?.settlersMapping[0] ?? 0, 0x3112)
for (const entry of entries.filter(entry => entry.key === 'worker')) {
  const torso = worker.decode(torsoFrames[entry.source.frame]!, 'torso'), body = entry.sprite
  for (let y = 0; y < torso.height; y++) for (let x = 0; x < torso.width; x++) {
    const from = (y * torso.width + x) * 4, dx = x + torso.offsetX - body.offsetX, dy = y + torso.offsetY - body.offsetY
    if (!torso.data[from + 3] || dx < 0 || dy < 0 || dx >= body.width || dy >= body.height) continue
    torso.data.copy(body.data, (dy * body.width + dx) * 4, from, from + 4)
  }
}
for (const [key, index] of Object.entries({ grass: 0, water: 17, rock: 21, sand: 31 })) {
  const landscape = await dat(0), at = landscape.frames(index, 0x2412)[0]!
  entries.push({ key: `terrain-${key}`, frame: 0, source: { file: 0, sequence: index, frame: 0 }, sprite: landscape.decode(at, '565', 'landscape') })
}
const width = 1024
let x = 1, y = 1, row = 0
const records = entries.map(entry => {
  const { width: w, height: h, offsetX, offsetY } = entry.sprite
  if (x + w + 1 > width) { x = 1; y += row + 2; row = 0 }
  const result = { key: entry.key, frame: entry.frame, x, y, width: w, height: h, offsetX, offsetY, source: entry.source }
  x += w + 2; row = Math.max(row, h)
  return result
})
const height = y + row + 1, pixels = Buffer.alloc(width * height * 4)
for (const [index, entry] of entries.entries()) {
  const r = records[index]!
  for (let row = 0; row < r.height; row++) entry.sprite.data.copy(pixels, ((r.y + row) * width + r.x) * 4, row * r.width * 4, (row + 1) * r.width * 4)
}
await Bun.write(resolve(output, 'sprites.png'), png.sync.write({ width, height, data: pixels }))
await Bun.write(resolve(output, 'manifest.json'), JSON.stringify({ version: 1, atlas: 'sprites.png', width, height, source: { repository, revision, download, sha1, sha256 }, sprites: records }, null, 2))
console.log(`Converted ${records.length} original sprites into a ${width}x${height} transparent PNG atlas.`)

// Individual composites let STX's construction catalog use the same original artwork.
for (const key of Object.keys(buildingFiles)) {
  const layers = entries.filter(entry => entry.key === key).map(entry => entry.sprite)
  const left = Math.min(...layers.map(s => s.offsetX)), top = Math.min(...layers.map(s => s.offsetY))
  const width = Math.max(...layers.map(s => s.offsetX + s.width)) - left, height = Math.max(...layers.map(s => s.offsetY + s.height)) - top
  const data = Buffer.alloc(width * height * 4)
  for (const s of layers) for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
    const from = (y * s.width + x) * 4
    if (s.data[from + 3]) s.data.copy(data, ((y + s.offsetY - top) * width + x + s.offsetX - left) * 4, from, from + 4)
  }
  await Bun.write(resolve(output, `${key}.png`), png.sync.write({ width, height, data }))
}

// The original sound bank stores mono PCM. Write complete, browser-readable WAV headers.
const sounds = await readFile(resolve(source, 'Snd/Siedler3_00.dat'))
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
}
await Bun.write(resolve(output, 'sounds.json'), JSON.stringify(soundFiles, null, 2))
console.log(`Converted ${Object.keys(soundFiles).length} original sounds to PCM WAV.`)
