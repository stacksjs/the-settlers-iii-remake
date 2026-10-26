// Format implementation adapted from JSettlers' MIT-licensed DatBitmapReader and
// AdvancedDatFileReader (2015-2018). See third-party/settlers-remake-LICENSE.txt.
import { Buffer } from 'node:buffer'

export interface Sprite { width: number, height: number, offsetX: number, offsetY: number, data: Buffer }

/** Compose DAT layers in anchor coordinates, in their drawing order. */
export function composeDatSprites(layers: readonly Sprite[]): Sprite {
  if (!layers.length) throw new Error('DAT composition needs a layer')
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const layer of layers) {
    if (![layer.width, layer.height, layer.offsetX, layer.offsetY].every(Number.isSafeInteger)
      || layer.width < 0 || layer.height < 0 || layer.width > 2048 || layer.height > 2048
      || layer.offsetX < -32768 || layer.offsetX > 32767 || layer.offsetY < -32768 || layer.offsetY > 32767
      || !layer.width !== !layer.height || layer.data.length !== layer.width * layer.height * 4)
      throw new Error('Invalid DAT composition layer')
    if (!layer.width) continue
    left = Math.min(left, layer.offsetX); top = Math.min(top, layer.offsetY)
    right = Math.max(right, layer.offsetX + layer.width); bottom = Math.max(bottom, layer.offsetY + layer.height)
  }
  if (left === Infinity) return { width: 0, height: 0, offsetX: 0, offsetY: 0, data: Buffer.alloc(0) }
  const width = right - left, height = bottom - top
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width > 4096 || height > 4096) throw new Error('DAT composition exceeds bounds')
  const data = Buffer.alloc(width * height * 4)
  for (const layer of layers) for (let y = 0; y < layer.height; y++) for (let x = 0; x < layer.width; x++) {
    const from = (y * layer.width + x) * 4
    if (!layer.data[from + 3]) continue
    if (layer.data[from + 3] !== 255) throw new Error('DAT composition requires opaque or transparent pixels')
    const dx = x + layer.offsetX - left, dy = y + layer.offsetY - top
    layer.data.copy(data, (dy * width + dx) * 4, from, from + 4)
  }
  return { width, height, offsetX: left, offsetY: top, data }
}

export class S3Dat {
  private sections = new Map<number, number[]>()
  constructor(private bytes: Buffer) {
    if (bytes.length < 96 || bytes.readUInt32LE(0) !== 0x00041304 || bytes.readUInt32LE(48) !== bytes.length) throw new Error('Invalid Settlers III DAT header')
    for (let i = 0; i < 6; i++) {
      const start = this.u32(56 + i * 4)
      const type = this.u32(start), size = this.u16(start + 4), count = this.u16(start + 6)
      if (size !== count * 4 + 8) throw new Error('Invalid DAT section length')
      this.sections.set(type, Array.from({ length: count }, (_, n) => this.u32(start + 8 + n * 4)))
    }
  }
  private u16(offset: number): number { if (offset < 0 || offset + 2 > this.bytes.length) throw new Error('Truncated DAT data'); return this.bytes.readUInt16LE(offset) }
  private u32(offset: number): number { if (offset < 0 || offset + 4 > this.bytes.length) throw new Error('Truncated DAT data'); return this.bytes.readUInt32LE(offset) }
  private sequenceStart(sequence: number, type: number): number | undefined {
    const section = this.sections.get(type)
    // AdvancedDatFileReader aligns shorter torso tables to the last body
    // sequences. Their absent prefix is not a different profession's clothing.
    const shift = type === 0x3112 ? Math.max(0, (this.sections.get(0x106)?.length ?? 0) - (section?.length ?? 0)) : 0
    return section?.[sequence - shift]
  }
  /** Whether a body sequence has the requested layer, including absent torso prefixes. */
  has(sequence: number, type = 0x106): boolean { return this.sequenceStart(sequence, type) !== undefined }
  frames(sequence: number, type = 0x106): number[] {
    const start = this.sequenceStart(sequence, type)
    if (start === undefined) throw new Error(`Missing DAT sequence ${type}:${sequence}`)
    if (type === 0x2412 || type === 0x11306) return [start]
    if (this.u32(start) !== 0x1402 || this.bytes[start + 4] !== 8) throw new Error('Invalid DAT sequence header')
    const count = this.u16(start + 6) >> 8
    const tableEnd = start + 8 + count * 4
    if (tableEnd > this.bytes.length) throw new Error('Truncated DAT frame table')
    return Array.from({ length: count }, (_, i) => {
      const frame = start + this.u32(start + 8 + i * 4)
      if (frame < tableEnd || frame + 12 > this.bytes.length) throw new Error('Invalid DAT frame offset')
      return frame
    })
  }
  decode(offset: number, color: '565' | '555' | 'torso' = '565', header: 'displaced' | 'landscape' | 'gui' = 'displaced'): Sprite {
    // GUI has two reserved shorts after its dimensions; landscape has one.
    const headerBytes = header === 'displaced' ? 12 : header === 'gui' ? 8 : 6
    if (offset < 0 || offset + headerBytes > this.bytes.length) throw new Error('Truncated DAT sprite header')
    if (header === 'displaced' && this.u32(offset) !== 12) throw new Error('Unsupported DAT sprite header')
    const start = offset + (header === 'displaced' ? 4 : 0)
    const width = this.u16(start), height = this.u16(start + 2)
    if ((!width !== !height) || width > 2048 || height > 2048) throw new Error(`Invalid DAT sprite dimensions ${width}x${height} at ${offset}`)
    const offsetX = header === 'displaced' ? this.bytes.readInt16LE(offset + 8) : 0, offsetY = header === 'displaced' ? this.bytes.readInt16LE(offset + 10) : 0
    const data = Buffer.alloc(width * height * 4)
    let at = offset + headerBytes
    if (at % 2) at++
    for (let y = 0; y < height; y++) {
      let x = 0, done = false, runs = 0
      while (!done) {
        if (++runs > width + 1) throw new Error('Invalid DAT row runs')
        const meta = this.u16(at); at += 2
        const count = meta & 255, skip = (meta >> 8) & 127
        done = (meta & 0x8000) !== 0; x += skip
        if (x + count > width) throw new Error('DAT row exceeds sprite width')
        for (let n = 0; n < count; n++, x++) {
          const pixel = (y * width + x) * 4
          if (color === 'torso') {
            if (at >= this.bytes.length) throw new Error('Truncated DAT torso')
            const shade = this.bytes[at++]! & 31
            // The source stores a grayscale player-color mask, not a palette.
            // Match the pinned reference translator's five-to-eight-bit truncation.
            const value = Math.floor(shade * 255 / 31)
            data[pixel] = value; data[pixel + 1] = value; data[pixel + 2] = value
          }
          else {
            const value = this.u16(at); at += 2
            const r = color === '565' ? value >> 11 : (value >> 10) & 31, g = color === '565' ? (value >> 5) & 63 : (value >> 5) & 31, b = value & 31
            data[pixel] = (r << 3) | (r >> 2); data[pixel + 1] = color === '565' ? (g << 2) | (g >> 4) : (g << 3) | (g >> 2); data[pixel + 2] = (b << 3) | (b >> 2)
          }
          data[pixel + 3] = 255
        }
      }
    }
    return { width, height, offsetX, offsetY, data }
  }
}
