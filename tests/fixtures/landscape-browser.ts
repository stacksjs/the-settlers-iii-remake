import type { Atlas } from '../../resources/game/assets'
import { createSession, describeMap, ROMAN_ENGINEERING as rules, worldFromOriginal } from '../../resources/game/engine'
import { createRenderer } from '../../resources/game/renderer'

/** Literal source selectors, not values read back from the production material resolver. */
const cases = [
  ['grass', 16, 0, 128], ['dry-grass', null, 1, 128], ['desert', 64, 18, 128], ['earth', null, 2, 128], ['mountain', 32, 21, 128], ['snow', 128, 24, 128], ['sand', 48, 31, 128], ['flattened', null, 35, 128],
  ['river-1', 96, 17, 32], ['river-2', 97, 17, 32], ['river-3', 98, 17, 32], ['river-4', 99, 17, 32], ['mountain-border', 33, 22, 0], ['mountain-border-outer', 17, 23, 0],
  ['water', 0, 17, 32], ['water-2', 1, 16, 32], ['water-3', 2, 15, 32], ['water-4', 3, 14, 32], ['water-5', 4, 13, 32], ['water-6', 5, 12, 32], ['water-7', 6, 11, 32], ['water-8', 7, 10, 128],
  ['moor', 80, 7, 128], ['moor-border', 81, 8, 0], ['moor-border-outer', 21, 9, 0], ['flattened-desert', null, 217, 128], ['sharp-flattened-desert', null, 217, 128], ['gravel', null, 230, 128],
  ['desert-border', 65, 19, 0], ['desert-border-outer', 20, 20, 0], ['snow-border', 129, 25, 0], ['snow-border-outer', 35, 26, 0], ['swamp', 144, 4, 128], ['mud-border', 145, 5, 0], ['mud-border-outer', 23, 6, 0], ['road', null, 34, 0], ['dry-earth', null, 36, 128],
] as const

export function checkSourceLandscapes(canvas: HTMLCanvasElement, atlas: Atlas): { landscapes: number, materials: number, pixels: number, faceLocal: number, materialBytes: number, materialEntries: number, fallbackColors: number } {
  const renderer = createRenderer(canvas), source = document.createElement('canvas')
  source.width = atlas.image.naturalWidth; source.height = atlas.image.naturalHeight
  const raw = source.getContext('2d')!; raw.drawImage(atlas.image, 0, 0)
  const context = canvas.getContext('2d')!, ratio = canvas.width / canvas.getBoundingClientRect().width
  let pixels = 0, faceLocal = 0, materialBytes = 0, materialEntries = 0
  try {
    renderer.setAssets(atlas); renderer.camera.zoom = 1
    for (const [id, code, image, period] of cases) {
      const size = 96, terrain = new Uint8Array(size * size).fill(code ?? 16)
      const map = code === null ? describeMap(rules, { width: size, height: size, base: id, features: [] }) : worldFromOriginal(rules, {
        area: { size, landscape: terrain, elevation: new Uint8Array(size * size), objects: new Uint8Array(size * size), resourceType: new Uint8Array(size * size), resourceAmount: new Uint8Array(size * size) }, players: [], settlers: [], buildings: [], stacks: [],
      }).map
      const session = createSession({ rules, map, seed: 1, players: [{ name: 'Viewer', civilization: 'roman', controller: 'observer', start: { x: 32, y: 32 }, scenario: { buildings: [], settlers: [] } }] })
      try {
        const before = session.checksum()
        renderer.home({ x: 32, y: 32 }); renderer.draw(session, { player: 1, cursor: null, tool: null, selected: null, time: 0, reduceMotion: true, placement: null })
        // Same flat-grid texel at both orientations and the neighboring cell.
        // Uniform face-local tiles use CONTINUOS orientation, without cell phase.
        for (const [x, y, dx, dy, localU, localV] of [[32, 32, 2, 2, 10, 4], [32, 32, 10, 2, 18, 4], [33, 32, 2, 2, 10, 4], [32, 33, 2, 2, 10, 4]]) {
          const key = image === 0 ? 'terrain-grass' : image === 17 ? 'terrain-water' : image === 21 ? 'terrain-rock' : image === 31 ? 'terrain-sand' : `terrain-source-${image}`
          const frame = atlas.frames.get(key)?.[0]
          if (!frame) throw new Error(`Missing original material ${image}`)
          const u = period ? ((x! * 16 - y! * 8 + localU!) % period + period) % period : localU!
          const v = period ? (y! * 16 + localV!) % period : localV!
          const expected = [...raw.getImageData(frame.x + u, frame.y + v, 1, 1).data].map((n, c) => c === 3 ? n : Math.round(n * 7 / 8))
          const point = renderer.screen({ x: x! * 16 - y! * 8, y: y! * 9 })
          const actual = [...context.getImageData(Math.floor((point.x + dx! + 0.5) * ratio), Math.floor((point.y + dy! + 0.5) * ratio), 1, 1).data]
          if (actual.join() !== expected.join()) throw new Error(`Source landscape ${id} at ${x},${y} offset ${dx},${dy}: ${actual} instead of ${expected}`)
          pixels++
        }
        if (!period) faceLocal++
        if (before !== session.checksum()) throw new Error('Source landscape rendering changed simulation state')
        const memory = renderer.terrainMaterialMemory()
        materialBytes = memory.bytes; materialEntries = memory.entries
        if (memory.bytes > memory.limit || memory.entries > 32) throw new Error('Source landscape material cache exceeded its bounds')
      }
      finally { session.dispose() }
    }
    if (materialBytes !== 991232 + 2048 || materialEntries !== 32) throw new Error('Landscape aliases duplicated or evicted source material pixels')
    renderer.setAssets({ ...atlas, frames: new Map() })
    for (const [id, expected] of [['grass', '18,96,18,255'], ['sand', '151,150,0,255'], ['river-1', '62,117,221,255'], ['water', '21,87,210,255']] as const) {
      const session = createSession({ rules, seed: 1, map: describeMap(rules, { width: 96, height: 96, base: id, features: [] }), players: [{ name: 'Viewer', civilization: 'roman', controller: 'observer', start: { x: 32, y: 32 }, scenario: { buildings: [], settlers: [] } }] })
      try {
        renderer.home({ x: 32, y: 32 }); renderer.draw(session, { player: 1, cursor: null, tool: null, selected: null, time: 0, reduceMotion: true, placement: null })
        const point = renderer.screen({ x: 256, y: 288 }), actual = [...context.getImageData(Math.floor((point.x + 2.5) * ratio), Math.floor((point.y + 2.5) * ratio), 1, 1).data]
        if (actual.join() !== expected) throw new Error(`Source catalog fallback color ${id}: ${actual} instead of ${expected}`)
        pixels++
      }
      finally { session.dispose() }
    }
  }
  finally { renderer.dispose(); source.width = source.height = 0 }
  if (renderer.terrainMaterialMemory().bytes || renderer.terrainCacheMemory().bytes || renderer.terrainFrameMemory().bytes) throw new Error('Source landscapes retained disposed resources')
  return { fallbackColors: 4, materialBytes, materialEntries, landscapes: cases.length, materials: 32, pixels, faceLocal }
}
