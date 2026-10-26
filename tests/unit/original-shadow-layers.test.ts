import { expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { S3Dat } from '../../scripts/lib/s3-dat'
import { isPlayerSprite } from '../../resources/game/player-colors'
import { referenceFrames, referenceImage } from '../fixtures/reference-dat'
import { png } from '@stacksjs/ts-png'
import type { AtlasFrame } from '../../resources/game/assets'

test('every imported movable resolves and decodes original shadows independently from its body and torso', async () => {
  const root = resolve(import.meta.dir, '../..'), directory = resolve(root, 'storage/reference/demo/Gfx'), names = await readdir(directory)
  const manifest = await Bun.file(resolve(root, 'public/assets/settlers-original/manifest.json')).json() as { sprites: { key: string, source: { file: number, actualSequence: number, frame: number } }[] }
  const sources = new Map<number, Buffer>(), readers = new Map<number, S3Dat>()
  for (const body of manifest.sprites.filter(frame => isPlayerSprite(frame.key))) {
    const { file, actualSequence, frame } = body.source
    if (!sources.has(file)) {
      const name = names.find(name => name.toLowerCase() === `siedler3_${String(file).padStart(2, '0')}.f8007e01f.dat`)
      if (!name) throw new Error(`Missing original DAT ${file}`)
      const bytes = Buffer.from(await Bun.file(resolve(directory, name)).arrayBuffer())
      sources.set(file, bytes); readers.set(file, new S3Dat(bytes))
    }
    const bytes = sources.get(file)!, reader = readers.get(file)!, expectedFrames = referenceFrames(bytes, 0x5982, actualSequence)
    expect(reader.has(actualSequence, 0x5982)).toBe(expectedFrames.length > 0)
    if (!expectedFrames.length) continue
    const actualFrames = reader.frames(actualSequence, 0x5982)
    expect(actualFrames).toEqual(expectedFrames)
    if (expectedFrames[frame] === undefined) continue
    expect(reader.decode(actualFrames[frame]!, 'shadow')).toEqual(referenceImage(bytes, expectedFrames[frame]!, 'shadow'))
  }
})

test('the original demo also verifies the distinct 66-body and 40-shadow table layout', async () => {
  const bytes = Buffer.from(await Bun.file(resolve(import.meta.dir, '../../storage/reference/demo/Gfx/Siedler3_13.f8007e01f.dat')).arrayBuffer()), reader = new S3Dat(bytes)
  for (let sequence = 0; sequence < 66; sequence++) {
    const expected = referenceFrames(bytes, 0x5982, sequence)
    if (!reader.has(sequence, 0x5982)) { expect(expected).toEqual([]); continue }
    expect(reader.frames(sequence, 0x5982)).toEqual(expected)
    for (const frame of expected) expect(reader.decode(frame, 'shadow')).toEqual(referenceImage(bytes, frame, 'shadow'))
  }
})

test('published shadow masks keep original pixels, physical selectors, anchors and explicit absence', async () => {
  const root = resolve(import.meta.dir, '../..'), directory = resolve(root, 'public/assets/settlers-original'), source = resolve(root, 'storage/reference/demo/Gfx'), names = await readdir(source)
  type Frame = AtlasFrame & { source: { file: number, sequence: number, actualSequence: number, frame: number, section: number, layerSequence?: number } }
  const manifest = await Bun.file(resolve(directory, 'manifest.json')).json() as { version: number, atlas: string, sprites: Frame[] }
  expect(manifest.version).toBe(3)
  const atlas = png.sync.read(Buffer.from(await Bun.file(resolve(directory, manifest.atlas)).arrayBuffer())), files = new Map<number, Buffer>()
  for (const body of manifest.sprites.filter(frame => isPlayerSprite(frame.key))) {
    const { file, actualSequence, frame: sourceFrame } = body.source
    if (!files.has(file)) {
      const name = names.find(name => name.toLowerCase() === `siedler3_${String(file).padStart(2, '0')}.f8007e01f.dat`)
      if (!name) throw new Error(`Missing original DAT ${file}`)
      files.set(file, Buffer.from(await Bun.file(resolve(source, name)).arrayBuffer()))
    }
    const bytes = files.get(file)!, at = referenceFrames(bytes, 0x5982, actualSequence)[sourceFrame]
    if (at === undefined) { expect(body.shadow).toBeNull(); continue }
    const mask = manifest.sprites.find(mask => mask.key === body.shadow && mask.frame === body.frame)!
    expect(mask).toBeDefined()
    const expected = referenceImage(bytes, at, 'shadow')
    expect([mask.width, mask.height, mask.offsetX, mask.offsetY]).toEqual([expected.width, expected.height, expected.offsetX, expected.offsetY])
    expect(mask.source).toMatchObject({ ...body.source, section: 0x5982 })
    expect(Number.isInteger(mask.source.layerSequence)).toBe(true)
    const table = Array.from({ length: 6 }, (_, index) => bytes.readUInt32LE(56 + index * 4)).find(offset => bytes.readUInt32LE(offset) === 0x5982)!
    expect(mask.source.layerSequence!).toBeLessThan(bytes.readUInt16LE(table + 6))
    const sequenceAt = bytes.readUInt32LE(table + 8 + mask.source.layerSequence! * 4)
    expect(sequenceAt + bytes.readUInt32LE(sequenceAt + 8 + sourceFrame * 4)).toBe(at)
    const pixels = Buffer.alloc(mask.width * mask.height * 4)
    for (let y = 0; y < mask.height; y++) atlas.data.copy(pixels, y * mask.width * 4, ((mask.y + y) * atlas.width + mask.x) * 4, ((mask.y + y) * atlas.width + mask.x + mask.width) * 4)
    expect(Bun.SHA256.hash(pixels, 'hex')).toBe(Bun.SHA256.hash(expected.data, 'hex'))
  }
})
