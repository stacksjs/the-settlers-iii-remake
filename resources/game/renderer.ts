import type { Atlas, AtlasFrame } from './assets'
import type { Point, Session } from './engine'
import type { SceneItem } from './scene'
import { pick, toView } from './engine'
import { scene } from './scene'

// Presentation reads the session and the viewing player's sight. It never
// changes simulation state, and foreign entities are drawn only where the
// player currently sees, matching the engine's player view.
export interface Camera { x: number, y: number, zoom: number }
const CHUNK = 32, CHUNK_SCALE = 2
const PLAYER_COLORS = ['#000000', '#4a78d6', '#d1513f', '#4f9b4a', '#d6b13c', '#9a5bc4', '#3fb2b6', '#d27c34', '#c7c7c7']
const TERRAIN_FILL: Record<string, string> = { grass: '#6f9452', mountain: '#8b8a7f', sand: '#b8ad78', desert: '#c9b783', moor: '#6b6447', snow: '#e8ecef', swamp: '#5d7347', water: '#3c7f8a' }
// Terrain without an imported original texture is drawn as a flat colour until its media is converted.
const TERRAIN_TEXTURE: Record<string, string> = { grass: 'terrain-grass', mountain: 'terrain-rock', sand: 'terrain-sand', desert: 'terrain-sand', water: 'terrain-water' }

export function createRenderer(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser could not create the game canvas.')
  let atlas: Atlas | null = null, width = 0, height = 0, pixelRatio = 1
  const camera: Camera = { x: 0, y: 0, zoom: 1.5 }
  const chunks = new Map<string, { canvas: HTMLCanvasElement, left: number, top: number, signature: string }>()
  let patterns: Map<string, CanvasPattern> | null = null

  function texturePatterns(target: CanvasRenderingContext2D): Map<string, CanvasPattern> {
    const result = new Map<string, CanvasPattern>()
    if (!atlas) return result
    for (const [terrain, key] of Object.entries(TERRAIN_TEXTURE)) {
      const frame = atlas.frames.get(key)?.[0]
      if (!frame?.width) continue
      const tile = canvas.ownerDocument.createElement('canvas')
      tile.width = frame.width; tile.height = frame.height
      tile.getContext('2d')!.drawImage(atlas.image, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height)
      const pattern = target.createPattern(tile, 'repeat')
      if (pattern) result.set(terrain, pattern)
    }
    return result
  }

  function renderChunk(session: Session, player: number, cx: number, cy: number) {
    const { map } = session.state, rules = session.rules, viewer = session.state.players.find(p => p.id === player)!
    const x0 = cx * CHUNK, y0 = cy * CHUNK, x1 = Math.min(map.width - 1, x0 + CHUNK), y1 = Math.min(map.height - 1, y0 + CHUNK)
    const left = x0 * 16 - y1 * 8 - 16, right = x1 * 16 - y0 * 8 + 16, top = y0 * 9 - 255 * 2 - 16, bottom = y1 * 9 + 16
    let maxRise = 0
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) maxRise = Math.max(maxRise, map.elevation[y * map.width + x]!)
    const realTop = y0 * 9 - maxRise * 2 - 16
    const surface = canvas.ownerDocument.createElement('canvas')
    surface.width = Math.ceil((right - left) * CHUNK_SCALE); surface.height = Math.ceil((bottom - realTop) * CHUNK_SCALE)
    const g = surface.getContext('2d')!
    g.setTransform(CHUNK_SCALE, 0, 0, CHUNK_SCALE, -left * CHUNK_SCALE, -realTop * CHUNK_SCALE)
    patterns ??= texturePatterns(g)
    const at = (x: number, y: number): Point => toView(x, y, map.elevation[y * map.width + x]!)
    const terrainOf = (x: number, y: number): string => rules.terrain[map.terrain[y * map.width + x]!]!.id
    const triangle = (a: [number, number], b: [number, number], c: [number, number]): void => {
      const [ax, ay] = a, [bx, by] = b, [cx2, cy2] = c
      if (Math.max(ax, bx, cx2) >= map.width || Math.max(ay, by, cy2) >= map.height) return
      const pa = at(ax, ay), pb = at(bx, by), pc = at(cx2, cy2), kind = terrainOf(ax, ay), t = ay * map.width + ax
      g.beginPath(); g.moveTo(pa.x, pa.y); g.lineTo(pb.x, pb.y); g.lineTo(pc.x, pc.y); g.closePath()
      if (!viewer.explored[t]) { g.fillStyle = '#0d1714'; g.fill(); return }
      g.fillStyle = patterns!.get(kind) ?? TERRAIN_FILL[kind] ?? '#6f9452'; g.fill()
      // Light falls from the upper left: slopes facing it brighten, the others darken.
      const slope = (map.elevation[ay * map.width + ax]! - map.elevation[cy2 * map.width + cx2]!) * 0.05
      g.fillStyle = slope >= 0 ? `rgba(255,248,220,${Math.min(0.35, slope)})` : `rgba(10,20,15,${Math.min(0.45, -slope)})`; g.fill()
      if (!viewer.visible[t]) { g.fillStyle = 'rgba(8,16,13,0.38)'; g.fill() }
    }
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { triangle([x, y], [x + 1, y], [x + 1, y + 1]); triangle([x, y], [x + 1, y + 1], [x, y + 1]) }
    // Border posts mark tiles whose neighbour belongs to someone else.
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = y * map.width + x, owner = map.owner[t]!
        if (!owner || !viewer.explored[t]) continue
        const edge = [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 0], [-1, -1]].some(([dx, dy]) => { const nx = x + dx!, ny = y + dy!; return nx < 0 || ny < 0 || nx >= map.width || ny >= map.height || map.owner[ny * map.width + nx] !== owner })
        if (!edge) continue
        const p = at(x, y)
        g.fillStyle = '#1a1a14'; g.fillRect(p.x - 1.5, p.y - 6, 3, 6)
        g.fillStyle = PLAYER_COLORS[owner % PLAYER_COLORS.length]!; g.fillRect(p.x - 1, p.y - 7, 2, 3)
      }
    }
    return { canvas: surface, left, top: realTop }
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
  const toScreen = (view: Point): Point => ({ x: camera.x + view.x * camera.zoom, y: camera.y + view.y * camera.zoom })

  function resize(): void {
    const rect = canvas.getBoundingClientRect()
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
    ctx!.fillStyle = '#0d1714'; ctx!.fillRect(0, 0, width, height)
    if (!atlas) return
    const { state, rules } = session, { map } = state, viewer = state.players.find(p => p.id === options.player)!
    ctx!.imageSmoothingEnabled = camera.zoom < 1
    // Terrain chunks are rebuilt when terrain, territory or sight changes.
    const signature = `${state.navigation}:${Math.floor(state.tick / rules.visibility.interval)}`
    const z = camera.zoom
    for (let cy = 0; cy * CHUNK < map.height - 1; cy++) {
      for (let cx = 0; cx * CHUNK < map.width - 1; cx++) {
        const key = `${cx}:${cy}`
        let chunk = chunks.get(key)
        const left = cx * CHUNK * 16 - Math.min(map.height - 1, cy * CHUNK + CHUNK) * 8 - 16
        const right = Math.min(map.width - 1, cx * CHUNK + CHUNK) * 16 - cy * CHUNK * 8 + 16
        const sx0 = camera.x + left * z, sx1 = camera.x + right * z, sy1 = camera.y + (Math.min(map.height - 1, cy * CHUNK + CHUNK) * 9 + 16) * z, sy0 = camera.y + (cy * CHUNK * 9 - 520) * z
        if (sx1 < 0 || sx0 > width || sy1 < 0 || sy0 > height) continue
        if (!chunk || chunk.signature !== signature) { chunk = { ...renderChunk(session, options.player, cx, cy), signature }; chunks.set(key, chunk) }
        ctx!.drawImage(chunk.canvas, camera.x + chunk.left * z, camera.y + chunk.top * z, chunk.canvas.width / CHUNK_SCALE * z, chunk.canvas.height / CHUNK_SCALE * z)
      }
    }
    // Visible tile range for entity culling.
    const yMin = Math.max(0, Math.floor((-camera.y / z) / 9) - 2), yMax = Math.min(map.height - 1, Math.ceil(((height - camera.y) / z + 520) / 9) + 2)
    const columns = (y: number): [number, number] => [Math.floor(((-camera.x) / z + y * 8) / 16) - 2, Math.ceil(((width - camera.x) / z + y * 8) / 16) + 2]
    const items = scene(session, { player: options.player, rows: [yMin, yMax], columns, reduceMotion: options.reduceMotion })
    for (const b of state.buildings.values()) {
      if (options.selected !== b.id && b.phase !== 'leveling') continue
      const rule = rules.buildings.find(r => r.id === b.type)!, selected = options.selected === b.id
      if (b.owner === options.player || rule.footprint.some(([dx, dy]) => viewer.visible[(b.y + dy) * map.width + b.x + dx])) outline(session, rule.footprint.map(([dx, dy]) => ({ x: b.x + dx, y: b.y + dy })), selected ? '#f3dd94' : '#d9c48a', selected ? 0.28 : 0.16)
      if (selected && 'radius' in rule.workflow) ring(session, b.workArea, rule.workflow.radius)
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
        if (allowed) sprite(`building:${options.tool}`, toView(c.x, c.y, map.elevation[c.y * map.width + c.x] ?? 0), 0, 0.55)
      }
      else outline(session, [c], '#f2df9c', 0.25)
    }
  }

  let marked: ReadonlySet<number> | null = null
  function paint(item: SceneItem, player: number): void {
    const z = camera.zoom, p = toScreen(item.view)
    switch (item.kind) {
      case 'sapling': sprite(item.sprite, item.view, Math.floor((item.growth ?? 0) * (atlas!.frames.get('sapling')?.length ?? 1))); break
      case 'building': for (let i = 0; i < (atlas!.frames.get(item.sprite)?.length ?? 0); i++) sprite(item.sprite, item.view, i); break
      case 'site': if (item.phase === 'building') for (let i = 0; i < (atlas!.frames.get(item.sprite)?.length ?? 0); i++) sprite(item.sprite, item.view, i, 1, Math.max(0.08, item.reveal ?? 0)); break
      case 'settler':
        ctx!.fillStyle = 'rgba(20,30,20,0.35)'; ctx!.beginPath(); ctx!.ellipse(p.x, p.y, 4 * z, 1.6 * z, 0, 0, Math.PI * 2); ctx!.fill()
        if (marked?.has(item.entity)) { ctx!.strokeStyle = '#f2df9c'; ctx!.lineWidth = Math.max(1, z); ctx!.beginPath(); ctx!.ellipse(p.x, p.y, 7 * z, 3 * z, 0, 0, Math.PI * 2); ctx!.stroke() }
        sprite(item.sprite, item.view, item.frame)
        if (item.owner !== player) { ctx!.fillStyle = PLAYER_COLORS[item.owner % PLAYER_COLORS.length]!; ctx!.fillRect(p.x - 2 * z, p.y - 34 * z, 4 * z, 2 * z) }
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
      case 'sign': {
        const color = item.good === 'coal' ? '#2b2b2b' : item.good === 'ironore' ? '#b5643c' : item.good === 'goldore' ? '#e3c04d' : '#eeeeee'
        ctx!.fillStyle = '#5b4632'; ctx!.fillRect(p.x - 0.6 * z, p.y - 8 * z, 1.2 * z, 8 * z); ctx!.fillStyle = color; ctx!.fillRect(p.x - 2.5 * z, p.y - 10 * z, 5 * z, 3 * z)
        return
      }
      default: sprite(item.sprite, item.view, item.frame)
    }
    if ((item.kind === 'building' || item.kind === 'site') && item.owner !== player) { ctx!.fillStyle = PLAYER_COLORS[item.owner % PLAYER_COLORS.length]!; ctx!.fillRect(p.x - 3 * z, p.y - 46 * z, 6 * z, 4 * z) }
    if (item.suspended) { ctx!.fillStyle = '#f0d58ccc'; ctx!.font = `${Math.round(9 * z)}px ui-sans-serif, system-ui`; ctx!.textAlign = 'center'; ctx!.fillText('II', p.x, p.y - 30 * z) }
  }
  function outline(session: Session, tiles: Point[], color: string, alpha: number): void {
    const { map } = session.state, z = camera.zoom
    ctx!.fillStyle = color; ctx!.strokeStyle = color; ctx!.lineWidth = Math.max(1, z * 0.8)
    for (const t of tiles) {
      if (t.x < 0 || t.y < 0 || t.x >= map.width || t.y >= map.height) continue
      const p = toScreen(toView(t.x, t.y, map.elevation[t.y * map.width + t.x]!))
      ctx!.beginPath(); ctx!.moveTo(p.x - 8 * z, p.y); ctx!.lineTo(p.x, p.y - 4.5 * z); ctx!.lineTo(p.x + 8 * z, p.y); ctx!.lineTo(p.x, p.y + 4.5 * z); ctx!.closePath()
      ctx!.globalAlpha = alpha; ctx!.fill(); ctx!.globalAlpha = Math.min(1, alpha * 3); ctx!.stroke(); ctx!.globalAlpha = 1
    }
  }
  function ring(session: Session, center: Point, radius: number): void {
    const { map } = session.state, z = camera.zoom
    ctx!.fillStyle = '#f2df9c'
    for (let y = center.y - radius; y <= center.y + radius; y++) {
      for (let x = center.x - radius; x <= center.x + radius; x++) {
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue
        const dx = x - center.x, dy = y - center.y, d = (dx >= 0) === (dy >= 0) ? Math.max(Math.abs(dx), Math.abs(dy)) : Math.abs(dx) + Math.abs(dy)
        if (d !== radius) continue
        const p = toScreen(toView(x, y, map.elevation[y * map.width + x]!))
        ctx!.beginPath(); ctx!.arc(p.x, p.y, 1.6 * z, 0, Math.PI * 2); ctx!.fill()
      }
    }
  }

  resize()
  return {
    camera, resize, draw, home,
    /** Canvas coordinates of a view point under the current camera. */
    screen: toScreen,
    setAssets(value: Atlas) { atlas = value; patterns = null; chunks.clear() },
    invalidate() { chunks.clear() },
    pick(session: Session, clientX: number, clientY: number): Point | null {
      const rect = canvas.getBoundingClientRect()
      return pick(session.state.map, (clientX - rect.left - camera.x) / camera.zoom, (clientY - rect.top - camera.y) / camera.zoom)
    },
  }
}
export type Renderer = ReturnType<typeof createRenderer>
