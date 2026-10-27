import { expect, test } from 'bun:test'
import type { Session } from '../../resources/game/engine'
import { audit, createSession, describeMap, economicAI, findBuildingSite, openSession, PUBLISHED_RULES, record, restore, ROMAN_ENGINEERING as rules, rulesIdentity, save, stepAI, validateRules, verify } from '../../resources/game/engine'
import { rivalSession, RIVAL_MILITARY } from '../../resources/game/controller'
import { anchors, order, place, session, until } from '../fixtures/engine'

// Public staffing controls and physical tools prove recovery. They do not
// establish original reassignment timing, percentage controls or a human win.
async function captured() {
  const bytes = await Bun.file(new URL('../fixtures/construction-crew-surplus.json', import.meta.url)).arrayBuffer()
  expect(Bun.SHA256.hash(bytes, 'hex')).toBe('c097e8737e78286cbb6363fff9fd88a3901c8037c8ec12dbe957eba928789fe6')
  return restore(JSON.parse(new TextDecoder().decode(bytes)), PUBLISHED_RULES)
}
const crew = (s: Session, profession: string, owner = 1) => s.view(owner).settlers.filter(p => p.owner === owner && p.profession === profession)
const next = (s: Session, player: number) => 1 + Math.max(-1, ...s.state.results.filter(r => r.player === player).map(r => r.seq), ...s.state.pending.filter(r => r.player === player).map(r => r.seq))

test('the captured 0.11 staffing save and replay retain their exact behavior', async () => {
  const s = await captured(), recorder = record(s), traced: Session = { ...s, enqueue: recorder.enqueue, advance: recorder.advance }
  expect(rulesIdentity(s.rules).digest).toBe('f1ce0705bbe9a53bf880e7c1d38036404c56e1d7256517123d3dd1e38aee0e78')
  expect(s.checksum()).toBe('1e8e5a21')
  expect(traced.enqueue({ tick: s.state.tick, player: 1, seq: 4, type: 'settings', settings: { builderLimit: 2 } })).toBeNull()
  traced.advance(1)
  const ai = economicAI(2, { military: RIVAL_MILITARY }), sequence = { next: next(s, 2) }
  for (let i = 0; i < 200; i++) { stepAI(traced, ai, sequence); traced.advance(1) }
  expect(traced.enqueue({ tick: s.state.tick, player: 1, seq: 5, type: 'specialists', profession: 'geologist', count: 1, x: 38, y: 60 })).toBeNull()
  traced.advance(1)
  expect(crew(s, 'builder').length).toBe(8)
  expect(s.view(1).results.at(-1)).toMatchObject({ ok: false, reason: 'No geologist could be equipped.' })
  expect(s.checksum()).toBe('f6debd29')
  expect(verify(recorder.replay(), PUBLISHED_RULES)).toMatchObject({ ok: true, checksum: 'f6debd29' })
  expect(audit(s.context)).toEqual([])
}, 30000)

test('current staffing controls recover actual idle builder hammers and equip a geologist', async () => {
  const legacy = await captured()
  // An explicit separate engineering scenario, not a silent save upgrade.
  // This is an explicit current-rule scenario. Translate terrain names rather
  // than reinterpreting the frozen profile's indices as the new catalog.
  const state = structuredClone(legacy.state)
  for (let tile = 0; tile < state.map.terrain.length; tile++) state.map.terrain[tile] = rules.terrain.findIndex(t => t.id === legacy.rules.terrain[state.map.terrain[tile]!]!.id)
  const s = openSession(rules, state, { id: 'crew-rule-comparison', digest: legacy.checksum() })
  const created = structuredClone(s.state.ledger[1]!.created), recovered = s.state.ledger[1]!.recovered.hammer ?? 0
  const seq = next(s, 1)
  expect(s.enqueue({ tick: s.state.tick, player: 1, seq, type: 'settings', settings: { builderLimit: 2 } })).toBeNull()
  s.advance(1)
  const copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
  s.advance(200); copy.advance(200)
  expect(crew(s, 'builder').length).toBe(2)
  expect(s.state.ledger[1]!.recovered.hammer).toBe(recovered + 6)
  expect(s.view(1).goods.hammer).toBe(6)
  expect(copy.checksum()).toBe(s.checksum())
  expect(s.enqueue({ tick: s.state.tick, player: 1, seq: seq + 1, type: 'specialists', profession: 'geologist', count: 1, x: 38, y: 60 })).toBeNull()
  s.advance(1)
  expect(s.view(1).results.at(-1)?.ok).toBe(true)
  s.advance(1000)
  expect(crew(s, 'geologist').length).toBe(1)
  expect(s.state.ledger[1]!.created).toEqual(created)
  expect(audit(s.context)).toEqual([])
})

test('digger and builder caps return only the current player surplus and preserve the retained crew', () => {
  const s = createSession({ rules, seed: 5, map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: [] }), players: [
    { name: 'Rome', civilization: 'roman', start: { x: 25, y: 25 }, settlers: { carrier: 6, builder: 2, digger: 2 }, goods: {} },
    { name: 'Other', civilization: 'roman', start: { x: 70, y: 70 }, settlers: { carrier: 6, builder: 2, digger: 2 }, goods: {} },
  ] })
  const before = structuredClone(s.state.ledger)
  order(s, 'settings', { settings: { builderLimit: 1, diggerLimit: 1 } })
  s.advance(40)
  expect(crew(s, 'builder').length).toBe(1)
  expect(crew(s, 'digger').length).toBe(1)
  expect(crew(s, 'builder', 2).length).toBe(2)
  expect(crew(s, 'digger', 2).length).toBe(2)
  expect(s.view(1).goods.hammer).toBe(1)
  expect(s.view(1).goods.shovel).toBe(1)
  for (const owner of [1, 2]) expect(s.state.ledger[owner]?.created ?? {}).toEqual(before[owner]?.created ?? {})
  expect(audit(s.context)).toEqual([])
})

test('an ordinary four-site opening can release real hammers through its staffing control', () => {
  const s = rivalSession(2), home = s.view(1).buildings.find(b => b.type === 'castle')!
  const created = structuredClone(s.state.ledger[1]!.created), ai = economicAI(2, { military: RIVAL_MILITARY }), sequence = { next: 0 }
  for (const type of ['woodcutter', 'stonecutter', 'sawmill', 'forester']) {
    const site = findBuildingSite(s, 1, type, home)
    expect(site).not.toBeNull()
    order(s, 'build', { building: type, ...site! })
  }
  for (let tick = 0; tick < 5000; tick++) { stepAI(s, ai, sequence); s.advance(1) }
  expect(crew(s, 'builder').length).toBe(8)
  expect(s.view(1).goods.hammer ?? 0).toBe(0)
  order(s, 'settings', { settings: { builderLimit: 2 } })
  for (let tick = 0; tick < 200; tick++) { stepAI(s, ai, sequence); s.advance(1) }
  expect(crew(s, 'builder').length).toBe(2)
  expect(s.view(1).goods.hammer).toBe(6)
  order(s, 'specialists', { profession: 'geologist', count: 1, x: home.x, y: home.y })
  s.advance(1000)
  expect(crew(s, 'geologist').length).toBe(1)
  expect(s.state.ledger[1]!.created).toEqual(created)
  expect(ai.results).toEqual([])
  expect(s.state.results.every(r => r.ok)).toBe(true)
  expect(audit(s.context)).toEqual([])
})

test('construction reassignment is a validated evidenced rule', () => {
  const unknown = structuredClone(rules)
  Object.assign(unknown, { constructionReassignment: 'discard-tool' })
  expect(() => validateRules(unknown)).toThrow('Unknown construction reassignment policy')
  const unrecorded = structuredClone(rules)
  delete unrecorded.evidence.constructionReassignment
  expect(() => validateRules(unrecorded)).toThrow('constructionReassignment has no evidence record')
})

test('a reduced cap keeps busy builders and their tools until the site finishes', () => {
  const s = session({ settlers: { carrier: 8, builder: 2 }, goods: { plank: 16, stone: 16 } })
  const site = place(s, 'storage', anchors.west)
  until(s, () => s.state.buildings.get(site)!.workers.length === 2, 2000)
  const working = [...s.state.buildings.get(site)!.workers]
  order(s, 'settings', { settings: { builderLimit: 0 } })
  expect(working.every(id => s.state.settlers.get(id)?.profession === 'builder' && s.state.settlers.get(id)?.tool === 'hammer')).toBe(true)
  until(s, () => s.state.buildings.get(site)!.phase === 'active', 6000)
  s.advance(40)
  expect(crew(s, 'builder').length).toBe(0)
  expect(s.state.ledger[1]!.recovered.hammer).toBe(2)
  expect(s.state.jobs.size).toBe(0)
  expect(audit(s.context)).toEqual([])
})

function fullGroundScenario(goods: string[] = ['log']) {
  const map = describeMap(rules, { width: 32, height: 32, base: 'water', features: [{ kind: 'terrain', id: 'grass', x: 16, y: 16, radius: 15 }] })
  const grass = rules.terrain.findIndex(t => t.id === 'grass')
  const layout = createSession({ rules, seed: 5, map, players: [{ name: 'Rome', civilization: 'roman', start: { x: 16, y: 16 }, settlers: {}, goods: {} }] })
  // The source ground border needs one more shore tile than the old coarse profile.
  const storageSite = findBuildingSite(layout, 1, 'storage', { x: 16, y: 16 })
  expect(storageSite).not.toBeNull()
  layout.dispose()
  const piles = Array.from({ length: 32 * 32 }, (_, tile) => tile).filter(tile => map.terrain[tile] === grass)
    .map((tile, i) => ({ good: goods[i % goods.length]!, amount: rules.logistics.groundPileCapacity, x: tile % 32, y: Math.floor(tile / 32) }))
  const s = createSession({ rules, seed: 5, map, players: [{ name: 'Rome', civilization: 'roman', start: { x: 16, y: 16 }, settings: { builderLimit: 0 }, scenario: {
    buildings: [{ type: 'castle', x: 16, y: 16 }, { type: 'storage', ...storageSite! }],
    settlers: [{ profession: 'builder', x: 11, y: 20 }, { profession: 'carrier', x: 11, y: 21 }],
  } }], piles })
  expect(s.skipped).toEqual({})
  const storage = s.view(1).buildings.find(b => b.type === 'storage')!, created = structuredClone(s.state.ledger[1]!.created)
  order(s, 'suspend', { building: storage.id, suspended: true })
  s.advance(40)
  return { s, storage, storageSite, created }
}

test('a worker keeps his tool when the ground is full and returns it after real delivery frees room', () => {
  const { s, storage, created } = fullGroundScenario()
  expect(crew(s, 'builder').length).toBe(1)
  expect(crew(s, 'builder')[0]!.tool).toBe('hammer')
  expect(s.state.ledger[1]!.recovered.hammer ?? 0).toBe(0)
  expect(audit(s.context)).toEqual([])
  order(s, 'settings', { settings: { stored: ['log'] } })
  order(s, 'suspend', { building: storage.id, suspended: false })
  const copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
  s.advance(5000); copy.advance(5000)
  expect(crew(s, 'builder').length).toBe(0)
  expect(s.state.ledger[1]!.recovered.hammer).toBe(1)
  expect(s.view(1).goods.hammer).toBe(1)
  expect(s.state.ledger[1]!.created).toEqual(created)
  expect(copy.checksum()).toBe(s.checksum())
  expect(audit(s.context)).toEqual([])
}, 30000)

test('surplus crew cannot start new work above the cap while their tool cannot be put down', () => {
  const { s, storage, storageSite } = fullGroundScenario(['plank', 'stone'])
  expect(crew(s, 'builder').length).toBe(1)
  order(s, 'demolish', { building: storage.id })
  order(s, 'build', { building: 'storage', ...storageSite! })
  const site = s.view(1).buildings.find(b => b.type === 'storage')!
  s.advance(2000)
  expect(s.state.buildings.get(site.id)!.phase).toBe('building')
  expect(s.state.buildings.get(site.id)!.workers).toEqual([])
  const materials = [...s.state.stacks.values()].filter(p => p.building === site.id && p.role === 'construction').reduce((sum, p) => sum + p.amount, 0)
  expect(materials).toBeGreaterThanOrEqual(Object.values(rules.buildings.find(b => b.id === 'storage')!.cost).reduce((sum, n) => sum + n, 0))
  expect(crew(s, 'builder')[0]?.tool).toBe('hammer')
  expect(audit(s.context)).toEqual([])
}, 30000)
