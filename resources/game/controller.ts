import type { BrowserPlatform } from 'craft-native/browser'
import type { Command, Point, Session } from './engine'
import type { Renderer } from './renderer'
import { useAnimationFrame } from '@stacksjs/stx/composables'
import { createBrowserPlatform } from 'craft-native/browser'
import { loadOriginalAssets } from './assets'
import type { Checkpoints } from './checkpoint'
import { createCheckpoints } from './checkpoint'
import type { EconomicAI } from './engine'
import { createSession, economicAI, findStart, generateMap, PUBLISHED_RULES, restore, ROMAN_ENGINEERING, save, SaveError, statistics, stepAI, worldFromOriginal } from './engine'
import { loadOriginalMap } from './maps'
import { createRenderer } from './renderer'

const rules = ROMAN_ENGINEERING
export const PLAYER = 1
// Checkpoints live in two slots plus a head under this prefix; the earlier single-key save is still read.
const SAVE_PREFIX = 'gold-checkpoint'
const LEGACY_SAVE_KEY = 'gold-session'
const PROTOTYPE_KEY = 'campaign'
const MAP_SIZE = 96

/** Building catalog for the control center, grouped as the manual groups the build menu. */
export const catalog = rules.buildings.filter(b => b.id !== 'castle').map(b => ({
  id: b.id, name: b.name, category: b.category,
  cost: Object.entries(b.cost).map(([good, n]) => `${n} ${good}`).join(' + '),
  description: describe(b.id),
}))
export const categories = [...new Set(catalog.map(item => item.category))]
export const goods = rules.goods

function describe(id: string): string {
  const b = rules.buildings.find(r => r.id === id)!, w = b.workflow
  if (b.storage) return `Stores up to ${b.storage.piles} piles of ${b.storage.capacity} goods marked for storage.`
  if (b.residents) return `Houses ${b.residents.count} new settlers, who arrive one at a time.`
  if (b.garrison) return `Claims land within ${b.territory} tiles and holds ${b.garrison.infantry} infantry and ${b.garrison.bowmen} bowmen.`
  if (b.id === 'barracks') return 'Turns carriers into soldiers with the swords, spears and bows delivered here.'
  if (b.territory) return `Claims land within ${b.territory} tiles once completed.`
  if (w.kind === 'harvest') return `A ${b.worker} fetches ${w.object === 'tree' ? 'trees' : 'stone'} within ${w.radius} tiles and returns ${w.output}.`
  if (w.kind === 'plant') return `A ${b.worker} plants saplings within ${w.radius} tiles.`
  if (w.kind === 'cultivate') return `A ${b.worker} sows fields and harvests ripe ${w.output}.`
  if (w.kind === 'extract') return w.food ? `A miner digs ${w.output} from the deposit below. Prefers ${w.food.preferred}.` : `A ${b.worker} brings ${w.output} from nearby water.`
  if (w.kind === 'process') return `Turns ${Object.keys(w.inputs).join(' and ')} into ${Object.keys(w.outputs).join(' and ')}.`
  if (w.kind === 'craft') return `Forges ${b.id === 'weaponsmith' ? 'swords, spears and bows' : w.choices.length > 1 ? 'tools' : w.choices[0]} from iron and coal.`
  return b.name
}

const STATUS: Record<string, string> = {
  'leveling': 'Diggers are levelling the site', 'building': 'Builders are at work', 'suspended': 'Work paused', 'inputs': 'Waiting for supplies', 'output-full': 'Doorstep full',
  'no-resources': 'Nothing left in the working area', 'no-space': 'No room to plant', 'exhausted': 'Deposit exhausted', 'food': 'Miners need food', 'carriers': 'Too few carriers to spare', 'settlers': 'No free settlers',
}
const article = (word: string): string => `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`
export function status(phase: string, shortage: string | null, suspended: boolean, worker: boolean, needsWorker: boolean): string {
  if (suspended) return STATUS.suspended!
  if (phase !== 'active') return shortage?.startsWith('tool:') ? `Needs ${article(shortage.slice(5))} for its crew` : STATUS[phase]!
  if (shortage?.startsWith('tool:')) return `Needs ${article(shortage.slice(5))}`
  if (shortage) return STATUS[shortage] ?? shortage
  if (needsWorker && !worker) return 'Waiting for a worker'
  return needsWorker ? 'Working' : 'Ready'
}

export function snapshot(session: Session | null, selected: number | null, message: string, speed: number, tool: string | null = null, sound = false, ready = false) {
  if (!session) return { army: army(null), carried: 0, needs: [] as string[], objectives: [] as { id: string, text: string, status: string }[], outcome: 'playing', map: 'Generated landscape', ready: false, message, speed, tool, sound, time: '0:00', population: 0, professions: [] as { name: string, count: number }[], goods: [] as { key: string, amount: number, stored: boolean }[], buildings: 0, carrierRatio: 0, selected: null as null | ReturnType<typeof inspect>, events: [] as string[], prototypeKept: false }
  const view = session.view(PLAYER), player = session.state.players[PLAYER - 1]!
  const seconds = Math.floor(session.state.tick / rules.tickRate)
  return {
    ready, message, speed, tool, sound,
    time: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
    population: view.population,
    professions: Object.entries(view.professions).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    goods: rules.goods.map(key => ({ key, amount: view.goods[key] ?? 0, stored: player.settings.stored.includes(key) })),
    buildings: view.buildings.filter(b => b.owner === PLAYER).length,
    carrierRatio: player.settings.carrierRatio,
    selected: selected ? inspect(session, selected) : null,
    events: view.events.slice(-6).reverse().map(e => e.text),
    prototypeKept: false,
    map: mapName(session),
    objectives: view.mission?.objectives ?? [],
    outcome: view.mission?.outcome ?? 'playing',
    ...economy(session),
    army: army(session),
  }
}

/** Soldiers by class and rank, and the barracks orders that make more. */
function army(session: Session | null) {
  const classes = rules.professions.filter(p => p.soldier).map(p => p.id)
  if (!session) return { soldiers: classes.map(name => ({ name, count: 0, queued: 0 })), outside: 0, rank: 1, ranks: rules.military?.ranks ?? 1, automatic: false }
  const player = session.state.players[PLAYER - 1]!, own = [...session.state.settlers.values()].filter(s => s.owner === PLAYER && s.soldier)
  return {
    soldiers: classes.map(name => ({ name, count: own.filter(s => s.profession === name).length, queued: player.settings.recruit?.queue[name] ?? 0 })),
    outside: own.filter(s => !s.inside).length,
    rank: player.settings.rank ?? 1, ranks: rules.military?.ranks ?? 1,
    automatic: player.settings.recruit?.automatic ?? false,
  }
}

/** Figures derived from the world: goods in carriers' hands and the shortages holding buildings back. */
function economy(session: Session): { carried: number, needs: string[] } {
  const stats = statistics(session, PLAYER)
  return {
    carried: Object.values(stats.stock.transit).reduce((a, n) => a + n, 0),
    needs: stats.shortages.map(s => `${rules.buildings.find(b => b.id === s.type)!.name}: ${status('active', s.shortage, false, true, true).toLowerCase()}`).slice(0, 6),
  }
}

function inspect(session: Session, id: number) {
  const b = session.state.buildings.get(id)
  if (!b || b.owner !== PLAYER) return null
  const rule = rules.buildings.find(r => r.id === b.type)!
  const total = Object.values(rule.cost).reduce((a, n) => a + n, 0) || 1
  const worker = session.state.settlers.get(b.worker)
  return {
    id: b.id, type: b.type, name: rule.name, phase: b.phase, suspended: b.suspended, castle: b.type === 'castle',
    status: status(b.phase, b.shortage, b.suspended, !!worker, !!rule.worker),
    progress: b.phase === 'leveling' ? 0 : b.phase === 'building' ? (total - b.workRemaining) / total : 'work' in rule.workflow ? b.cycle / rule.workflow.work : 1,
    worker: worker ? `${worker.profession} #${worker.id}` : rule.worker ? 'none' : 'not needed',
    stocks: [...session.state.stacks.values()].filter(s => s.building === b.id).map(s => ({ role: s.role, good: s.good, amount: s.amount, capacity: s.capacity })),
    garrison: rule.garrison ? `${session.view(PLAYER).buildings.find(v => v.id === b.id)?.garrison ?? 0} of ${rule.garrison.infantry + rule.garrison.bowmen} soldiers inside` : null,
    description: describe(b.type),
  }
}
export type Snapshot = ReturnType<typeof snapshot>
export type Game = ReturnType<typeof mountGame>

export type Landscape = 'generated' | 'tutorial' | 'rival'
export const mapName = (session: Session | null): string => session?.identity.content.id.startsWith('demo:') ? 'Original tutorial map' : session?.identity.content.id.startsWith('rival') ? 'Computer rival' : 'Generated landscape'
const RIVAL_SIZE = 128

/** Two Roman settlements on a wider generated landscape; the second is the economic computer player. */
export function rivalSession(seed: number): Session {
  const map = generateMap(rules, RIVAL_SIZE, RIVAL_SIZE, seed)
  const west = findStart(rules, map, { x: 34, y: 64 }, 10), east = findStart(rules, map, { x: 94, y: 64 }, 10)
  if (!west || !east || Math.abs(west.x - east.x) < 40) throw new Error('This landscape has no room for two settlements. Start another one.')
  return createSession({ rules, map, seed, players: [{ name: 'Rome', civilization: 'roman', start: west }, { name: 'Computer', civilization: 'roman', controller: 'computer', start: east }], content: { id: `rival-${RIVAL_SIZE}`, digest: `seed:${seed}` } })
}

/** A Roman start on the Amazons demo's original T1 tutorial map. Its missions and AI are not yet played. */
export async function tutorialSession(seed: number): Promise<Session> {
  const asset = await loadOriginalMap('t1')
  const world = worldFromOriginal(rules, asset.input)
  if (!world.players.length) throw new Error('The original tutorial map has no Roman player.')
  return createSession({ rules, map: world.map, seed, players: world.players.slice(0, 1), piles: world.piles, content: { id: `demo:${asset.source.path}`, digest: asset.source.sha256 } })
}

/** A fresh development settlement on a generated landscape. Not an original map or campaign. */
export function newSession(seed: number): Session {
  const map = generateMap(rules, MAP_SIZE, MAP_SIZE, seed)
  // The castle's reference footprint and protected ring reach nine tiles from its origin.
  const start = findStart(rules, map, { x: MAP_SIZE / 2, y: MAP_SIZE / 2 }, 10)
  if (!start) throw new Error('This landscape has no room for a settlement. Start another one.')
  return createSession({ rules, map, seed, players: [{ name: 'Rome', civilization: 'roman', start }], content: { id: `generated-${MAP_SIZE}`, digest: `seed:${seed}` } })
}

export function mountGame(canvas: HTMLCanvasElement, update: (value: Snapshot) => void, reduceMotion: () => boolean) {
  let session: Session | null = null, selected: number | null = null, tool: string | null = null, cursor: Point | null = null
  let speed = 1, message = 'Preparing original graphics and your settlement...', disposed = false, sound = false, soundPending = false
  let platform: BrowserPlatform | null = null, assetsReady = false, ready = false, elapsed = 0, sinceUpdate = 0, sinceSave = 0, accumulator = 0, seq = 0
  let prototypeKept = false
  // Computer players act through the same command queue as the person playing.
  let computers: { ai: EconomicAI, sequence: { next: number } }[] = []
  const renderer: Renderer = createRenderer(canvas), lifetime = new AbortController()
  const emit = (): void => { const value = snapshot(session, selected, message, speed, tool, sound, ready && assetsReady); value.prototypeKept = prototypeKept; update(value) }
  const report = (text: string): void => { message = text; emit() }
  // The castle on generated starts, otherwise the first building or settler an original map gives the player.
  const castle = (): Point | null => {
    if (!session) return null
    const own = [...session.state.buildings.values()].filter(b => b.owner === PLAYER)
    const b = own.find(b => b.type === 'castle') ?? own[0]
    if (b) return { x: b.x, y: b.y }
    const s = [...session.state.settlers.values()].find(s => s.owner === PLAYER)
    return s ? { x: s.x, y: s.y } : null
  }
  const center = (): void => { const c = castle(); if (c && session) renderer.home(c, session.state.map.elevation[c.y * session.state.map.width + c.x]) }
  const adopt = (next: Session): void => {
    session?.dispose(); session = next; selected = null; tool = null; accumulator = 0
    const nextSeq = (player: number): number => Math.max(0, ...next.state.pending.filter(c => c.player === player).map(c => c.seq + 1), ...next.state.results.filter(r => r.player === player).map(r => r.seq + 1))
    seq = nextSeq(PLAYER)
    computers = next.state.players.filter(p => p.controller === 'computer').map(p => ({ ai: economicAI(p.id), sequence: { next: nextSeq(p.id) } }))
    renderer.invalidate(); center(); cursor = castle()
  }
  const finishBoot = (): void => {
    if (ready && assetsReady && message.startsWith('Preparing')) message = 'Choose a building, then click open ground inside your border.'
    emit()
  }
  void loadOriginalAssets().then(atlas => { if (disposed) return; renderer.setAssets(atlas); assetsReady = true; finishBoot() }).catch(error => { if (!disposed) report(error instanceof Error ? error.message : 'Could not load original game assets.') })

  const send = (type: string, fields: Record<string, unknown>): string | null => {
    if (!session) return 'The settlement is not ready.'
    const command = { tick: session.state.tick, player: PLAYER, seq: seq++, type, ...fields } as Command
    const rejected = session.enqueue(command)
    if (rejected) return rejected.reason ?? 'That order was refused.'
    // Orders take effect on the next simulation tick, even while paused.
    session.advance(1)
    const result = session.state.results.find(r => r.seq === command.seq && r.player === PLAYER)
    return result?.ok ? null : result?.reason ?? 'That order was refused.'
  }
  let checkpoints: Checkpoints | null = null
  const persist = async (): Promise<void> => {
    if (!checkpoints || !ready || !session) return
    const result = await checkpoints.save(JSON.stringify(save(session)))
    if (disposed) return
    // Success is reported only once the checkpoint is verified and its head stored.
    if (result.ok) report('Settlement saved on this device.')
    else if (result.reason !== 'superseded') report(`Save failed. ${result.message} Your settlement is still running.`)
  }
  const load = async (): Promise<void> => {
    if (!ready || !checkpoints) { report('Device storage is not ready.'); return }
    try {
      const saved = await checkpoints.load()
      if (!saved) { report('There is no saved settlement on this device yet.'); return }
      const next = restore(saved, PUBLISHED_RULES)
      if (disposed) return
      adopt(next); report('Saved settlement restored.')
    }
    catch (error) { if (!disposed) report(error instanceof SaveError ? error.message : 'Could not restore the settlement.') }
  }
  void createBrowserPlatform({ namespace: 'the-settlers-iii-remake' }).then(async host => {
    if (disposed) { host.dispose(); return }
    platform = host
    checkpoints = createCheckpoints({
      get: (key, signal) => host.call('Storage', 'get', [key], signal),
      set: async (key, value, signal) => { await host.call('Storage', 'set', [key, value], signal) },
    }, SAVE_PREFIX, LEGACY_SAVE_KEY)
    try {
      const saved = await checkpoints.load()
      // The Riverlands prototype save stays untouched under its own key; it is never reinterpreted.
      prototypeKept = !!(await host.call('Storage', 'get', [PROTOTYPE_KEY], lifetime.signal))
      if (saved && !disposed) { adopt(restore(saved, PUBLISHED_RULES)); message = 'Welcome back. Your settlement has been restored.' }
    }
    catch (error) { if (!disposed) message = error instanceof SaveError ? `${error.message} A new settlement was started.` : 'Could not read the saved settlement. A new settlement was started.' }
    if (disposed) return
    if (!session) { try { adopt(newSession(1 + Math.floor(Math.random() * 1_000_000))) } catch (error) { report(error instanceof Error ? error.message : 'Could not start a settlement.'); return } }
    ready = true
    host.emit((type, payload) => { if (type === 'APP_STATE' && (payload as { state: string }).state === 'background') void persist() })
    finishBoot()
  }).catch(() => {
    if (disposed) return
    if (!session) { try { adopt(newSession(1 + Math.floor(Math.random() * 1_000_000))) } catch (error) { report(error instanceof Error ? error.message : 'Could not start a settlement.'); return } }
    ready = true; report('Device storage is unavailable. You can play, but this settlement cannot be saved.')
  })
  const play = (name: string): void => { if (sound && platform) void platform.call('Audio', 'play', [name, `/assets/settlers-original/${name}.wav`, { volume: 0.3 }], lifetime.signal).catch(() => {}) }

  const act = (): void => {
    if (!cursor || !session) return
    if (tool === 'march') {
      // Soldiers standing outside obey first; otherwise garrisons send all but their last soldier.
      const own = [...session.state.settlers.values()].filter(s => s.owner === PLAYER && s.soldier)
      const outside = own.filter(s => !s.inside), soldiers = (outside.length ? outside : own).map(s => s.id)
      if (!soldiers.length) { report('You have no soldiers yet. Build a barracks and recruit some.'); return }
      const map = session.state.map, target = session.state.buildings.get(session.context.index.buildingAt[cursor.y * map.width + cursor.x]!)
      const enemy = target && target.owner !== PLAYER && rules.buildings.find(r => r.id === target.type)?.garrison
      const error = enemy ? send('attack', { soldiers, building: target.id }) : send('move-soldiers', { soldiers, x: cursor.x, y: cursor.y })
      report(error ?? (enemy ? 'Your soldiers march to attack.' : 'Your soldiers march there and hold the position.'))
      return
    }
    if (tool === 'pioneer' || tool === 'geologist') {
      const error = send('specialists', { profession: tool, x: cursor.x, y: cursor.y, count: 1 })
      report(error ?? `A ${tool} is on the way.`)
      return
    }
    if (tool) {
      const error = send('build', { building: tool, x: cursor.x, y: cursor.y })
      const name = rules.buildings.find(b => b.id === tool)?.name ?? tool
      report(error ?? `${name} site placed. Diggers and builders will start when they are free.`)
      if (!error) { play('build'); selected = Math.max(...[...session.state.buildings.values()].filter(b => b.owner === PLAYER).map(b => b.id)) }
      return
    }
    const map = session.state.map, t = cursor.y * map.width + cursor.x
    const id = session.context.index.buildingAt[t] || [...session.state.buildings.values()].find(b => b.owner === PLAYER && b.x + (rules.buildings.find(r => r.id === b.type)!.door[0]) === cursor!.x && b.y + (rules.buildings.find(r => r.id === b.type)!.door[1]) === cursor!.y)?.id || 0
    selected = id && session.state.buildings.get(id)?.owner === PLAYER ? id : null
    emit()
  }

  let pointer: { x: number, y: number, cameraX: number, cameraY: number, moved: boolean } | null = null
  const on = <K extends keyof HTMLElementEventMap>(name: K, handler: (event: HTMLElementEventMap[K]) => void, options: AddEventListenerOptions = {}): void => canvas.addEventListener(name, handler as EventListener, { ...options, signal: lifetime.signal })
  on('pointerdown', event => { if (event.button !== 0) return; canvas.focus(); pointer = { x: event.clientX, y: event.clientY, cameraX: renderer.camera.x, cameraY: renderer.camera.y, moved: false }; canvas.setPointerCapture(event.pointerId) })
  on('pointermove', event => {
    if (session) cursor = renderer.pick(session, event.clientX, event.clientY) ?? cursor
    if (pointer) {
      const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y
      if (Math.hypot(dx, dy) > 6) pointer.moved = true
      if (pointer.moved) { renderer.camera.x = pointer.cameraX + dx; renderer.camera.y = pointer.cameraY + dy }
    }
  })
  on('pointerup', event => {
    if (pointer && !pointer.moved && ready && assetsReady && session) {
      cursor = renderer.pick(session, event.clientX, event.clientY)
      const placing = tool
      act()
      if (placing && !event.shiftKey && tool === placing && message.includes('placed')) { tool = null; emit() }
    }
    pointer = null
  })
  on('pointercancel', () => { pointer = null })
  on('wheel', event => {
    event.preventDefault()
    const bounds = canvas.getBoundingClientRect(), x = event.clientX - bounds.left, y = event.clientY - bounds.top, old = renderer.camera.zoom
    renderer.camera.zoom = Math.max(0.5, Math.min(3, old * Math.exp(-event.deltaY * 0.001)))
    const ratio = renderer.camera.zoom / old
    renderer.camera.x = x - (x - renderer.camera.x) * ratio; renderer.camera.y = y - (y - renderer.camera.y) * ratio
  }, { passive: false })
  on('keydown', event => {
    if (!session) return
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) event.preventDefault()
    const map = session.state.map
    cursor ??= castle() ?? { x: 0, y: 0 }
    if (event.key === 'ArrowUp') cursor = { x: cursor.x, y: Math.max(0, cursor.y - 1) }
    if (event.key === 'ArrowDown') cursor = { x: cursor.x, y: Math.min(map.height - 1, cursor.y + 1) }
    if (event.key === 'ArrowLeft') cursor = { x: Math.max(0, cursor.x - 1), y: cursor.y }
    if (event.key === 'ArrowRight') cursor = { x: Math.min(map.width - 1, cursor.x + 1), y: cursor.y }
    if (event.key === 'Enter' && ready && assetsReady) act()
    if (event.key === ' ') speed = speed === 0 ? 1 : 0
    if (event.key === 'Escape') { tool = null; selected = null }
    if (event.key.toLowerCase() === 'h') center()
    if (event.key.toLowerCase() === 's') void persist()
    canvas.setAttribute('aria-label', `Settlement map. Tile ${cursor.x}, ${cursor.y}. ${tool ? `Press Enter to place ${rules.buildings.find(b => b.id === tool)?.name ?? `a ${tool}`}.` : 'Press Enter to inspect.'}`)
    emit()
  })
  const resize = new ResizeObserver(() => { renderer.resize() }); resize.observe(canvas)
  const clock = useAnimationFrame(delta => {
    if (speed > 0) elapsed += delta / 1000
    if (session && ready && assetsReady && speed > 0) {
      // Fixed simulation ticks make the economy independent of the display refresh rate.
      sinceUpdate += delta; sinceSave += delta
      accumulator = Math.min(accumulator + delta / 1000 * speed * rules.tickRate, rules.tickRate * 2)
      const ticks = Math.floor(accumulator)
      if (ticks > 0) {
        if (!computers.length) session.advance(ticks)
        else for (let i = 0; i < ticks; i++) { for (const c of computers) stepAI(session, c.ai, c.sequence); session.advance(1) }
        accumulator -= ticks
      }
      if (sinceUpdate >= 250) { sinceUpdate = 0; emit() }
      if (sinceSave >= 30000) { sinceSave = 0; void persist() }
    }
    if (session) {
      const placement = tool && cursor && session.context.building.has(tool) ? session.placement(PLAYER, tool, cursor.x, cursor.y) : null
      renderer.draw(session, { player: PLAYER, cursor, tool, selected, time: elapsed, reduceMotion: reduceMotion(), placement })
    }
  })
  emit()
  return {
    choose(kind: string | null) {
      if (!ready || !session) return
      tool = kind
      if (kind && session.context.building.has(kind)) {
        // Keyboard players start from the nearest valid site to the castle.
        const c = castle()!
        for (let r = 0; r < 14 && c; r++) {
          const found = [...Array.from({ length: (2 * r + 1) ** 2 }).keys()].map(i => ({ x: c.x - r + (i % (2 * r + 1)), y: c.y - r + Math.floor(i / (2 * r + 1)) })).find(p => !session!.placement(PLAYER, kind, p.x, p.y))
          if (found) { cursor = found; break }
        }
        report(`${describe(kind)} Choose open ground inside your border.`)
      }
      else if (kind === 'march') report('Click open ground to send your soldiers there, or an enemy tower or castle to attack it.')
      else if (kind) report(`Choose where the ${kind} should go.`)
      else report('Select a building to inspect it.')
      canvas.focus()
    },
    async toggleSound() {
      if (!platform || !ready || soundPending || disposed) return
      soundPending = true
      try {
        if (sound) { await platform.call('Audio', 'stopAll', [], lifetime.signal); sound = false }
        else { await platform.call('Audio', 'play', ['ambient', '/assets/settlers-original/birds.wav', { loop: true, volume: 0.12 }], lifetime.signal); sound = true }
        if (!disposed) emit()
      }
      catch { if (!disposed) report('Your browser could not enable audio. You can continue playing.') }
      finally { soundPending = false }
    },
    speed(value: number) { speed = value; emit() },
    home: center,
    save: persist, load,
    async restart(landscape: Landscape = 'generated') {
      if (!ready) return
      const seed = 1 + Math.floor(Math.random() * 1_000_000)
      try {
        const next = landscape === 'tutorial' ? await tutorialSession(seed) : landscape === 'rival' ? rivalSession(seed) : newSession(seed)
        if (disposed) return
        adopt(next); speed = 1
        report(landscape === 'tutorial' ? 'The original tutorial map. Your Roman settlers and their tower are ready.' : landscape === 'rival' ? 'A computer settlement grows to the east, building by the same rules. You only see it where your settlers can.' : 'A new landscape. Your settlers have arrived.')
        void persist()
      }
      catch (error) { if (!disposed) report(error instanceof Error ? error.message : 'Could not open that map.') }
    },
    toggle() { if (!session || !selected) return; const b = session.state.buildings.get(selected); if (!b) return; report(send('suspend', { building: b.id, suspended: !b.suspended }) ?? (b.suspended ? 'Work paused.' : 'Work resumed.')) },
    demolish() { if (!session || !selected) return; const error = send('demolish', { building: selected }); if (!error) selected = null; report(error ?? 'Building torn down. Half of its materials lie on the ground.'); void persist() },
    store(good: string) {
      if (!session) return
      const stored = session.state.players[PLAYER - 1]!.settings.stored
      const next = stored.includes(good) ? stored.filter(g => g !== good) : [...stored, good]
      report(send('settings', { settings: { stored: next } }) ?? (next.includes(good) ? `Carriers will take ${good} to storage areas.` : `${good} will stay at the doorsteps.`))
    },
    recruit(profession: string) {
      if (!session) return
      report(send('recruit', { profession, count: 1 }) ?? `A ${profession} will be recruited when a barracks has the weapon and a carrier is free.`)
    },
    recruitAutomatic() {
      if (!session) return
      const next = !session.state.players[PLAYER - 1]!.settings.recruit?.automatic
      report(send('settings', { settings: { recruitAutomatic: next } }) ?? (next ? 'Barracks recruit whenever weapons arrive.' : 'Barracks recruit only the soldiers you order.'))
    },
    rank(delta: number) {
      if (!session) return
      const value = Math.max(1, Math.min(rules.military?.ranks ?? 1, (session.state.players[PLAYER - 1]!.settings.rank ?? 1) + delta))
      report(send('settings', { settings: { rank: value } }) ?? `New soldiers join at rank ${value}. Soldiers already serving keep their rank.`)
    },
    carrierRatio(delta: number) {
      if (!session) return
      const value = Math.max(0, Math.min(100, session.state.players[PLAYER - 1]!.settings.carrierRatio + delta))
      report(send('settings', { settings: { carrierRatio: value } }) ?? `At least ${value}% of settlers stay carriers.`)
    },
    dispose() {
      if (disposed) return
      // A last checkpoint is written before storage is released; the session itself stops now.
      const final = checkpoints && session && ready ? checkpoints.save(JSON.stringify(save(session))) : Promise.resolve()
      disposed = true; clock.stop(); resize.disconnect(); session?.dispose()
      void final.finally(() => { checkpoints?.dispose(); lifetime.abort(); platform?.dispose() })
    },
  }
}
