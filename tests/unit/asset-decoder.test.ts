import { Buffer } from 'node:buffer'
import { expect, test } from 'bun:test'
import { S3Dat } from '../../scripts/lib/s3-dat'

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
test('DAT conversion refuses truncated, oversized or out-of-bounds data', () => {
  expect(() => new S3Dat(Buffer.alloc(10))).toThrow()
  expect(() => new S3Dat(fixture(0x8003)).decode(173)).toThrow('width')
  const data = fixture(); data.writeUInt16LE(65535, 177)
  expect(() => new S3Dat(data).decode(173)).toThrow('dimensions')
})

test('DAT player-color torso shades composite as opaque settlement gold', () => {
  const data = fixture(); data[188] = 31
  const sprite = new S3Dat(data).decode(173, 'torso')
  expect([...sprite.data]).toEqual([0, 0, 0, 0, 224, 184, 87, 255])
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
