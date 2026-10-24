// Format implementation adapted from JSettlers' MIT-licensed DatBitmapReader and
// AdvancedDatFileReader (2015-2018). See third-party/settlers-remake-LICENSE.txt.
import { Buffer } from 'node:buffer'

export interface Sprite { width: number, height: number, offsetX: number, offsetY: number, data: Buffer }
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
  /** Whether a section holds a sequence; layers such as torsos exist only for some sequences. */
  has(sequence: number, type = 0x106): boolean { return this.sections.get(type)?.[sequence] !== undefined }
  frames(sequence: number, type = 0x106): number[] {
    const start = this.sections.get(type)?.[sequence]
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
  decode(offset: number, color: '565' | '555' | 'torso' = '565', header: 'displaced' | 'landscape' = 'displaced'): Sprite {
    if (header === 'displaced' && this.u32(offset) !== 12) throw new Error('Unsupported DAT sprite header')
    const start = offset + (header === 'displaced' ? 4 : 0)
    const width = this.u16(start), height = this.u16(start + 2)
    if ((!width !== !height) || width > 2048 || height > 2048) throw new Error(`Invalid DAT sprite dimensions ${width}x${height} at ${offset}`)
    const offsetX = header === 'displaced' ? this.bytes.readInt16LE(offset + 8) : 0, offsetY = header === 'displaced' ? this.bytes.readInt16LE(offset + 10) : 0
    const data = Buffer.alloc(width * height * 4)
    let at = offset + (header === 'displaced' ? 12 : 6)
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
