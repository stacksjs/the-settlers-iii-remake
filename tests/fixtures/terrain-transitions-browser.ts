import { order, until } from './engine'
import goldens from './terrain-transition-cases.json'
import type { MapFeature } from '../../resources/game/engine/map'
import type { Atlas } from '../../resources/game/assets'
import { createSession, describeMap, restore, save, ROMAN_ENGINEERING as rules, worldFromOriginal } from '../../resources/game/engine'
import { createRenderer } from '../../resources/game/renderer'

/** A literal source face, independent of the production material resolver. */
function checkLiteralTransition(canvas: HTMLCanvasElement, atlas: Atlas) {
  const renderer = createRenderer(canvas), size = 96, landscape = new Uint8Array(size * size)
  // Background's upward face at 32,32 has WATER2 at the apex and WATER1 at
  // both bottom corners. Its even variant selects image84 and BOTTOM UVs.
  landscape[32 * size + 32] = 1
  const world = worldFromOriginal(rules, { area: { size, landscape, elevation: new Uint8Array(size * size), objects: new Uint8Array(size * size), resourceType: new Uint8Array(size * size), resourceAmount: new Uint8Array(size * size) }, players: [], settlers: [], buildings: [], stacks: [] })
  const session = createSession({ rules, map: world.map, seed: 1, players: [{ name: 'Viewer', civilization: 'roman', controller: 'observer', start: { x: 32, y: 32 }, scenario: { buildings: [], settlers: [] } }] })
  try {
    const before = session.checksum()
    renderer.setAssets(atlas); renderer.camera.zoom = 2; renderer.home({ x: 32, y: 32 })
    renderer.draw(session, { player: 1, cursor: null, tool: null, selected: null, time: 0, reduceMotion: true, placement: null })
    const ratio = canvas.width / canvas.getBoundingClientRect().width, point = renderer.screen({ x: 256, y: 288 })
    const actual = [...canvas.getContext('2d')!.getImageData(Math.floor((point.x + 0.5) * ratio), Math.floor((point.y + 9.5) * ratio), 1, 1).data]
    // At 200% the source sample is away from final downsampling ties.
    // Source image84, texel(16,24), independently decoded through both DAT
    // readers. BOTTOM UVs are apex(16,16), left(8,32), right(24,32).
    const expected = [0, 141, 208, 255]
    if (actual.join() !== expected.join()) throw new Error(`Mixed WATER1/WATER2 face selected ${actual} instead of original transition ${expected}`)
    if (session.checksum() !== before) throw new Error('Source transition painting changed simulation state')
  }
  finally { renderer.dispose(); session.dispose() }
  if (renderer.terrainMaterialMemory().bytes || renderer.terrainCacheMemory().bytes || renderer.terrainFrameMemory().bytes) throw new Error('Transition painting retained disposed resources')
  return { pixels: 1, cases: 1, sourceImage: 84, sourceUV: [16, 24], checksumUnchanged: true, disposal: true }
}

/** The pinned Java code supplied image/UV goldens. Canvas independently builds
 * its original atlas, including row padding, empty cells and overwrite order.
 * Neither expected selection nor expected UVs call the production resolver.
 */
export function checkSourceTransitions(canvas: HTMLCanvasElement, atlas: Atlas) {
  const literal = checkLiteralTransition(canvas, atlas), size = 256, features: MapFeature[] = []
  const source = document.createElement('canvas'), tile = document.createElement('canvas')
  source.width = source.height = 1024
  const reference = source.getContext('2d')!
  for (let image = 0; image < goldens.positions.length; image++) {
    const [x, y, extent] = goldens.positions[image]!, key = image === 0 ? 'terrain-grass' : image === 17 ? 'terrain-water' : image === 21 ? 'terrain-rock' : image === 31 ? 'terrain-sand' : `terrain-source-${image}`
    const frame = atlas.frames.get(key)?.[0]
    if (!frame) throw new Error(`Missing independent reference atlas source ${image}`)
    tile.width = frame.width; tile.height = frame.height
    tile.getContext('2d')!.drawImage(atlas.image, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height)
    reference.save(); reference.translate(x! * 32, y! * 32); reference.fillStyle = reference.createPattern(tile, 'repeat')!; reference.fillRect(0, 0, extent! * 32, extent! * 32); reference.restore()
  }
  const raw = reference.getImageData(0, 0, 1024, 1024).data
  const points = (c: typeof goldens.cases[number]) => c.up ? [[c.x, c.y + 1], [c.x, c.y], [c.x + 1, c.y + 1]] : [[c.x, c.y], [c.x + 1, c.y + 1], [c.x + 1, c.y]]
  for (const c of goldens.cases) points(c).forEach(([x, y], i) => {
    const rule = rules.terrain.find(t => t.landscape?.name === c.names[i])
    if (!rule) throw new Error(`Unknown source case input ${c.names[i]}`)
    features.push({ kind: 'terrain', id: rule.id, x: x!, y: y!, radius: 0 }, { kind: 'elevation', amount: c.heights[i]!, x: x!, y: y!, radius: 0 })
  })
  const session = createSession({ rules, seed: 1, map: describeMap(rules, { width: size, height: size, base: 'grass', features }), players: [{ name: 'Viewer', civilization: 'roman', controller: 'observer', start: { x: 32, y: 32 }, scenario: { buildings: [], settlers: [] } }] })
  const renderer = createRenderer(canvas), context = canvas.getContext('2d')!, ratio = canvas.width / canvas.getBoundingClientRect().width
  const before = session.checksum(), images = new Set<number>()
  let pixels = literal.pixels, ties = 0, nearEdges = 0, maximumMaterialBytes = 0, maximumMaterialEntries = 0
  const weights = [[0.5, 0.25, 0.25], [0.25, 0.5, 0.25], [0.25, 0.25, 0.5], [0.02, 0.49, 0.49], [0.49, 0.02, 0.49], [0.49, 0.49, 0.02]]
  try {
    renderer.setAssets(atlas); renderer.camera.zoom = 2
    for (let page = 0; page * 30 < goldens.cases.length; page++) {
      renderer.home({ x: 27 + page % 6 * 30, y: 28 + Math.floor(page / 6) * 30 })
      renderer.draw(session, { player: 1, cursor: null, tool: null, selected: null, time: 0, reduceMotion: true, placement: null })
      const screen = context.getImageData(0, 0, canvas.width, canvas.height).data
      for (const c of goldens.cases.slice(page * 30, page * 30 + 30)) {
        images.add(c.expected[0]!)
        // Source order is apex,left,right (up), or left,bottom,right (down).
        const vertices = points(c), ordered = c.up ? [vertices[1]!, vertices[0]!, vertices[2]!] : vertices
        const projected = ordered.map(([x, y]) => {
          const height = session.state.map.elevation[y! * size + x!]!, north = session.state.map.elevation[(y! - 1) * size + x!]!
          return { x: x! * 16 - y! * 8, y: y! * 9 - height * 2, light: Math.max(0.4, 0.875 + (north - height) * 0.125) }
        })
        const [a, b, d] = projected as [typeof projected[number], typeof projected[number], typeof projected[number]]
        const determinant = (b.y - d.y) * (a.x - d.x) + (d.x - b.x) * (a.y - d.y)
        for (let sample = 0; sample < weights.length; sample++) {
          const w = weights[sample]!, desired = { x: a.x * w[0]! + b.x * w[1]! + d.x * w[2]!, y: a.y * w[0]! + b.y * w[1]! + d.y * w[2]! }
          const p = renderer.screen(desired), px = Math.floor(p.x * ratio), py = Math.floor(p.y * ratio)
          if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) throw new Error('Transition fixture case escaped its page')
          // At 200%, one source backing pixel maps to one CSS pixel. Read its
          // true centre after device scaling, rather than assuming a texel tie.
          const x = (Math.floor((px + 0.5) / ratio - renderer.camera.x) + 0.5) / 2, y = (Math.floor((py + 0.5) / ratio - renderer.camera.y) + 0.5) / 2
          const wa = ((b.y - d.y) * (x - d.x) + (d.x - b.x) * (y - d.y)) / determinant
          const wb = ((d.y - a.y) * (x - d.x) + (a.x - d.x) * (y - d.y)) / determinant, wd = 1 - wa - wb
          // Quantized near-edge samples can belong to the adjacent triangle.
          // Interior cases remain mandatory; count only points this face owns.
          if (Math.min(wa, wb, wd) <= 0) continue
          const uv = c.expected.slice(1), u = uv[0]! * wa + uv[2]! * wb + uv[4]! * wd, v = uv[1]! * wa + uv[3]! * wb + uv[5]! * wd
          const light = a.light * wa + b.light * wb + d.light * wd
          const candidates = (value: number): number[] => Math.abs(value - Math.round(value)) < 1e-9 ? [Math.round(value) - 1, Math.round(value)] : [Math.floor(value)]
          const us = candidates(u), vs = candidates(v), expected: string[] = []
          if (us.length * vs.length > 1) ties++
          for (const tu of us) for (const tv of vs) {
            const at = (Math.max(0, Math.min(1023, tv)) * 1024 + Math.max(0, Math.min(1023, tu))) * 4
            expected.push(raw[at + 3] ? [0, 1, 2].map(channel => Math.min(255, Math.round(raw[at + channel]! * light))).concat(255).join() : '13,23,20,255')
          }
          const at = (py * canvas.width + px) * 4, actual = [...screen.subarray(at, at + 4)].join()
          if (!expected.includes(actual)) throw new Error(`Java terrain ${c.label} ${c.x},${c.y} ${c.up ? 'up' : 'down'} image${c.expected[0]} UV${u},${v}: ${actual} instead of ${expected.join(' or ')}`)
          pixels++; if (sample >= 3) nearEdges++
        }
      }
      const memory = renderer.terrainMaterialMemory(), cache = renderer.terrainCacheMemory(), frame = renderer.terrainFrameMemory()
      maximumMaterialBytes = Math.max(maximumMaterialBytes, memory.bytes); maximumMaterialEntries = Math.max(maximumMaterialEntries, memory.entries)
      if (memory.bytes > memory.limit || memory.entries > 32 || cache.bytes > cache.limit || frame.bytes > frame.limit) throw new Error('Mixed transition matrix exceeded original resource budgets')
    }
    if (session.checksum() !== before) throw new Error('Mixed transition matrix changed simulation state')
    if (pixels < goldens.cases.length * 3 || nearEdges < goldens.cases.length) throw new Error('Transition coverage omitted required interior or near-edge samples')
  }
  finally { renderer.dispose(); session.dispose(); source.width = source.height = tile.width = tile.height = 0 }
  if (renderer.terrainMaterialMemory().bytes || renderer.terrainCacheMemory().bytes || renderer.terrainFrameMemory().bytes) throw new Error('Transition matrix retained disposed resources')
  return { terrainMutation: checkChangingTransitions(canvas, atlas), pixels, cases: goldens.cases.length, families: goldens.families, selectedImages: images.size, nearEdges, equidistantTexelSamples: ties, sourceImage: literal.sourceImage, sourceUV: literal.sourceUV, javaSelectorOracle: true, fullReferenceAtlasImages: goldens.positions.length, lastWritePolicy: 'image105-overwrites-image98', maximumMaterialBytes, maximumMaterialEntries, checksumUnchanged: true, disposal: true }
}

function checkChangingTransitions(canvas: HTMLCanvasElement, atlas: Atlas) {
  // Public scenario setup completes two real large temples, which give the
  // spell's manna through normal completion. No faith or terrain is patched.
  const session = createSession({ rules, seed: 1, map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: [{ kind: 'terrain', id: 'desert', x: 32, y: 32, radius: 2 }] }), players: [{ name: 'Rome', civilization: 'roman', start: { x: 16, y: 16 }, scenario: { buildings: [{ type: 'castle', x: 16, y: 16 }, { type: 'large-temple', x: 12, y: 60 }, { type: 'large-temple', x: 75, y: 60 }], settlers: [{ profession: 'priest', x: 32, y: 33 }] } }] })
  const renderer = createRenderer(canvas), context = canvas.getContext('2d')!, options = { player: 1, cursor: null, tool: null, selected: null, time: 0, reduceMotion: true, placement: null }
  let copy: ReturnType<typeof restore> | null = null, changed = 0
  const draw = (value = session) => {
    const before = value.checksum(); renderer.draw(value, options)
    if (value.checksum() !== before) throw new Error('Drawing a real terrain intervention changed simulation state')
    return context.getImageData(0, 0, canvas.width, canvas.height).data
  }
  try {
    if (session.view(1).religion?.manna !== 16) throw new Error('Scenario temple completion did not supply its real manna')
    renderer.setAssets(atlas); renderer.camera.zoom = 1; renderer.home({ x: 32, y: 32 })
    const original = draw(), before = session.state.map.terrain.slice(), priest = [...session.state.settlers.values()].find(s => s.profession === 'priest')!
    order(session, 'cast', { priest: priest.id, spell: 'grassland-galore', x: 32, y: 32 })
    until(session, () => !priest.cast, 100)
    const chunks = new Set<string>()
    session.state.map.terrain.forEach((terrain, t) => { if (terrain !== before[t]) { changed++; chunks.add(`${Math.floor(t % 96 / 32)},${Math.floor(Math.floor(t / 96) / 32)}`) } })
    if (!changed || chunks.size !== 4 || session.view(1).religion?.manna !== 6) throw new Error('The real intervention did not convert terrain across all four neighboring chunks')
    const cached = draw()
    if (cached.every((value, i) => value === original[i])) throw new Error('A real terrain conversion did not change the visible source materials')
    renderer.invalidate()
    if (!draw().every((value, i) => value === cached[i])) throw new Error('Mixed terrain transitions retained stale pixels after a real terrain conversion')
    copy = restore(save(session), rules)
    if (copy.checksum() !== session.checksum() || !draw(copy).every((value, i) => value === cached[i])) throw new Error('Terrain conversion changed after save/reload')
  }
  finally { copy?.dispose(); renderer.dispose(); session.dispose() }
  if (renderer.terrainMaterialMemory().bytes || renderer.terrainCacheMemory().bytes || renderer.terrainFrameMemory().bytes) throw new Error('Terrain conversion retained disposed resources')
  return { changedTiles: changed, chunks: 4, cachedFreshAndRestoredMatch: true, comparedPixels: canvas.width * canvas.height, realTempleManna: true, checksumUnchangedByDrawing: true, disposal: true }
}
