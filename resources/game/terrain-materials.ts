import type { Atlas } from './assets'

const FILL: Record<string, string> = { grass: '#6f9452', mountain: '#8b8a7f', sand: '#b8ad78', desert: '#c9b783', moor: '#6b6447', snow: '#e8ecef', swamp: '#5d7347', water: '#3c7f8a' }
const TEXTURE: Record<string, string> = { grass: 'terrain-grass', mountain: 'terrain-rock', sand: 'terrain-sand', desert: 'terrain-sand', water: 'terrain-water' }
const MATERIAL_CACHE_BYTES = 2 * 1024 * 1024
const shifts = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? [0, 8, 16, 24] : [24, 16, 8, 0]
interface Material { width: number, height: number, pixels: Uint32Array }
interface TerrainVertex { x: number, y: number, u: number, v: number, light: number }

/** Native Canvas supplies the unchanged source colors.
 * Mesh coverage is separate: source pixels never inherit path antialiasing.
 */
export function createTerrainMaterials(document: Document, atlas: Atlas) {
  const materials = new Map<string, Material>()
  let bytes = 0
  const release = (key: string): void => { bytes -= materials.get(key)!.pixels.byteLength; materials.delete(key) }
  function material(kind: string): Material {
    const key = kind, cached = materials.get(key)
    if (cached) { materials.delete(key); materials.set(key, cached); return cached }
    const frame = atlas.frames.get(Object.hasOwn(TEXTURE, kind) ? TEXTURE[kind]! : '')?.[0], surface = document.createElement('canvas')
    try {
      if (frame?.width && frame.height) {
        const width = frame.width, height = frame.height
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > 65536) throw new RangeError('Terrain material exceeds its supported raster capacity')
        surface.width = width; surface.height = height
        const context = surface.getContext('2d')!
        // TextureHandle defaults to NEAREST_FILTER in the pinned reference;
        // retain raw texels and select the nearest one after UV interpolation.
        context.drawImage(atlas.image, frame.x, frame.y, width, height, 0, 0, width, height)
      }
      else {
        surface.width = surface.height = 1
        const context = surface.getContext('2d')!
        context.fillStyle = Object.hasOwn(FILL, kind) ? FILL[kind]! : FILL.grass!; context.fillRect(0, 0, 1, 1)
      }
      const data = surface.getContext('2d')!.getImageData(0, 0, surface.width, surface.height).data
      // The converted original terrain sources are opaque rectangular tiles.
      // Reject unsupported alpha instead of inventing ground beneath holes.
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) throw new Error('Terrain material must preserve opaque source coverage')
      const value = { width: surface.width, height: surface.height, pixels: new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4) }
      while (materials.size && (bytes + data.byteLength > MATERIAL_CACHE_BYTES || materials.size >= 32)) release(materials.keys().next().value!)
      materials.set(key, value); bytes += data.byteLength
      return value
    }
    finally { surface.width = surface.height = 0 }
  }
  return {
    sampler(kind: string, a: TerrainVertex, b: TerrainVertex, c: TerrainVertex): (x: number, y: number) => number {
      if (typeof kind !== 'string' || ![a, b, c].every(p => [p.x, p.y, p.u, p.v, p.light].every(n => Number.isFinite(n) && Math.abs(n) <= 2 ** 24))) throw new RangeError('Invalid terrain material sampling')
      const bx = b.x - a.x, by = b.y - a.y, cx = c.x - a.x, cy = c.y - a.y, area = bx * cy - by * cx
      // The raster skips collapsed faces. Do not divide by zero or allocate
      // materials for geometry with no coverage.
      if (area === 0) return () => 0
      const ux = (b.u - a.u) * cy - (c.u - a.u) * by, uy = (c.u - a.u) * bx - (b.u - a.u) * cx
      const vx = (b.v - a.v) * cy - (c.v - a.v) * by, vy = (c.v - a.v) * bx - (b.v - a.v) * cx
      const u0 = a.u * area - ux * (a.x - 0.5) - uy * (a.y - 0.5), v0 = a.v * area - vx * (a.x - 0.5) - vy * (a.y - 0.5)
      const lx = (b.light - a.light) * cy - (c.light - a.light) * by, ly = (c.light - a.light) * bx - (b.light - a.light) * cx
      const l0 = a.light * area - lx * (a.x - 0.5) - ly * (a.y - 0.5)
      const source = material(kind), opaque = 255 << shifts[3]!
      return (x, y) => {
        const u = Math.floor((u0 + ux * x + uy * y) / area), v = Math.floor((v0 + vx * x + vy * y) / area)
        const pixel = source.pixels[((v % source.height + source.height) % source.height) * source.width + (u % source.width + source.width) % source.width]!
        // Match the reference fragment shader: interpolate light first, then
        // multiply source RGB. Saturate only the final RGBA8 channels.
        const light = Math.max(0, (l0 + lx * x + ly * y) / area)
        return opaque | Math.min(255, Math.round((pixel >>> shifts[0]! & 255) * light)) << shifts[0]!
          | Math.min(255, Math.round((pixel >>> shifts[1]! & 255) * light)) << shifts[1]!
          | Math.min(255, Math.round((pixel >>> shifts[2]! & 255) * light)) << shifts[2]!
      }
    },
    memory: () => ({ bytes, limit: MATERIAL_CACHE_BYTES, entries: materials.size }),
    dispose() { materials.clear(); bytes = 0 },
  }
}
