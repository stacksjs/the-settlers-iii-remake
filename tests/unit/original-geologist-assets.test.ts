import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { png } from '@stacksjs/ts-png'
import type { AtlasFrame } from '../../resources/game/assets'
import fixture from '../fixtures/original-geologist-frames.json'

test('all original geologist body and aligned torso frames retain their composed pixels and anchors in the atlas', async () => {
  const directory = resolve(import.meta.dir, '../../public/assets/settlers-original')
  const manifest = await Bun.file(resolve(directory, 'manifest.json')).json() as { atlas: string, sprites: (AtlasFrame & { source: { file: number, sequence: number, actualSequence: number, frame: number, section: number } })[] }
  const bytes = Buffer.from(await Bun.file(resolve(directory, manifest.atlas)).arrayBuffer()), atlas = png.sync.read(bytes)
  expect(manifest.atlas).toBe(`sprites.${Bun.SHA256.hash(bytes, 'hex')}.png`)
  for (const image of fixture.images) {
    const frames = manifest.sprites.filter(frame => frame.key === image.key)
    expect(frames).toHaveLength(image.frames.length)
    for (const expected of image.frames) {
      const frame = frames.find(frame => frame.frame === expected.frame)!
      expect([frame.width, frame.height, frame.offsetX, frame.offsetY]).toEqual([expected.width, expected.height, expected.offsetX, expected.offsetY])
      expect(frame.source).toEqual({ file: image.file, sequence: image.goldSequence, actualSequence: image.demoSequence, frame: expected.frame, section: 0x106 })
      const pixels = Buffer.alloc(frame.width * frame.height * 4)
      for (let y = 0; y < frame.height; y++) atlas.data.copy(pixels, y * frame.width * 4, ((frame.y + y) * atlas.width + frame.x) * 4, ((frame.y + y) * atlas.width + frame.x + frame.width) * 4)
      expect(Bun.SHA256.hash(pixels, 'hex')).toBe(expected.pixelsSha256)
    }
  }
})
