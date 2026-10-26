import { geologistImages } from './geologist-images'
import { surveySigns } from './survey-signs'

export interface AtlasFrame { key: string, frame: number, x: number, y: number, width: number, height: number, offsetX: number, offsetY: number }
export interface Atlas { image: HTMLImageElement, frames: Map<string, AtlasFrame[]> }
/** Original data is converted at build time. Missing assets are a visible startup error. */
export async function loadOriginalAssets(): Promise<Atlas> {
  const response = await fetch('/assets/settlers-original/manifest.json', { cache: 'no-cache' })
  if (!response.ok) throw new Error('Original game assets are missing. Run bun run assets:import before starting the game.')
  const manifest = await response.json() as { version: number, atlas: string, width: number, height: number, sprites: AtlasFrame[] }
  if (manifest?.version !== 1 || !/^sprites\.[a-f0-9]{64}\.png$/.test(manifest.atlas) || !Array.isArray(manifest.sprites)) throw new Error('The game asset manifest is invalid.')
  const image = new Image()
  image.src = `/assets/settlers-original/${manifest.atlas}`
  await image.decode()
  if (image.naturalWidth !== manifest.width || image.naturalHeight !== manifest.height) throw new Error('The game atlas dimensions differ from its manifest.')
  const frames = new Map<string, AtlasFrame[]>()
  for (const frame of manifest.sprites) { const group = frames.get(frame.key) ?? []; group.push(frame); frames.set(frame.key, group) }
  for (const expected of surveySigns) {
    const images = frames.get(expected.key)
    if (images?.length !== expected.frames || images.some((frame, index) => frame.frame !== index || frame.width !== 14 || frame.height !== 24 || frame.offsetX !== -8 || frame.offsetY !== -21))
      throw new Error(`Original survey images are missing or invalid: ${expected.key}`)
  }
  for (const expected of geologistImages) {
    const images = frames.get(expected.key)
    if (images?.length !== expected.frames || images.some((frame, index) => frame.frame !== index)) throw new Error(`Original geologist images are missing or invalid: ${expected.key}`)
  }
  return { image, frames }
}
