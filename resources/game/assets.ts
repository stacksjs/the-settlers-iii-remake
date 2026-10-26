import type { PlayerSlotCatalog } from './player-colors'
import { isPlayerSprite, validatePlayerSlotCatalog } from './player-colors'
import { geologistImages } from './geologist-images'
import { surveySigns } from './survey-signs'

export interface AtlasFrame { key: string, frame: number, x: number, y: number, width: number, height: number, offsetX: number, offsetY: number, torso?: string | null, shadow?: string | null }
export interface Atlas { image: HTMLImageElement, frames: Map<string, AtlasFrame[]>, playerSlots: PlayerSlotCatalog }
/** Index original layers once for the browser and build verifier. */
export function indexAtlasFrames(sprites: readonly AtlasFrame[], width: number, height: number): Map<string, AtlasFrame[]> {
  // Match the published PNG decoder's 256 MiB per-buffer RGBA ceiling.
  if (!Array.isArray(sprites) || sprites.length > 100000 || ![width, height].every(value => Number.isInteger(value) && value > 0) || width * height > 67_108_864) throw new Error('Invalid original atlas dimensions or frame count')
  const frames = new Map<string, AtlasFrame[]>()
  for (const frame of sprites) {
    if (!frame || typeof frame.key !== 'string' || !frame.key || frame.key.length > 128 || !Number.isInteger(frame.frame) || frame.frame < 0 || ![frame.x, frame.y, frame.width, frame.height, frame.offsetX, frame.offsetY].every(Number.isInteger) || frame.x < 0 || frame.y < 0 || frame.width < 0 || frame.height < 0 || !frame.width !== !frame.height || frame.x + frame.width > width || frame.y + frame.height > height || frame.offsetX < -32768 || frame.offsetX > 32767 || frame.offsetY < -32768 || frame.offsetY > 32767) throw new Error('Invalid original atlas frame bounds')
    const group = frames.get(frame.key) ?? []; group.push(frame); frames.set(frame.key, group)
  }
  for (const group of frames.values()) {
    group.sort((a, b) => a.frame - b.frame)
    if (group.some((frame, index) => frame.frame !== index)) throw new Error('Original atlas frame sequence is ambiguous')
  }
  for (const frame of sprites) for (const layer of ['torso', 'shadow'] as const) {
    const reference = frame[layer]
    if (isPlayerSprite(frame.key) && reference === undefined) throw new Error(`Original ${layer}-layer metadata is missing`)
    if (reference !== undefined && reference !== null) {
      if (typeof reference !== 'string' || reference !== `${layer}:${frame.key}`) throw new Error(`Invalid original ${layer} reference`)
      if (!frames.get(reference)?.some(mask => mask.frame === frame.frame && !mask.torso && !mask.shadow)) throw new Error(`Original ${layer} layer is missing`)
    }
    if (frame.key.startsWith(`${layer}:`) && !frames.get(frame.key.slice(layer.length + 1))?.some(body => body.frame === frame.frame && body[layer] === frame.key)) throw new Error(`Original ${layer} layer has no matching body`)
  }
  return frames
}
/** Original data is converted at build time. Missing assets are a visible startup error. */
export async function loadOriginalAssets(): Promise<Atlas> {
  const response = await fetch('/assets/settlers-original/manifest.json', { cache: 'no-cache' })
  if (!response.ok) throw new Error('Original game assets are missing. Run bun run assets:import before starting the game.')
  const manifest = await response.json() as { version: number, atlas: string, width: number, height: number, sprites: AtlasFrame[], playerSlots: unknown }
  if (manifest?.version !== 3 || !/^sprites\.[a-f0-9]{64}\.png$/.test(manifest.atlas) || !Array.isArray(manifest.sprites)) throw new Error('The game asset manifest is invalid.')
  const frames = indexAtlasFrames(manifest.sprites, manifest.width, manifest.height)
  const image = new Image()
  image.src = `/assets/settlers-original/${manifest.atlas}`
  await image.decode()
  if (image.naturalWidth !== manifest.width || image.naturalHeight !== manifest.height) throw new Error('The game atlas dimensions differ from its manifest.')
  for (const expected of surveySigns) {
    const images = frames.get(expected.key)
    if (images?.length !== expected.frames || images.some((frame, index) => frame.frame !== index || frame.width !== 14 || frame.height !== 24 || frame.offsetX !== -8 || frame.offsetY !== -21))
      throw new Error(`Original survey images are missing or invalid: ${expected.key}`)
  }
  for (const expected of geologistImages) {
    const images = frames.get(expected.key)
    if (images?.length !== expected.frames || images.some((frame, index) => frame.frame !== index)) throw new Error(`Original geologist images are missing or invalid: ${expected.key}`)
  }
  return { image, frames, playerSlots: validatePlayerSlotCatalog(manifest.playerSlots) }
}
