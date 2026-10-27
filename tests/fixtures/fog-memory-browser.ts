import type { Atlas } from '../../resources/game/assets'
import { createSession, describeMap, restore, save, toView, ROMAN_ENGINEERING as rules } from '../../resources/game/engine'
import { createRenderer } from '../../resources/game/renderer'
import { order, place, until } from './engine'

/** Real discovery, loss of sight and rival terrain change. No view-state patching. */
export function checkRememberedTerrain(canvas: HTMLCanvasElement, atlas: Atlas) {
  const session = createSession({ rules, seed: 1, map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: [{ kind: 'terrain', id: 'desert', x: 40, y: 40, radius: 2 }] }), players: [
    { name: 'Viewer', civilization: 'roman', start: { x: 10, y: 10 }, scenario: { buildings: [{ type: 'castle', x: 10, y: 10 }], settlers: [{ profession: 'swordsman', x: 40, y: 39 }] } },
    { name: 'Rival', civilization: 'roman', start: { x: 80, y: 80 }, scenario: { buildings: [{ type: 'castle', x: 80, y: 80 }, { type: 'large-temple', x: 12, y: 60 }, { type: 'large-temple', x: 75, y: 60 }], settlers: [{ profession: 'priest', x: 50, y: 50 }] } },
  ] })
  const renderer = createRenderer(canvas), late = createRenderer(canvas), tile = 40 * 96 + 40, viewer = session.state.players[0]!
  let copy: ReturnType<typeof restore> | null = null, pixels = 0
  const expected = [79, 60, 21, 255]
  // Independently decoded source image18 texel(73,4), at 7/16 remembered light.
  const paint = (target: ReturnType<typeof createRenderer>, value = session) => {
    target.camera.zoom = 2; target.home({ x: 40, y: 40 })
    const checksum = value.checksum()
    target.draw(value, { player: 1, cursor: null, tool: null, selected: null, time: 0, reduceMotion: true, placement: null })
    if (value.checksum() !== checksum) throw new Error('Remembered-ground painting changed simulation state')
    const p = target.screen({ x: 320, y: 360 }), ratio = canvas.width / canvas.getBoundingClientRect().width
    const actual = [...canvas.getContext('2d')!.getImageData(Math.floor((p.x + 2.5) * ratio), Math.floor((p.y + 4.5) * ratio), 1, 1).data]
    if (actual.join() !== expected.join()) throw new Error(`Unseen terrain changed from last-observed ${expected} to ${actual} without renewed sight`)
    pixels++
  }
  try {
    if (!viewer.visible[tile] || !viewer.explored[tile]) throw new Error('The scout did not actually discover the desert')
    const soldier = [...session.state.settlers.values()].find(s => s.owner === 1)!, priest = [...session.state.settlers.values()].find(s => s.owner === 2)!
    order(session, 'move-soldiers', { soldiers: [soldier.id], x: 65, y: 65 })
    until(session, () => soldier.x === 65 && soldier.y === 65 && !soldier.step, 1000)
    until(session, () => viewer.visible[tile] === 0, 30)
    if (!viewer.explored[tile] || session.view(2).religion?.manna !== 16) throw new Error('Real discovery and temple completion preconditions were not reached')
    renderer.setAssets(atlas); paint(renderer)
    order(session, 'cast', { priest: priest.id, spell: 'grassland-galore', x: 40, y: 40 }, 2)
    until(session, () => !priest.cast, 1000)
    if (viewer.visible[tile] || !viewer.explored[tile] || rules.terrain[session.state.map.terrain[tile]!]!.id !== 'grass') throw new Error('The rival did not convert the unseen desert normally')
    paint(renderer)
    // No previous draw exists for this renderer, including after restoring.
    // A presentation cache cannot invent the viewer's historical landscape.
    late.setAssets(atlas); paint(late)
    copy = restore(save(session), rules); paint(late, copy)
  }
  finally { copy?.dispose(); renderer.dispose(); late.dispose(); session.dispose() }
  for (const target of [renderer, late]) if (target.terrainMaterialMemory().bytes || target.terrainCacheMemory().bytes || target.terrainFrameMemory().bytes) throw new Error('Remembered-ground renderer retained disposed resources')
  const grading = checkRememberedGrading(canvas, atlas)
  return { pixels: pixels + grading.pixels, realScoutAndIntervention: true, lateFirstDraw: true, saveReload: true, checksumUnchangedByPainting: true, disposal: true, grading }
}

function checkRememberedGrading(canvas: HTMLCanvasElement, atlas: Atlas) {
  const session = createSession({ rules, seed: 1, map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: [{ kind: 'elevation', x: 30, y: 42, radius: 3, amount: 6 }] }), players: [
    { name: 'Scout', civilization: 'roman', start: { x: 10, y: 10 }, scenario: { buildings: [{ type: 'castle', x: 10, y: 10 }], settlers: [{ profession: 'swordsman', x: 30, y: 43 }] } },
    { name: 'Builder', civilization: 'roman', start: { x: 40, y: 40 } },
  ] })
  const renderer = createRenderer(canvas), fresh = createRenderer(canvas), tile = 42 * 96 + 30
  let copy: ReturnType<typeof restore> | null = null, pixels = 0
  const paint = (target: ReturnType<typeof createRenderer>, value = session) => {
    target.camera.zoom = 2; target.home({ x: 30, y: 42 })
    const checksum = value.checksum()
    target.draw(value, { player: 1, cursor: null, tool: null, selected: null, time: 0, reduceMotion: true, placement: null })
    if (value.checksum() !== checksum) throw new Error('Remembered grading painting changed the world')
    const p = target.screen(toView(30, 42, 6)), rect = canvas.getBoundingClientRect(), ratio = canvas.width / rect.width
    const picked = target.pick(value, rect.left + p.x, rect.top + p.y)
    if (picked?.x !== 30 || picked.y !== 42) throw new Error('Picking used unseen live height instead of the displayed remembered vertex')
    return canvas.getContext('2d')!.getImageData(Math.floor((p.x - 8) * ratio), Math.floor((p.y - 8) * ratio), 16 * ratio, 16 * ratio).data
  }
  try {
    const scout = [...session.state.settlers.values()].find(s => s.owner === 1)!
    order(session, 'move-soldiers', { soldiers: [scout.id], x: 70, y: 20 })
    until(session, () => scout.x === 70 && scout.y === 20 && !scout.step && !session.state.players[0]!.visible[tile], 1000)
    renderer.setAssets(atlas)
    const expected = paint(renderer)
    const id = place(session, 'sawmill', { x: 30, y: 42 }, 2), b = session.state.buildings.get(id)!
    if (b.x !== 30 || b.y !== 42) throw new Error('The grading fixture did not place its actual site')
    until(session, () => b.phase !== 'leveling', 3000)
    if (session.state.map.elevation[tile] === 6 || session.state.players[0]!.visible[tile]) throw new Error('Real hidden grading did not occur')
    const equal = (actual: Uint8ClampedArray) => {
      if (actual.length !== expected.length || actual.some((value, i) => value !== expected[i])) throw new Error('Hidden grading changed remembered geometry, source material or its north-height lighting dependency')
      pixels += actual.length / 4
    }
    equal(paint(renderer))
    fresh.setAssets(atlas); equal(paint(fresh))
    copy = restore(save(session), rules); equal(paint(fresh, copy))
  }
  finally { copy?.dispose(); renderer.dispose(); fresh.dispose(); session.dispose() }
  for (const target of [renderer, fresh]) if (target.terrainMaterialMemory().bytes || target.terrainCacheMemory().bytes || target.terrainFrameMemory().bytes) throw new Error('Remembered grading retained disposed resources')
  return { pixels, realDiggerGrading: true, cachedFreshAndRestored: true, pickingUsesDisplayedHeight: true }
}
