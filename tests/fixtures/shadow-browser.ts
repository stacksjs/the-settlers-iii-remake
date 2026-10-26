import type { Atlas, AtlasFrame } from '../../resources/game/assets'
import { loadOriginalAssets } from '../../resources/game/assets'
import { createSession, describeMap, PUBLISHED_RULES, restore, ROMAN_ENGINEERING as rules, save } from '../../resources/game/engine'
import type { Session } from '../../resources/game/engine'
import { createRenderer } from '../../resources/game/renderer'
import { scene } from '../../resources/game/scene'

// Authored public-session engineering fixture. Original masks stay unchanged;
// flat ground isolates their source pixels from unrelated terrain textures.
const result = document.querySelector('#result')!
try {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas')!, renderer = createRenderer(canvas), original = await loadOriginalAssets()
  const atlas: Atlas = { ...original, frames: new Map([...original.frames].filter(([key]) => !key.startsWith('terrain-'))) }
  renderer.setAssets(atlas)
  const sessions: Session[] = [], options = { player: 1, cursor: null, tool: null, selected: null, time: 0, reduceMotion: false, placement: null }
  const context = canvas.getContext('2d')!, ratio = canvas.width / canvas.getBoundingClientRect().width
  const pixel = (x: number, y: number): number[] => [...context.getImageData(Math.floor((x + 0.5) * ratio), Math.floor((y + 0.5) * ratio), 1, 1).data].slice(0, 3)
  // Native Canvas compositors can quantize source-over differently from
  // Math.round on floats. Compose independently decoded mask values through
  // the browser itself, keeping the final pixel comparison exact on each host.
  const expectedSurface = document.createElement('canvas'), maskSurface = document.createElement('canvas')
  expectedSurface.width = maskSurface.width = expectedSurface.height = maskSurface.height = 1
  const expectedContext = expectedSurface.getContext('2d')!, maskContext = maskSurface.getContext('2d')!
  const composite = (ground: number[], alpha: number): number[] => {
    expectedContext.putImageData(new ImageData(new Uint8ClampedArray([...ground, 255]), 1, 1), 0, 0)
    maskContext.putImageData(new ImageData(new Uint8ClampedArray([0, 0, 0, alpha]), 1, 1), 0, 0)
    expectedContext.drawImage(maskSurface, 0, 0)
    return [...expectedContext.getImageData(0, 0, 1, 1).data].slice(0, 3)
  }
  const poses = await fetch('/expected.json').then(response => response.json()) as { sprite: string, frame: number, samples: { x: number, y: number, alpha: number, groundX: number }[] }[]
  const make = (profession: string, terrain = 'grass'): Session => {
    const session = createSession({ rules, seed: 1, map: describeMap(rules, { width: 32, height: 32, base: terrain, features: [] }), players: [{ name: 'Rome', civilization: 'roman', start: { x: 16, y: 16 }, scenario: { buildings: [], settlers: [{ profession, x: 16, y: 16 }] } }] })
    sessions.push(session); return session
  }
  let checked = 0
  const visited = new Set<string>()
  const check = (session: Session): void => {
    const body = scene(session, { player: 1 }).find(item => item.kind === 'settler')!, pose = poses.find(pose => pose.sprite === body.sprite && pose.frame === body.frame)
    if (!pose) throw new Error(`No independent shadow samples for ${body.sprite}:${body.frame}`)
    const before = session.checksum()
    renderer.home({ x: 16, y: 16 }); renderer.draw(session, options)
    const origin = renderer.screen(body.view)
    for (const sample of pose.samples) {
      const ground = pixel(origin.x + sample.groundX, origin.y + sample.y), expected = composite(ground, sample.alpha), actual = pixel(origin.x + sample.x, origin.y + sample.y)
      if (actual.join() !== expected.join()) throw new Error(`Shadow ${body.sprite}:${body.frame} at ${sample.x},${sample.y}: ${actual} instead of ${expected}`)
      checked++
    }
    if (session.checksum() !== before) throw new Error('Shadow rendering changed the simulation')
    visited.add(`${body.sprite}:${body.frame}`)
  }
  for (const profession of ['carrier', 'swordsman', 'geologist']) {
    const session = make(profession); check(session)
    const paused = canvas.toDataURL(); renderer.draw(session, options)
    if (canvas.toDataURL() !== paused) throw new Error('Paused shadows changed without a simulation tick')
    const resumed = restore(JSON.parse(JSON.stringify(save(session))), PUBLISHED_RULES); sessions.push(resumed)
    check(resumed)
    if (resumed.checksum() !== session.checksum()) throw new Error('Shadow presentation changed the saved identity')
  }
  const survey = make('geologist', 'mountain')
  survey.enqueue({ tick: 0, player: 1, seq: 0, type: 'specialists', profession: 'geologist', x: 16, y: 16, count: 1 })
  let surveyPoses = 0
  for (let tick = 0; tick < rules.survey.work + 5; tick++) {
    survey.advance(1)
    if (scene(survey, { player: 1 }).some(item => item.kind === 'settler' && item.sprite.startsWith('geologist-survey-'))) { check(survey); surveyPoses++ }
  }
  if (surveyPoses < 10 || ![...visited].some(key => key.startsWith('geologist-survey-1:')) || ![...visited].some(key => key.startsWith('geologist-survey-2:'))) throw new Error('Actual survey did not exercise both source actions')

  const fog = createSession({ rules, seed: 1, map: describeMap(rules, { width: 32, height: 32, base: 'grass', features: [] }), players: [
    { name: 'Rome', civilization: 'roman', start: { x: 16, y: 16 }, scenario: { buildings: [], settlers: [{ profession: 'geologist', x: 16, y: 16 }] } },
    { name: 'Foreign', civilization: 'roman', start: { x: 18, y: 16 }, scenario: { buildings: [], settlers: [{ profession: 'geologist', x: 18, y: 16 }] } },
  ] }); sessions.push(fog)
  renderer.home({ x: 18, y: 16 }); renderer.draw(fog, options)
  const sample = poses.find(pose => pose.sprite === 'geologist' && pose.frame === 0)!.samples.find(sample => sample.alpha === 136 && sample.x < 0)!, enemy = renderer.screen({ x: 160, y: 144 }), visibleShadow = pixel(enemy.x + sample.x, enemy.y + sample.y)
  if (visibleShadow.join() !== composite(pixel(enemy.x + sample.x - 48, enemy.y + sample.y), 136).join()) throw new Error('Foreign source shadow was not visible before leaving sight')
  fog.enqueue({ tick: 0, player: 1, seq: 0, type: 'specialists', profession: 'geologist', x: 3, y: 3, count: 1 }); fog.advance(1000)
  if (scene(fog, { player: 1 }).some(item => item.owner === 2 && (item.kind === 'shadow' || item.kind === 'settler'))) throw new Error('Foreign shadow leaked through fog')
  renderer.draw(fog, options)
  if (pixel(enemy.x + sample.x, enemy.y + sample.y).join() === visibleShadow.join()) throw new Error('Hidden foreign shadow remained painted')

  // Small authored layers expose depth/occlusion without hiding the actual
  // production renderer behind a compositing substitute.
  const sheet = document.createElement('canvas'); sheet.width = 4; sheet.height = 1
  sheet.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray([0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 136, 255, 255, 255, 255]), 4, 1), 0, 0)
  const image = new Image(); image.src = sheet.toDataURL(); await image.decode()
  const worker: AtlasFrame = { key: 'worker', frame: 0, x: 0, y: 0, width: 1, height: 1, offsetX: 0, offsetY: 0, torso: null, shadow: null }
  const body: AtlasFrame = { ...worker, key: 'geologist', x: 1, offsetX: 2, shadow: 'shadow:geologist' }
  const shadow: AtlasFrame = { ...worker, key: 'shadow:geologist', x: 2 }
  const authored: Atlas = { image, frames: new Map([[worker.key, [worker]], [body.key, [body]], [shadow.key, [shadow]]]), playerSlots: [] }
  const plain = make('geologist')
  renderer.setAssets(authored); renderer.home({ x: 16, y: 16 })
  authored.frames.set(body.key, [{ ...body, shadow: null }]); renderer.draw(plain, options)
  const center = renderer.screen({ x: 128, y: 144 })
  if (pixel(center.x, center.y).join() !== pixel(center.x + 32, center.y).join()) throw new Error('A missing source shadow became a fabricated oval')
  authored.frames.set(body.key, [body]); authored.frames.set(shadow.key, [{ ...shadow, offsetX: 2 }]); renderer.draw(plain, options)
  if (pixel(center.x + 2, center.y).join() !== '0,0,255') throw new Error('A shadow covered its own opaque body')
  const torso: AtlasFrame = { ...worker, key: 'torso:geologist', x: 3 }
  authored.frames.set(body.key, [{ ...body, torso: torso.key }]); authored.frames.set(torso.key, [torso]); authored.frames.set(shadow.key, [shadow]); renderer.draw(plain, options)
  if (pixel(center.x, center.y).join() !== '247,16,0') throw new Error('A shadow covered its opaque torso')
  authored.frames.set(body.key, [body]); authored.frames.delete(torso.key)
  for (const front of [false, true]) {
    const at = front ? { x: 24, y: 32 } : { x: 16, y: 16 }, elevation = front ? 72 : 0
    const session = createSession({ rules, seed: 1, map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: [{ kind: 'elevation', ...at, radius: 0, amount: elevation }, { kind: 'elevation', x: 40, y: 64, radius: 0, amount: 216 }] }), players: [{ name: 'Rome', civilization: 'roman', start: at, scenario: { buildings: [], settlers: [{ profession: 'carrier', ...at }, { profession: 'geologist', x: 40, y: 64 }] } }] }); sessions.push(session)
    renderer.home(at, elevation); renderer.draw(session, options)
    const origin = renderer.screen({ x: 128, y: 144 }), expected = front ? '0,255,0' : '0,119,0'
    if (pixel(origin.x, origin.y).join() !== expected) throw new Error(`Source depth order on steep terrain: ${pixel(origin.x, origin.y)} instead of ${expected}`)
  }
  const untouched = document.createElement('canvas'); untouched.width = 4; untouched.height = 1; untouched.getContext('2d')!.drawImage(image, 0, 0)
  if ([...untouched.getContext('2d')!.getImageData(2, 0, 1, 1).data].join() !== '0,0,0,136') throw new Error('Painting changed the original shadow mask')
  renderer.dispose(); renderer.draw(plain, options)
  if (pixel(center.x, center.y).join() !== '13,23,20') throw new Error('Disposed renderer retained shadow images')
  renderer.setAssets(atlas); check(plain)
  for (const session of sessions) session.dispose()
  result.textContent = JSON.stringify({ ok: true, checkedPixels: checked, poses: visited.size, surveyPoses, originalCarrierSoldierGeologist: true, transparentBoundaries: true, signedAnchors: true, fog: true, pause: true, saveRestore: true, missingLayer: true, bodyAndTorsoPrecedence: true, sourceDepthOcclusion: true, sourceMaskUnchanged: true, assetReplacementAndDisposal: true, scope: 'Production renderer and public sessions; original masks over flat engineering ground, plus authored layers for exact depth occlusion. Not Gold runtime observations.' })
}
catch (error) { result.textContent = JSON.stringify({ ok: false, error: String(error) }) }
