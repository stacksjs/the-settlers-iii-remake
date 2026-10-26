import type { Atlas } from './assets'

const FILL: Record<string, string> = { grass: '#6f9452', mountain: '#8b8a7f', sand: '#b8ad78', desert: '#c9b783', moor: '#6b6447', snow: '#e8ecef', swamp: '#5d7347', water: '#3c7f8a', unexplored: '#0d1714' }
const TEXTURE: Record<string, string> = { grass: 'terrain-grass', mountain: 'terrain-rock', sand: 'terrain-sand', desert: 'terrain-sand', water: 'terrain-water' }
const MATERIAL_CACHE_BYTES = 2 * 1024 * 1024
const shifts = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? [0, 8, 16, 24] : [24, 16, 8, 0]
interface Material { width: number, height: number, pixels: Uint32Array }
interface Shade { red: Uint32Array, green: Uint32Array, blue: Uint32Array }

/** Native Canvas supplies source colors and channel compositing.
 * Mesh coverage is separate: source pixels never inherit path antialiasing.
 */
export function createTerrainMaterials(document: Document, atlas: Atlas) {
  const materials = new Map<string, Material>(), shades = new Map<string, Shade>()
  let bytes = 0
  const release = (key: string): void => { bytes -= materials.get(key)!.pixels.byteLength; materials.delete(key) }
  function material(kind: string, scale: number): Material {
    const key = `${kind}:${scale}`, cached = materials.get(key)
    if (cached) { materials.delete(key); materials.set(key, cached); return cached }
    const frame = atlas.frames.get(Object.hasOwn(TEXTURE, kind) ? TEXTURE[kind]! : '')?.[0], surface = document.createElement('canvas'), tile = document.createElement('canvas')
    try {
      if (frame?.width && frame.height) {
        const density = frame.width === 1 && frame.height === 1 ? 1 : scale
        const width = frame.width * density, height = frame.height * density
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > 65536) throw new RangeError('Terrain material exceeds its supported raster capacity')
        tile.width = frame.width; tile.height = frame.height
        tile.getContext('2d')!.drawImage(atlas.image, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height)
        surface.width = width; surface.height = height
        const context = surface.getContext('2d')!
        // TextureHandle defaults to NEAREST_FILTER in the pinned reference;
        // Background does not override it. Preserve the original texel colors.
        context.imageSmoothingEnabled = false
        context.setTransform(density, 0, 0, density, 0, 0)
        const pattern = context.createPattern(tile, 'repeat')
        if (!pattern) throw new Error('Terrain texture could not create its native material')
        context.fillStyle = pattern
        context.fillRect(0, 0, frame.width, frame.height)
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
    finally { surface.width = surface.height = tile.width = tile.height = 0 }
  }
  function shade(delta: number, visible: boolean): Shade {
    delta = Math.max(-9, Math.min(7, delta))
    const key = `${delta}:${visible}`, cached = shades.get(key)
    if (cached) return cached
    const surface = document.createElement('canvas'); surface.width = 256; surface.height = 1
    try {
      const context = surface.getContext('2d')!, ramp = new ImageData(256, 1)
      for (let value = 0; value < 256; value++) ramp.data.set([value, value, value, 255], value * 4)
      context.putImageData(ramp, 0, 0)
      const slope = delta * 0.05
      context.fillStyle = slope >= 0 ? `rgba(255,248,220,${Math.min(0.35, slope)})` : `rgba(10,20,15,${Math.min(0.45, -slope)})`; context.fillRect(0, 0, 256, 1)
      if (!visible) { context.fillStyle = 'rgba(8,16,13,0.38)'; context.fillRect(0, 0, 256, 1) }
      const data = context.getImageData(0, 0, 256, 1).data, red = new Uint32Array(256), green = new Uint32Array(256), blue = new Uint32Array(256)
      for (let value = 0; value < 256; value++) {
        red[value] = data[value * 4]! << shifts[0]!
        green[value] = data[value * 4 + 1]! << shifts[1]!
        blue[value] = data[value * 4 + 2]! << shifts[2]!
      }
      const value = { red, green, blue }; shades.set(key, value); return value
    }
    finally { surface.width = surface.height = 0 }
  }
  return {
    sampler(kind: string, scale: number, delta: number, visible: boolean, originX: number, originY: number): (x: number, y: number) => number {
      if (typeof kind !== 'string' || typeof visible !== 'boolean' || ![0.5, 1, 2].includes(scale) || !Number.isInteger(delta) || !Number.isSafeInteger(originX) || !Number.isSafeInteger(originY)) throw new RangeError('Invalid terrain material sampling')
      const source = material(kind, scale), colors = shade(delta, visible), opaque = 255 << shifts[3]!
      let row = 0, lastY = NaN
      return (x, y) => {
        if (lastY !== y) { row = ((y + originY) % source.height + source.height) % source.height * source.width; lastY = y }
        const pixel = source.pixels[row + ((x + originX) % source.width + source.width) % source.width]!
        return opaque | colors.red[pixel >>> shifts[0]! & 255]! | colors.green[pixel >>> shifts[1]! & 255]! | colors.blue[pixel >>> shifts[2]! & 255]!
      }
    },
    memory: () => ({ bytes, limit: MATERIAL_CACHE_BYTES, entries: materials.size, shadeBytes: shades.size * 256 * 3 * 4 }),
    dispose() { materials.clear(); shades.clear(); bytes = 0 },
  }
}
