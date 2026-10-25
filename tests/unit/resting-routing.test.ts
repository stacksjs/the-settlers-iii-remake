import { expect, test } from 'bun:test'
import { audit, economicAI, openSession, PUBLISHED_RULES, record, restore, ROMAN_ENGINEERING as rules, save, stepAI, validateRules, verify } from '../../resources/game/engine'
import { route } from '../../resources/game/engine/routing'
import { rivalSession, RIVAL_MILITARY } from '../../resources/game/controller'

// Public sessions/saved movement programs catch impossible resting orders.
// They do not establish original crowd rules or a wall-clock performance bound.
test('ordinary civilian resting orders choose free destinations reachable within their territory', () => {
  const s = rivalSession(2), ai = economicAI(2, { military: RIVAL_MILITARY }), sequence = { next: 0 }
  while (s.state.tick < 26000) { stepAI(s, ai, sequence); s.advance(1) }
  const invalid = []
  for (const person of s.state.settlers.values()) {
    const op = person.program?.steps[person.program.pc]
    if (person.program?.kind !== 'settle' || op?.op !== 'go') continue
    const territory = s.rules.professions.find(p => p.id === person.profession)?.specialist ? 0 : person.owner
    if (!route(s.context, person.y * s.state.map.width + person.x, op.tile, { territory }).ok) invalid.push({ id: person.id, target: op.tile, owner: person.owner, targetOwner: s.state.map.owner[op.tile] })
  }
  expect(invalid).toEqual([])
  expect(s.state.ledger[2]!.created.plank).toBe(30)
  expect(audit(s.context)).toEqual([])
  const copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES), fresh = economicAI(2, { military: RIVAL_MILITARY }), copied = { ...sequence }
  for (let tick = 0; tick < 1000; tick++) { stepAI(s, ai, sequence); stepAI(copy, fresh, copied); s.advance(1); copy.advance(1) }
  expect(copy.checksum()).toBe(s.checksum())
  expect(audit(copy.context)).toEqual([])
}, 120000)

test('the frozen 0.10 captured rest/save/replay keeps its exact previous behavior', async () => {
  const bytes = await Bun.file(new URL('../fixtures/rest-neutral-tile.json', import.meta.url)).arrayBuffer()
  const provenance = await Bun.file(new URL('../fixtures/rest-neutral-tile.provenance.json', import.meta.url)).json()
  expect(Bun.SHA256.hash(bytes, 'hex')).toBe(provenance.fixtureSha256)
  const s = restore(JSON.parse(new TextDecoder().decode(bytes)), PUBLISHED_RULES), recorder = record(s)
  expect(s.rules.version).toBe('0.10.0')
  expect(s.checksum()).toBe('eab2856b')
  recorder.advance(1)
  expect(s.checksum()).toBe('f5184e9d')
  expect(verify(recorder.replay(), PUBLISHED_RULES)).toMatchObject({ ok: true, checksum: 'f5184e9d' })
  expect(audit(s.context)).toEqual([])
})

test('an explicit new-rules scenario resolves the captured crowd through movement without grants', async () => {
  const bytes = await Bun.file(new URL('../fixtures/rest-neutral-tile.json', import.meta.url)).arrayBuffer()
  const legacy = restore(JSON.parse(new TextDecoder().decode(bytes)), PUBLISHED_RULES)
  // Construct a separate engineering scenario from the captured physical state.
  // Loading the original save above continues to select its frozen 0.10 rules.
  const s = openSession(rules, structuredClone(legacy.state), { id: 'resting-rule-comparison', digest: Bun.SHA256.hash(bytes, 'hex') })
  const crowd = [...s.state.settlers.values()].filter(p => p.program?.kind === 'settle').map(p => ({ id: p.id, x: p.x, y: p.y }))
  const created = structuredClone(s.state.ledger)
  expect(crowd.length).toBe(12)
  s.advance(1)
  for (const before of crowd) {
    const person = s.state.settlers.get(before.id)!
    expect({ x: person.x, y: person.y }).toEqual({ x: before.x, y: before.y })
    const op = person.program?.steps[person.program.pc]
    if (op?.op === 'go') expect(route(s.context, person.y * s.state.map.width + person.x, op.tile, { territory: person.owner }).ok).toBe(true)
  }
  const copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES)
  s.advance(1000); copy.advance(1000)
  expect(copy.checksum()).toBe(s.checksum())
  for (const player of s.state.players) expect(s.state.ledger[player.id]!.created).toEqual(created[player.id]!.created)
  expect(audit(s.context)).toEqual([])
})

test('resting routing policy is validated and carries its own evidence', () => {
  const unknown = JSON.parse(JSON.stringify(rules))
  unknown.restingRouting = 'teleport'
  expect(() => validateRules(unknown)).toThrow('Unknown resting routing policy')
  const unrecorded = JSON.parse(JSON.stringify(rules))
  unrecorded.restingRouting = 'reachable'
  delete unrecorded.evidence.restingRouting
  expect(() => validateRules(unrecorded)).toThrow('restingRouting has no evidence record')
})
