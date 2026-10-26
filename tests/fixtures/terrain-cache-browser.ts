import type { Atlas } from '../../resources/game/assets'
import { createSession, describeMap, ROMAN_ENGINEERING as rules } from '../../resources/game/engine'
import { createRenderer } from '../../resources/game/renderer'

const result = document.querySelector('#result')!
try {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas')!, renderer = createRenderer(canvas)
  const options = { player: 1, cursor: null, tool: null, selected: null, time: 0, reduceMotion: true, placement: null }
  const assets = async (color?: string): Promise<Atlas> => {
    const surface = document.createElement('canvas'); surface.width = surface.height = 1
    if (color) { const context = surface.getContext('2d')!; context.fillStyle = color; context.fillRect(0, 0, 1, 1) }
    const image = new Image(); image.src = surface.toDataURL(); await image.decode()
    return { image, playerSlots: [], frames: new Map(color ? [['terrain-grass', [{ key: 'terrain-grass', frame: 0, x: 0, y: 0, width: 1, height: 1, offsetX: 0, offsetY: 0 }]]] : []) }
  }
  const empty = await assets()
  renderer.setAssets(empty)
  const session = createSession({ rules, seed: 1, map: describeMap(rules, { width: 256, height: 256, base: 'grass', features: [] }), players: [
    { name: 'Viewer', civilization: 'roman', start: { x: 16, y: 16 }, scenario: { buildings: [], settlers: [{ profession: 'carrier', x: 16, y: 16 }, { profession: 'carrier', x: 128, y: 128 }] } },
    { name: 'Foreign', civilization: 'roman', start: { x: 208, y: 16 }, scenario: { buildings: [], settlers: [{ profession: 'carrier', x: 208, y: 16 }] } },
  ] })
  let draws = 0, maximumBytes = 0
  const drawMs: number[] = []
  const samples: { x: number, entries: number, bytes: number, limit: number }[] = []
  const draw = (current = session): string => {
    const before = current.checksum()
    const started = performance.now()
    renderer.draw(current, options); draws++; drawMs.push(performance.now() - started)
    if (current.checksum() !== before) throw new Error('Terrain rendering changed the simulation')
    const memory = renderer.terrainCacheMemory(); maximumBytes = Math.max(maximumBytes, memory.bytes)
    if (memory.bytes > memory.limit || memory.limit !== 64 * 1024 * 1024) throw new Error(`Terrain retained ${memory.bytes} bytes beyond its fixed budget`)
    return canvas.toDataURL()
  }
  const cleared = (): void => {
    const memory = renderer.terrainCacheMemory()
    if (memory.bytes !== 0 || memory.entries !== 0) throw new Error('Retired terrain backing stores remained in the cache')
  }
  renderer.home({ x: 16, y: 16 })
  const initial = draw()
  for (const x of [80, 144, 208, 16, 16]) {
    renderer.home({ x, y: 16 }); const image = draw()
    samples.push({ x, ...renderer.terrainCacheMemory() })
    if (x === 16 && image !== initial) throw new Error('Panning back changed the rendered terrain')
  }
  // The same view must not reuse another player's explored ground.
  options.player = 2
  if (draw() === initial) throw new Error('Player switch reused the previous sight cache')
  options.player = 1
  if (draw() !== initial) throw new Error('Returning to the original player changed the terrain')
  // More visible raster capacity than the retained budget must still paint.
  renderer.camera.zoom = 0.25; renderer.home({ x: 128, y: 128 })
  const overview = draw(), center = renderer.screen({ x: 1024, y: 1152 })
  const context = canvas.getContext('2d')!, ratio = canvas.width / canvas.getBoundingClientRect().width
  const rgb = [...context.getImageData(Math.floor(center.x * ratio), Math.floor(center.y * ratio), 1, 1).data].slice(0, 3)
  if (rgb.join() === '13,23,20') throw new Error('Budget exhaustion omitted visible explored terrain')
  renderer.invalidate(); cleared()
  if (draw() !== overview || draw() !== overview) throw new Error('Eviction or repeated drawing changed the overview')
  if (renderer.terrainCacheMemory().rebuiltChunks !== 0) throw new Error('An unchanged overview repeatedly rebuilt evicted terrain')
  renderer.setPlayerSlots([1, 0]); cleared()
  if (draw() !== overview) throw new Error('Clearing palette-dependent terrain changed unowned ground')
  renderer.setAssets(await assets('#dc281e')); cleared()
  if (draw() === overview) throw new Error('Asset replacement reused old terrain raster data')
  renderer.setAssets(empty); cleared()
  if (draw() !== overview) throw new Error('Restoring assets did not restore terrain pixels')
  renderer.camera.zoom = 0.5; renderer.home({ x: 128, y: 128 })
  const minimumZoom = draw()
  if (draw() !== minimumZoom || renderer.terrainCacheMemory().rebuiltChunks !== 0) throw new Error('The interface minimum zoom thrashed its terrain cache')
  canvas.style.width = '1600px'; canvas.style.height = '900px'; renderer.resize()
  renderer.camera.zoom = 1; renderer.home({ x: 128, y: 128 })
  const largeView = draw(), largeFrameBytes = renderer.terrainCacheMemory().frameBytes
  if (largeFrameBytes <= renderer.terrainCacheMemory().limit) throw new Error('Large view did not exercise more raster capacity than the retained budget')
  renderer.invalidate(); cleared()
  if (draw() !== largeView) throw new Error('A view exceeding the cache budget lost terrain after eviction')
  canvas.style.width = '800px'; canvas.style.height = '480px'; renderer.resize()
  renderer.home({ x: 128, y: 128 })
  session.advance(rules.visibility.interval)
  const changed = draw(); renderer.invalidate(); cleared()
  if (draw() !== changed) throw new Error('A refreshed visibility signature reused stale terrain')
  const other = createSession({ rules, seed: 1, map: describeMap(rules, { width: 32, height: 32, base: 'water', features: [] }), players: [{ name: 'Other', civilization: 'roman', start: { x: 16, y: 16 }, scenario: { buildings: [], settlers: [] } }] })
  other.advance(session.state.tick)
  renderer.camera.zoom = 1; renderer.home({ x: 16, y: 16 })
  const originalMap = draw(), switched = draw(other)
  if (switched === originalMap) throw new Error('Session switch reused the previous explored map')
  renderer.invalidate(); cleared()
  if (draw(other) !== switched) throw new Error('Session switch reused another map raster')
  renderer.dispose(); cleared()
  renderer.setAssets(empty)
  if (draw(other) !== switched) throw new Error('Renderer reuse after disposal changed terrain')
  const elevated = createSession({ rules, seed: 1, map: describeMap(rules, { width: 128, height: 128, base: 'grass', features: [{ kind: 'elevation', x: 64, y: 64, radius: 256, amount: 255 }] }), players: [{ name: 'Hills', civilization: 'roman', start: { x: 64, y: 64 }, scenario: { buildings: [], settlers: [{ profession: 'carrier', x: 64, y: 64 }] } }] })
  renderer.home({ x: 64, y: 64 }, 255)
  const hills = draw(elevated); renderer.invalidate(); cleared()
  if (draw(elevated) !== hills) throw new Error('Variable-height chunk eviction changed terrain pixels')
  renderer.dispose(); cleared(); session.dispose(); other.dispose(); elevated.dispose()
  result.textContent = JSON.stringify({ ok: true, draws, drawMs, maximumBytes, largeFrameBytes, limit: 64 * 1024 * 1024, samples, panReturn: true, repeatedDraw: true, minimumZoomWithoutThrashing: true, overBudgetViewport: true, elevatedChunkSizes: true, playerSwitch: true, sessionSwitch: true, visibilityInvalidation: true, paletteInvalidation: true, assetReplacement: true, disposal: true, checksumUnchanged: true, scope: 'Actual Canvas renderer and public engineering sessions with an empty or authored one-pixel atlas. Capacity covers retained terrain backing stores, not total RSS or GPU memory. Frame bytes sum the raster capacity drawn; timings are host measurements, not a cross-host frame-rate qualification. No original media or Gold runtime observations.' })
}
catch (error) { result.textContent = JSON.stringify({ ok: false, error: String(error) }) }
