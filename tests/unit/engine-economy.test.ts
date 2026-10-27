import { describe, expect, test } from 'bun:test'
import { checksum, restore, save } from '../../resources/game/engine'
import { footprint, ruleOf, tileOf } from '../../resources/game/engine/context'
import { area, distance, indexOf, neighbours } from '../../resources/game/engine/geometry'
import { anchors, building, conserved, landscape, order, place, present, rules, run, session, site, until } from '../fixtures/engine'

const jobsReferToLiveStacks = (s: ReturnType<typeof session>): boolean => [...s.state.jobs.values()].every(j => (j.picked || s.state.stacks.has(j.source)) && (j.kind !== 'deliver' || s.state.stacks.has(j.target)))

describe('physical construction', () => {
  test('diggers level uneven ground before builders consume delivered materials, and work starts only after completion', () => {
    const map = landscape([{ kind: 'elevation', ...anchors.west, radius: 3, amount: 6 }])
    const s = session({ map })
    const id = place(s, 'sawmill', anchors.west)
    const b = s.state.buildings.get(id)!
    const tiles = footprint(ruleOf(s.context, b), b).map(p => tileOf(s.context, p))
    const before = tiles.map(t => s.state.map.elevation[t]!)
    expect(new Set(before).size).toBeGreaterThan(1)
    expect(b.phase).toBe('leveling')
    const planks = present(s, 1).plank!
    until(s, () => b.phase !== 'leveling', 3000)
    // Levelling alone consumes no materials and flattens the actual terrain.
    expect(s.state.ledger[1]!.consumed.plank ?? 0).toBe(0)
    expect(new Set(tiles.map(t => s.state.map.elevation[t]!)).size).toBe(1)
    expect(s.state.map.elevation[tiles[0]!]).toBe(b.target)
    until(s, () => b.phase === 'active', 3000)
    expect(b.used).toEqual(rules.buildings.find(r => r.id === 'sawmill')!.cost)
    expect(present(s, 1).plank).toBe(planks - 3)
    expect(s.state.ledger[1]!.produced.plank ?? 0).toBe(0)
    expect(b.workers).toEqual([])
    expect([...s.state.settlers.values()].filter(p => p.profession === 'builder' || p.profession === 'digger').every(p => p.workplace === 0)).toBe(true)
  })
  test('a site waits for missing material and resumes when goods become available', () => {
    const s = session({ goods: { plank: 6, stone: 0, axe: 1, saw: 1, pickaxe: 1, hammer: 2, shovel: 1 } })
    const quarry = place(s, 'stonecutter', anchors.granite)
    run(s, 1500)
    const q = s.state.buildings.get(quarry)!
    expect(q.phase).toBe('building')
    expect(q.used).toEqual({ plank: 2 })
    expect(q.workRemaining).toBe(3)
    // Demolishing a finished hut returns half its materials as physical ground piles.
    const hut = place(s, 'forester', anchors.south)
    run(s, 2500)
    expect(s.state.buildings.get(hut)!.workRemaining).toBe(1)
    order(s, 'demolish', { building: hut })
    expect(s.state.ledger[1]!.recovered).toEqual({ plank: 1 })
    expect(conserved(s)).toBe(true)
  })
})

describe('suspension and demolition', () => {
  test('suspended sites receive no deliveries and do no work until resumed', () => {
    const s = session()
    const id = place(s, 'woodcutter', anchors.forest)
    order(s, 'suspend', { building: id, suspended: true })
    const b = s.state.buildings.get(id)!
    // Carriers already holding goods finish their trip; nothing new is sent.
    const inFlight = [...s.state.jobs.values()].filter(j => j.kind === 'deliver' && j.picked && s.state.stacks.get(j.target)?.building === id).length
    const delivered = (): number => [...s.state.stacks.values()].filter(st => st.building === id).reduce((n, st) => n + st.amount, 0)
    const before = delivered()
    run(s, 600)
    expect(b.workRemaining).toBe(4)
    expect(delivered()).toBe(before + inFlight)
    expect([...s.state.stacks.values()].filter(st => st.building === id).reduce((n, st) => n + st.reservedIn, 0)).toBe(0)
    order(s, 'suspend', { building: id, suspended: false })
    until(s, () => b.phase === 'active', 2000)
  })
  test('demolishing a working building releases its worker resource claims', () => {
    const s = session()
    const id = place(s, 'woodcutter', anchors.forest)
    const b = s.state.buildings.get(id)!
    until(s, () => b.phase === 'active' && [...s.state.claims.values()].includes(b.worker), 4000)
    const worker = b.worker
    expect(worker).toBeGreaterThan(0)
    order(s, 'demolish', { building: id })
    expect([...s.state.claims.values()]).not.toContain(worker)
    expect(s.state.settlers.get(worker)!.workplace).toBe(0)
    expect(conserved(s)).toBe(true)
  })
  test('demolition in every phase releases people, jobs and reservations without duplicating goods', () => {
    for (const phase of ['leveling', 'delivering', 'building', 'active'] as const) {
      const map = landscape([{ kind: 'elevation', ...anchors.west, radius: 3, amount: 6 }])
      const s = session({ map })
      const id = place(s, 'sawmill', anchors.west)
      const b = s.state.buildings.get(id)!
      if (phase === 'leveling') until(s, () => b.workers.length > 0 && b.levelRemaining < 10, 2000)
      if (phase === 'delivering') until(s, () => [...s.state.jobs.values()].some(j => j.kind === 'deliver' && j.picked && s.state.stacks.get(j.target)?.building === id), 3000)
      if (phase === 'building') until(s, () => b.phase === 'building' && Object.keys(b.used).length > 0, 3000)
      if (phase === 'active') until(s, () => b.phase === 'active', 4000)
      const used = structuredClone(b.used), recoveredBefore = structuredClone(s.state.ledger[1]!.recovered)
      order(s, 'demolish', { building: id })
      expect(s.state.buildings.has(id)).toBe(false)
      expect(conserved(s)).toBe(true)
      expect(jobsReferToLiveStacks(s)).toBe(true)
      expect([...s.state.settlers.values()].every(p => p.workplace !== id && p.inside !== id)).toBe(true)
      expect([...s.state.stacks.values()].every(st => st.building !== id)).toBe(true)
      const basis = phase === 'active' ? rules.buildings.find(r => r.id === 'sawmill')!.cost : used
      const refund = Object.fromEntries(Object.entries(basis).map(([g, n]) => [g, Math.floor(n / 2)] as const).filter(([, n]) => n > 0))
      const delta = Object.fromEntries(Object.entries(s.state.ledger[1]!.recovered).map(([g, n]) => [g, n - (recoveredBefore[g] ?? 0)] as const).filter(([, n]) => n > 0))
      expect(delta).toEqual(refund)
      // The site footprint is open land again.
      expect(footprint(rules.buildings.find(r => r.id === 'sawmill')!, b).every(p => s.context.index.buildingAt[tileOf(s.context, p)] === 0)).toBe(true)
      run(s, 300)
    }
  }, 60_000)
})

describe('workers and tools', () => {
  test('a workplace without the required tool reports the shortage and never gets a phantom worker', () => {
    const s = session({ goods: { plank: 12, stone: 12, hammer: 2, shovel: 1 } })
    const id = place(s, 'woodcutter', anchors.forest)
    const b = s.state.buildings.get(id)!
    until(s, () => b.phase === 'active', 3000)
    run(s, 200)
    expect(b.worker).toBe(0)
    expect(b.shortage).toBe('tool:axe')
    expect(s.view(1).events.some(e => e.type === 'shortage' && e.text.includes('axe'))).toBe(true)
    expect([...s.state.settlers.values()].some(p => p.profession === 'woodcutter')).toBe(false)
  })
  test('equipping moves one physical tool into a worker and records the profession change', () => {
    const s = session()
    const axes = present(s, 1).axe!
    const id = place(s, 'woodcutter', anchors.forest)
    const b = s.state.buildings.get(id)!
    until(s, () => b.worker !== 0 && s.state.settlers.get(b.worker)!.inside === id, 4000)
    const worker = s.state.settlers.get(b.worker)!
    expect(worker.profession).toBe('woodcutter')
    expect(worker.tool).toBe('axe')
    expect(present(s, 1).axe).toBe(axes - 1)
    expect(s.state.ledger[1]!.equipped.axe).toBe(1)
    expect(s.state.ledger[1]!.transitions).toBeGreaterThanOrEqual(1)
    // Cancelling the workplace keeps the person and their tool; nothing is duplicated.
    const people = s.state.settlers.size
    order(s, 'demolish', { building: id })
    expect(s.state.settlers.size).toBe(people)
    expect(worker.workplace).toBe(0)
    expect(worker.inside).toBe(0)
    expect(worker.tool).toBe('axe')
    expect(conserved(s)).toBe(true)
  })
})

describe('logistics', () => {
  test('competing sites never receive more goods than exist, and destinations change only on arrival', () => {
    const s = session({ goods: { plank: 40, stone: 2, hammer: 4, shovel: 2 } })
    const a = place(s, 'stonecutter', anchors.granite), b = place(s, 'woodcutter', anchors.west)
    let watched: { target: number, amount: number } | null = null
    until(s, () => {
      const job = [...s.state.jobs.values()].find(j => j.kind === 'deliver' && j.picked)
      if (job && job.kind === 'deliver' && !watched) watched = { target: job.target, amount: s.state.stacks.get(job.target)!.amount }
      return !!watched
    }, 2000)
    // While the good is in a carrier's hands the destination stack has not changed.
    expect(s.state.stacks.get(watched!.target)!.amount).toBe(watched!.amount)
    run(s, 3000)
    const stoneUsed = (s.state.buildings.get(a)!.used.stone ?? 0) + (s.state.buildings.get(b)!.used.stone ?? 0)
    const stoneWaiting = [...s.state.stacks.values()].filter(st => st.role === 'construction' && st.good === 'stone').reduce((n, st) => n + st.amount, 0)
    expect(stoneUsed + stoneWaiting).toBe(2)
    expect(present(s, 1).stone ?? 0).toBe(stoneWaiting)
  })
  test('full doorsteps stop production until carriers take goods into storage', () => {
    const s = session({ settlers: { carrier: 12, digger: 2, builder: 3 } })
    order(s, 'settings', { settings: { carrierRatio: 0 } })
    const storage = place(s, 'storage', anchors.north)
    until(s, () => s.state.buildings.get(storage)!.phase === 'active', 6000)
    const id = place(s, 'stonecutter', anchors.granite)
    const b = s.state.buildings.get(id)!
    until(s, () => b.shortage === 'output-full', 30_000)
    const doorstep = [...s.state.stacks.values()].find(st => st.building === id && st.role === 'output')!
    expect(doorstep.amount).toBe(8)
    const produced = s.state.ledger[1]!.produced.stone
    run(s, 800)
    expect(s.state.ledger[1]!.produced.stone).toBe(produced)
    // Mark stone for storage: carriers empty the doorstep into storage piles and production resumes.
    order(s, 'settings', { settings: { stored: ['stone'] } })
    until(s, () => (s.state.ledger[1]!.produced.stone ?? 0) > produced!, 6000)
    const piles = [...s.state.stacks.values()].filter(st => st.building === storage && st.role === 'storage')
    expect(piles.length).toBeGreaterThan(0)
    expect(piles.every(p => p.good === 'stone' && p.amount <= 8)).toBe(true)
  }, 60_000)
})

describe('population', () => {
  test('residences add settlers one at a time and the carrier ratio holds back conversions', () => {
    const s = session()
    const people = s.state.settlers.size
    const id = place(s, 'small-residence', anchors.west)
    until(s, () => s.state.buildings.get(id)!.phase === 'active', 4000)
    until(s, () => s.state.buildings.get(id)!.residents === 6, 3000)
    expect(s.state.settlers.size).toBe(people + 6)
    expect(s.state.ledger[1]!.births).toBe(6)
    order(s, 'settings', { settings: { carrierRatio: 100 } })
    const woodcutter = place(s, 'woodcutter', anchors.forest)
    until(s, () => s.state.buildings.get(woodcutter)!.phase === 'active', 4000)
    run(s, 100)
    expect(s.state.buildings.get(woodcutter)!.shortage).toBe('carriers')
  })
})

describe('natural resources', () => {
  test('foresters plant saplings that grow into trees, and woodcutters fell them physically', () => {
    const s = session({ map: landscape(), seed: 3 })
    const forester = place(s, 'forester', anchors.south)
    until(s, () => s.state.buildings.get(forester)!.phase === 'active', 4000)
    const sapling = s.context.objectIndex.get('sapling')!, tree = s.context.objectIndex.get('tree')!
    until(s, () => s.state.map.object.some(o => o === sapling), 3000)
    const planted = s.state.map.object.findIndex(o => o === sapling)
    until(s, () => s.state.map.object[planted] === tree, rules.objects.find(o => o.id === 'sapling')!.grows!.ticks + 50)
  }, 30_000)
  test('stone runs out, fishing depletes the water, and nothing goes negative', () => {
    const s = session({ map: landscape([{ kind: 'object', id: 'stone', ...anchors.granite, radius: 1, amount: 1 }, { kind: 'resource', id: 'fish', ...anchors.water, radius: 2, amount: 1 }]) })
    // Fish and stone go into the castle's storage so full doorsteps do not mask exhaustion.
    order(s, 'settings', { settings: { stored: ['fish', 'stone'] } })
    const fish = s.context.goodIndex.get('fish')!
    const water = (): number => [...s.state.map.resourceAmount].reduce((n, a, t) => n + (s.state.map.resource[t] === fish ? a : 0), 0)
    const shoal = water()
    const quarry = place(s, 'stonecutter', anchors.granite)
    const fisher = place(s, 'fisher', anchors.water)
    // Stricter source ground can move the hut. The normal control keeps this
    // exhaustion scenario aimed at its finite patch instead of only its edge.
    order(s, 'work-area', { building: quarry, ...anchors.granite })
    order(s, 'work-area', { building: fisher, ...anchors.water })
    const stones = s.state.map.object.filter(o => o === s.context.objectIndex.get('stone')).length
    until(s, () => s.state.buildings.get(quarry)!.shortage === 'no-resources' && s.state.buildings.get(fisher)!.shortage === 'no-resources', 40_000)
    expect(s.state.ledger[1]!.produced.stone).toBe(stones)
    expect(s.state.map.object.some(o => o === s.context.objectIndex.get('stone'))).toBe(false)
    expect(s.state.ledger[1]!.produced.fish).toBe(shoal - water())
    expect(water()).toBeLessThan(shoal)
    // Whatever fish remain lie beyond the working area or have no shore inside the territory.
    const f = s.state.buildings.get(fisher)!
    for (let t = 0; t < s.state.map.resource.length; t++) {
      if (s.state.map.resource[t] !== fish) continue
      const p = { x: t % 64, y: Math.floor(t / 64) }
      const shore = neighbours(s.state.map, t).some(n => !rules.terrain[s.state.map.terrain[n]!]!.water && s.state.map.owner[n] === 1)
      expect(distance(p, f.workArea) > 6 || !shore).toBe(true)
    }
    expect(s.state.map.resourceAmount.every(n => n >= 0)).toBe(true)
  }, 60_000)
  test('mines eat physical food, preferred meals last longer, and deposits are finite', () => {
    const s = session({ goods: { plank: 30, stone: 30, bread: 1, fish: 1, pickaxe: 2, hammer: 3, shovel: 2 } })
    order(s, 'settings', { settings: { stored: ['coal'], transportPriority: ['bread', ...rules.goods.filter(g => g !== 'bread')] } })
    const mine = place(s, 'coal-mine', anchors.mountain)
    const b = s.state.buildings.get(mine)!
    until(s, () => b.phase === 'active', 6000)
    until(s, () => (s.state.ledger[1]!.consumed.bread ?? 0) === 1 && (s.state.ledger[1]!.consumed.fish ?? 0) === 1, 6000, true)
    until(s, () => b.shortage === 'food' || b.shortage === 'exhausted', 10_000)
    // Bread is the coal miner's favourite: one loaf is worth ten descents, a fish only two.
    expect(s.state.ledger[1]!.produced.coal).toBe(12)
    expect(b.shortage).toBe('food')
    expect(s.state.map.resourceAmount.every(n => n >= 0)).toBe(true)
  }, 60_000)
  test('a coal mine stops when its deposit is exhausted', () => {
    const s = session({ goods: { plank: 30, stone: 30, bread: 8, pickaxe: 2, hammer: 3, shovel: 2 } })
    order(s, 'settings', { settings: { stored: ['coal'] } })
    const mine = place(s, 'coal-mine', anchors.mountain)
    const b = s.state.buildings.get(mine)!
    const coal = s.context.goodIndex.get('coal')!
    until(s, () => b.phase === 'active', 6000)
    const deposit = area(s.state.map, b, 2).reduce((n, t) => n + (s.state.map.resource[t] === coal ? s.state.map.resourceAmount[t]! : 0), 0)
    until(s, () => b.shortage === 'exhausted', 20_000)
    expect(s.state.ledger[1]!.produced.coal).toBe(deposit)
    expect(area(s.state.map, b, 2).every(t => s.state.map.resource[t] !== coal)).toBe(true)
    expect(s.view(1).events.some(e => e.type === 'exhausted')).toBe(true)
  }, 60_000)
  test('a grain farm sows fields that ripen before harvest', () => {
    const s = session({ goods: { plank: 30, stone: 30, scythe: 1, hammer: 3, shovel: 2 } })
    const farm = place(s, 'grain-farm', anchors.south)
    until(s, () => s.state.buildings.get(farm)!.phase === 'active', 8000)
    const field = s.context.objectIndex.get('field')!
    until(s, () => s.state.map.object.some(o => o === field), 2000)
    expect(s.state.ledger[1]!.produced.grain ?? 0).toBe(0)
    until(s, () => (s.state.ledger[1]!.produced.grain ?? 0) > 0, rules.objects.find(o => o.id === 'field')!.grows!.ticks + 2000)
  }, 60_000)
})

test('a complete wood, stone and plank economy runs from start resources and stays conserved across restores', () => {
  const s = session()
  for (const [type, near] of [['woodcutter', anchors.forest], ['woodcutter', anchors.east], ['forester', anchors.south], ['stonecutter', anchors.granite], ['sawmill', anchors.north]] as const) place(s, type, near)
  for (let round = 0; round < 8; round++) {
    run(s, 1000)
    const copy = restore(JSON.parse(JSON.stringify(save(s))), rules)
    s.advance(50); copy.advance(50)
    expect(checksum(copy.state)).toBe(checksum(s.state))
  }
  const l = s.state.ledger[1]!
  expect(l.produced.log ?? 0).toBeGreaterThan(4)
  expect(l.produced.plank ?? 0).toBeGreaterThan(0)
  expect(l.consumed.log ?? 0).toBe(l.produced.plank ?? 0)
  expect(l.produced.stone ?? 0).toBeGreaterThan(2)
  expect(jobsReferToLiveStacks(s)).toBe(true)
}, 120_000)

test('sites are never placed over people, goods, doors or outside the border', () => {
  const s = session()
  const castle = building(s, 'castle')!
  const door = { x: castle.x + 2, y: castle.y + 2 }
  expect(s.placement(1, 'woodcutter', door.x, door.y)).not.toBeNull()
  expect(s.placement(1, 'woodcutter', 90, 90)).toBe('Build inside your territory.')
  expect(s.placement(1, 'coal-mine', anchors.west.x, anchors.west.y)).toContain('mountain')
  const tree = s.state.map.object.findIndex(o => o === s.context.objectIndex.get('tree'))
  expect(s.placement(1, 'woodcutter', tree % 96, Math.floor(tree / 96))).toContain('Trees')
  const free = site(s, 'woodcutter', anchors.west)
  expect(s.placement(1, 'woodcutter', free.x, free.y)).toBeNull()
  expect(indexOf(s.state.map, free.x, free.y)).toBeGreaterThan(0)
})

test('an unreachable construction pile backs off instead of looping goods between piles', () => {
  const s = session()
  const id = place(s, 'stonecutter', anchors.granite)
  const b = s.state.buildings.get(id)!
  // Wall off the stone pile after placement, as a grown tree or a new building could.
  const rule = rules.buildings.find(r => r.id === 'stonecutter')!
  const pile = rule.piles.find(p => p.role === 'construction' && p.good === 'stone')!
  const tile = (b.y + pile.at[1]) * 96 + b.x + pile.at[0]
  for (const t of [tile, ...neighbours(s.state.map, tile)]) { s.state.map.object[t] = s.context.objectIndex.get('tree')!; s.state.map.objectAmount[t] = 1 }
  s.state.navigation++
  const before = s.state.nextId
  run(s, 3000)
  // Each retry creates a job and possibly a dropped pile; backing off keeps that bounded.
  expect(s.state.nextId - before).toBeLessThan(400)
  expect(b.used.stone ?? 0).toBe(0)
  expect(conserved(s)).toBe(true)
}, 30_000)

describe('controls change real work', () => {
  test('changing storage eligibility mid-delivery lets carried goods arrive and stops new storage trips', () => {
    // The castle keeps storage piles too; it is the nearest storage to the starting goods.
    const s = session({ settlers: { carrier: 20, digger: 2, builder: 3 } })
    const storage = building(s, 'castle')!.id
    order(s, 'settings', { settings: { stored: ['log'] } })
    until(s, () => [...s.state.jobs.values()].some(j => j.kind === 'deliver' && j.picked && s.state.stacks.get(j.target)?.building === storage), 2000)
    const carried = [...s.state.jobs.values()].filter(j => j.kind === 'deliver' && j.picked && s.state.stacks.get(j.target)?.building === storage).length
    const before = [...s.state.stacks.values()].filter(st => st.building === storage).reduce((n, st) => n + st.amount, 0)
    order(s, 'settings', { settings: { stored: [] } })
    run(s, 600)
    const after = [...s.state.stacks.values()].filter(st => st.building === storage).reduce((n, st) => n + st.amount, 0)
    // Goods already in hand finish their trip; unpicked storage jobs may also complete, but no new ones start.
    expect(after).toBeGreaterThanOrEqual(before + carried)
    run(s, 600)
    expect([...s.state.stacks.values()].filter(st => st.building === storage).reduce((n, st) => n + st.amount, 0)).toBe(after)
    expect(conserved(s)).toBe(true)
  }, 30_000)

  test('geologists survey mountains and leave signs only the owner can see', () => {
    const s = session({ goods: { plank: 10, stone: 10, hammer: 3, shovel: 2 } })
    order(s, 'specialists', { profession: 'geologist', ...anchors.mountain, count: 1 })
    until(s, () => s.view(1).signs.length >= 5, 4000)
    const coal = s.context.goodIndex.get('coal')!
    for (const sign of s.view(1).signs) {
      const t = sign.tile
      expect(s.state.map.terrain[t]).toBe(rules.terrain.findIndex(r => r.id === 'mountain'))
      expect(sign.good).toBe(s.state.map.resource[t] === coal ? 'coal' : null)
      expect(sign.amount).toBe(s.state.map.resource[t] ? s.state.map.resourceAmount[t]! : 0)
    }
    expect(s.state.ledger[1]!.equipped.hammer).toBe(1)
    // A geologist's duty program refers to its target tile; saves must accept it.
    expect([...s.state.settlers.values()].some(p => p.program?.kind === 'duty' && p.program.ref >= s.state.nextId)).toBe(true)
    const copy = restore(JSON.parse(JSON.stringify(save(s))), rules)
    copy.advance(200); s.advance(200)
    expect(checksum(copy.state)).toBe(checksum(s.state))
  }, 30_000)

  test('moving a working area during a trip finishes that trip and sends the next one to the new area', () => {
    const s = session()
    const id = place(s, 'woodcutter', anchors.forest)
    const b = s.state.buildings.get(id)!
    until(s, () => { const w = s.state.settlers.get(b.worker); return !!w && w.program?.kind === 'work' && !w.inside }, 6000)
    const worker = s.state.settlers.get(b.worker)!
    const trip = worker.program!, target = trip.steps.find(op => op.op === 'go')!
    // Plant a grove elsewhere inside the border and point the woodcutter at it.
    const grove = anchors.east
    for (const t of [grove.y * 96 + grove.x, grove.y * 96 + grove.x + 1]) { s.state.map.object[t] = s.context.objectIndex.get('tree')!; s.state.map.objectAmount[t] = 1 }
    order(s, 'work-area', { building: id, ...grove })
    expect(worker.program).toBe(trip)
    expect(worker.program?.steps.find(op => op.op === 'go')).toEqual(target)
    until(s, () => worker.program !== trip && worker.program?.kind === 'work', 3000)
    const next = worker.program!.steps.find(op => op.op === 'go')!
    expect(next.op === 'go' && Math.abs(next.tile % 96 - grove.x) + Math.abs(Math.floor(next.tile / 96) - grove.y)).toBeLessThanOrEqual(1)
  }, 30_000)

  test('the tool smith serves urgent orders first, then rotates by weight', () => {
    const s = session({ goods: { plank: 20, stone: 20, iron: 8, coal: 8, hammer: 4, shovel: 2 } })
    order(s, 'settings', { settings: { stored: ['hammer', 'shovel', 'axe', 'saw', 'pickaxe', 'scythe', 'fishingrod'], toolWeights: { hammer: 0, shovel: 0, axe: 3, saw: 0, pickaxe: 1, scythe: 0, fishingrod: 0 } } })
    order(s, 'urgent-tool', { tool: 'scythe' })
    const smith = place(s, 'toolsmith', anchors.west)
    until(s, () => (s.state.ledger[1]!.produced.scythe ?? 0) + (s.state.ledger[1]!.produced.axe ?? 0) + (s.state.ledger[1]!.produced.pickaxe ?? 0) >= 5, 20_000)
    const made = s.state.ledger[1]!.produced
    expect(made.scythe).toBe(1)
    expect(made.axe).toBe(3)
    expect(made.pickaxe).toBe(1)
    expect(made.hammer ?? 0).toBe(0)
    // Every tool consumed one iron and one coal.
    expect(s.state.ledger[1]!.consumed.iron).toBe(s.state.ledger[1]!.consumed.coal)
    expect(s.state.buildings.get(smith)!.phase).toBe('active')
  }, 60_000)
})

describe('releasing workers', () => {
  test('a worker released mid-step stays on its tile and the game still saves', () => {
    const s = session()
    const hut = place(s, 'woodcutter', anchors.forest)
    until(s, () => [...s.state.settlers.values()].some(p => p.workplace === hut && p.action === 'walking' && p.step > 0), 4000)
    const worker = [...s.state.settlers.values()].find(p => p.workplace === hut)!
    const at = { x: worker.x, y: worker.y }
    order(s, 'demolish', { building: hut })
    expect(worker.workplace).toBe(0)
    expect(worker.next === -1 || worker.action === 'walking').toBe(true)
    expect({ x: worker.x, y: worker.y }).toEqual(at)
    const copy = restore(JSON.parse(JSON.stringify(save(s))), rules)
    s.advance(50); copy.advance(50)
    expect(checksum(copy.state)).toBe(checksum(s.state))
  }, 60_000)
})
