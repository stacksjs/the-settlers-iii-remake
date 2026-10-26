import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { png } from '@stacksjs/ts-png'
import type { AtlasFrame } from '../../resources/game/assets'
import fixture from '../fixtures/original-survey-frames.json'

const directory = resolve(import.meta.dir, '../../public/assets/settlers-original')
test('the published atlas pairs immutable PNG bytes with all twelve original survey frames and anchors', async () => {
  const manifest = await Bun.file(resolve(directory, 'manifest.json')).json() as { atlas: string, sprites: (AtlasFrame & { source: { file: number, sequence: number, actualSequence: number, frame: number, section: number } })[] }
  expect(manifest.atlas).toMatch(/^sprites\.[a-f0-9]{64}\.png$/)
  const bytes = Buffer.from(await Bun.file(resolve(directory, manifest.atlas)).arrayBuffer())
  expect(manifest.atlas).toBe(`sprites.${Bun.SHA256.hash(bytes, 'hex')}.png`)
  const atlas = png.sync.read(bytes)
  for (const sign of fixture.signs) {
    const frames = manifest.sprites.filter(x => x.key === `sign:${sign.name}`)
    expect(frames).toHaveLength(2)
    for (const expected of sign.frames) {
      const frame = frames.find(x => x.frame === expected.frame)!
      expect([frame.width, frame.height, frame.offsetX, frame.offsetY]).toEqual([expected.width, expected.height, expected.offsetX, expected.offsetY])
      expect(frame.source).toEqual({ file: sign.file, sequence: sign.goldSequence, actualSequence: sign.demoSequence, frame: expected.frame, section: 0x106 })
      const pixels = Buffer.alloc(frame.width * frame.height * 4)
      for (let y = 0; y < frame.height; y++) atlas.data.copy(pixels, y * frame.width * 4, ((frame.y + y) * atlas.width + frame.x) * 4, ((frame.y + y) * atlas.width + frame.x + frame.width) * 4)
      expect(Bun.SHA256.hash(pixels, 'hex')).toBe(expected.pixelsSha256)
    }
  }
})
