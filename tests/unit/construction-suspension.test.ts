import { expect, test } from 'bun:test'
import type { RulesProfile } from '../../resources/game/engine'
import { audit, createSession, describeMap, PUBLISHED_RULES, record, restore, ROMAN_ENGINEERING as rules, save, validateRules, verify } from '../../resources/game/engine'
import { anchors, order, place, session, until } from '../fixtures/engine'

// The public session command seam proves paused physical construction and
// saved/replayed work. It does not establish original Gold suspension timing.
function site(phase: 'leveling' | 'building', profile: RulesProfile = rules) {
  const s = createSession({ rules: profile, seed: 5,
    map: describeMap(profile, { width: 96, height: 96, base: 'grass', features: phase === 'leveling' ? [{ kind: 'elevation', ...anchors.west, radius: 3, amount: 6 }] : [] }),
    players: [{ name: 'Rome', civilization: 'roman', start: anchors.castle, settlers: { carrier: 12, builder: 1, digger: 1 }, goods: { plank: 20, stone: 20 } }],
  })
  order(s, 'settings', { settings: { builderLimit: 1, diggerLimit: 1 } })
  const id = place(s, 'sawmill', anchors.west)
  const b = s.state.buildings.get(id)!
  until(s, () => b.phase === phase && b.workers.some(id => s.state.settlers.get(id)?.action === 'working'), 4000)
  return { s, b }
}

for (const phase of ['building', 'leveling'] as const) {
  test(`suspending a ${phase} site preserves its actual worker progress until resumed`, () => {
    const { s, b } = site(phase)
    const worker = s.state.settlers.get(b.workers[0]!)!
    const progress = worker.step, remaining = { build: b.workRemaining, level: b.levelRemaining }, used = structuredClone(b.used), elevation = [...s.state.map.elevation]
    order(s, 'suspend', { building: b.id, suspended: true })
    s.advance(400)
    expect(b.workRemaining).toBe(remaining.build)
    expect(b.levelRemaining).toBe(remaining.level)
    expect(b.used).toEqual(used)
    expect([...s.state.map.elevation]).toEqual(elevation)
    expect(worker.step).toBe(progress)
    expect(worker.action).toBe('working')
    expect(s.view(1).buildings.find(view => view.id === b.id)?.suspended).toBe(true)
    expect(audit(s.context)).toEqual([])
    order(s, 'suspend', { building: b.id, suspended: false })
    until(s, () => phase === 'building' ? b.workRemaining < remaining.build : b.levelRemaining < remaining.level, 500)
    expect(audit(s.context)).toEqual([])
  })

  test(`a suspend order blocks an already due ${phase} effect and preserves it across restore and replay`, () => {
    const { s, b } = site(phase)
    const effect = phase === 'building' ? 'build' : 'level'
    until(s, () => b.workers.some(id => {
      const person = s.state.settlers.get(id), op = person?.program?.steps[person.program.pc]
      return op?.op === 'do' && op.effect === effect
    }), 500)
    const remaining = { build: b.workRemaining, level: b.levelRemaining }, used = structuredClone(b.used)
    const recorder = record(s)
    expect(recorder.enqueue({ tick: s.state.tick, player: 1, seq: 2, type: 'suspend', building: b.id, suspended: true })).toBeNull()
    recorder.advance(400)
    expect(b.workRemaining).toBe(remaining.build)
    expect(b.levelRemaining).toBe(remaining.level)
    expect(b.used).toEqual(used)
    const copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
    expect(recorder.enqueue({ tick: s.state.tick, player: 1, seq: 3, type: 'suspend', building: b.id, suspended: false })).toBeNull()
    expect(copy.enqueue({ tick: copy.state.tick, player: 1, seq: 3, type: 'suspend', building: b.id, suspended: false })).toBeNull()
    recorder.advance(400); copy.advance(400)
    expect(copy.checksum()).toBe(s.checksum())
    expect(phase === 'building' ? b.workRemaining < remaining.build : b.levelRemaining < remaining.level).toBe(true)
    expect(verify(recorder.replay(), PUBLISHED_RULES)).toMatchObject({ ok: true, checksum: s.checksum() })
    expect(audit(s.context)).toEqual([])
    expect(audit(copy.context)).toEqual([])
  })

  test(`demolishing a suspended ${phase} site releases its paused crew without stranded work`, () => {
    const { s, b } = site(phase)
    const workers = [...b.workers]
    order(s, 'suspend', { building: b.id, suspended: true })
    s.advance(100)
    order(s, 'demolish', { building: b.id })
    s.advance(400)
    expect(s.view(1).buildings.some(view => view.id === b.id)).toBe(false)
    for (const id of workers) expect(s.state.settlers.get(id)).toMatchObject({ workplace: 0, program: null })
    expect([...s.state.jobs.values()].some(job => job.kind === 'equip' && job.building === b.id)).toBe(false)
    expect(audit(s.context)).toEqual([])
  })
}

test('a worker who finishes equipping cannot start a fresh site operation while suspended', () => {
  const s = session({ settlers: { carrier: 12 }, goods: { plank: 20, stone: 20, hammer: 2, shovel: 2 } })
  const id = place(s, 'sawmill', anchors.west), b = s.state.buildings.get(id)!
  until(s, () => b.workers.some(id => s.state.settlers.get(id)?.program?.kind === 'equip'), 4000)
  const worker = [...s.state.settlers.values()].find(person => person.workplace === id && person.program?.kind === 'equip')!
  order(s, 'suspend', { building: id, suspended: true })
  until(s, () => worker.program?.kind === 'site', 1000)
  expect(worker).toMatchObject({ action: 'idle', next: -1, path: [], program: { kind: 'site', pc: 0 } })
  s.advance(200)
  expect(worker).toMatchObject({ action: 'idle', next: -1, path: [], program: { kind: 'site', pc: 0 } })
  expect(audit(s.context)).toEqual([])
  order(s, 'suspend', { building: id, suspended: false })
  until(s, () => worker.action === 'working', 1000)
  expect(audit(s.context)).toEqual([])
})

test('published 0.15 construction saves and replays retain their original suspension behavior', () => {
  const legacy = PUBLISHED_RULES.find(profile => profile.version === '0.15.0')!
  for (const phase of ['building', 'leveling'] as const) {
    const { s, b } = site(phase, legacy), recorder = record(s)
    const remaining = phase === 'building' ? b.workRemaining : b.levelRemaining
    expect(recorder.enqueue({ tick: s.state.tick, player: 1, seq: 2, type: 'suspend', building: b.id, suspended: true })).toBeNull()
    recorder.advance(400)
    expect(phase === 'building' ? b.workRemaining : b.levelRemaining).toBe(remaining - 1)
    const copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
    recorder.advance(100); copy.advance(100)
    expect(copy.checksum()).toBe(s.checksum())
    expect(verify(recorder.replay(), PUBLISHED_RULES)).toMatchObject({ ok: true, checksum: s.checksum() })
    expect(audit(s.context)).toEqual([])
  }
})

test('construction suspension policy is validated and requires evidence', () => {
  const unknown = structuredClone(rules)
  Object.assign(unknown, { constructionSuspension: 'discard-progress' })
  expect(() => validateRules(unknown)).toThrow('Unknown construction suspension policy')
  const unevidenced = structuredClone(rules)
  delete unevidenced.evidence.constructionSuspension
  expect(() => validateRules(unevidenced)).toThrow('constructionSuspension has no evidence record')
})
