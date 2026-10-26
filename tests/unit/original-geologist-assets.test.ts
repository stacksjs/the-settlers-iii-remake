import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { png } from '@stacksjs/ts-png'
import type { AtlasFrame } from '../../resources/game/assets'
import fixture from '../fixtures/original-geologist-frames.json'

test('all original geologist bodies and grayscale torsos retain independent pixels and signed anchors', async () => {
  const directory = resolve(import.meta.dir, '../../public/assets/settlers-original')
  const manifest = await Bun.file(resolve(directory, 'manifest.json')).json() as { atlas: string, sprites: (AtlasFrame & { source: { file: number, sequence: number, actualSequence: number, frame: number, section: number } })[] }
  const bytes = Buffer.from(await Bun.file(resolve(directory, manifest.atlas)).arrayBuffer()), atlas = png.sync.read(bytes)
  expect(manifest.atlas).toBe(`sprites.${Bun.SHA256.hash(bytes, 'hex')}.png`)
  for (const image of fixture.images) {
    const bodies = manifest.sprites.filter(frame => frame.key === image.key), torsos = manifest.sprites.filter(frame => frame.key === `torso:${image.key}`)
    expect(bodies).toHaveLength(image.frames.length)
    expect(torsos).toHaveLength(image.frames.length)
    for (const expected of image.frames) {
      const body = bodies.find(frame => frame.frame === expected.frame)!, torso = torsos.find(frame => frame.frame === expected.frame)!
      expect(body.torso).toBe(torso.key)
      for (const [frame, reference, section] of [[body, expected.body, 0x106], [torso, expected.torso, 0x3112]] as const) {
        expect([frame.width, frame.height, frame.offsetX, frame.offsetY]).toEqual([reference.width, reference.height, reference.offsetX, reference.offsetY])
        expect(frame.source).toEqual({ file: image.file, sequence: image.goldSequence, actualSequence: image.demoSequence, frame: expected.frame, section })
        const pixels = Buffer.alloc(frame.width * frame.height * 4)
        for (let y = 0; y < frame.height; y++) atlas.data.copy(pixels, y * frame.width * 4, ((frame.y + y) * atlas.width + frame.x) * 4, ((frame.y + y) * atlas.width + frame.x + frame.width) * 4)
        expect(Bun.SHA256.hash(pixels, 'hex')).toBe(reference.pixelsSha256)
      }
    }
  }
})
