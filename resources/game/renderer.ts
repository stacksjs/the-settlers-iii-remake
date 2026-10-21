import type { Atlas } from './assets'
import type { Kind, Terrain, World } from './simulation'
import { BUILDINGS, distance, owned, placementError, SIZE, terrain } from './simulation'

export interface Camera { x: number, y: number, zoom: number }
export interface Cursor { x: number, y: number }
const colors: Record<Terrain, string[]> = { grass: ['#719757', '#789c5d', '#6d9254', '#7b9c5e'], forest: ['#60844b', '#688d50'], rock: ['#91928a', '#868b83'], water: ['#3d8187', '#42888d'], iron: ['#939080', '#868678'], coal: ['#777e74', '#7e8379'], sand: ['#b1af77', '#b5b37e'] }
const noise = (x: number, y: number): number => Math.abs(Math.sin(x * 43.1 + y * 17.3) * 45117.4) % 1
export function project(x: number, y: number, camera: Camera): Cursor { return { x: camera.x + (x - y) * 22 * camera.zoom, y: camera.y + (x + y) * 11 * camera.zoom } }
export function unproject(x: number, y: number, camera: Camera): Cursor { const a = (x - camera.x) / (22 * camera.zoom), b = (y - camera.y) / (11 * camera.zoom); return { x: Math.round((a + b) / 2) || 0, y: Math.round((b - a) / 2) || 0 } }

export function createRenderer(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser could not create the game canvas.')
  let atlas: Atlas | null = null
  let width = 0, height = 0, pixelRatio = 1
  let background: HTMLCanvasElement | null = null, signature = ''
  const camera: Camera = { x: 0, y: 0, zoom: 1 }
  function polygon(points: number[][], fill: string, stroke?: string): void {
    ctx!.beginPath(); points.forEach(([x, y], i) => i === 0 ? ctx!.moveTo(x!, y!) : ctx!.lineTo(x!, y!)); ctx!.closePath(); ctx!.fillStyle = fill; ctx!.fill()
    if (stroke) { ctx!.strokeStyle = stroke; ctx!.lineWidth = 0.7; ctx!.stroke() }
  }
  function diamond(x: number, y: number, fill: string, stroke?: string): void { const w = 22 * camera.zoom, h = 11 * camera.zoom; polygon([[x, y - h], [x + w, y], [x, y + h], [x - w, y]], fill, stroke) }
  function sprite(key: string, x: number, y: number, scale: number, frameIndex = 0): void {
    const frames = atlas?.frames.get(key)
    if (!frames?.length || !atlas) return
    const frame = frames[frameIndex % frames.length]!
    if (!frame.width || !frame.height) return
    ctx!.imageSmoothingEnabled = false
    ctx!.drawImage(atlas.image, frame.x, frame.y, frame.width, frame.height, x + frame.offsetX * scale, y + frame.offsetY * scale, frame.width * scale, frame.height * scale)
  }
  function tree(x: number, y: number, scale: number, n: number): void { sprite(`tree-${Math.floor(n * 7) % 7}`, x, y, scale * 0.48) }
  function rock(x: number, y: number, scale: number, type: Terrain): void {
    sprite('stone-deposit', x, y, scale * 0.75, Math.floor(noise(x, y) * 3))
    if (type !== 'rock') {
      ctx!.fillStyle = type === 'coal' ? '#232d28' : '#c58c59'
      ctx!.beginPath(); ctx!.arc(x, y - 3 * scale, 2 * scale, 0, Math.PI * 2); ctx!.fill()
    }
  }
  function house(x: number, y: number, kind: Kind, time: number, rival = false): void {
    const z = camera.zoom
    for (let layer = 0; layer < (atlas?.frames.get(kind)?.length ?? 0); layer++) sprite(kind, x, y, z * (kind === 'headquarters' ? 0.55 : 0.47), layer)
    if (rival) {
      ctx!.fillStyle = '#cc7355'; ctx!.beginPath(); ctx!.arc(x, y - 80 * z, 3 * z, 0, Math.PI * 2); ctx!.fill()
    }
    if (['smelter', 'smith', 'bakery'].includes(kind)) {
      for (let i = 0; i < 3; i++) {
        const phase = (time / 2 + i / 3) % 1
        ctx!.fillStyle = `rgba(224,220,190,${(1 - phase) * 0.25})`
        ctx!.beginPath(); ctx!.arc(x + (8 + phase * 9) * z, y - (35 + phase * 30) * z, (2 + phase * 4) * z, 0, Math.PI * 2); ctx!.fill()
      }
    }
  }
  const home = (): void => { camera.zoom = Math.max(0.5, Math.min(width / 1280, height / 690)); camera.x = width / 2; camera.y = Math.max(35, (height - 600 * camera.zoom) / 2) }
  function resize(): void {
    const rect = canvas.getBoundingClientRect()
    width = rect.width; height = rect.height; pixelRatio = Math.min(2, devicePixelRatio || 1)
    canvas.width = Math.round(width * pixelRatio); canvas.height = Math.round(height * pixelRatio)
    ctx!.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    home(); signature = ''
  }
  function draw(world: World, cursor: Cursor | null, tool: Kind | null, time: number, reduceMotion: boolean): void {
    if (!atlas) return
    const key = `${world.seed}:${width}:${height}:${camera.x}:${camera.y}:${camera.zoom}`
    ctx!.fillStyle = '#243e37'; ctx!.fillRect(0, 0, width, height)
    if (signature !== key || !background) {
      const z = camera.zoom
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const p = project(x, y, camera), t = terrain(x, y, world.seed), n = noise(x, y), shades = colors[t]
        diamond(p.x, p.y, shades[Math.floor(n * shades.length)]!)
        const textureKey = ['iron', 'coal', 'rock'].includes(t) ? 'rock' : t === 'forest' ? 'grass' : t
        const texture = atlas.frames.get(`terrain-${textureKey}`)?.[0]
        if (texture) {
          const w = 22 * z, h = 11 * z
          ctx!.save(); ctx!.beginPath(); ctx!.moveTo(p.x, p.y - h); ctx!.lineTo(p.x + w, p.y); ctx!.lineTo(p.x, p.y + h); ctx!.lineTo(p.x - w, p.y); ctx!.closePath(); ctx!.clip()
          ctx!.drawImage(atlas.image, texture.x, texture.y, texture.width, texture.height, p.x - w, p.y - h, w * 2, h * 2)
          ctx!.restore()
        }
        if (t === 'forest') { tree(p.x - 5 * z, p.y - 2 * z, z * (0.65 + n * 0.4), n); if (n > 0.6) tree(p.x + 9 * z, p.y + 3 * z, z * 0.7, 1 - n) }
        if (['rock', 'iron', 'coal'].includes(t)) rock(p.x, p.y, z * (0.6 + n * 0.6), t)
        if (t === 'grass' && n > 0.65) { ctx!.fillStyle = '#9bb46c'; ctx!.fillRect(p.x + 3 * z, p.y - 2 * z, 2 * z, z) }
        if (t === 'water' && n > 0.6) { ctx!.strokeStyle = '#9ac3af44'; ctx!.beginPath(); ctx!.moveTo(p.x - 7 * z, p.y); ctx!.lineTo(p.x + 4 * z, p.y); ctx!.stroke() }
      }
      background = canvas.ownerDocument.createElement('canvas'); background.width = canvas.width; background.height = canvas.height; background.getContext('2d')!.drawImage(canvas, 0, 0)
      signature = key
    }
    else ctx!.drawImage(background, 0, 0, width, height)
    // Only border edges are outlined, leaving the landscape readable.
    for (let y = 1; y < SIZE - 1; y++) for (let x = 1; x < SIZE - 1; x++) {
      if (!owned(world, x, y)) continue
      const p = project(x, y, camera), w = 22 * camera.zoom, h = 11 * camera.zoom
      const edges = [[0, -1, -w, 0, 0, -h], [1, 0, 0, -h, w, 0], [0, 1, w, 0, 0, h], [-1, 0, 0, h, -w, 0]]
      ctx!.strokeStyle = '#ecd48d'; ctx!.lineWidth = 1.4
      for (const [dx, dy, ax, ay, bx, by] of edges) if (!owned(world, x + dx!, y + dy!)) { ctx!.beginPath(); ctx!.moveTo(p.x + ax!, p.y + ay!); ctx!.lineTo(p.x + bx!, p.y + by!); ctx!.stroke() }
    }
    const hq = world.buildings[0]!
    for (const b of world.buildings) {
      if (b.kind === 'headquarters') continue
      const from = project(hq.x, hq.y, camera), to = project(b.x, b.y, camera)
      ctx!.strokeStyle = '#b6aa7970'; ctx!.lineWidth = 3 * camera.zoom; ctx!.setLineDash([3 * camera.zoom, 2 * camera.zoom]); ctx!.beginPath(); ctx!.moveTo(from.x, from.y + 5); ctx!.lineTo(to.x, to.y + 5); ctx!.stroke(); ctx!.setLineDash([])
    }
    const ordered = [...world.buildings].sort((a, b) => a.x + a.y - b.x - b.y)
    for (const b of ordered) {
      const p = project(b.x, b.y, camera)
      if (b.built > 0) {
        diamond(p.x, p.y, '#baa071', '#f2d694'); ctx!.strokeStyle = '#715436'; ctx!.lineWidth = 2 * camera.zoom; ctx!.strokeRect(p.x - 10 * camera.zoom, p.y - 14 * camera.zoom, 20 * camera.zoom, 14 * camera.zoom)
      }
      else house(p.x, p.y, b.kind, reduceMotion || !b.enabled ? 0 : time)
      if (b.enabled && b.built === 0 && BUILDINGS[b.kind].seconds > 0) {
        const phase = reduceMotion ? 0.5 : (time / (4 + distance(hq, b) / 2) + b.id / 3) % 1, t = Math.abs(phase * 2 - 1)
        const from = project(hq.x, hq.y, camera)
        const x = from.x + (p.x - from.x) * t, y = from.y + (p.y - from.y) * t + 6 * camera.zoom
        ctx!.fillStyle = '#253c32'; ctx!.beginPath(); ctx!.ellipse(x + 2, y + 2, 3 * camera.zoom, camera.zoom, 0, 0, Math.PI * 2); ctx!.fill()
        const direction = phase < 0.5 ? 0 : 3
        const frame = direction * 12 + (reduceMotion ? 0 : 1 + Math.floor(time * 10) % 11)
        sprite('worker', x, y, camera.zoom * 0.65, frame)
      }
    }
    const enemy = project(23, 10, camera)
    house(enemy.x, enemy.y, 'headquarters', time, true)
    const label = (text: string, x: number, y: number): void => { ctx!.font = '11px ui-sans-serif, system-ui'; ctx!.textAlign = 'center'; ctx!.fillStyle = '#192e29d9'; const size = ctx!.measureText(text).width; ctx!.fillRect(x - size / 2 - 7, y - 11, size + 14, 18); ctx!.fillStyle = '#f0e5c8'; ctx!.fillText(text, x, y + 2) }
    const p = project(9, 13, camera)
    label('Your settlement', p.x, p.y + 30 * camera.zoom)
    label(`Rival stronghold  ${world.enemyHealth}/18`, enemy.x, enemy.y + 30 * camera.zoom)
    if (cursor && cursor.x >= 0 && cursor.y >= 0 && cursor.x < SIZE && cursor.y < SIZE) {
      const p = project(cursor.x, cursor.y, camera), allowed = !tool || !placementError(world, tool, cursor.x, cursor.y)
      diamond(p.x, p.y, allowed ? '#f2df9c55' : '#ce654655', allowed ? '#fff0b5' : '#f6a68a')
      if (tool && allowed) { ctx!.globalAlpha = 0.6; house(p.x, p.y, tool, 0); ctx!.globalAlpha = 1 }
    }
  }
  resize()
  return { camera, resize, draw, home, setAssets(value: Atlas) { atlas = value; signature = '' }, pick: (clientX: number, clientY: number) => { const rect = canvas.getBoundingClientRect(); return unproject(clientX - rect.left, clientY - rect.top, camera) } }
}
