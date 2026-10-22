import type { Atlas, AtlasFrame } from './assets'
import type { Point, Session } from './engine'
import { pick, toView } from './engine'

// Presentation reads the session and the viewing player's sight. It never
// changes simulation state, and foreign entities are drawn only where the
// player currently sees, matching the engine's player view.
export interface Camera { x: number, y: number, zoom: number }
const CHUNK = 32, CHUNK_SCALE = 2
const PLAYER_COLORS = ['#000000', '#4a78d6', '#d1513f', '#4f9b4a', '#d6b13c', '#9a5bc4', '#3fb2b6', '#d27c34', '#c7c7c7']
const TERRAIN_FILL: Record<string, string> = { grass: '#6f9452', mountain: '#8b8a7f', sand: '#b8ad78', desert: '#c9b783', swamp: '#5d7347', water: '#3c7f8a' }
const TERRAIN_TEXTURE: Record<string, string> = { grass: 'terrain-grass', mountain: 'terrain-rock', sand: 'terrain-sand', desert: 'terrain-sand', swamp: 'terrain-grass', water: 'terrain-water' }

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

  interface DrawOptions { player: number, cursor: Point | null, tool: string | null, selected: number | null, time: number, reduceMotion: boolean, placement: string | null }
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
    const drawables: { depth: number, paint: () => void }[] = []
    const seen = (t: number): boolean => viewer.visible[t] === 1
    for (let y = yMin; y <= yMax; y++) {
      const xMin = Math.max(0, Math.floor(((-camera.x) / z + y * 8) / 16) - 2), xMax = Math.min(map.width - 1, Math.ceil(((width - camera.x) / z + y * 8) / 16) + 2)
      for (let x = xMin; x <= xMax; x++) {
        const t = y * map.width + x, object = map.object[t]!
        if (!object || !viewer.explored[t]) continue
        const rule = rules.objects[object - 1]!, view = toView(x, y, map.elevation[t]!)
        const age = state.tick - map.objectSince[t]!, growth = rule.grows ? Math.min(0.999, age / rule.grows.ticks) : 1
        const hash = (x * 73856093 ^ y * 19349663) >>> 0
        drawables.push({ depth: view.y, paint: () => {
          if (rule.id === 'tree') sprite(`tree-${hash % 7}`, view, 0)
          else if (rule.id === 'sapling') sprite('sapling', view, Math.floor(growth * (atlas!.frames.get('sapling')?.length ?? 1)))
          else if (rule.id === 'stone') sprite('stone-deposit', view, map.objectAmount[t]! > 8 ? 0 : map.objectAmount[t]! > 4 ? 1 : 2)
          else if (rule.id === 'field') sprite('crop', view, Math.floor(growth * 7))
          else if (rule.id === 'ripe-grain') sprite('crop', view, 7)
        } })
      }
    }
    for (const st of state.stacks.values()) {
      if (st.amount < 1 || (st.owner !== options.player && !seen(st.tile))) continue
      const x = st.tile % map.width, y = Math.floor(st.tile / map.width)
      if (y < yMin || y > yMax) continue
      // Piles lie on their own tiles; several piles waiting at one door fan out beside it.
      const slot = [...state.stacks.values()].filter(o => o.tile === st.tile && o.amount > 0).indexOf(st)
      const base = toView(x, y, map.elevation[st.tile]!), view = { x: base.x + (slot ? 10 + ((slot - 1) % 3) * 9 : 0), y: base.y + (slot ? Math.floor((slot - 1) / 3) * 6 - 2 : 0) }
      drawables.push({ depth: view.y, paint: () => sprite(`stack:${st.good}`, view, Math.min(8, st.amount) - 1) })
    }
    for (const b of state.buildings.values()) {
      const rule = rules.buildings.find(r => r.id === b.type)!
      const covered = rule.footprint.some(([dx, dy]) => { const t = (b.y + dy) * map.width + b.x + dx; return b.owner === options.player || seen(t) })
      if (!covered) continue
      const view = toView(b.x, b.y, map.elevation[b.y * map.width + b.x]!)
      const total = Object.values(rule.cost).reduce((a, n) => a + n, 0) || 1
      const selected = options.selected === b.id
      drawables.push({ depth: view.y + 4, paint: () => {
        if (selected || b.phase === 'leveling') outline(session, rule.footprint.map(([dx, dy]) => ({ x: b.x + dx, y: b.y + dy })), selected ? '#f3dd94' : '#d9c48a', selected ? 0.28 : 0.16)
        if (b.phase === 'active') { for (let i = 0; i < (atlas!.frames.get(`building:${b.type}`)?.length ?? 0); i++) sprite(`building:${b.type}`, view, i) }
        else if (b.phase === 'building') {
          const progress = (total - b.workRemaining) / total
          for (let i = 0; i < (atlas!.frames.get(`site:${b.type}`)?.length ?? 0); i++) sprite(`site:${b.type}`, view, i, 1, Math.max(0.08, progress))
        }
        if (b.owner !== options.player) { const p = toScreen(view); ctx!.fillStyle = PLAYER_COLORS[b.owner % PLAYER_COLORS.length]!; ctx!.fillRect(p.x - 3 * z, p.y - 46 * z, 6 * z, 4 * z) }
        if (b.suspended && b.owner === options.player) { const p = toScreen(view); ctx!.fillStyle = '#f0d58ccc'; ctx!.font = `${Math.round(9 * z)}px ui-sans-serif, system-ui`; ctx!.textAlign = 'center'; ctx!.fillText('II', p.x, p.y - 30 * z) }
      } })
      if (selected && 'radius' in rule.workflow) { const radius = rule.workflow.radius, area = b.workArea; drawables.push({ depth: -1e9, paint: () => ring(session, area, radius) }) }
    }
    for (const s of state.settlers.values()) {
      if (s.inside) continue
      const t = s.y * map.width + s.x
      if (s.owner !== options.player && !seen(t)) continue
      if (s.y < yMin - 1 || s.y > yMax + 1) continue
      const from = toView(s.x, s.y, map.elevation[t]!)
      let view = from
      if (s.action === 'walking' && s.next >= 0) {
        const nx = s.next % map.width, ny = Math.floor(s.next / map.width), to = toView(nx, ny, map.elevation[s.next]!)
        // Interpolation only affects drawing; the simulation keeps whole tiles.
        const f = s.stepTicks ? s.step / s.stepTicks : 0
        view = { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f }
      }
      const walking = s.action === 'walking', step = walking && s.stepTicks ? s.step / s.stepTicks : 0
      const index = s.dir * 12 + (walking && !options.reduceMotion ? 1 + Math.floor(step * 11) % 11 : 0)
      const key = s.cargo ? `carry:${s.cargo}` : 'worker'
      drawables.push({ depth: view.y + 1, paint: () => {
        const p = toScreen(view)
        ctx!.fillStyle = 'rgba(20,30,20,0.35)'; ctx!.beginPath(); ctx!.ellipse(p.x, p.y, 4 * z, 1.6 * z, 0, 0, Math.PI * 2); ctx!.fill()
        sprite(key, view, index)
        if (s.owner !== options.player) { ctx!.fillStyle = PLAYER_COLORS[s.owner % PLAYER_COLORS.length]!; ctx!.fillRect(p.x - 2 * z, p.y - 34 * z, 4 * z, 2 * z) }
        else if (s.action === 'working') { ctx!.fillStyle = '#f2df9c'; ctx!.fillRect(p.x - 0.5 * z, p.y - 36 * z, z, 3 * z) }
      } })
    }
    for (const sign of viewer.signs) {
      if (sign.until <= state.tick) continue
      const x = sign.tile % map.width, y = Math.floor(sign.tile / map.width), view = toView(x, y, map.elevation[sign.tile]!)
      const color = sign.good === 'coal' ? '#2b2b2b' : sign.good === 'ironore' ? '#b5643c' : sign.good === 'goldore' ? '#e3c04d' : '#eeeeee'
      drawables.push({ depth: view.y, paint: () => { const p = toScreen(view); ctx!.fillStyle = '#5b4632'; ctx!.fillRect(p.x - 0.6 * z, p.y - 8 * z, 1.2 * z, 8 * z); ctx!.fillStyle = color; ctx!.fillRect(p.x - 2.5 * z, p.y - 10 * z, 5 * z, 3 * z) } })
    }
    drawables.sort((a, b) => a.depth - b.depth)
    for (const d of drawables) d.paint()
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
    setAssets(value: Atlas) { atlas = value; patterns = null; chunks.clear() },
    invalidate() { chunks.clear() },
    pick(session: Session, clientX: number, clientY: number): Point | null {
      const rect = canvas.getBoundingClientRect()
      return pick(session.state.map, (clientX - rect.left - camera.x) / camera.zoom, (clientY - rect.top - camera.y) / camera.zoom)
    },
  }
}
export type Renderer = ReturnType<typeof createRenderer>
