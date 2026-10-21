import type { BrowserPlatform } from 'craft-native/browser'
import type { Cursor } from './renderer'
import type { Kind, World } from './simulation'
import { useAnimationFrame } from '@stacksjs/stx/composables'
import { createBrowserPlatform } from 'craft-native/browser'
import { loadOriginalAssets } from './assets'
import { createRenderer } from './renderer'
import { attack, BUILDINGS, createWorld, demolish, employed, place, population, RESOURCES, restore, status, step } from './simulation'

export const catalog = Object.entries(BUILDINGS).filter(([kind]) => kind !== 'headquarters').map(([kind, definition]) => ({ kind: kind as Kind, ...definition, costLabel: Object.entries(definition.cost).map(([key, n]) => `${n} ${key}`).join(' + ') }))
export function snapshot(world: World, selected: number | null, message: string, speed: number, tool: Kind | null = null, sound = false, ready = false) {
  const b = world.buildings.find(b => b.id === selected)
  return {
    tool, sound, ready, resources: RESOURCES.map(key => ({ key, amount: Math.floor(world.stock[key]) })),
    settlers: population(world), employed: employed(world), soldiers: world.soldiers, enemy: world.enemy, health: world.health,
    day: Math.floor(world.tick / 120) + 1, time: `${Math.floor(world.tick / 60)}:${Math.floor(world.tick % 60).toString().padStart(2, '0')}`,
    raidIn: Math.max(0, Math.ceil(world.nextRaid - world.tick)), result: world.result, message, speed,
    selected: b ? { ...b, name: BUILDINGS[b.kind].name, status: status(world, b), description: BUILDINGS[b.kind].description, progress: b.built > 0 ? 1 - b.built / BUILDINGS[b.kind].build : BUILDINGS[b.kind].seconds ? b.progress / BUILDINGS[b.kind].seconds : 1 } : null,
    buildings: world.buildings.length, log: world.log.slice(0, 4),
    objectives: [
      { text: 'Establish timber and stone production', done: ['woodcutter', 'sawmill', 'quarry'].every(kind => world.buildings.some(b => b.kind === kind && b.built === 0)) },
      { text: 'Bake bread and forge your first sword', done: world.buildings.some(b => b.kind === 'smith' && b.cycles > 0) && world.buildings.some(b => b.kind === 'bakery' && b.cycles > 0) },
      { text: 'Claim the crossing with a guard tower', done: world.buildings.some(b => b.kind === 'tower' && b.x >= 15 && b.built === 0) },
      { text: 'Capture the rival stronghold', done: world.result === 'won' },
    ],
  }
}
export type Snapshot = ReturnType<typeof snapshot>
export type Game = ReturnType<typeof mountGame>

export function mountGame(canvas: HTMLCanvasElement, update: (value: Snapshot) => void, reduceMotion: () => boolean) {
  let world = createWorld(), selected: number | null = 1, tool: Kind | null = null, cursor: Cursor | null = null
  let speed = 1, message = 'Preparing original graphics and your saved campaign...', disposed = false
  let assetsReady = false, sound = false, soundPending = false
  let platform: BrowserPlatform | null = null, elapsed = 0, sinceUpdate = 0, sinceSave = 0, accumulator = 0, ready = false
  const renderer = createRenderer(canvas), lifetime = new AbortController()
  void loadOriginalAssets().then(assets => { if (disposed) return; renderer.setAssets(assets); assetsReady = true; finishBoot() }).catch(error => { if (!disposed) report(error instanceof Error ? error.message : 'Could not load original game assets.') })
  const emit = (): void => update(snapshot(world, selected, message, speed, tool, sound, ready && assetsReady))
  const report = (text: string): void => { message = text; emit() }
  const finishBoot = (): void => {
    if (ready && assetsReady && message === 'Preparing original graphics and your saved campaign...') message = 'Choose a building, then click clear ground within your golden border.'
    emit()
  }
  const persist = async (): Promise<void> => {
    if (!platform || !ready) return
    try {
      await platform.call('Storage', 'set', ['campaign', structuredClone(world)], lifetime.signal)
      if (!disposed) report('Campaign saved on this device.') }
      catch { if (!disposed) report('Save failed. Device storage may be full or unavailable. Your campaign is still running.') }
    }
    const load = async (): Promise<void> => {
      if (!ready || !platform) { report('Device storage is not ready.'); return }
      try {
        const next = restore(await platform.call('Storage', 'get', ['campaign'], lifetime.signal))
        if (disposed) return
        world = next; accumulator = 0; selected = 1; report('Saved campaign restored.'); renderer.home()
      }
      catch (error) { if (!disposed) report(error instanceof Error ? error.message : 'Could not restore the campaign.') }
    }
    void createBrowserPlatform({ namespace: 'the-settlers-iii-remake' }).then(async host => {
      if (disposed) { host.dispose(); return }
      platform = host
      try {
        const saved = await host.call('Storage', 'get', ['campaign'], lifetime.signal)
        if (saved && !disposed) { world = restore(saved); report('Welcome back. Your campaign has been restored.') }
      }
      catch (error) { if (!disposed) report(error instanceof Error ? error.message : 'Could not read saved campaign.') }
      if (disposed) return
      ready = true
      host.emit((type, payload) => { if (type === 'APP_STATE' && (payload as { state: string }).state === 'background') void persist() })
      finishBoot()
    }).catch(() => { if (disposed) return; ready = true; report('Device storage is unavailable. You can play, but this campaign cannot be saved.') })
    const play = (name: string): void => { if (sound && platform) void platform.call('Audio', 'play', [name, `/assets/settlers-original/${name}.wav`, { volume: 0.3 }], lifetime.signal).catch(() => {}) }
    const chooseTile = (): boolean => {
      if (!cursor) return false
      if (tool) {
        const error = place(world, tool, cursor.x, cursor.y)
        report(error ?? `${BUILDINGS[tool].name} commissioned. Hold Shift while placing to keep building.`)
        if (!error) { play('build'); selected = world.buildings.at(-1)!.id; emit() }
        return !error
      }
      else { selected = world.buildings.find(b => b.x === cursor!.x && b.y === cursor!.y)?.id ?? null; emit() }
      return false
    }
    let pointer: { x: number, y: number, cameraX: number, cameraY: number, moved: boolean } | null = null
    const on = <K extends keyof HTMLElementEventMap>(name: K, handler: (event: HTMLElementEventMap[K]) => void, options: AddEventListenerOptions = {}): void => canvas.addEventListener(name, handler as EventListener, { ...options, signal: lifetime.signal })
    on('pointerdown', event => { if (event.button !== 0) return; canvas.focus(); pointer = { x: event.clientX, y: event.clientY, cameraX: renderer.camera.x, cameraY: renderer.camera.y, moved: false }; canvas.setPointerCapture(event.pointerId) })
    on('pointermove', event => {
      cursor = renderer.pick(event.clientX, event.clientY)
      if (pointer) {
        const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y
        if (Math.hypot(dx, dy) > 6) pointer.moved = true
        if (pointer.moved) { renderer.camera.x = pointer.cameraX + dx; renderer.camera.y = pointer.cameraY + dy }
      }
    })
    on('pointerup', event => { if (pointer && !pointer.moved && ready && assetsReady) { cursor = renderer.pick(event.clientX, event.clientY); const placed = chooseTile(); if (placed && tool && !event.shiftKey) { tool = null; emit() } }; pointer = null })
    on('pointercancel', () => { pointer = null })
    on('pointerleave', () => { if (!pointer) cursor = null })
    on('wheel', event => {
      event.preventDefault()
      const bounds = canvas.getBoundingClientRect(), x = event.clientX - bounds.left, y = event.clientY - bounds.top, old = renderer.camera.zoom
      renderer.camera.zoom = Math.max(0.4, Math.min(2.8, old * Math.exp(-event.deltaY * 0.001)))
      const ratio = renderer.camera.zoom / old
      renderer.camera.x = x - (x - renderer.camera.x) * ratio; renderer.camera.y = y - (y - renderer.camera.y) * ratio
    }, { passive: false })
    on('keydown', event => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) event.preventDefault()
      cursor ??= { x: 9, y: 13 }
      if (event.key === 'ArrowUp') cursor.y = Math.max(1, cursor.y - 1)
      if (event.key === 'ArrowDown') cursor.y = Math.min(26, cursor.y + 1)
      if (event.key === 'ArrowLeft') cursor.x = Math.max(1, cursor.x - 1)
      if (event.key === 'ArrowRight') cursor.x = Math.min(26, cursor.x + 1)
      if (event.key === 'Enter' && ready && assetsReady) chooseTile()
      if (event.key === ' ') speed = speed === 0 ? 1 : 0
      if (event.key === 'Escape') { tool = null; selected = null }
      if (event.key.toLowerCase() === 'h') renderer.home()
      if (event.key.toLowerCase() === 's') void persist()
      canvas.setAttribute('aria-label', `Island map. Tile ${cursor.x}, ${cursor.y}. ${tool ? `Place ${BUILDINGS[tool].name} with Enter.` : 'Press Enter to inspect.'}`)
      emit()
    })
    const resize = new ResizeObserver(() => renderer.resize()); resize.observe(canvas)
    const clock = useAnimationFrame(delta => {
      if (speed > 0) elapsed += delta / 1000
      if (ready && assetsReady && speed > 0) {
        // Fixed simulation steps make production independent of refresh rate.
        sinceUpdate += delta; sinceSave += delta
        accumulator += delta / 1000 * speed
        while (accumulator >= 0.05) { step(world, 0.05); accumulator -= 0.05 }
        if (sinceUpdate >= 250) { sinceUpdate = 0; emit() }
        if (sinceSave >= 30000) { sinceSave = 0; void persist() }
      }
      renderer.draw(world, cursor, tool, elapsed, reduceMotion())
    })
    emit()
    return {
      choose(kind: Kind | null) { if (!ready) return; tool = kind; report(kind ? `${BUILDINGS[kind].description} Choose a clear tile inside your border.` : 'Select a building to inspect it.'); canvas.focus() },
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
      home: renderer.home,
      save: persist, load,
      restart() { if (!ready) return; accumulator = 0; world = createWorld(world.seed + 1); selected = 1; tool = null; speed = 1; renderer.home(); report('A fresh island. Your new campaign has begun.'); void persist() },
      attack() { if (!ready) return; const error = attack(world); report(error ?? world.log[0]!); void persist() },
      toggle() { if (!ready) return; const b = world.buildings.find(b => b.id === selected); if (b) { b.enabled = !b.enabled; emit() } },
      demolish() { if (!ready) return; if (selected) demolish(world, selected); selected = null; emit(); void persist() },
      dispose() {
        if (disposed) return
        void persist()
        disposed = true; clock.stop(); resize.disconnect()
        lifetime.abort(); platform?.dispose()
      },
    }
  }
