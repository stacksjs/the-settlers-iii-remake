import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { png } from '@stacksjs/ts-png'
import type { AtlasFrame } from '../../resources/game/assets'
import { isPlayerSprite } from '../../resources/game/player-colors'
import { referenceFrames, referenceImage } from '../fixtures/reference-dat'

test('every player body and grayscale clothing frame preserves independent original pixels and anchors', async () => {
  const root = resolve(import.meta.dir, '../..'), directory = resolve(root, 'public/assets/settlers-original')
  const manifest = await Bun.file(resolve(directory, 'manifest.json')).json() as { atlas: string, sprites: (AtlasFrame & { source: { file: number, actualSequence: number, frame: number, section: number } })[] }
  const atlas = png.sync.read(Buffer.from(await Bun.file(resolve(directory, manifest.atlas)).arrayBuffer())), files = new Map<number, Buffer>()
  const layers = manifest.sprites.filter(frame => isPlayerSprite(frame.key) || frame.key.startsWith('torso:'))
  expect(layers).toHaveLength(7294)
  for (const frame of layers) {
    const { file, actualSequence, section, frame: sourceFrame } = frame.source
    if (!files.has(file)) files.set(file, Buffer.from(await Bun.file(resolve(root, `storage/reference/demo/Gfx/Siedler3_${String(file).padStart(2, '0')}.f8007e01f.dat`)).arrayBuffer()))
    const bytes = files.get(file)!, expected = referenceImage(bytes, referenceFrames(bytes, section, actualSequence)[sourceFrame]!, section === 0x3112)
    expect([frame.width, frame.height, frame.offsetX, frame.offsetY]).toEqual([expected.width, expected.height, expected.offsetX, expected.offsetY])
    const pixels = Buffer.alloc(frame.width * frame.height * 4)
    for (let y = 0; y < frame.height; y++) atlas.data.copy(pixels, y * frame.width * 4, ((frame.y + y) * atlas.width + frame.x) * 4, ((frame.y + y) * atlas.width + frame.x + frame.width) * 4)
    expect(Bun.SHA256.hash(pixels, 'hex')).toBe(Bun.SHA256.hash(expected.data, 'hex'))
  }
})
