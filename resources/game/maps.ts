import type { OriginalMapInput } from './engine'

export interface OriginalMapAsset { input: OriginalMapInput, source: { path: string, sha256: string } }

/** Loads a converted original map. The file is local converted media, still validated before use. */
export async function loadOriginalMap(name: string): Promise<OriginalMapAsset> {
  const response = await fetch(`/assets/settlers-original/maps/${name}.json`)
  if (!response.ok) throw new Error('The original map is missing. Run bun run assets:import before starting the game.')
  const raw = await response.json() as Record<string, any>
  const size = raw?.size
  if (raw?.version !== 1 || !Number.isInteger(size) || size < 8 || size > 1024 || typeof raw.source?.sha256 !== 'string') throw new Error('The original map file is invalid.')
  const decode = (text: unknown): Uint8Array => {
    if (typeof text !== 'string') throw new Error('The original map file is invalid.')
    const binary = atob(text), bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    if (bytes.length !== size * size) throw new Error('The original map file is damaged.')
    return bytes
  }
  const list = <T>(value: unknown): T[] => { if (!Array.isArray(value) || value.length > 100_000) throw new Error('The original map file is invalid.'); return value as T[] }
  const layers = raw.layers ?? {}
  return {
    source: { path: String(raw.source.path), sha256: raw.source.sha256 },
    input: {
      area: { size, elevation: decode(layers.elevation), landscape: decode(layers.landscape), objects: decode(layers.objects), resourceType: decode(layers.resourceType), resourceAmount: decode(layers.resourceAmount) },
      players: list(raw.players), settlers: list(raw.settlers), buildings: list(raw.buildings), stacks: list(raw.stacks),
    },
  }
}
