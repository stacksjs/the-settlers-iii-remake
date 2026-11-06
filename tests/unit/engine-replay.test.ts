import { expect, test } from 'bun:test'
import type { Replay } from '../../resources/game/engine'
import legacy from '../fixtures/replay-format-1.json'
import { createSession, PUBLISHED_RULES, record, restore, save, verify } from '../../resources/game/engine'
import { anchors, landscape, order, rules, session, until } from '../fixtures/engine'

test('a future command replays from when it was submitted, including its pending queue', () => {
  const s = session()
  try {
    const recorder = record(s)
    expect(recorder.enqueue({ tick: 4, player: 1, seq: 0, type: 'settings', settings: { carrierRatio: 40 } })).toBeNull()
    recorder.advance(5)
    expect(verify(JSON.parse(JSON.stringify(recorder.replay())), rules)).toEqual({ ok: true, ticks: 5, checksum: s.checksum() })
  }
  finally { s.dispose() }
})

test('verification rejects a recording whose declared interval is incomplete', () => {
  const s = session()
  try {
    const recorder = record(s)
    recorder.advance(3)
    const replay = recorder.replay()
    for (const end of [-1, 2, 4, 3.5, Number.NaN, Infinity]) {
      expect(() => verify({ ...replay, end }, rules)).toThrow('Replay interval')
    }
  }
  finally { s.dispose() }
})

test('invalid arrival times cannot hide commands outside the verified timeline', () => {
  const s = session()
  try {
    const recorder = record(s)
    const replay = recorder.replay()
    for (const at of [-1, 1, 0.5, Number.NaN, Infinity]) {
      const changed = structuredClone(replay)
      changed.submissions.push({ at, command: { tick: 4, player: 1, seq: 0, type: 'settings', settings: { carrierRatio: 40 } } })
      expect(() => verify(changed, rules)).toThrow('submission timeline')
    }
  }
  finally { s.dispose() }
})

test('nonzero starts retain already queued work and the arrival order of later commands', () => {
  const s = session()
  try {
    s.advance(7)
    expect(s.enqueue({ tick: 10, player: 1, seq: 0, type: 'settings', settings: { carrierRatio: 30 } })).toBeNull()
    const recorder = record(s)
    expect(recorder.enqueue({ tick: 12, player: 1, seq: 1, type: 'settings', settings: { carrierRatio: 50 } })).toBeNull()
    recorder.advance(2)
    expect(recorder.enqueue({ tick: 11, player: 1, seq: 2, type: 'settings', settings: { carrierRatio: 40 } })).toBeNull()
    recorder.advance(5)
    const before = s.checksum()
    expect(verify(recorder.replay(), rules)).toEqual({ ok: true, ticks: 7, checksum: before })
    expect(s.checksum()).toBe(before)
  }
  finally { s.dispose() }
})

test('the final snapshot retains commands queued after the last recorded advance', () => {
  const s = session()
  try {
    const recorder = record(s)
    recorder.advance(2)
    expect(recorder.enqueue({ tick: 8, player: 1, seq: 0, type: 'settings', settings: { carrierRatio: 40 } })).toBeNull()
    const replay = recorder.replay()
    expect(verify(replay, rules)).toEqual({ ok: true, ticks: 2, checksum: s.checksum() })
    replay.submissions = []
    expect(verify(replay, rules)).toMatchObject({ ok: false, tick: 2, reason: 'divergence', expected: s.checksum() })
  }
  finally { s.dispose() }
})

test('a zero tick recording can retain newly queued future commands', () => {
  const s = session()
  try {
    const recorder = record(s)
    expect(recorder.enqueue({ tick: 4, player: 1, seq: 0, type: 'settings', settings: { carrierRatio: 40 } })).toBeNull()
    expect(verify(recorder.replay(), rules)).toEqual({ ok: true, ticks: 0, checksum: s.checksum() })
  }
  finally { s.dispose() }
})

test('reads the immutable format1 artifact captured from the previous recorder', () => {
  expect(verify(structuredClone(legacy) as Replay, PUBLISHED_RULES)).toEqual({ ok: true, ticks: 5, checksum: '6b98801a' })
})

test('the recorder refuses fractional advances without advancing the session', () => {
  const s = session()
  try {
    const recorder = record(s)
    for (const ticks of [-1, 0.5, Number.NaN, Infinity, 1_000_001]) {
      expect(() => recorder.advance(ticks)).toThrow('whole number')
      expect(s.state.tick).toBe(0)
    }
  }
  finally { s.dispose() }
})

test('malformed checksums are rejected as recording data instead of simulation divergence', () => {
  const s = session()
  try {
    const recorder = record(s)
    recorder.advance(1)
    const replay = recorder.replay()
    for (const checksum of ['not-a-checksum', '', null, 12]) {
      const malformed = JSON.parse(JSON.stringify(replay))
      malformed.checksums[0] = checksum
      expect(() => verify(malformed, rules)).toThrow('Replay checksum')
      malformed.checksums = replay.checksums
      malformed.checksum = checksum
      expect(() => verify(malformed, rules)).toThrow('Replay checksum')
    }
    const missing = JSON.parse(JSON.stringify(replay))
    delete missing.checksum
    expect(() => verify(missing, rules)).toThrow('Replay checksum')
  }
  finally { s.dispose() }
})

test('a rejected submission at the final tick reports the final expected checksum', () => {
  const s = session()
  try {
    const recorder = record(s)
    expect(recorder.enqueue({ tick: 4, player: 1, seq: 0, type: 'settings', settings: { carrierRatio: 40 } })).toBeNull()
    const replay = recorder.replay()
    replay.submissions[0]!.command.player = 2
    expect(verify(replay, rules)).toMatchObject({ ok: false, tick: 0, reason: 'rejected-command', expected: replay.checksum })
  }
  finally { s.dispose() }
})

test('arrival ordering is checked before simulating a reordered recording', () => {
  const s = session()
  try {
    const recorder = record(s)
    expect(recorder.enqueue({ tick: 4, player: 1, seq: 0, type: 'settings', settings: { carrierRatio: 40 } })).toBeNull()
    recorder.advance(1)
    expect(recorder.enqueue({ tick: 3, player: 1, seq: 1, type: 'settings', settings: { carrierRatio: 50 } })).toBeNull()
    recorder.advance(4)
    const replay = recorder.replay()
    replay.submissions.reverse()
    expect(() => verify(replay, rules)).toThrow('submission timeline')
  }
  finally { s.dispose() }
})

test('rejected commands never enter the recording', () => {
  const s = session()
  try {
    const recorder = record(s)
    expect(recorder.enqueue({ tick: 0, player: 2, seq: 0, type: 'settings', settings: { carrierRatio: 40 } })).not.toBeNull()
    expect(recorder.replay().submissions).toEqual([])
    expect(verify(recorder.replay(), rules)).toEqual({ ok: true, ticks: 0, checksum: s.checksum() })
  }
  finally { s.dispose() }
})

test('editing an exported save cannot change the session identity or an active recording', () => {
  const s = session()
  try {
    const recorder = record(s)
    const expected = structuredClone(s.identity)
    const exported = save(s)
    exported.rules.version = 'edited outside the session'
    exported.content.id = 'another content pack'
    expect(s.identity).toEqual(expected)
    const next = save(s)
    expect({ rules: next.rules, content: next.content }).toEqual(expected)
    const restored = restore(next, rules)
    try { expect(restored.checksum()).toBe(s.checksum()) }
    finally { restored.dispose() }
    expect(verify(recorder.replay(), rules)).toEqual({ ok: true, ticks: 0, checksum: s.checksum() })
  }
  finally { s.dispose() }
})

test('the content descriptor supplied at creation cannot change later saves or recordings', () => {
  const content = { id: 'generated-test', digest: 'fixed-content-digest' }
  const s = createSession({ rules, seed: 1, map: landscape(), content, players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle }] })
  try {
    const recorder = record(s)
    content.id = 'replacement'
    content.digest = 'replacement-digest'
    expect(save(s).content).toEqual({ id: 'generated-test', digest: 'fixed-content-digest' })
    expect(recorder.replay().start.content).toEqual({ id: 'generated-test', digest: 'fixed-content-digest' })
    recorder.advance(1)
    expect(verify(recorder.replay(), rules)).toEqual({ ok: true, ticks: 1, checksum: s.checksum() })
  }
  finally { s.dispose() }
})

test('editing setup settings cannot change a running session or its recording', () => {
  const settings = {
    transportPriority: [...rules.goods], toolWeights: { axe: 2 }, urgentTools: ['axe'], stored: ['plank'],
    recruit: { automatic: false, queue: {} as Record<string, number> }, distribution: { coal: { toolsmith: 2 } },
  }
  const s = session({ players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle, settings }] })
  try {
    const before = save(s), recorder = record(s)
    expect(verify(recorder.replay(), rules)).toEqual({ ok: true, ticks: 0, checksum: before.checksum })
    settings.transportPriority.reverse()
    settings.toolWeights.axe = 9
    settings.urgentTools.push('hammer')
    settings.stored.push('stone')
    settings.recruit.automatic = true
    settings.recruit.queue.swordsman = 3
    settings.distribution.coal.toolsmith = 7
    expect(save(s)).toEqual(before)
    expect(verify(recorder.replay(), rules)).toEqual({ ok: true, ticks: 0, checksum: before.checksum })
    recorder.advance(2)
    expect(verify(recorder.replay(), rules)).toEqual({ ok: true, ticks: 2, checksum: s.checksum() })
  }
  finally { s.dispose() }
})

test('sessions using one settings preset retain independent command histories', () => {
  const settings = { urgentTools: ['axe'] }
  const players = [{ name: 'Rome', civilization: 'roman', start: anchors.castle, settings }]
  const first = session({ players }), second = session({ players })
  try {
    const untouched = save(second), recorder = record(first)
    expect(recorder.enqueue({ tick: 0, player: 1, seq: 0, type: 'urgent-tool', tool: 'hammer' })).toBeNull()
    recorder.advance(1)
    expect(first.state.results.at(-1)).toMatchObject({ ok: true, type: 'urgent-tool' })
    expect(first.state.players[0]!.settings.urgentTools).toEqual(['axe', 'hammer'])
    expect(settings.urgentTools).toEqual(['axe'])
    expect(save(second)).toEqual(untouched)
    expect(verify(recorder.replay(), rules)).toEqual({ ok: true, ticks: 1, checksum: first.checksum() })
  }
  finally { first.dispose(); second.dispose() }
})


test('editing a player view cannot change live work areas or a recording', () => {
  const s = session()
  try {
    const recorder = record(s)
    const expected = structuredClone(s.view(1))
    const exported = s.view(1)
    expect(exported.buildings.length).toBeGreaterThan(0)
    exported.buildings[0]!.workArea.x += 10
    exported.buildings[0]!.workArea.y += 10
    expect(s.view(1)).toEqual(expected)
    expect(verify(recorder.replay(), rules)).toEqual({ ok: true, ticks: 0, checksum: s.checksum() })
  }
  finally { s.dispose() }
})


test('editing displayed command diagnostics cannot change live results or a recording', () => {
  const s = session()
  try {
    const recorder = record(s)
    expect(recorder.enqueue({ tick: 0, player: 1, seq: 0, type: 'build', building: 'not-a-building', x: 0, y: 0 })).toBeNull()
    recorder.advance(1)
    const expected = structuredClone(s.view(1))
    const exported = s.view(1)
    const rejected = exported.events.find(event => event.type === 'rejected')
    expect(rejected).toBeDefined()
    expect(exported.results).toHaveLength(1)
    expect(exported.results[0]!.ok).toBe(false)
    rejected!.text = 'edited presentation'
    exported.results[0]!.ok = true
    exported.results[0]!.reason = 'edited presentation'
    expect(s.view(1)).toEqual(expected)
    expect(verify(recorder.replay(), rules)).toEqual({ ok: true, ticks: 1, checksum: s.checksum() })
  }
  finally { s.dispose() }
})


test('editing displayed survey signs cannot change live surveys or a recording', () => {
  const s = session()
  try {
    order(s, 'specialists', { profession: 'geologist', ...anchors.mountain, count: 1 })
    until(s, () => s.view(1).signs.length > 0, 4000)
    const recorder = record(s)
    const expected = structuredClone(s.view(1).signs)
    const exported = s.view(1)
    expect(exported.signs.length).toBeGreaterThan(0)
    exported.signs[0]!.amount += 100
    exported.signs[0]!.until += 100
    expect(s.view(1).signs).toEqual(expected)
    expect(verify(recorder.replay(), rules)).toEqual({ ok: true, ticks: 0, checksum: s.checksum() })
  }
  finally { s.dispose() }
})
