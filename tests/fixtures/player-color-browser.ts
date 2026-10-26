import type { Atlas, AtlasFrame } from '../../resources/game/assets'
import { loadOriginalAssets } from '../../resources/game/assets'
import { createSession, describeMap, distance, PUBLISHED_RULES, restore, ROMAN_ENGINEERING as rules, save } from '../../resources/game/engine'
import { playerSlotsForContent, validatePlayerSlotCatalog } from '../../resources/game/player-colors'
import { createRenderer } from '../../resources/game/renderer'
import { mountGame } from '../../resources/game/controller'
import { createCheckpoints } from '../../resources/game/checkpoint'
import { createBrowserPlatform } from 'craft-native/browser'

// Authored production-renderer fixture, not a human-input playthrough. Public
// setup, commands, views and saves exercise color, fog and ownership contracts.
const result = document.querySelector('#result')!
try {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas')!, renderer = createRenderer(canvas), atlas = await loadOriginalAssets()
  renderer.setAssets(atlas)
  const session = createSession({ rules, seed: 1, map: describeMap(rules, { width: 32, height: 32, base: 'grass', features: [] }), players: [
    { name: 'Red', civilization: 'roman', start: { x: 16, y: 16 }, scenario: { buildings: [], settlers: [{ profession: 'geologist', x: 16, y: 16 }] } },
    { name: 'Blue', civilization: 'roman', start: { x: 20, y: 16 }, scenario: { buildings: [], settlers: [{ profession: 'geologist', x: 20, y: 16 }] } },
  ] })
  const before = session.checksum(), saved = save(session)
  const drawOptions = { player: 1, cursor: null, tool: null, selected: null, time: 0, reduceMotion: true, placement: null }
  renderer.home({ x: 16, y: 16 })
  const variants = await fetch('/expected.json').then(response => response.json()) as { slots: number[], samples: { owner: number, x: number, y: number, rgb: number[] }[] }[]
  const context = canvas.getContext('2d')!, ratio = canvas.width / canvas.getBoundingClientRect().width
  const pixel = (x: number, y: number): number[] => [...context.getImageData(Math.floor((x + 0.5) * ratio), Math.floor((y + 0.5) * ratio), 1, 1).data].slice(0, 3)
  const check = (samples: typeof variants[number]['samples']): void => {
    for (const sample of samples) {
      const origin = renderer.screen({ x: sample.owner === 1 ? 128 : 192, y: 144 }), actual = pixel(origin.x + sample.x, origin.y + sample.y)
      if (actual.join() !== sample.rgb.join()) throw new Error(`Player ${sample.owner} pixel ${sample.x},${sample.y}: ${actual} instead of ${sample.rgb}`)
    }
  }
  for (const variant of variants) {
    const content = { id: 'demo:renderer-fixture', digest: 'a'.repeat(64) }
    const slots = playerSlotsForContent(content, 2, validatePlayerSlotCatalog([{ ...content, slots: variant.slots }]))
    renderer.setPlayerSlots(slots); renderer.draw(session, drawOptions); check(variant.samples)
    if (session.checksum() !== before) throw new Error('Drawing changed simulation state')
  }
  const warm = renderer.tintedFrameCount()
  renderer.draw(session, drawOptions)
  if (renderer.tintedFrameCount() !== warm) throw new Error('A repeated frame duplicated clothing textures')

  // Move away through an ordinary command; the former enemy position stays
  // explored but its settler must no longer be drawn through fog.
  session.enqueue({ tick: session.state.tick, player: 1, seq: 0, type: 'specialists', profession: 'geologist', x: 3, y: 3, count: 1 })
  session.advance(1000)
  if (session.view(1).settlers.some(s => s.owner === 2)) throw new Error('Fixture did not conceal the foreign settler')
  renderer.setPlayerSlots([0, 1]); renderer.draw(session, drawOptions)
  const blue = variants[0]!.samples.find(sample => sample.owner === 2 && sample.rgb[2]! > 150 && sample.rgb[0]! < 20)!, enemy = renderer.screen({ x: 192, y: 144 })
  if (pixel(enemy.x + blue.x, enemy.y + blue.y).join() === blue.rgb.join()) throw new Error('Foreign clothing remained visible through fog')
  const restored = restore(JSON.parse(JSON.stringify(saved)), PUBLISHED_RULES)
  renderer.draw(restored, drawOptions); check(variants[0]!.samples)
  if (restored.checksum() !== before) throw new Error('Palette mapping changed the restored checksum')

  // Authored two-pixel layers prove opaque body precedence and a torso that
  // extends outside the body rectangle. No replacement media enters the game.
  const sheet = document.createElement('canvas'); sheet.width = 3; sheet.height = 1
  sheet.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray([0, 255, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255]), 3, 1), 0, 0)
  const image = new Image(); image.src = sheet.toDataURL(); await image.decode()
  const body: AtlasFrame = { key: 'geologist', frame: 0, x: 0, y: 0, width: 1, height: 1, offsetX: 0, offsetY: 0, torso: 'torso:geologist' }
  const mask: AtlasFrame = { key: 'torso:geologist', frame: 0, x: 1, y: 0, width: 2, height: 1, offsetX: -1, offsetY: 0 }
  const authored: Atlas = { image, frames: new Map([[body.key, [body]], [mask.key, [mask]]]), playerSlots: [] }
  renderer.setAssets(authored); renderer.draw(restored, drawOptions)
  const origin = renderer.screen({ x: 128, y: 144 })
  if (pixel(origin.x, origin.y).join() !== '0,255,0' || pixel(origin.x - 1, origin.y).join() !== '247,16,0') throw new Error('Body precedence or signed torso anchor was lost')
  authored.frames.set(body.key, [{ ...body, torso: null }]); authored.frames.delete(mask.key)
  renderer.setAssets(authored); renderer.draw(restored, drawOptions)
  if (pixel(origin.x, origin.y).join() !== '0,255,0' || renderer.tintedFrameCount() !== 0) throw new Error('Missing clothing recolored the body or allocated a fake layer')
  const unchanged = document.createElement('canvas'); unchanged.width = 3; unchanged.height = 1
  unchanged.getContext('2d')!.drawImage(authored.image, 0, 0)
  if ([...unchanged.getContext('2d')!.getImageData(1, 0, 1, 1).data].join() !== '255,255,255,255') throw new Error('Tinting modified the source mask')

  // Twenty actual public-session actors surveying together produce more than
  // 512 distinct palette/frame pairs without mutating session internals.
  const points = [{ x: 16, y: 16 }]
  for (let y = 13; y <= 19; y++) for (let x = 13; x <= 19; x++) if ((x !== 16 || y !== 16) && distance({ x, y }, { x: 16, y: 16 }) <= 3) points.push({ x, y })
  const stress = createSession({ rules, seed: 1, map: describeMap(rules, { width: 32, height: 32, base: 'grass', features: [{ kind: 'terrain', id: 'mountain', x: 16, y: 16, radius: 4 }] }), players: points.slice(0, 20).map((at, index) => ({ name: `Player ${index + 1}`, civilization: 'roman', start: at, scenario: { buildings: [], settlers: [{ profession: 'geologist', ...at }] } })) })
  renderer.setAssets(atlas); renderer.setPlayerSlots(Array.from({ length: 20 }, (_, index) => index))
  for (let player = 1; player <= 20; player++) stress.enqueue({ tick: 0, player, seq: 0, type: 'specialists', profession: 'geologist', ...points[player - 1]!, count: 1 })
  let maximum = 0
  for (let tick = 0; tick < rules.survey.work + 5; tick++) {
    stress.advance(1)
    const checksum = stress.checksum()
    renderer.draw(stress, { ...drawOptions, reduceMotion: false })
    if (stress.checksum() !== checksum) throw new Error('Cache work changed the simulation')
    maximum = Math.max(maximum, renderer.tintedFrameCount())
    if (maximum > 512) throw new Error('Clothing cache exceeded its frame budget')
  }
  if (maximum !== 512) throw new Error('The cache stress did not reach its declared bound')
  renderer.setAssets(atlas)
  if (renderer.tintedFrameCount() !== 0) throw new Error('Asset replacement retained old colored textures')
  renderer.dispose()
  if (renderer.tintedFrameCount() !== 0) throw new Error('Disposed renderer retained colored textures')
  const finalRenderer = createRenderer(canvas)
  finalRenderer.setAssets(atlas); finalRenderer.setPlayerSlots([0, 1]); finalRenderer.home({ x: 16, y: 16 }); finalRenderer.draw(restored, drawOptions)
  // An otherwise valid older checkpoint may lack installed presentation
  // metadata. Exercise the real controller and Craft storage without replacing
  // platform APIs, save internals or simulation state.
  const unknown = createSession({ rules, seed: 2, map: describeMap(rules, { width: 32, height: 32, base: 'grass', features: [] }), players: [{ name: 'Saved Rome', civilization: 'roman', start: { x: 16, y: 16 } }], content: { id: 'demo:uninstalled-original.map', digest: 'b'.repeat(64) } })
  const savedUnknown = JSON.stringify(save(unknown)); unknown.dispose()
  const host = await createBrowserPlatform({ namespace: 'the-settlers-iii-remake' })
  const checkpoints = createCheckpoints({
    get: (key, signal) => host.call('Storage', 'get', [key], signal),
    setIfAbsent: (key, value, signal) => host.call('Storage', 'setIfAbsent', [key, value], signal) as Promise<boolean>,
    compareAndSet: (key, expected, value, signal) => host.call('Storage', 'compareAndSet', [key, expected, value], signal) as Promise<boolean>,
  }, 'gold-checkpoint', 'gold-session')
  if (!(await checkpoints.save(savedUnknown)).ok) throw new Error('Could not prepare an unavailable-content checkpoint')
  const startupCanvas = document.createElement('canvas'); startupCanvas.style.cssText = 'width:400px;height:300px'; document.body.append(startupCanvas)
  let rejectStartup: (reason: Error) => void = () => {}
  let onStartup: (value: { ready: boolean, message: string }) => void = () => {}
  const unavailable = new Promise<void>((resolve, reject) => {
    rejectStartup = reject
    onStartup = value => {
      if (value.ready) reject(new Error('Unavailable saved content became playable'))
      if (value.message.includes('Player colors for this saved content are unavailable')) resolve()
    }
  })
  const timeout = setTimeout(() => rejectStartup(new Error('Unavailable-content startup did not finish')), 10000)
  const controller = mountGame(startupCanvas, value => onStartup(value), () => true)
  try {
    await unavailable; await controller.save()
    if (await checkpoints.load() !== savedUnknown) throw new Error('Unavailable-content startup replaced the saved checkpoint')
  }
  finally { clearTimeout(timeout); controller.dispose(); checkpoints.dispose(); host.dispose(); startupCanvas.remove() }
  session.dispose(); restored.dispose(); stress.dispose()
  result.textContent = JSON.stringify({ ok: true, checkedPixels: variants.reduce((sum, variant) => sum + variant.samples.length, 0), checksumUnchanged: true, fog: true, originalSlots: true, saveRestore: true, unavailableSavedContentPreserved: true, bodyPrecedence: true, missingLayer: true, sourceMaskUnchanged: true, maximumCachedFrames: maximum, assetReplacementAndDisposal: true, scope: 'Production renderer with authored public-session actors and independent original-frame pixels.' })
}
catch (error) { result.textContent = JSON.stringify({ ok: false, error: String(error) }) }
