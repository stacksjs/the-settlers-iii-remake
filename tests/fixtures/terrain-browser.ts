import type { Atlas, AtlasFrame } from '../../resources/game/assets'
import { loadOriginalAssets } from '../../resources/game/assets'
import type { MapFeature } from '../../resources/game/engine/map'
import type { Session } from '../../resources/game/engine'
import { createSession, describeMap, ROMAN_ENGINEERING as rules } from '../../resources/game/engine'
import { createRenderer } from '../../resources/game/renderer'

const result = document.querySelector('#result')!
try {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas')!, renderer = createRenderer(canvas), context = canvas.getContext('2d')!
  const ratio = canvas.width / canvas.getBoundingClientRect().width, options = { player: 1, cursor: null, tool: null, selected: null, time: 0, reduceMotion: true, placement: null }
  const sessions: Session[] = [], timings: number[] = []
  let checkedPixels = 0, maximumFrameBytes = 0, maximumMaterialBytes = 0
  const image = async (source: HTMLCanvasElement): Promise<HTMLImageElement> => { const value = new Image(); value.src = source.toDataURL(); await value.decode(); return value }
  const blank = document.createElement('canvas'); blank.width = blank.height = 1
  const empty: Atlas = { image: await image(blank), frames: new Map(), playerSlots: [] }
  const make = (features: MapFeature[] = [], profession = 'carrier', starts = [{ x: 32, y: 32 }]): Session => {
    const session = createSession({ rules, seed: 1, map: describeMap(rules, { width: 96, height: 96, base: 'grass', features }), players: [{ name: 'Viewer', civilization: 'roman', start: starts[0]!, scenario: { buildings: [], settlers: starts.map(at => ({ profession, ...at })) } }] })
    sessions.push(session); return session
  }
  const pixel = (target: CanvasRenderingContext2D, x: number, y: number): number[] => [...target.getImageData(Math.floor((x + 0.5) * ratio), Math.floor((y + 0.5) * ratio), 1, 1).data]
  const draw = (session: Session): void => {
    const checksum = session.checksum(), started = performance.now()
    renderer.draw(session, options); timings.push(performance.now() - started)
    if (session.checksum() !== checksum) throw new Error('Terrain painting changed the simulation')
    const frame = renderer.terrainFrameMemory(), material = renderer.terrainMaterialMemory(), cache = renderer.terrainCacheMemory()
    maximumFrameBytes = Math.max(maximumFrameBytes, frame.bytes); maximumMaterialBytes = Math.max(maximumMaterialBytes, material.bytes)
    if (frame.bytes > frame.limit || material.bytes > material.limit || material.entries > 32 || material.shadeBytes > 34 * 256 * 3 * 4 || cache.bytes > cache.limit || cache.inputBytes > cache.entries * 35 * 35 * 5) throw new Error('Terrain rendering exceeded its resource budgets')
  }
  const clear = (): void => {
    if (renderer.terrainFrameMemory().bytes || renderer.terrainMaterialMemory().bytes || renderer.terrainMaterialMemory().shadeBytes || renderer.terrainCacheMemory().bytes || renderer.terrainCacheMemory().inputBytes) throw new Error('Disposed terrain retained derived resources')
  }
  const zooms = [{ zoom: 0.5, p: 1, q: 2 }, { zoom: 0.6, p: 3, q: 5 }, { zoom: 0.75, p: 3, q: 4 }, { zoom: 1, p: 1, q: 1 }, { zoom: 1.25, p: 5, q: 4 }, { zoom: 3, p: 3, q: 1 }]
  const cases = zooms.flatMap(value => [0, 0.25, 0.5].map(offset => ({ ...value, offset })))
  const patchReader = (target: CanvasRenderingContext2D, origin: { x: number, y: number }, zoom: number): ((x: number, y: number) => number[]) => {
    const x0 = Math.floor(origin.x) - Math.ceil(8 * zoom), x1 = Math.floor(origin.x) + Math.ceil(8 * zoom)
    const y0 = Math.floor(origin.y) - Math.ceil(4 * zoom), y1 = Math.floor(origin.y) + Math.ceil(4 * zoom)
    const left = Math.floor((x0 + 0.5) * ratio), top = Math.floor((y0 + 0.5) * ratio), width = Math.floor((x1 + 0.5) * ratio) - left + 1
    const data = target.getImageData(left, top, width, Math.floor((y1 + 0.5) * ratio) - top + 1).data
    return (x, y) => {
      const offset = ((Math.floor((y + 0.5) * ratio) - top) * width + Math.floor((x + 0.5) * ratio) - left) * 4
      return [...data.subarray(offset, offset + 4)]
    }
  }
  const samplePatch = (origin: { x: number, y: number }, zoom: number, check: (actual: number[], x: number, y: number) => void): void => {
    const read = patchReader(context, origin, zoom)
    for (let dy = -Math.ceil(4 * zoom); dy <= Math.ceil(4 * zoom); dy++) for (let dx = -Math.ceil(8 * zoom); dx <= Math.ceil(8 * zoom); dx++) {
      const x = Math.floor(origin.x) + dx, y = Math.floor(origin.y) + dy
      check(read(x, y), x, y); checkedPixels++
    }
  }
  const flat = make(); renderer.setAssets(empty)
  for (const { zoom, offset } of cases) {
    renderer.camera.zoom = zoom; renderer.home({ x: 32, y: 32 }); renderer.camera.x += offset; renderer.camera.y += offset; draw(flat)
    samplePatch(renderer.screen({ x: 256, y: 288 }), zoom, actual => {
      if (actual.join() !== '111,148,82,255') throw new Error(`Flat four-chunk seam at zoom${zoom}/offset${offset}: ${actual}`)
    })
  }
  const elevated = make([{ kind: 'elevation', x: 32, y: 32, radius: 100000, amount: 128 }])
  renderer.camera.zoom = 0.6; renderer.home({ x: 32, y: 32 }, 128); draw(elevated)
  samplePatch(renderer.screen({ x: 256, y: 32 }), 0.6, actual => { if (actual.join() !== '111,148,82,255') throw new Error('Raised terrain lost shared-edge coverage') })
  const mixed = make([{ kind: 'terrain', id: 'sand', x: 40, y: 32, radius: 8 }])
  for (const { zoom, offset } of cases) {
    renderer.camera.zoom = zoom; renderer.home({ x: 32, y: 32 }); renderer.camera.x += offset; renderer.camera.y += offset; draw(mixed)
    samplePatch(renderer.screen({ x: 256, y: 288 }), zoom, actual => {
      if (actual[3] !== 255 || actual.some((value, channel) => channel < 3 && (value < [111, 148, 82][channel]! || value > [184, 173, 120][channel]!))) throw new Error(`Mixed-material coverage gap or additive brightening: ${actual}`)
    })
  }
  const opaque = (color: string, overlay?: string): number[] => {
    const surface = document.createElement('canvas'); surface.width = surface.height = 1
    const context = surface.getContext('2d')!; context.fillStyle = color; context.fillRect(0, 0, 1, 1)
    if (overlay) { context.fillStyle = overlay; context.fillRect(0, 0, 1, 1) }
    const value = [...context.getImageData(0, 0, 1, 1).data]; surface.width = surface.height = 0; return value
  }
  const overlap = make([{ kind: 'elevation', x: 40, y: 64, radius: 0, amount: 216 }, { kind: 'terrain', id: 'sand', x: 40, y: 64, radius: 0 }], 'carrier', [{ x: 16, y: 16 }, { x: 40, y: 64 }])
  renderer.camera.zoom = 1; renderer.home({ x: 16, y: 16 }); draw(overlap)
  const overlapPoint = renderer.screen({ x: 128, y: 200 }), expectedOverlap = opaque('#b8ad78', 'rgba(255,248,220,0.35)')
  if (pixel(context, overlapPoint.x, overlapPoint.y).join() !== expectedOverlap.join()) throw new Error(`Opaque elevated face did not replace lower ground: ${pixel(context, overlapPoint.x, overlapPoint.y)} instead of ${expectedOverlap}`)
  checkedPixels++
  const folded = make([{ kind: 'elevation', x: 32, y: 32, radius: 0, amount: 216 }, { kind: 'elevation', x: 33, y: 33, radius: 0, amount: 216 }], 'carrier', [{ x: 32, y: 32 }, { x: 33, y: 33 }])
  renderer.home({ x: 32, y: 32 }, 216); draw(folded)
  const foldPoint = renderer.screen({ x: 260, y: -130 })
  if (pixel(context, foldPoint.x, foldPoint.y).join() !== '111,148,82,255') throw new Error('Folded cell did not retain the reference upward/downward face order')
  checkedPixels++
  const crossing = make([{ kind: 'elevation', x: 31, y: 32, radius: 0, amount: 216 }, { kind: 'elevation', x: 32, y: 33, radius: 0, amount: 64 }, { kind: 'terrain', id: 'sand', x: 31, y: 32, radius: 0 }], 'carrier', [{ x: 31, y: 32 }, { x: 32, y: 33 }])
  renderer.home({ x: 31, y: 32 }, 216); renderer.camera.y -= 344; draw(crossing)
  const crossingPoint = renderer.screen({ x: 250, y: 200 }), expectedCrossing = opaque('#6f9452', 'rgba(255,248,220,0.35)')
  if (pixel(context, crossingPoint.x, crossingPoint.y).join() !== expectedCrossing.join()) throw new Error('Chunk grouping changed overlapping terrain row order')
  checkedPixels++
  const fog = make([], 'geologist'); renderer.home({ x: 32, y: 32 }); draw(fog)
  fog.enqueue({ tick: 0, player: 1, seq: 0, type: 'specialists', profession: 'geologist', x: 3, y: 3, count: 1 }); fog.advance(1000); draw(fog)
  const fogPoint = renderer.screen({ x: 256, y: 288 }), expectedFog = opaque('#6f9452', 'rgba(8,16,13,0.38)')
  if (pixel(context, fogPoint.x, fogPoint.y).join() !== expectedFog.join()) throw new Error('Explored terrain fog did not use opaque native material compositing')
  checkedPixels++

  // Literal reference texel: at grid (32,32), the UV is (264,512).
  // The sampled flat projected offset lies inside texel (266,516), repeated
  // into this 16x32 authored source as (10,4). Raising the same land and
  // following it with the camera must leave that texel unchanged.
  const coordinates = document.createElement('canvas'); coordinates.width = 16; coordinates.height = 32
  const coordinateContext = coordinates.getContext('2d')!
  for (let y = 0; y < 32; y++) for (let x = 0; x < 16; x++) { coordinateContext.fillStyle = `rgb(${x * 13 + 7},${y * 7 + 11},${(x * 3 + y * 5) % 256})`; coordinateContext.fillRect(x, y, 1, 1) }
  const coordinateFrame: AtlasFrame = { key: 'terrain-grass', frame: 0, x: 0, y: 0, width: 16, height: 32, offsetX: 0, offsetY: 0 }
  renderer.setAssets({ image: await image(coordinates), frames: new Map([[coordinateFrame.key, [coordinateFrame]]]), playerSlots: [] })
  const coordinateFailures: string[] = []
  for (const height of [0, 13]) {
    const session = make(height ? [{ kind: 'elevation', x: 32, y: 32, radius: 100000, amount: height }] : [], 'carrier', [{ x: 28, y: 32 }])
    renderer.camera.zoom = 1; renderer.home({ x: 32, y: 32 }, height); draw(session)
    const centre = renderer.screen({ x: 256, y: 288 - height * 2 })
    for (const [dx, expected] of [[2, '137,39,50,255'], [-2, '85,39,38,255']] as const) {
      const actual = pixel(context, centre.x + dx, centre.y + 2)
      if (actual.join() !== expected) coordinateFailures.push(`height${height}/dx${dx}: ${actual} instead of ${expected}`)
      checkedPixels++
    }
  }
  // Unequal heights 2/1/0 project this upward face to (256,284),
  // (264,295), (248,297). The interior sample has raw UV texel (264,515).
  const sloped = make([{ kind: 'elevation', x: 32, y: 32, radius: 0, amount: 2 }, { kind: 'elevation', x: 33, y: 33, radius: 0, amount: 1 }])
  renderer.home({ x: 32, y: 32 }, 2); draw(sloped)
  const slopedPoint = renderer.screen({ x: 256, y: 284 }), slopedExpected = opaque('rgb(111,32,39)', 'rgba(255,248,220,0.1)')
  const slopedActual = pixel(context, slopedPoint.x, slopedPoint.y + 2)
  if (slopedActual.join() !== slopedExpected.join()) coordinateFailures.push(`unequal-height upward face: ${slopedActual} instead of ${slopedExpected}`)
  checkedPixels++
  // The existing folded cell's downward face has negative projected area.
  // Its winning interior sample has u=268 and v=519 or 520 depending on the
  // viewport's exact nearest backing-pixel tie, not an arbitrary color range.
  renderer.home({ x: 32, y: 32 }, 216); draw(folded)
  const foldedPoint = renderer.screen({ x: 260, y: -130 }), foldedActual = pixel(context, foldedPoint.x, foldedPoint.y)
  if (!['163,60,71,255', '163,67,76,255'].includes(foldedActual.join())) coordinateFailures.push(`folded downward face: ${foldedActual}`)
  checkedPixels++
  const collapsed = make([{ kind: 'elevation', x: 33, y: 33, radius: 0, amount: 4 }, { kind: 'elevation', x: 32, y: 33, radius: 0, amount: 5 }])
  renderer.home({ x: 32, y: 32 }); draw(collapsed)
  coordinates.width = coordinates.height = 0
  if (coordinateFailures.length) throw new Error(`Reference continuous terrain coordinates: ${coordinateFailures.join('; ')}`)

  // Native Canvas independently maps the reference UV plane to flat geometry:
  // x=u-8, y=v*9/16. It contains no mesh or production interpolation code.
  const original = await loadOriginalAssets(), terrain: Atlas = { ...original, frames: new Map([...original.frames].filter(([key]) => key.startsWith('terrain-'))) }
  const checker = document.createElement('canvas'); checker.width = checker.height = 4
  const checkerContext = checker.getContext('2d')!
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { checkerContext.fillStyle = ['#fc2318', '#168eeb', '#f6e946', '#238d36'][(x + y) % 4]!; checkerContext.fillRect(x, y, 1, 1) }
  const checkerImage = await image(checker), checkerFrame: AtlasFrame = { key: 'terrain-grass', frame: 0, x: 0, y: 0, width: 4, height: 4, offsetX: 0, offsetY: 0 }
  const authored: Atlas = { image: checkerImage, frames: new Map([[checkerFrame.key, [checkerFrame]]]), playerSlots: [] }
  let texturedCases = 0, exactTexels = 0, tiedTexels = 0, differingTies = 0
  const sources = [
    { atlas: authored, kind: 'grass', key: 'terrain-grass' },
    ...[{ kind: 'grass', key: 'terrain-grass' }, { kind: 'water', key: 'terrain-water' }, { kind: 'mountain', key: 'terrain-rock' }, { kind: 'sand', key: 'terrain-sand' }].map(value => ({ ...value, atlas: terrain })),
  ]
  for (const { atlas, kind, key } of sources) {
    renderer.setAssets(atlas)
    const frame = atlas.frames.get(key)![0]!, tile = document.createElement('canvas')
    tile.width = frame.width; tile.height = frame.height
    tile.getContext('2d')!.drawImage(atlas.image, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height)
    const sourceData = tile.getContext('2d')!.getImageData(0, 0, frame.width, frame.height).data
    const expected = document.createElement('canvas'); expected.width = canvas.width; expected.height = canvas.height
    const target = expected.getContext('2d')!; target.setTransform(ratio, 0, 0, ratio, 0, 0)
    for (const centre of [{ tile: { x: 32, y: 32 }, x: 256, y: 288, left: 128, top: 160 }, { tile: { x: 16, y: 64 }, x: -256, y: 576, left: -384, top: 448 }]) for (const height of [0, 13]) {
      const features: MapFeature[] = kind === 'grass' ? [] : [{ kind: 'terrain', id: kind, ...centre.tile, radius: 3 }]
      if (height) features.push({ kind: 'elevation', ...centre.tile, radius: 100000, amount: height })
      const session = make(features, 'carrier', [{ x: centre.tile.x - 4, y: centre.tile.y }])
      const fields = new Map<number, HTMLCanvasElement>()
      for (const { zoom, offset, p, q } of cases) {
        const density = zoom <= 0.5 ? 1 : 2
        let field = fields.get(density)
        if (!field) {
          field = document.createElement('canvas'); field.width = field.height = 256 * density
          const fill = field.getContext('2d')!; fill.imageSmoothingEnabled = false
          fill.setTransform(density, 0, 0, density * 9 / 16, (-centre.left - 8) * density, -centre.top * density)
          fill.fillStyle = fill.createPattern(tile, 'repeat')!; fill.fillRect(centre.left + 8, centre.top * 16 / 9, 256, 256 * 16 / 9); fields.set(density, field)
        }
        renderer.camera.zoom = zoom; renderer.home(centre.tile, height); renderer.camera.x += offset; renderer.camera.y += offset; draw(session)
        target.clearRect(0, 0, 800, 480); target.imageSmoothingEnabled = false
        const origin = renderer.screen({ x: centre.left, y: centre.top - height * 2 }); target.drawImage(field, origin.x, origin.y, 256 * zoom, 256 * zoom)
        const patchOrigin = renderer.screen({ x: centre.x, y: centre.y - height * 2 }), readReference = patchReader(target, patchOrigin, zoom)
        samplePatch(patchOrigin, zoom, (actual, x, y) => {
          const reference = readReference(x, y)
          // Classify both nearest stages with exact rational positions: the
          // viewport selects a backing-raster pixel, then reference UV selects
          // a raw source texel. Native ties may choose either adjacent value.
          const px = Math.floor((x + 0.5) * ratio), py = Math.floor((y + 0.5) * ratio), denominator = 4 * p * canvas.width
          const nx = ((2 * px + 1) * 1600 - (1600 + offset * 4) * canvas.width) * q + 4 * centre.x * p * canvas.width
          const ny = ((2 * py + 1) * 1600 - (960 + offset * 4) * canvas.width) * q + 4 * centre.y * p * canvas.width
          const nearest = (n: number, d: number): number[] => { const value = Math.floor(n / d); return n % d === 0 ? [value - 1, value] : [value] }
          const rasterX = nearest((nx - centre.left * denominator) * density, denominator), rasterY = nearest((ny - centre.top * denominator) * density, denominator)
          const allowed = new Set<string>()
          let tied = rasterX.length > 1 || rasterY.length > 1
          for (const ry of rasterY) for (const rx of rasterX) {
            const us = nearest(2 * rx + 1 + 2 * density * (centre.left + 8), 2 * density)
            const vs = nearest((2 * ry + 1 + 2 * density * centre.top) * 16, 2 * density * 9)
            tied ||= us.length > 1 || vs.length > 1
            for (const sy of vs) for (const sx of us) {
              const i = (((sy % frame.height + frame.height) % frame.height) * frame.width + (sx % frame.width + frame.width) % frame.width) * 4
              allowed.add([...sourceData.subarray(i, i + 4)].join())
            }
          }
          if (!allowed.has(actual.join()) || !allowed.has(reference.join())) throw new Error(`Invalid reference UV texel at${x},${y}/zoom${zoom}/offset${offset}:actual${actual}/native${reference}/allowed${[...allowed]}/tie${tied}`)
          if (tied) { tiedTexels++; if (actual.join() !== reference.join()) differingTies++ }
          else { exactTexels++; if (actual.join() !== reference.join()) throw new Error('Native material differs away from a texel tie') }
        }); texturedCases++
      }
      for (const field of fields.values()) field.width = field.height = 0
    }
    const unchanged = document.createElement('canvas'); unchanged.width = frame.width; unchanged.height = frame.height
    const unchangedContext = unchanged.getContext('2d')!; unchangedContext.drawImage(atlas.image, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height)
    if (!unchangedContext.getImageData(0, 0, frame.width, frame.height).data.every((value, index) => value === sourceData[index])) throw new Error('Material painting changed its actual source image')
    unchanged.width = unchanged.height = tile.width = tile.height = expected.width = expected.height = 0
  }
  for (const failure of ['alpha', 'capacity']) {
    const invalid = document.createElement('canvas'); invalid.width = invalid.height = failure === 'alpha' ? 1 : 257
    const fill = invalid.getContext('2d')!; fill.fillStyle = failure === 'alpha' ? 'rgba(220,40,30,0.5)' : '#dc281e'; fill.fillRect(0, 0, invalid.width, invalid.height)
    const frame: AtlasFrame = { key: 'terrain-grass', frame: 0, x: 0, y: 0, width: invalid.width, height: invalid.height, offsetX: 0, offsetY: 0 }
    renderer.setAssets({ image: await image(invalid), frames: new Map([[frame.key, [frame]]]), playerSlots: [] })
    renderer.camera.zoom = 1; renderer.home({ x: 32, y: 32 })
    let rejected = false
    try { draw(flat) }
    catch (error) {
      const expected = failure === 'alpha' ? 'opaque source coverage' : 'supported raster capacity'
      if (!(error instanceof Error) || !error.message.includes(expected)) throw error
      rejected = true
    }
    if (!rejected) throw new Error(`Unsupported material ${failure} was silently accepted`)
    renderer.dispose(); clear(); invalid.width = invalid.height = 0
  }
  renderer.setAssets(empty); renderer.camera.zoom = 1; renderer.home({ x: 32, y: 32 }); draw(flat)
  flat.advance(rules.visibility.interval); draw(flat)
  if (renderer.terrainCacheMemory().rebuiltChunks !== 0) throw new Error('Unchanged actual visibility inputs caused repeated rasterization')
  renderer.dispose(); clear()
  for (const session of sessions) session.dispose()
  result.textContent = JSON.stringify({ ok: true, deviceScale: ratio, checkedPixels, continuousUV: true, literalFaceSamples: 6, textureHeights: [0, 13], unequalHeightInterpolation: true, foldedUV: true, collapsedFace: true, rawSourceNearest: true, uniformCases: cases.length, texturedCases, exactTexels, tiedTexels, differingTies, exactNonTieNativePattern: true, equidistantSourceCandidates: true, originalPalettePreserved: true, originalTextures: true, originalMaterialKinds: 4, negativeTextureCoordinates: true, unsupportedAlphaRejected: true, materialCapacityGuard: true, mixedMaterials: true, elevation: true, opaqueOverlap: true, sourceFaceOrder: true, crossChunkOcclusion: true, fog: true, sourceUnchanged: true, unchangedVisibilityWithoutRebuild: true, resourceBounds: true, disposal: true, checksumUnchanged: true, maximumFrameBytes, maximumMaterialBytes, timings, scope: 'Production browser renderer and public engineering sessions, independent reference-UV native material oracle and exact supplied terrain texels across flat and elevated ground. Equidistant texel boundaries are tested against their exact nearest source candidates, with no RGB tolerance; native GPU tie behavior is unqualified. Not original Gold runtime observations or full terrain-presentation parity.' })
}
catch (error) { result.textContent = JSON.stringify({ ok: false, error: String(error) }) }
