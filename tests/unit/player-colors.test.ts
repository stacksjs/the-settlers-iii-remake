import { expect, test } from 'bun:test'
import { createSession, observe, originalPlayerSlots, PUBLISHED_RULES, record, restore, ROMAN_ENGINEERING as rules, save, verify, worldFromOriginal } from '../../resources/game/engine'
import { colorTorsoPixels, paletteRGB, PLAYER_PALETTE, playerRGB, playerSlotsForContent, validatePlayerSlotCatalog } from '../../resources/game/player-colors'
import { minimapPixels, minimapSize, toMinimap } from '../../resources/game/minimap'

const content = { id: 'demo:filtered.map', digest: 'a'.repeat(64) }
test('reference palette distinguishes original editor slots and remake additions and preserves grayscale masks', () => {
  expect(PLAYER_PALETTE).toHaveLength(32)
  expect(paletteRGB(0)).toEqual([247, 16, 0])
  expect(paletteRGB(1)).toEqual([16, 140, 247])
  expect(paletteRGB(19)).toEqual([140, 189, 239])
  expect(paletteRGB(20)).toEqual([186, 255, 69])
  expect(paletteRGB(31)).toEqual([255, 87, 143])
  const gray = new Uint8ClampedArray([0, 0, 0, 255, 8, 8, 8, 255, 123, 123, 123, 255, 246, 246, 246, 255, 255, 255, 255, 255, 1, 2, 3, 0]), before = gray.slice()
  expect([...colorTorsoPixels(gray, 0)]).toEqual([0, 0, 0, 255, 8, 1, 0, 255, 119, 8, 0, 255, 238, 15, 0, 255, 247, 16, 0, 255, 1, 2, 3, 0])
  expect([...colorTorsoPixels(gray, 1)]).toEqual([0, 0, 0, 255, 1, 4, 8, 255, 8, 68, 119, 255, 15, 135, 238, 255, 16, 140, 247, 255, 1, 2, 3, 0])
  expect(gray).toEqual(before)
  expect(playerRGB([7, 1], 1)).toEqual([41, 41, 41])
  expect(playerRGB([7, 1], 2)).toEqual([16, 140, 247])
  expect(playerRGB([7, 1], 0)).toEqual([0, 0, 0])
  expect(() => paletteRGB(32)).toThrow('palette slot')
  expect(() => paletteRGB(-1)).toThrow('palette slot')
  expect(() => colorTorsoPixels(new Uint8ClampedArray(3), 0)).toThrow('pixel buffer')
  expect(() => colorTorsoPixels(new Uint8ClampedArray([1, 2, 3, 255]), 0)).toThrow('grayscale')
  expect(Object.isFrozen(PLAYER_PALETTE)).toBe(true)
  expect(Object.isFrozen(PLAYER_PALETTE[0])).toBe(true)
})

test('original slots survive filtered civilizations, legacy saves and replay without entering simulation state', () => {
  const size = 40, players = [
    { index: 0, civilization: 3, startX: 5, startY: 5, name: 'Amazons' },
    { index: 7, civilization: 0, startX: 22, startY: 22, name: 'Rome' },
  ]
  const slots = originalPlayerSlots(players)
  expect(slots).toEqual([7])
  expect(originalPlayerSlots([...players, { index: 2, civilization: 255, startX: 5, startY: 5, name: 'Free' }])).toEqual([7, 2])
  const world = worldFromOriginal(rules, { area: { size, elevation: new Uint8Array(size * size), landscape: new Uint8Array(size * size).fill(16), objects: new Uint8Array(size * size), resourceType: new Uint8Array(size * size), resourceAmount: new Uint8Array(size * size) }, players, buildings: [], settlers: [], stacks: [] })
  const session = createSession({ rules, seed: 1, map: world.map, players: world.players, content })
  const catalog = validatePlayerSlotCatalog([{ ...content, slots }]), before = session.checksum(), mapped = playerSlotsForContent(session.identity.content, session.state.players.length, catalog)
  expect(mapped).toEqual([7])
  expect(session.state.players[0]!.id).toBe(1)
  const envelope = save(session), copy = restore(JSON.parse(JSON.stringify(envelope)), PUBLISHED_RULES)
  expect(Object.keys(envelope).sort()).toEqual(['checksum', 'content', 'format', 'rules', 'state', 'tick', 'version'])
  expect('playerSlots' in envelope.state.players[0]!).toBe(false)
  expect(playerSlotsForContent(copy.identity.content, copy.state.players.length, catalog)).toEqual([7])
  expect(copy.checksum()).toBe(before)
  const pixels = minimapPixels(observe(session, 1), { territory: 'players', settlers: 'none', buildings: true }, mapped)
  const at = toMinimap({ x: 22, y: 22 }, size), offset = (at.y * minimapSize(size, size).width + at.x) * 4
  expect([...pixels.subarray(offset, offset + 3)]).toEqual([41, 41, 41])
  expect(session.checksum()).toBe(before)
  const recorder = record(copy)
  expect(recorder.enqueue({ tick: copy.state.tick, player: 1, seq: 0, type: 'settings', settings: { carrierRatio: 40 } })).toBeNull()
  recorder.advance(20)
  expect(verify(recorder.replay(), PUBLISHED_RULES).ok).toBe(true)
  session.dispose(); copy.dispose()
})

test('presentation catalog rejects ambiguous or unknown originals while generated mappings are explicit', () => {
  const input = [{ ...content, slots: [7] }], catalog = validatePlayerSlotCatalog(input)
  input[0]!.slots[0] = 0
  expect(playerSlotsForContent(content, 1, catalog)).toEqual([7])
  expect(playerSlotsForContent({ id: 'generated-96', digest: 'seed:1' }, 3, catalog)).toEqual([0, 1, 2])
  expect(playerSlotsForContent({ id: 'rival-128-elimination-v1', digest: 'seed:1' }, 2, catalog)).toEqual([0, 1])
  expect(() => playerSlotsForContent({ ...content, digest: 'b'.repeat(64) }, 1, catalog)).toThrow('unavailable')
  expect(() => playerSlotsForContent(content, 2, catalog)).toThrow('too few')
  for (const raw of [null, [{ ...content, slots: [-1] }], [{ ...content, slots: [32] }], [{ ...content, slots: [1, 1] }], [{ ...content, digest: 'wrong', slots: [0] }], [{ ...content, slots: [0] }, { ...content, slots: [1] }]]) expect(() => validatePlayerSlotCatalog(raw)).toThrow('catalog')
  expect(Object.isFrozen(catalog[0]!.slots)).toBe(true)
})
