import { Buffer } from 'node:buffer'
import { expect, test } from 'bun:test'
import { S3Dat } from '../../scripts/lib/s3-dat'

function archive(bodies: number, shadows: number): { reader: S3Dat, first: number } {
  const shadowTable = 104 + bodies * 4, first = shadowTable + 8 + shadows * 4
  const bytes = Buffer.alloc(first + shadows * 32)
  bytes.writeUInt32LE(0x41304, 0); bytes.writeUInt32LE(bytes.length, 48)
  for (let i = 0; i < 6; i++) bytes.writeUInt32LE(i === 3 ? shadowTable : 96, 56 + i * 4)
  bytes.writeUInt32LE(0x106, 96); bytes.writeUInt16LE(8 + bodies * 4, 100); bytes.writeUInt16LE(bodies, 102)
  for (let i = 0; i < bodies; i++) bytes.writeUInt32LE(first, 104 + i * 4)
  bytes.writeUInt32LE(0x5982, shadowTable); bytes.writeUInt16LE(8 + shadows * 4, shadowTable + 4); bytes.writeUInt16LE(shadows, shadowTable + 6)
  for (let i = 0; i < shadows; i++) {
    const at = first + i * 32
    bytes.writeUInt32LE(at, shadowTable + 8 + i * 4)
    bytes.writeUInt32LE(0x1402, at); bytes[at + 4] = 8; bytes[at + 7] = 1; bytes.writeUInt32LE(12, at + 8)
    bytes.writeUInt32LE(12, at + 12); bytes.writeUInt16LE(1, at + 16); bytes.writeUInt16LE(1, at + 18); bytes.writeUInt16LE(0x8001, at + 24)
  }
  return { reader: new S3Dat(bytes), first }
}

test('a shadow table eight sequences shorter than its bodies leaves the prefix absent and aligns the remaining frames', () => {
  // AdvancedDatFileReader's file-12 layout: 34 bodies, 26 shadow sequences.
  const { reader, first } = archive(34, 26)
  expect(reader.has(0, 0x5982)).toBe(false)
  expect(reader.has(7, 0x5982)).toBe(false)
  expect(() => reader.frames(7, 0x5982)).toThrow('Missing DAT sequence')
  expect(reader.frames(8, 0x5982)).toEqual([first + 12])
  expect(reader.frames(33, 0x5982)).toEqual([first + 25 * 32 + 12])
})

test('the 239-sequence specialist layout remaps shadow indices independently from torso offsets', () => {
  const { reader, first } = archive(239, 239)
  // Worked selectors from AdvancedDatFileReader's descending 171..13 copy.
  for (const [body, raw] of [[0, 0], [12, 12], [13, 0], [37, 24], [171, 158], [172, 172], [238, 238]]) {
    expect(reader.frames(body!, 0x5982)).toEqual([first + raw! * 32 + 12])
    expect(reader.layerSequence(body!, 0x5982)).toBe(raw!)
  }
})

test('the distinct building and vehicle shadow layouts retain source aliases and explicit missing layers', () => {
  // The demo's file 13 has 66 body sequences and 40 shadows. The vehicle
  // layout is a hand-encoded reference contract; file 36 is absent here.
  for (const [bodies, shadows, selectors] of [
    [66, 40, [[0, 3], [26, 29], [27, 29], [28, null], [35, 37], [36, null], [43, null], [44, 38], [45, 39], [46, null], [65, null]]],
    [36, 8, [[0, 0], [1, 1], [2, null], [3, 3], [4, 1], [5, 5], [6, null], [7, 7], [8, null], [35, null]]],
  ] as const) {
    const { reader, first } = archive(bodies, shadows)
    for (const [body, raw] of selectors) {
      expect(reader.layerSequence(body, 0x5982)).toBe(raw)
      expect(reader.has(body, 0x5982)).toBe(raw !== null)
      if (raw !== null) expect(reader.frames(body, 0x5982)).toEqual([first + raw * 32 + 12])
    }
  }
})
