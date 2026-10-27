import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { readdir } from 'node:fs/promises'
import { png } from '@stacksjs/ts-png'
import type { AtlasFrame } from '../../resources/game/assets'
import fixture from '../fixtures/original-geologist-frames.json'

test('all original geologist bodies and grayscale torsos retain independent pixels and signed anchors', async () => {
  const directory = resolve(import.meta.dir, '../../public/assets/settlers-original')
  const manifest = await Bun.file(resolve(directory, 'manifest.json')).json() as { atlas: string, sprites: (AtlasFrame & { source: { file: number, sequence: number, actualSequence: number, frame: number, section: number } })[] }
  const bytes = Buffer.from(await Bun.file(resolve(directory, manifest.atlas)).arrayBuffer()), atlas = png.sync.read(bytes)
  expect(manifest.atlas).toBe(`sprites.${Bun.SHA256.hash(bytes, 'hex')}.png`)
  const sources = resolve(import.meta.dir, '../../storage/reference/demo/Gfx'), names = await readdir(sources)
  for (const image of fixture.images) {
    const name = names.find(name => name.toLowerCase() === `siedler3_${String(image.file).padStart(2, '0')}.f8007e01f.dat`)!
    const original = Buffer.from(await Bun.file(resolve(sources, name)).arrayBuffer()), tables = new Map<number, number>()
    for (let i = 0; i < 6; i++) { const at = original.readUInt32LE(56 + i * 4); tables.set(original.readUInt32LE(at), original.readUInt16LE(at + 6)) }
    const torsoSequence = image.demoSequence - Math.max(0, tables.get(0x106)! - tables.get(0x3112)!)
    const bodies = manifest.sprites.filter(frame => frame.key === image.key), torsos = manifest.sprites.filter(frame => frame.key === `torso:${image.key}`)
    expect(bodies).toHaveLength(image.frames.length)
    expect(torsos).toHaveLength(image.frames.length)
    for (const expected of image.frames) {
      const body = bodies.find(frame => frame.frame === expected.frame)!, torso = torsos.find(frame => frame.frame === expected.frame)!
      expect(body.torso).toBe(torso.key)
      for (const [frame, reference, section] of [[body, expected.body, 0x106], [torso, expected.torso, 0x3112]] as const) {
        expect([frame.width, frame.height, frame.offsetX, frame.offsetY]).toEqual([reference.width, reference.height, reference.offsetX, reference.offsetY])
        expect(frame.source).toEqual({ file: image.file, sequence: image.goldSequence, actualSequence: image.demoSequence, frame: expected.frame, section, ...(section === 0x3112 ? { layerSequence: torsoSequence } : {}) })
        const pixels = Buffer.alloc(frame.width * frame.height * 4)
        for (let y = 0; y < frame.height; y++) atlas.data.copy(pixels, y * frame.width * 4, ((frame.y + y) * atlas.width + frame.x) * 4, ((frame.y + y) * atlas.width + frame.x + frame.width) * 4)
        expect(Bun.SHA256.hash(pixels, 'hex')).toBe(reference.pixelsSha256)
      }
    }
  }
})
