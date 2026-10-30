import { expect, test } from 'bun:test'
import { png } from '@stacksjs/ts-png'
import { createSession, restore, save, toView } from '../../resources/game/engine'
import { scene } from '../../resources/game/scene'
import { anchors, landscape, order, rules, until } from '../fixtures/engine'
import { referenceFrames, referenceImage } from '../fixtures/reference-dat'
import { shadowSequence } from '../../resources/game/shadow-images'

const directions = [
  { name: 'north-east', dx: 0, dy: -1, sequence: 103 },
  { name: 'east', dx: 1, dy: 0, sequence: 104 },
  // Original sequence 105 is the southeast silhouette. The pinned drawer's
  // duplicated 104 selector is recorded as a reference discrepancy, not Gold evidence.
  { name: 'south-east', dx: 1, dy: 1, sequence: 105 },
  { name: 'south-west', dx: 0, dy: 1, sequence: 100 },
  { name: 'west', dx: -1, dy: 0, sequence: 101 },
  { name: 'north-west', dx: -1, dy: -1, sequence: 102 },
]

test('original Gold shadow selectors remove DAT 1 gaps before edition and physical table translation', () => {
  // Pinned ShadowMapping1 removes original missing shadows 26 and 33.
  for (const [body, shadow] of [[0, 0], [25, 25], [26, null], [27, 26], [32, 31], [33, null], [34, 32], [100, 98], [105, 103]] as const) expect(shadowSequence(1, body)).toBe(shadow)
  for (const file of [10, 11, 12, 13]) expect(shadowSequence(file, 65)).toBe(65)
  expect(() => shadowSequence(6, 65)).toThrow('not implemented for DAT 6')
})

test('real bowman shots select original directional frames, anchored launch height and shadows', () => {
  for (const direction of directions) for (const [fromHeight, toHeight] of [[0, 0], [13, 2]] as const) {
    const map = landscape()
    map.elevation[54 * 96 + 40] = fromHeight
    map.elevation[(54 + direction.dy * 8) * 96 + 40 + direction.dx * 8] = toHeight
    const s = createSession({ rules, map, seed: 1, players: [
      { name: 'Rome', civilization: 'roman', start: anchors.castle, scenario: { buildings: [{ type: 'castle', x: 40, y: 40 }], settlers: [{ profession: 'bowman', x: 40, y: 54 }] } },
      { name: 'Other', civilization: 'roman', start: anchors.castle, scenario: { buildings: [], settlers: [{ profession: 'pikeman', x: 40 + direction.dx * 8, y: 54 + direction.dy * 8 }] } },
    ] })
    try {
      expect(s.skipped).toEqual({})
      const bowman = [...s.state.settlers.values()].find(p => p.owner === 1 && p.soldier)!
      order(s, 'move-soldiers', { soldiers: [bowman.id], x: 40, y: 54 })
      until(s, () => (s.state.projectiles ?? []).length > 0, 400)
      const projectile = s.state.projectiles![0]!, from = toView(40, 54, fromHeight), to = toView(40 + direction.dx * 8, 54 + direction.dy * 8, toHeight)
      expect(projectile.from).toBe(54 * 96 + 40)
      expect(projectile.to).toBe((54 + direction.dy * 8) * 96 + 40 + direction.dx * 8)
      expect(projectile.arrives - projectile.fired).toBe(20)
      for (const [tick, frame] of [[1, 0], [5, 1], [15, 2]] as const) {
        s.advance(projectile.fired + tick - s.state.tick)
        const checksum = s.checksum(), items = scene(s, { player: 1 }), body = items.find(item => item.kind === 'arrow' && item.entity === projectile.id)!
        const shadow = items.find(item => item.kind === 'shadow' && item.entity === projectile.id && item.sprite.startsWith('arrow:'))!
        const share = tick / 20
        expect(body.sprite).toBe(`arrow:${direction.name}`)
        expect(body.frame).toBe(frame)
        expect(body.view.x).toBeCloseTo(from.x + (to.x - from.x) * share, 10)
        expect(body.view.y).toBeCloseTo(from.y + (to.y - from.y) * share - 20 - 20 * share * (1 - share), 10)
        expect(shadow).toMatchObject({ sprite: body.sprite, frame, view: body.view, depth: body.depth - 40 })
        const copy = restore(JSON.parse(JSON.stringify(save(s))), rules)
        try { expect(scene(copy, { player: 1 })).toEqual(items) }
        finally { copy.dispose() }
        expect(s.checksum()).toBe(checksum)
      }
    }
    finally { s.dispose() }
  }
})

test('all original arrow bodies and mapped shadows retain source pixels and signed anchors', async () => {
  const bytes = Buffer.from(await Bun.file('storage/reference/demo/Gfx/Siedler3_01.f8007e01f.dat').bytes())
  const manifest = await Bun.file('public/assets/settlers-original/manifest.json').json()
  const atlas = png.sync.read(Buffer.from(await Bun.file('public/assets/settlers-original/' + manifest.atlas).bytes()))
  for (const direction of directions) for (const shadow of [false, true]) {
    // ShadowMapping1 removes absent Gold shadows 26 and 33 before the demo
    // mapping and the DAT reader's independent shadow table alignment.
    const sequence = direction.sequence - (shadow ? 2 : 0), section = shadow ? 0x5982 : 0x106
    const starts = referenceFrames(bytes, section, sequence), key = `${shadow ? 'shadow:' : ''}arrow:${direction.name}`
    expect(starts).toHaveLength(3)
    const frames = manifest.sprites.filter((frame: { key: string }) => frame.key === key)
    expect(frames).toHaveLength(3)
    for (const [index, offset] of starts.entries()) {
      const source = referenceImage(bytes, offset, shadow ? 'shadow' : false), frame = frames[index]!
      expect(frame).toMatchObject({ frame: index, width: source.width, height: source.height, offsetX: source.offsetX, offsetY: source.offsetY, source: { file: 1, sequence, actualSequence: sequence, section, frame: index } })
      if (!shadow) expect(frame.shadow).toBe(`shadow:arrow:${direction.name}`)
      for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
        const actual = ((frame.y + y) * atlas.width + frame.x + x) * 4, expected = (y * source.width + x) * 4
        expect(Array.from(atlas.data.subarray(actual, actual + 4))).toEqual(Array.from(source.data.subarray(expected, expected + 4)))
      }
    }
  }
})
