import { Buffer } from 'node:buffer'

// Test-only independent reader for verified original fixtures. Ported from the
// pinned remake's DatBitmapReader, DatFileType, Color and TorsoTranslator.
// It deliberately imports no production DAT reader or compositor.
// MIT notice: third-party/settlers-remake-LICENSE.txt.
const five = [0, 8, 16, 24, 32, 41, 49, 57, 65, 74, 82, 90, 98, 106, 115, 123, 131, 139, 148, 156, 164, 172, 180, 189, 197, 205, 213, 222, 230, 238, 246, 255]
const six = Array.from({ length: 64 }, (_, value) => Math.trunc(Math.fround(Math.fround(value * 255) / 63)))
export interface ReferenceImage { width: number, height: number, offsetX: number, offsetY: number, data: Buffer<ArrayBuffer> }
export function referenceFrames(bytes: Buffer, section: number, sequence: number): number[] {
  const sections = new Map<number, { at: number, count: number }>()
  for (let i = 0; i < 6; i++) { const at = bytes.readUInt32LE(56 + i * 4); sections.set(bytes.readUInt32LE(at), { at, count: bytes.readUInt16LE(at + 6) }) }
  const table = sections.get(section)!
  const shift = section === 0x3112 ? Math.max(0, sections.get(0x106)!.count - table.count) : 0
  if (section !== 0x5982 && (sequence < shift || sequence - shift >= table.count)) return []
  let start = section === 0x5982 ? 0 : bytes.readUInt32LE(table.at + 8 + (sequence - shift) * 4)
  if (section === 0x5982) {
    // Direct port of the reference's array alignment, intentionally separate
    // from the production reader's physical-index calculation.
    const bodies = sections.get(0x106)!.count, difference = bodies - table.count
    const raw = Array.from({ length: table.count }, (_, index) => bytes.readUInt32LE(table.at + 8 + index * 4))
    const aligned: (number | undefined)[] = difference > 0 ? Array(bodies).fill(undefined) : raw.slice()
    if (difference > 0) for (let index = 0; index < raw.length; index++) aligned[index + ([7, 8].includes(difference) ? difference : 0)] = raw[index]
    if (difference === 0 && bodies === 239) for (let index = 171; index >= 13; index--) aligned[index] = aligned[index - 13]
    if (difference === 26) {
      for (let index = 0; index < 27; index++) aligned[index] = aligned[index + 3]
      for (let index = 27; index < 36; index++) aligned[index] = aligned[index + 2]
      aligned[28] = undefined; aligned[44] = aligned[38]; aligned[45] = aligned[39]
      for (let index = 36; index < 44; index++) aligned[index] = undefined
      for (let index = 46; index < aligned.length; index++) aligned[index] = undefined
    }
    if (difference === 28) { aligned[4] = aligned[1]; aligned[6] = undefined; aligned[2] = undefined }
    if (aligned[sequence] === undefined) return []
    start = aligned[sequence]!
  }
  if (section === 0x2412 || section === 0x11306) return [start]
  return Array.from({ length: bytes.readUInt16LE(start + 6) >>> 8 }, (_, i) => start + bytes.readUInt32LE(start + 8 + i * 4))
}
export function referenceImage(bytes: Buffer, offset: number, torso: boolean | 'shadow' = false, header: 'displaced' | 'landscape' | 'gui' = 'displaced'): ReferenceImage {
  const displaced = header === 'displaced', dimensions = offset + (displaced ? 4 : 0)
  const width = bytes.readUInt16LE(dimensions), height = bytes.readUInt16LE(dimensions + 2)
  const image = { width, height, offsetX: displaced ? bytes.readInt16LE(offset + 8) : 0, offsetY: displaced ? bytes.readInt16LE(offset + 10) : 0, data: Buffer.alloc(width * height * 4) }
  let cursor = offset + (displaced ? 12 : header === 'gui' ? 8 : 6)
  cursor += cursor % 2
  for (let row = 0; row < height; row++) {
    let column = 0, last: boolean
    do {
      const run = bytes.readUInt16LE(cursor); cursor += 2
      last = !!(run & 0x8000); column += (run >>> 8) & 0x7f
      for (let pixel = 0; pixel < (run & 0xff); pixel++, column++) {
        if (column >= width) throw new Error('Invalid verified reference row')
        const to = (row * width + column) * 4
        if (torso === 'shadow') image.data.set([0, 0, 0, 136], to)
        else if (torso) { const gray = five[bytes[cursor++]! & 31]!; image.data.set([gray, gray, gray, 255], to) }
        else { const word = bytes.readUInt16LE(cursor); cursor += 2; image.data.set([five[(word >>> 11) & 31]!, six[(word >>> 5) & 63]!, five[word & 31]!, 255], to) }
      }
    } while (!last)
  }
  return image
}
export function referenceCompose(layers: ReferenceImage[]): ReferenceImage {
  const left = Math.min(...layers.map(i => i.offsetX)), top = Math.min(...layers.map(i => i.offsetY))
  const width = Math.max(...layers.map(i => i.offsetX + i.width)) - left, height = Math.max(...layers.map(i => i.offsetY + i.height)) - top
  const data = Buffer.alloc(width * height * 4)
  for (const image of layers) for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const from = (y * image.width + x) * 4
    if (image.data[from + 3]) data.set(image.data.subarray(from, from + 4), ((y + image.offsetY - top) * width + x + image.offsetX - left) * 4)
  }
  return { width, height, offsetX: left, offsetY: top, data }
}
