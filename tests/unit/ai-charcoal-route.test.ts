import { expect, test } from 'bun:test'
import { audit, economicAI, observe, PUBLISHED_RULES, restore, save, stepAI } from '../../resources/game/engine'
import { rivalSession, RIVAL_MILITARY } from '../../resources/game/controller'

// Public policy/session commands prove an actual alternative coal chain.
// They do not establish original AI priorities or a completed seeded match.
async function captured() {
  const bytes = await Bun.file(new URL('../fixtures/ai-charcoal-route.json', import.meta.url)).arrayBuffer()
  const provenance = await Bun.file(new URL('../fixtures/ai-charcoal-route.provenance.json', import.meta.url)).json()
  expect(Bun.SHA256.hash(bytes, 'hex')).toBe(provenance.sha256)
  return restore(JSON.parse(new TextDecoder().decode(bytes)), PUBLISHED_RULES)
}

test('the captured iron economy plans an available Roman charcoal maker without granting stock', async () => {
  const s = await captured(), before = s.checksum(), o = observe(s, 2)
  expect(o.view.buildings.some(b => b.owner === 2 && b.type === 'iron-mine' && b.phase === 'active')).toBe(true)
  expect(s.state.ledger[2]!.produced.coal ?? 0).toBe(0)
  expect(economicAI(2, { military: RIVAL_MILITARY }).decide(o).some(c => c.type === 'build' && c.building === 'charcoal-maker')).toBe(true)
  expect(s.checksum()).toBe(before)
})

test('ordinary planning delivers planks, makes coal and smelts real iron with a matching restore', async () => {
  const s = await captured(), copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES), created = structuredClone(s.state.ledger[2]!.created)
  const sequences = [1, 2].map(player => ({ next: 1 + Math.max(-1, ...s.state.results.filter(r => r.player === player).map(r => r.seq), ...s.state.pending.filter(r => r.player === player).map(r => r.seq)) }))
  const copied = sequences.map(s => ({ ...s })), ais = [1, 2].map(player => economicAI(player, { military: RIVAL_MILITARY })), fresh = [1, 2].map(player => economicAI(player, { military: RIVAL_MILITARY })), refusals = []
  // This captured city must first restore stone supply as well as both new workplaces.
  for (let tick = 0; tick < 24000 && !(s.state.ledger[2]!.produced.iron ?? 0); tick++) {
    for (let p = 0; p < 2; p++) { stepAI(s, ais[p]!, sequences[p]!); stepAI(copy, fresh[p]!, copied[p]!) }
    s.advance(1); copy.advance(1)
    refusals.push(...s.state.results.filter(r => r.tick === s.state.tick - 1 && !r.ok))
  }
  expect(s.state.ledger[2]!.produced.coal ?? 0).toBeGreaterThan(0)
  expect(s.state.ledger[2]!.produced.iron ?? 0).toBeGreaterThan(0)
  expect(s.state.ledger[2]!.created).toEqual(created)
  expect(refusals).toEqual([])
  expect(audit(s.context)).toEqual([])
  expect(copy.checksum()).toBe(s.checksum())
}, 60000)

test('a retained working coal mine remains preferred to a new charcoal maker', async () => {
  const s = await captured(), o = observe(s, 1)
  expect(o.view.buildings.some(b => b.owner === 1 && b.type === 'coal-mine' && b.phase === 'active')).toBe(true)
  expect(economicAI(1, { military: RIVAL_MILITARY }).decide(o).some(c => c.type === 'build' && c.building === 'charcoal-maker')).toBe(false)
})

test('a planned alternative supplies the smelter prerequisite without another coal producer', async () => {
  const s = await captured(), first = economicAI(2, { military: RIVAL_MILITARY }).decide(observe(s, 2)).find(c => c.type === 'build' && c.building === 'charcoal-maker')
  expect(first).toBeDefined()
  if (!first) throw new Error('Expected a charcoal construction order')
  const seq = 1 + Math.max(-1, ...s.state.results.filter(r => r.player === 2).map(r => r.seq), ...s.state.pending.filter(r => r.player === 2).map(r => r.seq))
  expect(s.enqueue({ ...first, type: 'build', tick: s.state.tick, player: 2, seq })).toBeNull()
  s.advance(1)
  expect(s.state.results.find(r => r.player === 2 && r.seq === seq)?.ok).toBe(true)
  // The explicit policy option exposes the prerequisite while two sites are pending.
  const orders = economicAI(2, { military: RIVAL_MILITARY, maxSites: 4 }).decide(observe(s, 2))
  expect(orders.some(c => c.type === 'build' && c.building === 'iron-smelter')).toBe(true)
  expect(orders.some(c => c.type === 'build' && ['charcoal-maker', 'coal-mine'].includes(String(c.building)))).toBe(false)
})

test('a client catalog without the optional charcoal building cannot plan it', async () => {
  const s = await captured(), o = observe(s, 2), before = s.checksum()
  const limited = { ...o, rules: { ...o.rules, buildings: o.rules.buildings.filter(b => b.id !== 'charcoal-maker') } }
  expect(economicAI(2, { military: RIVAL_MILITARY }).decide(limited).some(c => c.type === 'build' && c.building === 'charcoal-maker')).toBe(false)
  expect(s.checksum()).toBe(before)
})

test('charcoal construction waits for an ore producer or an actual coal consumer', () => {
  const s = rivalSession(2), ai = economicAI(2, { military: RIVAL_MILITARY }), sequence = { next: 0 }
  for (let tick = 0; tick < 20000; tick++) {
    if (s.state.tick % ai.interval === 0) {
      const o = observe(s, 2), orders = ai.decide(o)
      if (orders.some(c => c.type === 'build' && c.building === 'charcoal-maker')) {
        const needed = o.view.buildings.some(b => b.owner === 2 && !b.suspended && ((b.phase === 'active' && (o.rules.buildings.find(r => r.id === b.type)?.outputs.ironore ?? 0) > 0) || (o.rules.buildings.find(r => r.id === b.type)?.inputs.coal ?? 0) > 0))
        expect({ tick: s.state.tick, needsCoal: needed }).toMatchObject({ needsCoal: true })
      }
    }
    stepAI(s, ai, sequence); s.advance(1)
  }
  expect(audit(s.context)).toEqual([])
})
