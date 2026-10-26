import { Buffer } from 'node:buffer'
import { expect, test } from 'bun:test'
import { composeDatSprites, S3Dat } from '../../scripts/lib/s3-dat'

function fixture(meta = 0x8101): Buffer {
  const data = Buffer.alloc(256)
  data.writeUInt32LE(0x41304, 0); data.writeUInt32LE(data.length, 48)
  for (let i = 0; i < 6; i++) data.writeUInt32LE(96, 56 + i * 4)
  data.writeUInt32LE(0x106, 96); data.writeUInt16LE(12, 100); data.writeUInt16LE(1, 102); data.writeUInt32LE(160, 104)
  data.writeUInt32LE(0x1402, 160); data[164] = 8; data[167] = 1; data.writeUInt32LE(13, 168)
  data.writeUInt32LE(12, 173); data.writeUInt16LE(2, 177); data.writeUInt16LE(1, 179)
  data.writeInt16LE(-1, 181); data.writeInt16LE(-2, 183)
  data.writeUInt16LE(meta, 186); data.writeUInt16LE(0x7e0, 188)
  return data
}
test('DAT conversion keeps transparency, RGB565 colors, signed anchors and odd-byte alignment', () => {
  const dat = new S3Dat(fixture()), [at] = dat.frames(0), sprite = dat.decode(at!)
  expect([sprite.width, sprite.height, sprite.offsetX, sprite.offsetY]).toEqual([2, 1, -1, -2])
  expect([...sprite.data]).toEqual([0, 0, 0, 0, 0, 255, 0, 255])
})
test('DAT shadow runs contain no pixel-color bytes and retain source opacity, skips and signed anchors', () => {
  const data = fixture().subarray(0, 192)
  data.writeUInt32LE(data.length, 48)
  data.writeUInt16LE(3, 177); data.writeUInt16LE(2, 179)
  data.writeUInt16LE(0x0101, 186); data.writeUInt16LE(0x8001, 188); data.writeUInt16LE(0x8201, 190)
  const image = new S3Dat(data).decode(173, 'shadow')
  expect([image.width, image.height, image.offsetX, image.offsetY]).toEqual([3, 2, -1, -2])
  expect([...image.data]).toEqual([0, 0, 0, 0, 0, 0, 0, 136, 0, 0, 0, 136, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 136])
})
test('DAT shadow decoding rejects incomplete rows, overflowing runs and oversized allocations', () => {
  const short = fixture(0x0101).subarray(0, 188); short.writeUInt32LE(short.length, 48)
  expect(() => new S3Dat(short).decode(173, 'shadow')).toThrow('Truncated DAT')
  expect(() => new S3Dat(fixture(0x8003)).decode(173, 'shadow')).toThrow('width')
  const large = fixture(); large.writeUInt16LE(2049, 177)
  expect(() => new S3Dat(large).decode(173, 'shadow')).toThrow('dimensions')
  const noEnd = fixture(0); noEnd.fill(0, 186)
  expect(() => new S3Dat(noEnd).decode(173, 'shadow')).toThrow('row runs')
})
test('DAT RGB555 and RGB565 midtones match reference channel truncation at every channel level', () => {
  // Literal tables from the pinned Color.cnv5to8/cnv6to8 contract, independent
  // of the production decoder. Packed words exercise the public byte boundary.
  const five = [0, 8, 16, 24, 32, 41, 49, 57, 65, 74, 82, 90, 98, 106, 115, 123, 131, 139, 148, 156, 164, 172, 180, 189, 197, 205, 213, 222, 230, 238, 246, 255]
  const six = [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 85, 89, 93, 97, 101, 105, 109, 113, 117, 121, 125, 129, 133, 137, 141, 145, 149, 153, 157, 161, 165, 170, 174, 178, 182, 186, 190, 194, 198, 202, 206, 210, 214, 218, 222, 226, 230, 234, 238, 242, 246, 250, 255]
  for (const format of ['555', '565'] as const) for (const channel of [0, 1, 2]) {
    const levels = format === '565' && channel === 1 ? six : five
    for (const [level, expected] of levels.entries()) {
      const shift = channel === 0 ? format === '565' ? 11 : 10 : channel === 1 ? 5 : 0
      const bytes = fixture(); bytes.writeUInt16LE(level << shift, 188)
      const sprite = new S3Dat(bytes).decode(173, format)
      const rgba = [0, 0, 0, 255]; rgba[channel] = expected
      expect([...sprite.data]).toEqual([0, 0, 0, 0, ...rgba])
      expect([sprite.offsetX, sprite.offsetY]).toEqual([-1, -2])
    }
  }
})

test('DAT conversion refuses truncated, oversized or out-of-bounds data', () => {
  expect(() => new S3Dat(Buffer.alloc(10))).toThrow()
  expect(() => new S3Dat(fixture(0x8003)).decode(173)).toThrow('width')
  const data = fixture(); data.writeUInt16LE(65535, 177)
  expect(() => new S3Dat(data).decode(173)).toThrow('dimensions')
})

test('DAT frame enumeration rejects pointers into its table or outside the archive', () => {
  for (const relative of [0, 11, 94, 5000]) {
    const data = fixture()
    data.writeUInt32LE(relative, 168)
    expect(() => new S3Dat(data).frames(0)).toThrow('frame offset')
  }
})

test('DAT torso decoding preserves the grayscale player-color layer and transparent skips', () => {
  // TorsoTranslator at the pinned reference masks the low five bits and
  // truncates their conversion to eight-bit grayscale. Palette selection is
  // presentation behavior, not information stored in a DAT torso pixel.
  for (const [encoded, gray] of [[0, 0], [1, 8], [15, 123], [30, 246], [31, 255], [255, 255]] as const) {
    const data = fixture(); data[188] = encoded
    const sprite = new S3Dat(data).decode(173, 'torso')
    expect([...sprite.data]).toEqual([0, 0, 0, 0, gray, gray, gray, 255])
  }
})

test('a shorter torso table aligns to the last body sequences and leaves earlier bodies without a torso', () => {
  const data = fixture()
  data.writeUInt16LE(16, 100); data.writeUInt16LE(2, 102); data.writeUInt32LE(160, 108)
  data.writeUInt32LE(112, 68)
  data.writeUInt32LE(0x3112, 112); data.writeUInt16LE(12, 116); data.writeUInt16LE(1, 118); data.writeUInt32LE(212, 120)
  data.writeUInt32LE(0x1402, 212); data[216] = 8; data[219] = 1; data.writeUInt32LE(12, 220)
  data.writeUInt32LE(12, 224); data.writeUInt16LE(2, 228); data.writeUInt16LE(1, 230)
  data.writeInt16LE(-1, 232); data.writeInt16LE(-2, 234); data.writeUInt16LE(0x8101, 236); data[238] = 15
  const dat = new S3Dat(data)
  expect(dat.has(0, 0x3112)).toBe(false)
  expect(() => dat.frames(0, 0x3112)).toThrow('Missing DAT sequence')
  expect(dat.has(1, 0x3112)).toBe(true)
  expect(dat.frames(1, 0x3112)).toEqual([224])
  expect([...dat.decode(224, 'torso').data]).toEqual([0, 0, 0, 0, 123, 123, 123, 255])
  expect(dat.frames(0)).toEqual([173])
  expect(dat.frames(1)).toEqual([173])
})

test('DAT clothing outside the body rectangle keeps its full bounds and signed anchor', () => {
  const body = { width: 2, height: 1, offsetX: -1, offsetY: -2, data: Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]) }
  const torso = { width: 1, height: 2, offsetX: -2, offsetY: -3, data: Buffer.from([0, 0, 255, 255, 123, 123, 123, 255]) }
  const result = composeDatSprites([body, torso])
  expect([result.width, result.height, result.offsetX, result.offsetY]).toEqual([3, 2, -2, -3])
  expect([...result.data]).toEqual([
    0, 0, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0,
    123, 123, 123, 255, 255, 0, 0, 255, 0, 255, 0, 255,
  ])
  expect([...body.data]).toEqual([255, 0, 0, 255, 0, 255, 0, 255])
})

test('DAT layer order replaces opaque pixels and transparent pixels leave the body visible', () => {
  const body = { width: 2, height: 1, offsetX: 0, offsetY: 0, data: Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]) }
  const torso = { ...body, data: Buffer.from([0, 0, 0, 0, 0, 0, 255, 255]) }
  const empty = { width: 0, height: 0, offsetX: -100, offsetY: 100, data: Buffer.alloc(0) }
  const result = composeDatSprites([body, empty, torso])
  expect([result.width, result.height, result.offsetX, result.offsetY]).toEqual([2, 1, 0, 0])
  expect([...result.data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255])
  expect(composeDatSprites([empty])).toEqual({ ...empty, offsetX: 0, offsetY: 0 })
})

test('DAT composition rejects damaged layers and excessive anchor distances before drawing', () => {
  const pixel = { width: 1, height: 1, offsetX: 0, offsetY: 0, data: Buffer.from([0, 0, 0, 255]) }
  expect(() => composeDatSprites([])).toThrow('needs a layer')
  expect(() => composeDatSprites([{ ...pixel, data: Buffer.alloc(0) }])).toThrow('Invalid DAT')
  expect(() => composeDatSprites([{ ...pixel, offsetX: Infinity }])).toThrow('Invalid DAT')
  expect(() => composeDatSprites([{ ...pixel, offsetY: 32768 }])).toThrow('Invalid DAT')
  expect(() => composeDatSprites([pixel, { ...pixel, offsetX: 32767 }])).toThrow('exceeds bounds')
  expect(() => composeDatSprites([{ ...pixel, data: Buffer.from([0, 0, 0, 127]) }])).toThrow('opaque or transparent')
})

test('landscape sections use direct frames and their shorter header', () => {
  const data = fixture()
  data.writeUInt32LE(0x2412, 96)
  data.writeUInt16LE(2, 160); data.writeUInt16LE(1, 162)
  data.writeUInt16LE(0x8002, 166)
  data.writeUInt16LE(0xf800, 168); data.writeUInt16LE(0x001f, 170)
  const dat = new S3Dat(data)
  expect(dat.frames(0, 0x2412)).toEqual([160])
  const sprite = dat.decode(160, '565', 'landscape')
  expect([sprite.offsetX, sprite.offsetY]).toEqual([0, 0])
  expect([...sprite.data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255])
})

test('GUI sections decode their eight-byte header without treating reserved fields as pixels', () => {
  const data = fixture()
  data.writeUInt32LE(0x11306, 96)
  data.writeUInt16LE(2, 160); data.writeUInt16LE(1, 162)
  data.writeUInt16LE(0x1234, 164); data.writeUInt16LE(0xabcd, 166)
  data.writeUInt16LE(0x8101, 168); data.writeUInt16LE(0xf800, 170)
  const dat = new S3Dat(data)
  expect(dat.frames(0, 0x11306)).toEqual([160])
  const sprite = dat.decode(160, '565', 'gui')
  expect([sprite.width, sprite.height, sprite.offsetX, sprite.offsetY]).toEqual([2, 1, 0, 0])
  expect([...sprite.data]).toEqual([0, 0, 0, 0, 255, 0, 0, 255])
})

test('even empty GUI and landscape images require their complete reserved header fields', () => {
  const dat = new S3Dat(fixture())
  expect(() => dat.decode(250, '565', 'gui')).toThrow('Truncated DAT')
  expect(() => dat.decode(252, '565', 'landscape')).toThrow('Truncated DAT')
})
