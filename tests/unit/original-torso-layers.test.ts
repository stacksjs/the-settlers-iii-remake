import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { S3Dat } from '../../scripts/lib/s3-dat'
import fixture from '../fixtures/original-torso-layers.json'

test('actual demo carrier, geologist, priest and soldier layers follow the reference torso alignment', async () => {
  for (const sample of fixture.samples) {
    const bytes = Buffer.from(await Bun.file(resolve(import.meta.dir, '../../storage/reference/demo', sample.path)).arrayBuffer())
    expect(Bun.SHA256.hash(bytes, 'hex')).toBe(sample.datSha256)
    const reader = new S3Dat(bytes)
    if (sample.prefix) {
      expect(reader.has(sample.prefix - 1, 0x3112)).toBe(false)
      expect(() => reader.frames(sample.prefix - 1, 0x3112)).toThrow('Missing DAT sequence')
    }
    expect(reader.has(sample.bodySequence, 0x3112)).toBe(true)
    const frames = reader.frames(sample.bodySequence, 0x3112)
    expect(frames).toHaveLength(sample.frameCount)
    for (const expected of sample.frames) {
      const image = reader.decode(frames[expected.frame]!, 'torso')
      expect([image.width, image.height, image.offsetX, image.offsetY]).toEqual([expected.width, expected.height, expected.offsetX, expected.offsetY])
      expect(Bun.SHA256.hash(image.data, 'hex')).toBe(expected.pixelsSha256)
    }
  }
})
