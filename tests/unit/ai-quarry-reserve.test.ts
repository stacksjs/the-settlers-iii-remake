import { expect, test } from 'bun:test'
import { audit, createSession, describeMap, ROMAN_ENGINEERING as rules, economicAI, observe, PUBLISHED_RULES, restore, save, stepAI } from '../../resources/game/engine'
import { RIVAL_MILITARY } from '../../resources/game/controller'

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

test('ordinary expansion spends only stone remaining after the quarry and pending-site budgets', () => {
  // A defined budget boundary, independent of a generated map's evolving
  // shoreline, scouting route or the tick at which another site finishes.
  // 3 quarry + 1 pending forester + 3 tower = 7 available stone.
  // A carrier has already picked up one additional stone for the forester.
  for (const stone of [7, 8]) {
    const s = createSession({ rules, seed: 3, map: describeMap(rules, { width: 96, height: 96, base: 'grass', features: [] }), players: [{ name: 'Computer', civilization: 'roman', controller: 'computer', start: { x: 40, y: 40 }, goods: { plank: 10, stone, hammer: 2, shovel: 1 } }] })
    expect(s.enqueue({ type: 'build', tick: 0, player: 1, seq: 0, building: 'forester', x: 31, y: 44 })).toBeNull()
    s.advance(1)
    const before = s.checksum(), o = observe(s, 1), created = structuredClone(s.state.ledger[1]!.created)
    expect(o.view.buildings.some(b => b.type === 'stonecutter')).toBe(false)
    expect(o.view.buildings.some(b => b.type === 'forester' && b.phase !== 'active')).toBe(true)
    expect(o.view.stacks.filter(stack => stack.good === 'stone' && stack.role === 'ground').reduce((sum, stack) => sum + stack.amount, 0)).toBe(stone - 1)
    const orders = economicAI(1, { military: RIVAL_MILITARY }).decide(o), tower = orders.find(c => c.type === 'build' && c.building === 'small-tower')
    expect(s.checksum()).toBe(before)
    if (stone === 7) expect(orders.filter(c => c.type === 'build')).toEqual([])
    else {
      expect(tower).toBeDefined()
      expect(s.enqueue({ ...tower!, type: 'build', tick: s.state.tick, player: 1, seq: 1 })).toBeNull()
      s.advance(1)
      expect(s.state.results.find(r => r.player === 1 && r.seq === 1)?.ok).toBe(true)
    }
    expect(s.state.ledger[1]!.created).toEqual(created)
    expect(audit(s.context)).toEqual([]); s.dispose()
  }
})
