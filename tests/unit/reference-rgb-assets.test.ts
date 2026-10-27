import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { png } from '@stacksjs/ts-png'
import { S3Dat } from '../../scripts/lib/s3-dat'
import { referenceFrames, referenceImage } from '../fixtures/reference-dat'

// Actual original bytes through two independently implemented readers. The
// literal selectors follow pinned amazon_demo.json and interface metadata.
test('body, landscape and GUI conversion match the independent pinned reference reader', async () => {
  for (const [file, section, sequence, header] of [
    ['Siedler3_11.f8007e01f.dat', 0x106, 37, 'displaced'],
    ['siedler3_00.f8007e01f.dat', 0x2412, 0, 'landscape'],
    ['Siedler3_03.f8007e01f.dat', 0x11306, 51, 'gui'],
  ] as const) {
    const bytes = Buffer.from(await Bun.file(resolve(import.meta.dir, '../../storage/reference/demo/Gfx', file)).arrayBuffer())
    const at = referenceFrames(bytes, section, sequence)[0]!, expected = referenceImage(bytes, at, false, header)
    const actual = new S3Dat(bytes).decode(at, '565', header)
    expect(actual).toEqual(expected)
    expect(actual.data.some((v, i) => i % 4 !== 3 && v > 0 && v < 255)).toBe(true)
  }
})

test('converted landscape and GUI PNGs retain independently decoded reference pixels', async () => {
  for (const [file, section, sequence, header, output] of [
    ['siedler3_00.f8007e01f.dat', 0x2412, 0, 'landscape', 'terrain-grass'],
    ['Siedler3_03.f8007e01f.dat', 0x11306, 51, 'gui', 'ui/build-inactive.png'],
  ] as const) {
    const bytes = Buffer.from(await Bun.file(resolve(import.meta.dir, '../../storage/reference/demo/Gfx', file)).arrayBuffer())
    const expected = referenceImage(bytes, referenceFrames(bytes, section, sequence)[0]!, false, header)
    const directory = resolve(import.meta.dir, '../../public/assets/settlers-original')
    if (section === 0x11306) {
      const image = png.sync.read(Buffer.from(await Bun.file(resolve(directory, output)).arrayBuffer()))
      expect([image.width, image.height]).toEqual([expected.width, expected.height])
      expect(Buffer.from(image.data)).toEqual(expected.data)
    }
    else {
      const manifest = await Bun.file(resolve(directory, 'manifest.json')).json()
      const frame = manifest.sprites.find((s: { key: string }) => s.key === output), atlas = png.sync.read(Buffer.from(await Bun.file(resolve(directory, manifest.atlas)).arrayBuffer()))
      const data = Buffer.alloc(frame.width * frame.height * 4)
      for (let y = 0; y < frame.height; y++) atlas.data.copy(data, y * frame.width * 4, ((frame.y + y) * atlas.width + frame.x) * 4, ((frame.y + y) * atlas.width + frame.x + frame.width) * 4)
      expect([frame.width, frame.height, frame.offsetX, frame.offsetY]).toEqual([expected.width, expected.height, expected.offsetX, expected.offsetY])
      expect(data).toEqual(expected.data)
    }
  }
})

test('all 32 imported terrain materials preserve every independently decoded source pixel', async () => {
  const bytes = Buffer.from(await Bun.file(resolve(import.meta.dir, '../../storage/reference/demo/Gfx/siedler3_00.f8007e01f.dat')).arrayBuffer())
  const directory = resolve(import.meta.dir, '../../public/assets/settlers-original'), manifest = await Bun.file(resolve(directory, 'manifest.json')).json()
  const atlas = png.sync.read(Buffer.from(await Bun.file(resolve(directory, manifest.atlas)).arrayBuffer()))
  // The complete literal selector set from ELandscapeType, not the generated catalog.
  const images = [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 31, 34, 35, 36, 217, 230]
  const frames = manifest.sprites.filter((f: { key: string }) => f.key.startsWith('terrain-'))
  expect(frames).toHaveLength(32)
  let materialBytes = 0
  for (const image of images) {
    const expected = referenceImage(bytes, referenceFrames(bytes, 0x2412, image)[0]!, false, 'landscape')
    const matches = frames.filter((f: { source: { actualSequence: number } }) => f.source.actualSequence === image)
    expect(matches).toHaveLength(1)
    const frame = matches[0]!, data = Buffer.alloc(frame.width * frame.height * 4)
    expect([frame.source.file, frame.source.section, frame.source.frame]).toEqual([0, 0x2412, 0])
    expect([frame.width, frame.height, frame.offsetX, frame.offsetY]).toEqual([expected.width, expected.height, expected.offsetX, expected.offsetY])
    for (let y = 0; y < frame.height; y++) atlas.data.copy(data, y * frame.width * 4, ((frame.y + y) * atlas.width + frame.x) * 4, ((frame.y + y) * atlas.width + frame.x + frame.width) * 4)
    expect(data).toEqual(expected.data)
    materialBytes += data.length
  }
  expect(materialBytes).toBe(991232)
})
