import { expect, test } from 'bun:test'
import { createSession, describeMap, restore, ROMAN_ENGINEERING as rules, save, toView } from '../../resources/game/engine'
import { scene } from '../../resources/game/scene'
import { png } from '@stacksjs/ts-png'
import { referenceCompose, referenceFrames, referenceImage } from '../fixtures/reference-dat'

function borderSession() {
  const map = describeMap(rules, { width: 32, height: 32, base: 'grass', features: [{ kind: 'terrain', id: 'water', x: 13, y: 16, radius: 0 }] })
  // Authored starting ownership, not injected into an ongoing session.
  map.owner.fill(1)
  map.owner[16 * 32 + 13] = 0
  map.owner[16 * 32 + 15] = 0
  for (let y = 15; y <= 17; y++) for (let x = 19; x <= 21; x++) map.owner[y * 32 + x] = 2
  return createSession({ rules, seed: 1, map, players: [
    { name: 'Rome', civilization: 'roman', start: { x: 16, y: 16 }, scenario: { buildings: [], settlers: [{ profession: 'geologist', x: 16, y: 16 }] } },
    { name: 'Rival', civilization: 'roman', start: { x: 20, y: 16 }, scenario: { buildings: [], settlers: [] } },
  ] })
}

test('visible land borders use original posts, excluding sea and neutral tiles', () => {
  const session = borderSession()
  try {
    const before = session.checksum(), items = scene(session, { player: 1 }).filter(item => item.sprite === 'border-post')
    expect(items.find(item => item.tile === 16 * 32 + 14)).toMatchObject({ owner: 1, frame: 0, view: toView(14, 16, 0) })
    expect(items.find(item => item.tile === 16 * 32 + 19)).toMatchObject({ owner: 2 })
    expect(items.some(item => [16 * 32 + 12, 16 * 32 + 13, 16 * 32 + 15].includes(item.tile))).toBe(false)
    expect(items.every(item => item.depth < -32)).toBe(true)
    expect(session.checksum()).toBe(before)
  }
  finally { session.dispose() }
})

test('territory posts disappear under explored fog and restore only with current sight', () => {
  const session = borderSession()
  try {
    const saved = save(session), initial = scene(session, { player: 1 })
    expect(scene(session, { player: 1 }).some(item => item.sprite === 'border-post' && item.tile === 16 * 32 + 19)).toBe(true)
    expect(session.enqueue({ tick: 0, player: 1, seq: 0, type: 'specialists', profession: 'geologist', x: 2, y: 2, count: 1 })).toBeNull()
    session.advance(1000)
    expect(session.state.players[0]!.explored[16 * 32 + 19]).toBe(1)
    expect(session.state.players[0]!.visible[16 * 32 + 19]).toBe(0)
    expect(scene(session, { player: 1 }).some(item => item.sprite === 'border-post' && item.tile === 16 * 32 + 19)).toBe(false)
    const restored = restore(JSON.parse(JSON.stringify(saved)), rules)
    try { expect(scene(restored, { player: 1 })).toEqual(initial) }
    finally { restored.dispose() }
  }
  finally { session.dispose() }
})

test('map edges and owned blocked ground do not create false territory posts', () => {
  const map = describeMap(rules, { width: 16, height: 16, base: 'grass', features: [{ kind: 'terrain', id: 'water', x: 4, y: 4, radius: 0 }] })
  map.owner.fill(1); map.owner[3 * 16 + 4] = 0
  const session = createSession({ rules, seed: 1, map, players: [{ name: 'Rome', civilization: 'roman', start: { x: 2, y: 2 }, scenario: { buildings: [], settlers: [{ profession: 'geologist', x: 2, y: 2 }] } }] })
  try {
    expect(session.state.players[0]!.visible[0]).toBe(1)
    const posts = scene(session, { player: 1 }).filter(item => item.sprite === 'border-post')
    expect(posts.some(item => item.tile === 3 * 16 + 3)).toBe(true)
    expect(posts.some(item => [0, 4 * 16 + 4, 3 * 16 + 4].includes(item.tile))).toBe(false)
  }
  finally { session.dispose() }
})

test('border body and flag retain independent original DAT pixels and signed anchors', async () => {
  const bytes = Buffer.from(await Bun.file('storage/reference/demo/Gfx/Siedler3_13.f8007e01f.dat').arrayBuffer())
  const expected = [referenceImage(bytes, referenceFrames(bytes, 0x106, 65)[0]!), referenceImage(bytes, referenceFrames(bytes, 0x3112, 65)[0]!, true)]
  const manifest = await Bun.file('public/assets/settlers-original/manifest.json').json()
  const atlas = png.sync.read(Buffer.from(await Bun.file('public/assets/settlers-original/' + manifest.atlas).arrayBuffer()))
  for (const [i, key] of ['border-post', 'torso:border-post'].entries()) {
    const frames = manifest.sprites.filter((frame: { key: string }) => frame.key === key)
    expect(frames).toHaveLength(1)
    const f = frames[0]!, original = expected[i]!
    expect(f.source).toMatchObject({ file: 13, sequence: 65, actualSequence: 65, section: i ? 0x3112 : 0x106, frame: 0, ...(i ? { layerSequence: 2 } : {}) })
    expect([f.width, f.height, f.offsetX, f.offsetY]).toEqual([9, 12, -3, -8])
    const actual = Buffer.alloc(f.width * f.height * 4)
    for (let y = 0; y < f.height; y++) atlas.data.copy(actual, y * f.width * 4, ((f.y + y) * atlas.width + f.x) * 4, ((f.y + y) * atlas.width + f.x + f.width) * 4)
    expect(actual).toEqual(original.data)
  }
  expect(referenceCompose([expected[1]!, expected[0]!]).width).toBe(9)
})
