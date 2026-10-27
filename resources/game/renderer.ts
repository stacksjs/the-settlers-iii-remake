import { sourceTerrainFace } from './terrain-faces'
import { createTerrainMaterials } from './terrain-materials'
import { paintTriangle } from './terrain-raster'
import { colorTorsoPixels, DEFAULT_PLAYER_SLOTS, playerCSS } from './player-colors'
import type { Atlas, AtlasFrame } from './assets'
import type { Point, Session } from './engine'
import type { SceneItem } from './scene'
import { pick, toView } from './engine'
import { scene } from './scene'
import { perceivedHeight, perceivedTerrain } from './engine/perception'

// Presentation reads the session and the viewing player's sight. It never
// changes simulation state. Foreign units require current sight; persistent
// objects outside sight use the player's retained observations.
export interface Camera { x: number, y: number, zoom: number }
const CHUNK = 32
const TERRAIN_CACHE_BYTES = 64 * 1024 * 1024


export function createRenderer(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser could not create the game canvas.')
  let atlas: Atlas | null = null, width = 0, height = 0, pixelRatio = 1
  // The pinned reference's ScreenPosition starts at 100%, preserving original sprite pixels.
  const camera: Camera = { x: 0, y: 0, zoom: 1 }
  const chunks = new Map<string, { canvas: HTMLCanvasElement, left: number, top: number, signature: string, inputs: Uint8Array }>()
  let terrainBytes = 0, terrainInputBytes = 0, terrainFrameBytes = 0, terrainFrameBuilds = 0, terrainSession: Session | null = null, terrainPlayer = 0, chunkScale = 2
  function retireChunk(key: string): void {
    const chunk = chunks.get(key)!
    terrainBytes -= chunk.canvas.width * chunk.canvas.height * 4
    terrainInputBytes -= chunk.inputs.byteLength
    chunk.canvas.width = 0; chunk.canvas.height = 0; chunks.delete(key)
  }
  const terrainFrame = canvas.ownerDocument.createElement('canvas')
  terrainFrame.width = terrainFrame.height = 0
  const terrainContext = terrainFrame.getContext('2d')!
  const clearChunks = (): void => { for (const key of chunks.keys()) retireChunk(key); terrainFrame.width = terrainFrame.height = 0 }
  function reserveTerrain(bytes: number): void {
    while (chunks.size && terrainBytes + bytes > TERRAIN_CACHE_BYTES) retireChunk(chunks.keys().next().value!)
  }
  let materials: ReturnType<typeof createTerrainMaterials> | null = null
  let playerSlots: readonly number[] = DEFAULT_PLAYER_SLOTS
  const tinted = new Map<string, HTMLCanvasElement>(), tintLimit = 512
  const clearTinted = (): void => { for (const surface of tinted.values()) { surface.width = 0; surface.height = 0 }; tinted.clear() }
  function clothing(frame: AtlasFrame, slot: number): HTMLCanvasElement | null {
    if (!atlas || !frame.width || !frame.height) return null
    const key = `${frame.key}:${frame.frame}:${slot}`, cached = tinted.get(key)
    if (cached) { tinted.delete(key); tinted.set(key, cached); return cached }
    const surface = canvas.ownerDocument.createElement('canvas')
    surface.width = frame.width; surface.height = frame.height
    const context = surface.getContext('2d')!
    context.drawImage(atlas.image, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height)
    const data = context.getImageData(0, 0, frame.width, frame.height)
    data.data.set(colorTorsoPixels(data.data, slot)); context.putImageData(data, 0, 0)
    if (tinted.size >= tintLimit) { const first = tinted.keys().next().value!; const old = tinted.get(first)!; old.width = 0; old.height = 0; tinted.delete(first) }
    tinted.set(key, surface)
    return surface
  }

  function chunkBounds(session: Session, player: number, cx: number, cy: number) {
    const { map } = session.state
    const viewer = session.state.players.find(p => p.id === player)!
    const x0 = cx * CHUNK, y0 = cy * CHUNK, x1 = Math.min(map.width - 1, x0 + CHUNK), y1 = Math.min(map.height - 1, y0 + CHUNK)
    const left = x0 * 16 - y1 * 8 - 16, right = x1 * 16 - y0 * 8 + 16
    let minY = Infinity, maxY = -Infinity
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const viewY = y * 9 - perceivedHeight(map, viewer, y * map.width + x) * 2
      minY = Math.min(minY, viewY); maxY = Math.max(maxY, viewY)
    }
    const realTop = Math.floor((minY - 16) * chunkScale) / chunkScale, bottom = Math.ceil((maxY + 16) * chunkScale) / chunkScale
    return { x0, y0, x1, y1, left, right, realTop, bottom }
  }
  // Compare actual inputs after a visibility/navigation pass. A stationary
  // world must not rerasterize just because another pass ran. The halo includes
  // neighboring ownership used by border posts; comparison has no hash collisions.
  function terrainInputs(session: Session, player: number, bounds: ReturnType<typeof chunkBounds>, previous?: Uint8Array): Uint8Array {
    const { map } = session.state, viewer = session.state.players.find(p => p.id === player)!
    const fields = [(t: number) => perceivedTerrain(map, viewer, t), (t: number) => perceivedHeight(map, viewer, t), (t: number) => map.owner[t]!, (t: number) => viewer.explored[t]!, (t: number) => viewer.visible[t]!]
    const x0 = Math.max(0, bounds.x0 - 1), x1 = Math.min(map.width - 1, bounds.x1 + 1), y0 = Math.max(0, bounds.y0 - 1), y1 = Math.min(map.height - 1, bounds.y1 + 1)
    const length = (x1 - x0 + 1) * (y1 - y0 + 1) * fields.length
    let index = 0, same = previous?.length === length
    if (same) {
      compare: for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (const field of fields) {
        if (previous![index++] !== field(y * map.width + x)) { same = false; break compare }
      }
      if (same) return previous!
    }
    const value = new Uint8Array(length); index = 0
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (const field of fields) value[index++] = field(y * map.width + x)
    return value
  }
  function renderChunk(session: Session, player: number, bounds: ReturnType<typeof chunkBounds>) {
    const { map } = session.state, rules = session.rules, viewer = session.state.players.find(p => p.id === player)!
    const { x0, y0, x1, y1, left, right, realTop, bottom } = bounds
    const surfaceWidth = Math.ceil((right - left) * chunkScale), surfaceHeight = Math.ceil((bottom - realTop) * chunkScale)
    reserveTerrain(surfaceWidth * surfaceHeight * 4)
    const surface = canvas.ownerDocument.createElement('canvas')
    let complete = false
    try {
      surface.width = surfaceWidth; surface.height = surfaceHeight
      const g = surface.getContext('2d')!
      g.setTransform(chunkScale, 0, 0, chunkScale, -left * chunkScale, -realTop * chunkScale)
      const raster = new ImageData(surfaceWidth, surfaceHeight), pixels = new Uint32Array(raster.data.buffer)
      // Background/ETextureOrientation continuous UVs follow the land grid,
      // independently of the height-deformed projected geometry.
      const rasterPoint = (p: Point, x: number, y: number) => {
        const t = y * map.width + x
        // Background.addPointToGeometry uses a north-height gradient and an
        // explicit interior guard. Current sight provides steady-state 100/50/0
        // reference weights; temporal fog dimming remains separate work.
        const light = x > 0 && x < map.width - 2 && y > 0 && y < map.height - 2 && viewer.explored[t]
          ? Math.max(0.4, 0.875 + (perceivedHeight(map, viewer, t - map.width) - perceivedHeight(map, viewer, t)) * 0.125) * (viewer.visible[t] ? 1 : 0.5) : 0
        return { x: (p.x - left) * chunkScale, y: (p.y - realTop) * chunkScale, u: x * 16 - y * 8 + 8, v: y * 16, light }
      }
      const at = (x: number, y: number): Point => toView(x, y, perceivedHeight(map, viewer, y * map.width + x))
      const terrainOf = (x: number, y: number) => rules.terrain[perceivedTerrain(map, viewer, y * map.width + x)]!
      const triangle = (a: [number, number], b: [number, number], c: [number, number]): void => {
        const [ax, ay] = a, [bx, by] = b, [cx2, cy2] = c
        if (Math.max(ax, bx, cx2) >= map.width || Math.max(ay, by, cy2) >= map.height) return
        const pa = at(ax, ay), pb = at(bx, by), pc = at(cx2, cy2), kind = terrainOf(ax, ay)
        const ra = rasterPoint(pa, ax, ay), rb = rasterPoint(pb, bx, by), rc = rasterPoint(pc, cx2, cy2)
        let image: number | undefined
        const up = by !== ay, leftKind = up ? terrainOf(cx2, cy2) : kind, apexKind = up ? kind : terrainOf(cx2, cy2), rightKind = terrainOf(bx, by)
        if (leftKind.landscape && apexKind.landscape && rightKind.landscape) {
          const face = sourceTerrainFace(leftKind.landscape, apexKind.landscape, rightKind.landscape, ax, ay, up)
          image = face.image
          const vertices = [ra, rb, rc]
          vertices.forEach((vertex, index) => { vertex.u = face.uv[index]!.u; vertex.v = face.uv[index]!.v })
        }
        const sample = materials!.sampler(image === undefined ? kind : leftKind, ra, rb, rc, image)
        paintTriangle(pixels, surfaceWidth, surfaceHeight, ra, rb, rc, sample)
      }
      // Background.addTrianglesToGeometry emits the upward face first.
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { triangle([x, y], [x + 1, y + 1], [x, y + 1]); triangle([x, y], [x + 1, y], [x + 1, y + 1]) }
      g.putImageData(raster, 0, 0)
      complete = true
      return { canvas: surface, left, top: realTop }
    }
    finally { if (!complete) surface.width = surface.height = 0 }
  }

  function frame(key: string, index = 0): AtlasFrame | null {
    const frames = atlas?.frames.get(key)
    if (!frames?.length) return null
    return frames[((index % frames.length) + frames.length) % frames.length]!
  }
  function sprite(key: string, view: Point, index = 0, alpha = 1, reveal = 1): void {
    const f = frame(key, index)
    if (!f?.width || !atlas) return
    const z = camera.zoom, x = camera.x + (view.x + f.offsetX) * z, y = camera.y + (view.y + f.offsetY) * z
    ctx!.globalAlpha = alpha
    if (reveal < 1) {
      // Construction stages rise from the ground as material is built in.
      const visible = Math.max(1, Math.round(f.height * reveal))
      ctx!.drawImage(atlas.image, f.x, f.y + f.height - visible, f.width, visible, x, y + (f.height - visible) * z, f.width * z, visible * z)
    }
    else ctx!.drawImage(atlas.image, f.x, f.y, f.width, f.height, x, y, f.width * z, f.height * z)
    ctx!.globalAlpha = 1
  }
  function playerSprite(item: SceneItem, index: number): void {
    const body = frame(item.sprite, index)
    const mask = body?.torso ? atlas!.frames.get(body.torso)?.find(mask => mask.frame === body.frame) : null
    if (mask) {
      const source = clothing(mask, playerSlots[item.owner - 1]!)
      if (source) ctx!.drawImage(source, camera.x + (item.view.x + mask.offsetX) * camera.zoom, camera.y + (item.view.y + mask.offsetY) * camera.zoom, mask.width * camera.zoom, mask.height * camera.zoom)
    }
    // The reference gives opaque body pixels precedence over the mask.
    sprite(item.sprite, item.view, index)
  }
  const toScreen = (view: Point): Point => ({ x: camera.x + view.x * camera.zoom, y: camera.y + view.y * camera.zoom })

  function resize(): void {
    const rect = canvas.getBoundingClientRect()
    // A hidden map has no view centre. Retain its last visible geometry until it returns.
    if (rect.width <= 0 || rect.height <= 0) return
    // Keep the world point at the centre of the player's view through layout changes.
    if (width > 0 && height > 0) {
      camera.x += (rect.width - width) / 2; camera.y += (rect.height - height) / 2
    }
    width = rect.width; height = rect.height; pixelRatio = Math.min(2, devicePixelRatio || 1)
    canvas.width = Math.round(width * pixelRatio); canvas.height = Math.round(height * pixelRatio)
    ctx!.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  }
  function home(tile: Point, elevation = 0): void {
    const v = toView(tile.x, tile.y, elevation)
    camera.x = width / 2 - v.x * camera.zoom; camera.y = height / 2 - v.y * camera.zoom
  }

  interface DrawOptions {
    player: number, cursor: Point | null, tool: string | null, selected: number | null, time: number, reduceMotion: boolean, placement: string | null
    /** Marked soldiers and the rectangle being dragged to mark them, in canvas coordinates. */
    marked?: ReadonlySet<number>, band?: { x0: number, y0: number, x1: number, y1: number } | null
  }
  function draw(session: Session, options: DrawOptions): void {
    terrainFrameBytes = 0; terrainFrameBuilds = 0
    ctx!.fillStyle = '#0d1714'; ctx!.fillRect(0, 0, width, height)
    if (!atlas) return
    const { state, rules } = session, { map } = state, viewer = state.players.find(p => p.id === options.player)!
    // Retain at least one raster sample per displayed device pixel when
    // zooming out. Original 100% rendering keeps its existing 2x backing grid.
    const scale = Math.max(0.5, Math.min(2, 2 ** Math.ceil(Math.log2(camera.zoom * 2))))
    if (terrainSession !== session || terrainPlayer !== options.player || chunkScale !== scale) { clearChunks(); terrainSession = session; terrainPlayer = options.player; chunkScale = scale }
    ctx!.imageSmoothingEnabled = camera.zoom < 1
    // Terrain chunks are rebuilt when terrain, territory or sight changes.
    const signature = `${state.navigation}:${Math.floor(state.tick / rules.visibility.interval)}`
    const z = camera.zoom
    const visible: { key: string, bounds: ReturnType<typeof chunkBounds> }[] = []
    for (let cy = 0; cy * CHUNK < map.height - 1; cy++) {
      for (let cx = 0; cx * CHUNK < map.width - 1; cx++) {
        const left = cx * CHUNK * 16 - Math.min(map.height - 1, cy * CHUNK + CHUNK) * 8 - 16
        const right = Math.min(map.width - 1, cx * CHUNK + CHUNK) * 16 - cy * CHUNK * 8 + 16
        const sx0 = camera.x + left * z, sx1 = camera.x + right * z, sy1 = camera.y + (Math.min(map.height - 1, cy * CHUNK + CHUNK) * 9 + 16) * z, sy0 = camera.y + (cy * CHUNK * 9 - 520) * z
        if (sx1 < 0 || sx0 > width || sy1 < 0 || sy0 > height) continue
        const bounds = chunkBounds(session, options.player, cx, cy)
        if (camera.y + bounds.bottom * z < 0 || camera.y + bounds.realTop * z > height) continue
        visible.push({ key: `${cx}:${cy}`, bounds })
      }
    }
    // Assemble neighbors on one sampling grid. Screen tiles have disjoint
    // integer device-pixel clips. The sampling gutter copies actual neighboring
    // raster data without enlarging any triangle or painting across its edges.
    const tilePixels = Math.max(1, Math.floor(256 * pixelRatio))
    const frameSize = Math.ceil(tilePixels / pixelRatio / z * chunkScale) + 6
    if (frameSize * frameSize * 4 > 8 * 1024 * 1024) throw new RangeError('Terrain staging raster exceeds its supported capacity')
    if (terrainFrame.width !== frameSize || terrainFrame.height !== frameSize) {
      terrainFrame.width = terrainFrame.height = 0
      terrainFrame.width = terrainFrame.height = frameSize
    }
    terrainContext.imageSmoothingEnabled = false
    for (let py = 0; py < canvas.height; py += tilePixels) for (let px = 0; px < canvas.width; px += tilePixels) {
      const pw = Math.min(tilePixels, canvas.width - px), ph = Math.min(tilePixels, canvas.height - py)
      const left = Math.floor((px / pixelRatio - camera.x) / z * chunkScale) - 2, top = Math.floor((py / pixelRatio - camera.y) / z * chunkScale) - 2
      const right = Math.ceil(((px + pw) / pixelRatio - camera.x) / z * chunkScale) + 2, bottom = Math.ceil(((py + ph) / pixelRatio - camera.y) / z * chunkScale) + 2
      terrainContext.clearRect(0, 0, frameSize, frameSize)
      for (const { key, bounds } of visible) {
        if (bounds.right * chunkScale < left || bounds.left * chunkScale > right || bounds.bottom * chunkScale < top || bounds.realTop * chunkScale > bottom) continue
        let chunk = chunks.get(key)
        const inputs = !chunk || chunk.signature !== signature ? terrainInputs(session, options.player, bounds, chunk?.inputs) : chunk.inputs
        if (chunk && inputs === chunk.inputs) chunk.signature = signature
        if (!chunk || chunk.signature !== signature) {
          if (chunk) retireChunk(key)
          chunk = { ...renderChunk(session, options.player, bounds), signature, inputs }; terrainFrameBuilds++
          const bytes = chunk.canvas.width * chunk.canvas.height * 4
          if (bytes <= TERRAIN_CACHE_BYTES) { chunks.set(key, chunk); terrainBytes += bytes; terrainInputBytes += inputs.byteLength }
        }
        else { chunks.delete(key); chunks.set(key, chunk) }
        terrainFrameBytes += chunk.canvas.width * chunk.canvas.height * 4
        terrainContext.drawImage(chunk.canvas, chunk.left * chunkScale - left, chunk.top * chunkScale - top)
        if (!chunks.has(key)) { chunk.canvas.width = 0; chunk.canvas.height = 0 }
      }
      ctx!.save(); ctx!.setTransform(1, 0, 0, 1, 0, 0)
      ctx!.beginPath(); ctx!.rect(px, py, pw, ph); ctx!.clip()
      ctx!.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      // The reference background texture retains its default nearest filter.
      ctx!.imageSmoothingEnabled = false
      ctx!.drawImage(terrainFrame, 0, 0, right - left, bottom - top, camera.x + left / chunkScale * z, camera.y + top / chunkScale * z, (right - left) / chunkScale * z, (bottom - top) / chunkScale * z)
      ctx!.restore()
    }
    // Visible tile range for entity culling.
    const yMin = Math.max(0, Math.floor((-camera.y / z) / 9) - 2), yMax = Math.min(map.height - 1, Math.ceil(((height - camera.y) / z + 520) / 9) + 2)
    const columns = (y: number): [number, number] => [Math.floor(((-camera.x) / z + y * 8) / 16) - 2, Math.ceil(((width - camera.x) / z + y * 8) / 16) + 2]
    const items = scene(session, { player: options.player, rows: [yMin, yMax], columns, reduceMotion: options.reduceMotion })
    for (const b of state.buildings.values()) {
      if (options.selected !== b.id && b.phase !== 'leveling') continue
      const rule = rules.buildings.find(r => r.id === b.type)!, selected = options.selected === b.id
      if (b.owner !== options.player && !rule.footprint.some(([dx, dy]) => viewer.visible[(b.y + dy) * map.width + b.x + dx])) continue
      outline(session, rule.footprint.map(([dx, dy]) => ({ x: b.x + dx, y: b.y + dy })), selected ? '#f3dd94' : '#d9c48a', selected ? 0.28 : 0.16)
      if (selected && b.owner === options.player && 'radius' in rule.workflow) ring(session, options.tool === `work-area:${b.id}` && options.cursor ? options.cursor : b.workArea, rule.workflow.radius)
    }
    marked = options.marked ?? null
    for (const item of items) paint(item, options.player)
    if (options.band) {
      const { x0, y0, x1, y1 } = options.band
      ctx!.strokeStyle = '#f2df9c'; ctx!.lineWidth = 1; ctx!.fillStyle = '#f2df9c18'
      ctx!.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); ctx!.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0))
    }

    if (options.cursor) {
      const c = options.cursor
      if (options.tool && session.context.building.has(options.tool)) {
        const rule = session.context.building.get(options.tool)!, allowed = options.placement === null
        outline(session, rule.footprint.map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })), allowed ? '#f2df9c' : '#e4765a', 0.3)
        if (allowed) sprite(`building:${options.tool}`, toView(c.x, c.y, perceivedHeight(map, viewer, c.y * map.width + c.x)), 0, 0.55)
      }
      else outline(session, [c], '#f2df9c', 0.25)
    }
  }

  let marked: ReadonlySet<number> | null = null
  function posedIndex(item: SceneItem): number {
    const per = Math.max(1, Math.floor((atlas!.frames.get(item.sprite)?.length ?? 6) / 6))
    return item.progress === undefined ? item.frame : item.frame * per + Math.min(per - 1, Math.floor(item.progress * per))
  }
  function paint(item: SceneItem, player: number): void {
    const z = camera.zoom, p = toScreen(item.view)
    switch (item.kind) {
      case 'border': playerSprite(item, item.frame); break
      case 'sapling': sprite(item.sprite, item.view, Math.floor((item.growth ?? 0) * (atlas!.frames.get('sapling')?.length ?? 1))); break
      case 'building': for (let i = 0; i < (atlas!.frames.get(item.sprite)?.length ?? 0); i++) sprite(item.sprite, item.view, i); break
      case 'site': if (item.phase === 'building') for (let i = 0; i < (atlas!.frames.get(item.sprite)?.length ?? 0); i++) sprite(item.sprite, item.view, i, 1, Math.max(0.08, item.reveal ?? 0)); break
      case 'shadow': {
        const body = frame(item.sprite, posedIndex(item)), shadow = body?.shadow ? atlas!.frames.get(body.shadow)?.find(layer => layer.frame === body.frame) : null
        if (shadow?.width && shadow.height) ctx!.drawImage(atlas!.image, shadow.x, shadow.y, shadow.width, shadow.height, camera.x + (item.view.x + shadow.offsetX) * z, camera.y + (item.view.y + shadow.offsetY) * z, shadow.width * z, shadow.height * z)
        break
      }
      case 'settler':
        if (marked?.has(item.entity)) { ctx!.strokeStyle = '#f2df9c'; ctx!.lineWidth = Math.max(1, z); ctx!.beginPath(); ctx!.ellipse(p.x, p.y, 7 * z, 3 * z, 0, 0, Math.PI * 2); ctx!.stroke() }
        // Strike sequences hold equal runs per direction. Body and clothing
        // resolve the same actual frame before either layer is painted.
        playerSprite(item, posedIndex(item))
        if (item.owner !== player) { ctx!.fillStyle = playerCSS(playerSlots, item.owner); ctx!.fillRect(p.x - 2 * z, p.y - 34 * z, 4 * z, 2 * z) }
        else if (item.action === 'working' && item.health === undefined) { ctx!.fillStyle = '#f2df9c'; ctx!.fillRect(p.x - 0.5 * z, p.y - 36 * z, z, 3 * z) }
        if (item.health !== undefined) {
          // Soldiers show remaining health above their heads.
          ctx!.fillStyle = '#1d1a14cc'; ctx!.fillRect(p.x - 5 * z, p.y - 39 * z, 10 * z, 2 * z)
          ctx!.fillStyle = item.health > 0.5 ? '#9fd27a' : item.health > 0.25 ? '#e8c35a' : '#e4765a'; ctx!.fillRect(p.x - 5 * z, p.y - 39 * z, 10 * z * item.health, 2 * z)
        }
        return
      case 'arrow': {
        // No arrow sprite is mapped from the original data yet, so arrows are drawn as short shafts along their flight.
        const from = item.from!, to = item.to!, length = Math.hypot(to.x - from.x, to.y - from.y) || 1
        const ux = (to.x - from.x) / length, uy = (to.y - from.y) / length
        ctx!.strokeStyle = '#3a2a1a'; ctx!.lineWidth = Math.max(1, z * 0.8)
        ctx!.beginPath(); ctx!.moveTo(p.x - ux * 5 * z, p.y - uy * 5 * z); ctx!.lineTo(p.x + ux * 5 * z, p.y + uy * 5 * z); ctx!.stroke()
        return
      }
      default: sprite(item.sprite, item.view, item.frame)
    }
    if ((item.kind === 'building' || item.kind === 'site') && item.owner !== player) { ctx!.fillStyle = playerCSS(playerSlots, item.owner); ctx!.fillRect(p.x - 3 * z, p.y - 46 * z, 6 * z, 4 * z) }
    if (item.suspended) { ctx!.fillStyle = '#f0d58ccc'; ctx!.font = `${Math.round(9 * z)}px ui-sans-serif, system-ui`; ctx!.textAlign = 'center'; ctx!.fillText('II', p.x, p.y - 30 * z) }
  }
  function outline(session: Session, tiles: Point[], color: string, alpha: number): void {
    const { map } = session.state, z = camera.zoom
    const viewer = session.state.players.find(p => p.id === terrainPlayer)!
    ctx!.fillStyle = color; ctx!.strokeStyle = color; ctx!.lineWidth = Math.max(1, z * 0.8)
    for (const t of tiles) {
      if (t.x < 0 || t.y < 0 || t.x >= map.width || t.y >= map.height) continue
      const p = toScreen(toView(t.x, t.y, perceivedHeight(map, viewer, t.y * map.width + t.x)))
      ctx!.beginPath(); ctx!.moveTo(p.x - 8 * z, p.y); ctx!.lineTo(p.x, p.y - 4.5 * z); ctx!.lineTo(p.x + 8 * z, p.y); ctx!.lineTo(p.x, p.y + 4.5 * z); ctx!.closePath()
      ctx!.globalAlpha = alpha; ctx!.fill(); ctx!.globalAlpha = Math.min(1, alpha * 3); ctx!.stroke(); ctx!.globalAlpha = 1
    }
  }
  function ring(session: Session, center: Point, radius: number): void {
    const { map } = session.state, z = camera.zoom
    const viewer = session.state.players.find(p => p.id === terrainPlayer)!
    ctx!.fillStyle = '#f2df9c'
    for (let y = center.y - radius; y <= center.y + radius; y++) {
      for (let x = center.x - radius; x <= center.x + radius; x++) {
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue
        const dx = x - center.x, dy = y - center.y, d = (dx >= 0) === (dy >= 0) ? Math.max(Math.abs(dx), Math.abs(dy)) : Math.abs(dx) + Math.abs(dy)
        if (d !== radius) continue
        const p = toScreen(toView(x, y, perceivedHeight(map, viewer, y * map.width + x)))
        ctx!.beginPath(); ctx!.arc(p.x, p.y, 1.6 * z, 0, Math.PI * 2); ctx!.fill()
      }
    }
  }

  resize()
  return {
    camera, resize, draw, home,
    /** Canvas coordinates of a view point under the current camera. */
    screen: toScreen,
    setAssets(value: Atlas) { clearTinted(); materials?.dispose(); atlas = value; materials = createTerrainMaterials(canvas.ownerDocument, value); clearChunks() },
    setPlayerSlots(slots: readonly number[]) { playerSlots = slots; clearChunks() },
    tintedFrameCount: () => tinted.size,
    /** Retained capacity and summed raster bytes drawn this frame, not RSS/GPU memory. */
    terrainCacheMemory: () => ({ entries: chunks.size, bytes: terrainBytes, inputBytes: terrainInputBytes, frameBytes: terrainFrameBytes, rebuiltChunks: terrainFrameBuilds, limit: TERRAIN_CACHE_BYTES }),
    terrainFrameMemory: () => ({ bytes: terrainFrame.width * terrainFrame.height * 4, limit: 8 * 1024 * 1024 }),
    terrainMaterialMemory: () => materials?.memory() ?? { bytes: 0, limit: 2 * 1024 * 1024, entries: 0 },
    dispose() { clearTinted(); clearChunks(); materials?.dispose(); materials = null; atlas = null; terrainSession = null },
    invalidate() { clearChunks() },
    pick(session: Session, clientX: number, clientY: number): Point | null {
      const rect = canvas.getBoundingClientRect()
      const viewer = session.state.players.find(p => p.id === terrainPlayer) ?? session.state.players[0]!
      return pick(session.state.map, (clientX - rect.left - camera.x) / camera.zoom, (clientY - rect.top - camera.y) / camera.zoom, tile => perceivedHeight(session.state.map, viewer, tile))
    },
  }
}
export type Renderer = ReturnType<typeof createRenderer>
