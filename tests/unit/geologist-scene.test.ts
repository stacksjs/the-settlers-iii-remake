import { expect, test } from 'bun:test'
import type { Session } from '../../resources/game/engine'
import { audit, createSession, describeMap, PUBLISHED_RULES, restore, ROMAN_ENGINEERING as rules, save } from '../../resources/game/engine'
import { scene } from '../../resources/game/scene'
import { order, until } from '../fixtures/engine'

// Public scenario, orders and scene observe the actual geologist. Pixel
// conversion and native browser output are checked separately.
test('a walking geologist uses the original profession image in its actual direction', () => {
  const s = createSession({ rules, seed: 5, map: describeMap(rules, { width: 32, height: 32, base: 'grass', features: [{ kind: 'terrain', id: 'mountain', x: 18, y: 16, radius: 0 }] }),
    players: [{ name: 'Rome', civilization: 'roman', start: { x: 16, y: 16 }, scenario: { buildings: [], settlers: [{ profession: 'geologist', x: 16, y: 16 }] } }],
  })
  expect(s.skipped).toEqual({})
  order(s, 'specialists', { profession: 'geologist', x: 18, y: 16, count: 1 })
  until(s, () => s.view(1).settlers[0]?.action === 'walking', 20)
  const person = s.view(1).settlers[0]!, before = s.checksum()
  const image = scene(s, { player: 1 }).find(i => i.kind === 'settler' && i.entity === person.id)!
  expect(image.sprite).toBe('geologist')
  // movables.txt puts EAST in the fifth twelve-frame group.
  expect(Math.floor(image.frame / 12)).toBe(4)
  expect(scene(s, { player: 1, reduceMotion: true }).find(i => i.kind === 'settler')).toMatchObject({ sprite: 'geologist', frame: 48 })
  expect(s.checksum()).toBe(before)
  expect(audit(s.context)).toEqual([])
  s.dispose()
})

test('an actual survey plays both original work sequences in order and keeps a mid-survey restore identical', () => {
  const s = createSession({ rules, seed: 5, map: describeMap(rules, { width: 32, height: 32, base: 'grass', features: [{ kind: 'terrain', id: 'mountain', x: 16, y: 16, radius: 0 }] }),
    players: [{ name: 'Rome', civilization: 'roman', start: { x: 16, y: 16 }, scenario: { buildings: [], settlers: [{ profession: 'geologist', x: 16, y: 16 }] } }],
  })
  order(s, 'specialists', { profession: 'geologist', x: 16, y: 16, count: 1 })
  until(s, () => s.view(1).settlers[0]?.action === 'working', 20)
  const images = [], keys = new Set<string>()
  let copy: Session | undefined
  for (let tick = 0; tick < rules.survey.work && s.view(1).settlers[0]?.action === 'working'; tick++) {
    const before = s.checksum(), current = scene(s, { player: 1 }), image = current.find(i => i.kind === 'settler')!
    expect(s.checksum()).toBe(before)
    expect(s.view(1).signs).toEqual([])
    images.push(image); keys.add(image.sprite)
    if (image.sprite === 'geologist-survey-2' && !copy) {
      copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
      expect(scene(copy, { player: 1 })).toEqual(current)
    }
    s.advance(1); copy?.advance(1)
  }
  expect(images[0]).toMatchObject({ sprite: 'geologist-survey-1', frame: 0 })
  expect([...keys]).toEqual(['geologist-survey-1', 'geologist-survey-2'])
  for (const [sprite, count] of [['geologist-survey-1', 31], ['geologist-survey-2', 16]] as const) {
    const frames = images.filter(i => i.sprite === sprite).map(i => i.frame)
    expect(new Set(frames).size).toBeGreaterThan(2)
    expect(frames.every(frame => frame >= 0 && frame < count)).toBe(true)
  }
  expect(copy).toBeDefined()
  for (const live of [s, copy!]) {
    until(live, () => live.view(1).signs.length === 1, 10)
    expect(live.view(1).signs[0]).toMatchObject({ tile: 16 * 32 + 16, amount: 0 })
    expect(scene(live, { player: 1 }).find(i => i.kind === 'settler')?.sprite).toBe('geologist')
    expect(audit(live.context)).toEqual([])
  }
  expect(copy!.checksum()).toBe(s.checksum())
  copy!.dispose(); s.dispose()
})

test('reduced motion keeps surveying still while the actual task and discovery continue', () => {
  const s = createSession({ rules, seed: 5, map: describeMap(rules, { width: 32, height: 32, base: 'grass', features: [{ kind: 'terrain', id: 'mountain', x: 16, y: 16, radius: 0 }] }),
    players: [{ name: 'Rome', civilization: 'roman', start: { x: 16, y: 16 }, scenario: { buildings: [], settlers: [{ profession: 'geologist', x: 16, y: 16 }] } }],
  })
  order(s, 'specialists', { profession: 'geologist', x: 16, y: 16, count: 1 })
  until(s, () => scene(s, { player: 1 }).some(i => i.sprite === 'geologist-survey-2'), rules.survey.work)
  const before = s.checksum(), still = scene(s, { player: 1, reduceMotion: true })
  expect(still.find(i => i.kind === 'settler')).toMatchObject({ sprite: 'geologist-survey-1', frame: 0 })
  expect(scene(s, { player: 1, reduceMotion: true })).toEqual(still)
  expect(s.checksum()).toBe(before)
  until(s, () => s.view(1).signs.length === 1, rules.survey.work)
  expect(s.view(1).signs[0]?.amount).toBe(0)
  expect(audit(s.context)).toEqual([])
  s.dispose()
})

test('an unseen foreign geologist and its work images stay out of the player scene', () => {
  const s = createSession({ rules, seed: 5, map: describeMap(rules, { width: 64, height: 64, base: 'grass', features: [
    { kind: 'terrain', id: 'mountain', x: 16, y: 16, radius: 0 }, { kind: 'terrain', id: 'mountain', x: 48, y: 48, radius: 0 },
  ] }), players: [
    { name: 'One', civilization: 'roman', start: { x: 16, y: 16 }, scenario: { buildings: [], settlers: [{ profession: 'geologist', x: 16, y: 16 }] } },
    { name: 'Two', civilization: 'roman', start: { x: 48, y: 48 }, scenario: { buildings: [], settlers: [{ profession: 'geologist', x: 48, y: 48 }] } },
  ] })
  order(s, 'specialists', { profession: 'geologist', x: 16, y: 16, count: 1 })
  order(s, 'specialists', { profession: 'geologist', x: 48, y: 48, count: 1 }, 2)
  const before = s.checksum(), own = scene(s, { player: 1 }).filter(i => i.kind === 'settler')
  expect(own).toHaveLength(1)
  expect(own[0]).toMatchObject({ owner: 1, sprite: 'geologist-survey-1' })
  expect(scene(s, { player: 2 }).filter(i => i.kind === 'settler').map(i => i.owner)).toEqual([2])
  expect(s.checksum()).toBe(before)
  expect(audit(s.context)).toEqual([])
  s.dispose()
})
