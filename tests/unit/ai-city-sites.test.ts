import { expect, test } from 'bun:test'
import { audit, economicAI, observe, PUBLISHED_RULES, restore, save, stepAI } from '../../resources/game/engine'
import { rivalSession, RIVAL_MILITARY } from '../../resources/game/controller'

async function captured() {
  const bytes = await Bun.file(new URL('../fixtures/ai-crowded-city.json', import.meta.url)).arrayBuffer()
  const provenance = await Bun.file(new URL('../fixtures/ai-crowded-city.provenance.json', import.meta.url)).json()
  expect(Bun.SHA256.hash(bytes, 'hex')).toBe(provenance.sha256)
  return restore(JSON.parse(new TextDecoder().decode(bytes)), PUBLISHED_RULES)
}
function coordinate(order: Record<string, unknown> | undefined, key: string): number {
  const value = order?.[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`Expected integer order field: ${key}`)
  return value
}

test('the captured crowded city plans a legal weaponsmith beyond the nearby holding windows', async () => {
  const s = await captured(), before = s.checksum(), o = observe(s, 1)
  const build = economicAI(1, { military: RIVAL_MILITARY }).decide(o).find(c => c.type === 'build' && c.building === 'weaponsmith')
  expect(build).toBeDefined()
  const x = coordinate(build, 'x'), y = coordinate(build, 'y')
  const holdings = o.view.buildings.filter(b => b.owner === 1 && ['castle', 'small-tower'].includes(b.type))
  expect(Math.min(...holdings.map(b => Math.max(Math.abs(x - b.x), Math.abs(y - b.y))))).toBeGreaterThan(14)
  expect(o.explored(y * o.width + x)).toBe(true)
  expect(o.view.owner[y * o.width + x]).toBe(1)
  expect(s.placement(1, 'weaponsmith', x, y)).toBeNull()
  expect(s.checksum()).toBe(before)
})

test('ordinary city construction completes with matching restored decisions and no grants', async () => {
  const s = await captured(), copy = restore(JSON.parse(JSON.stringify(save(s))), PUBLISHED_RULES), created = structuredClone(s.state.ledger[1]!.created)
  const sequences = [1, 2].map(player => ({ next: 1 + Math.max(-1, ...s.state.results.filter(r => r.player === player).map(r => r.seq), ...s.state.pending.filter(r => r.player === player).map(r => r.seq)) }))
  const copied = sequences.map(s => ({ ...s })), ais = [1, 2].map(player => economicAI(player, { military: RIVAL_MILITARY })), fresh = [1, 2].map(player => economicAI(player, { military: RIVAL_MILITARY }))
  for (let tick = 0; tick < 12000 && !s.view(1).buildings.some(b => b.owner === 1 && b.type === 'weaponsmith' && b.phase === 'active'); tick++) {
    for (let p = 0; p < 2; p++) { stepAI(s, ais[p]!, sequences[p]!); stepAI(copy, fresh[p]!, copied[p]!) }
    s.advance(1); copy.advance(1)
  }
  expect(s.view(1).buildings.some(b => b.owner === 1 && b.type === 'weaponsmith' && b.phase === 'active')).toBe(true)
  expect(s.state.ledger[1]!.created).toEqual(created)
  expect(audit(s.context)).toEqual([])
  expect(copy.checksum()).toBe(s.checksum())
}, 60000)

test('existing nearby selection remains the first choice', () => {
  const s = rivalSession(2), o = observe(s, 1)
  expect(economicAI(1, { military: RIVAL_MILITARY }).decide(o).find(c => c.type === 'build')).toEqual({ type: 'build', building: 'sawmill', x: 46, y: 62 })
})

test('the fallback respects a stricter client knowledge or ownership view', async () => {
  const s = await captured(), o = observe(s, 1), hidden = new Set<number>()
  for (let tile = 0; tile < o.width * o.height; tile++) if (o.explored(tile) && o.view.owner[tile] === 1 && !o.placement('weaponsmith', tile % o.width, Math.floor(tile / o.width))) hidden.add(tile)
  expect(hidden.size).toBe(8)
  // Withhold candidates in the public observation; the real simulation is unchanged.
  const limited = { ...o, explored: (tile: number) => o.explored(tile) && !hidden.has(tile) }
  const foreign = { ...o, view: { ...o.view, owner: o.view.owner.map((owner, tile) => hidden.has(tile) ? 2 : owner) } }
  const before = s.checksum()
  for (const view of [limited, foreign]) expect(economicAI(1, { military: RIVAL_MILITARY }).decide(view).some(c => c.type === 'build' && c.building === 'weaponsmith')).toBe(false)
  expect(s.checksum()).toBe(before)
})
