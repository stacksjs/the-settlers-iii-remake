import { expect, test } from 'bun:test'
import { audit, economicAI, observe, PUBLISHED_RULES, restore, save, stepAI } from '../../resources/game/engine'
import { rivalSession, RIVAL_MILITARY } from '../../resources/game/controller'

// Public decisions and ordinary session execution catch budget loss and recovery.
// They do not establish original AI difficulty or every generated map's economy.
async function captured() {
  const bytes = await Bun.file(new URL('../fixtures/ai-quarry-reserve.json', import.meta.url)).arrayBuffer()
  const provenance = await Bun.file(new URL('../fixtures/ai-quarry-reserve.provenance.json', import.meta.url)).json()
  expect(Bun.SHA256.hash(bytes, 'hex')).toBe(provenance.sha256)
  return restore(JSON.parse(new TextDecoder().decode(bytes)), PUBLISHED_RULES)
}

test('the captured city keeps its quarry budget before granite is discovered', async () => {
  const s = await captured(), before = s.checksum(), o = observe(s, 1)
  expect(o.view.goods.stone).toBe(3)
  expect(o.view.buildings.some(b => b.owner === 1 && b.type === 'stonecutter')).toBe(false)
  expect(o.view.owner.some((owner, tile) => [0, 1].includes(owner) && o.object(tile) === 'stone')).toBe(false)
  const builds = economicAI(1, { military: RIVAL_MILITARY }).decide(o).filter(c => c.type === 'build')
  expect(builds.filter(c => c.building !== 'stonecutter' && (s.rules.buildings.find(b => b.id === c.building)?.cost.stone ?? 0) > 0)).toEqual([])
  expect(s.checksum()).toBe(before)
})

test('the reserved budget becomes real quarried stone through ordinary exploration and construction', async () => {
  const s = await captured(), copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES), created = structuredClone(s.state.ledger[1]!.created)
  const sequences = [1, 2].map(player => ({ next: 1 + Math.max(-1, ...s.state.results.filter(r => r.player === player).map(r => r.seq), ...s.state.pending.filter(r => r.player === player).map(r => r.seq)) }))
  const copied = sequences.map(s => ({ ...s })), ais = [1, 2].map(player => economicAI(player, { military: RIVAL_MILITARY })), fresh = [1, 2].map(player => economicAI(player, { military: RIVAL_MILITARY }))
  const refusals = []
  for (let tick = 0; tick < 24000 && !(s.state.ledger[1]!.produced.stone ?? 0); tick++) {
    for (let p = 0; p < 2; p++) { stepAI(s, ais[p]!, sequences[p]!); stepAI(copy, fresh[p]!, copied[p]!) }
    s.advance(1); copy.advance(1)
    refusals.push(...s.state.results.filter(r => r.tick === s.state.tick - 1 && !r.ok))
  }
  expect(s.state.ledger[1]!.produced.stone ?? 0).toBeGreaterThan(0)
  expect(s.state.ledger[1]!.created).toEqual(created)
  expect(refusals).toEqual([])
  expect(audit(s.context)).toEqual([])
  expect(copy.checksum()).toBe(s.checksum())
}, 60000)

test('ordinary expansion still builds a tower when spare stone covers the quarry and pending sites', () => {
  const s = rivalSession(3), ais = [1, 2].map(player => economicAI(player, { military: RIVAL_MILITARY })), sequences = [{ next: 0 }, { next: 0 }]
  while (s.state.tick < 400) {
    for (let p = 0; p < 2; p++) stepAI(s, ais[p]!, sequences[p]!)
    s.advance(1)
  }
  const o = observe(s, 1)
  expect(o.view.buildings.some(b => b.owner === 1 && b.type === 'stonecutter')).toBe(false)
  expect(ais[0]!.decide(o).some(c => c.type === 'build' && c.building === 'small-tower')).toBe(true)
  stepAI(s, ais[0]!, sequences[0]!); s.advance(1)
  expect(s.state.results.find(r => r.player === 1 && r.tick === 400 && r.type === 'build')?.ok).toBe(true)
  expect(audit(s.context)).toEqual([])
})
