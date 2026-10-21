export interface AtlasFrame { key: string, frame: number, x: number, y: number, width: number, height: number, offsetX: number, offsetY: number }
export interface Atlas { image: HTMLImageElement, frames: Map<string, AtlasFrame[]> }
/** Original data is converted at build time. Missing assets are a visible startup error. */
export async function loadOriginalAssets(): Promise<Atlas> {
  const response = await fetch('/assets/settlers-original/manifest.json')
  if (!response.ok) throw new Error('Original game assets are missing. Run bun run assets:import before starting the game.')
  const manifest = await response.json() as { version: number, sprites: AtlasFrame[] }
  if (manifest.version !== 1 || !Array.isArray(manifest.sprites)) throw new Error('The game asset manifest is invalid.')
  const image = new Image()
  image.src = '/assets/settlers-original/sprites.png'
  await image.decode()
  const frames = new Map<string, AtlasFrame[]>()
  for (const frame of manifest.sprites) { const group = frames.get(frame.key) ?? []; group.push(frame); frames.set(frame.key, group) }
  return { image, frames }
}
