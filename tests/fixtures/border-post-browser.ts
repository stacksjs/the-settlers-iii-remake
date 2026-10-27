import { loadOriginalAssets } from '../../resources/game/assets'
import { createSession, describeMap, restore, ROMAN_ENGINEERING as rules, save, toView } from '../../resources/game/engine'
import { createRenderer } from '../../resources/game/renderer'
import { scene } from '../../resources/game/scene'

interface Sample { x: number, y: number, rgb: number[] }
interface Expected { variants: { slots: number[], posts: { x: number, y: number, samples: Sample[] }[] }[], occlusion: Sample[] }

// Authored public-session renderer fixture. Real source pixels come from the
// runner's independent DAT decoder, not this painter or the game atlas.
const result = document.querySelector('#result')!
try {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas')!, renderer = createRenderer(canvas), atlas = await loadOriginalAssets()
  const expected = await fetch('/expected.json').then(response => response.json()) as Expected
  const setup = (tree = false, elevation = 0) => {
    const map = describeMap(rules, { width: 32, height: 32, base: 'grass', features: [
      ...(tree ? [{ kind: 'object' as const, id: 'tree', x: 16, y: 16, radius: 0 }] : []),
      ...(elevation ? [{ kind: 'elevation' as const, amount: elevation, x: 16, y: 16, radius: 0 }] : []),
    ] })
    map.owner[16 * 32 + 16] = 1; map.owner[16 * 32 + 20] = 2
    return createSession({ rules, seed: 1, map, players: [
      { name: 'Rome', civilization: 'roman', start: { x: 18, y: 14 }, scenario: { buildings: [], settlers: [{ profession: 'geologist', x: 18, y: 14 }] } },
      { name: 'Rival', civilization: 'roman', start: { x: 20, y: 16 }, scenario: { buildings: [], settlers: [] } },
    ] })
  }
  const session = setup(), before = session.checksum(), saved = save(session)
  const options = { player: 1, cursor: null, tool: null, selected: null, time: 0, reduceMotion: true, placement: null }
  renderer.setAssets(atlas); renderer.home({ x: 18, y: 16 })
  const context = canvas.getContext('2d')!, ratio = canvas.width / canvas.getBoundingClientRect().width
  let pixels = 0
  const read = (x: number, y: number, dx = 0, dy = 0) => [...context.getImageData(Math.floor(x * ratio) + dx, Math.floor(y * ratio) + dy, 1, 1).data].slice(0, 3)
  const check = (x: number, y: number, samples: Sample[], elevation = 0) => {
    const origin = renderer.screen(toView(x, y, elevation))
    for (const sample of samples) for (let dy = 0; dy < ratio; dy++) for (let dx = 0; dx < ratio; dx++) {
      const actual = read(origin.x + sample.x, origin.y + sample.y, dx, dy)
      if (actual.join() !== sample.rgb.join()) throw new Error(`Border pixel ${x},${y}/${sample.x},${sample.y}: ${actual} instead of ${sample.rgb}`)
      pixels++
    }
  }
  for (const variant of expected.variants) {
    renderer.setPlayerSlots(variant.slots); renderer.draw(session, options)
    for (const post of variant.posts) check(post.x, post.y, post.samples)
    const warm = renderer.tintedFrameCount()
    renderer.draw(session, options)
    if (renderer.tintedFrameCount() !== warm || warm > 512 || session.checksum() !== before) throw new Error('Border draw changed cache ownership or simulation state')
  }
  if (expected.variants.length !== 32 || scene(session, { player: 1 }).filter(item => item.kind === 'border').length !== 2) throw new Error('Palette or border fixture coverage is incomplete')
  renderer.setPlayerSlots([0, 1]); renderer.draw(session, options)
  const sentinel = expected.variants[0]!.posts[0]!.samples.find(sample => sample.rgb[0]! > 100 && sample.rgb[1]! < 16 && sample.rgb[2]! === 0)!
  if (!sentinel) throw new Error('Independent flag sentinel is missing')
  const origin = renderer.screen(toView(16, 16, 0))
  if (session.enqueue({ tick: 0, player: 1, seq: 0, type: 'specialists', profession: 'geologist', x: 2, y: 2, count: 1 })) throw new Error('Scout move was rejected')
  session.advance(1000)
  const fogChecksum = session.checksum()
  renderer.draw(session, options)
  if (!session.state.players[0]!.explored[16 * 32 + 16] || session.state.players[0]!.visible[16 * 32 + 16]
    || scene(session, { player: 1 }).some(item => item.kind === 'border')
    || read(origin.x + sentinel.x, origin.y + sentinel.y).join() === sentinel.rgb.join()
    || session.checksum() !== fogChecksum) throw new Error('Border post leaked through explored fog or painting changed state')
  const restored = restore(JSON.parse(JSON.stringify(saved)), rules)
  renderer.draw(restored, options)
  for (const post of expected.variants[0]!.posts) check(post.x, post.y, post.samples)
  if (restored.checksum() !== before) throw new Error('Restored border draw changed the checkpoint')
  const forest = setup(true), forestChecksum = forest.checksum()
  renderer.draw(forest, options); check(16, 16, expected.occlusion)
  if (!expected.occlusion.length || forest.checksum() !== forestChecksum) throw new Error('Background-depth occlusion was not exercised')
  const elevated = setup(false, 13), elevatedChecksum = elevated.checksum()
  renderer.draw(elevated, options); check(16, 16, expected.variants[0]!.posts[0]!.samples, 13)
  if (elevated.checksum() !== elevatedChecksum) throw new Error('Elevated border draw changed the simulation')
  renderer.setAssets(atlas)
  if (renderer.tintedFrameCount()) throw new Error('Asset replacement retained colored flag surfaces')
  renderer.draw(restored, options); renderer.dispose()
  if (renderer.tintedFrameCount()) throw new Error('Disposal retained colored flag surfaces')
  restored.dispose(); forest.dispose(); elevated.dispose(); session.dispose()
  result.textContent = JSON.stringify({ ok: true, deviceScale: devicePixelRatio, pixels, palettes: 32, posts: 2, occlusion: expected.occlusion.length * ratio ** 2, elevatedAnchor: true, fogLossAndRestore: true, checksumUnchanged: true, cacheReuse: true, replacementAndDisposal: true })
}
catch (error) { result.textContent = JSON.stringify({ ok: false, error: String(error) }); throw error }
