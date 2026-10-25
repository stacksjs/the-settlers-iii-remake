import { expect, test } from 'bun:test'
import type { Replay } from '../../resources/game/engine'
import legacy from '../fixtures/replay-format-1.json'
import { PUBLISHED_RULES, record, verify } from '../../resources/game/engine'
import { rules, session } from '../fixtures/engine'

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
